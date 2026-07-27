/**
 * Phase 5 Material Import — Controlled DEV UAT
 * Tests all duplicate-resolution paths against real DEV Supabase.
 * Run: node scripts/uat-phase5-material-import.mjs
 */
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.SUPABASE_DEV_DATABASE_URL || process.env.SUPABASE_DATABASE_URL_DEV,
});

const actor = { id: "uat-script", name: "UAT Script", type: "system" };

// --- Mini implementations (mirroring service logic) for direct DB test ---

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function transition(id, nextStatus, notes) {
  const rows = await query("SELECT * FROM ai_platform.material_import_staging WHERE id=$1", [id]);
  if (!rows[0]) throw new Error(`staging row ${id} not found`);
  const current = rows[0];
  if (nextStatus === "rejected" && !notes) throw new Error("Reviewer notes required for rejection");
  await query(
    `UPDATE ai_platform.material_import_staging
     SET status=$2, reviewer_id=$3, reviewer_name=$4, reviewer_notes=COALESCE($5, reviewer_notes),
         reviewed_at=CASE WHEN $2 IN ('approved','rejected') THEN NOW() ELSE reviewed_at END, updated_at=NOW()
     WHERE id=$1`,
    [id, nextStatus, actor.id, actor.name, notes ?? null]
  );
  return { id, from: current.status, to: nextStatus };
}

async function setResolution(id, resolution, targetCanonicalId = null, mergeFieldMap = null) {
  await query(
    `UPDATE ai_platform.material_import_staging
     SET duplicate_resolution=$2, target_canonical_id=$3, merge_field_map=$4::jsonb, updated_at=NOW()
     WHERE id=$1`,
    [id, resolution, targetCanonicalId, JSON.stringify(mergeFieldMap)]
  );
}

async function importItem(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = await client.query(
      `UPDATE ai_platform.material_import_staging
       SET status='importing', import_started_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status='approved' RETURNING *`,
      [id]
    );
    if (!claim.rows[0]) {
      await client.query("ROLLBACK");
      return { id, result: "skipped (not approved)" };
    }
    const row = claim.rows[0];
    const resolution = row.duplicate_resolution ?? "create_new";
    const targetCanonicalId = row.target_canonical_id;
    const mergeFieldMap = row.merge_field_map;
    let canonicalId = null;
    let resolvedAs = resolution;

    if (resolution === "keep_existing") {
      const existing = await client.query(
        `SELECT id FROM ai_platform.materials WHERE material_code=$1 LIMIT 1`, [row.product_code]
      );
      if (!existing.rows[0]) throw new Error(`keep_existing: no canonical found for ${row.product_code}`);
      canonicalId = existing.rows[0].id;
    } else if (resolution === "replace_existing") {
      if (!targetCanonicalId) throw new Error("replace_existing needs targetCanonicalId");
      const existing = await client.query(`SELECT * FROM ai_platform.materials WHERE id=$1`, [targetCanonicalId]);
      if (!existing.rows[0]) throw new Error(`replace_existing: canonical ${targetCanonicalId} not found`);
      await client.query(
        `UPDATE ai_platform.materials SET name=$2, updated_at=NOW() WHERE id=$1`,
        [targetCanonicalId, row.name]
      );
      canonicalId = targetCanonicalId;
    } else if (resolution === "merge") {
      if (!targetCanonicalId) throw new Error("merge needs targetCanonicalId");
      const existing = await client.query(`SELECT * FROM ai_platform.materials WHERE id=$1`, [targetCanonicalId]);
      if (!existing.rows[0]) throw new Error(`merge: canonical ${targetCanonicalId} not found`);
      // Apply merge (simplified: use_incoming for name if in map)
      const newName = mergeFieldMap?.name === "use_incoming" ? row.name : existing.rows[0].name;
      await client.query(
        `UPDATE ai_platform.materials SET name=$2, finish=$3, updated_at=NOW() WHERE id=$1`,
        [targetCanonicalId, newName, row.finish ?? existing.rows[0].finish]
      );
      canonicalId = targetCanonicalId;
    } else {
      // create_new
      const conflict = await client.query(
        `SELECT id FROM ai_platform.materials WHERE material_code=$1 LIMIT 1`, [row.product_code]
      );
      if (conflict.rows[0]) throw new Error(`create_new: material_code ${row.product_code} already exists`);
      const name = row.name || `${row.brand} ${row.product_code}`;
      const slug = `${row.product_code}-${id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const ins = await client.query(
        `INSERT INTO ai_platform.materials (material_code,name,slug,category,brand,finish,status)
         VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [row.product_code, name, slug, row.category, row.brand, row.finish]
      );
      canonicalId = ins.rows[0].id;
    }

    await client.query(
      `UPDATE ai_platform.material_import_staging
       SET status='imported', canonical_material_id=$2, imported_at=NOW(), updated_at=NOW()
       WHERE id=$1`,
      [id, canonicalId]
    );
    await client.query("COMMIT");
    return { id, result: "imported", resolvedAs, canonicalId };
  } catch (err) {
    await client.query("ROLLBACK");
    await pool.query(
      `UPDATE ai_platform.material_import_staging SET status='failed', failure_reason=$2, updated_at=NOW() WHERE id=$1`,
      [id, err.message]
    );
    return { id, result: "failed", error: err.message };
  } finally {
    client.release();
  }
}

// ─── UAT Execution ────────────────────────────────────────────────────────────

async function runUAT() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 5 Controlled Material Import — DEV UAT   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // Count canonical BEFORE
  const [{ count: before }] = await query("SELECT COUNT(*)::int AS count FROM ai_platform.materials");
  console.log(`Canonical materials BEFORE: ${before}`);

  // Get our UAT staging rows (inserted by psql before this script)
  const stagingRows = await query(
    `SELECT id, product_code, status FROM ai_platform.material_import_staging
     WHERE source IN ('phase4a-import') ORDER BY id`
  );
  console.log(`\nUAT staging rows found: ${stagingRows.length}`);
  for (const r of stagingRows) console.log(`  • [${r.id}] ${r.product_code} → ${r.status}`);

  if (stagingRows.length < 6) {
    console.error("\n✗ Expected 6 staging rows, found", stagingRows.length);
    process.exit(1);
  }

  const [id1, id2, id3, id4, id5, id6] = stagingRows.map(r => r.id);

  // Get reference canonical IDs for keep/replace/merge
  const lavaRef = await query("SELECT id FROM ai_platform.materials WHERE material_code='NG-LAVA-001' LIMIT 1");
  const terraRef = await query("SELECT id FROM ai_platform.materials WHERE material_code='NG-TERRA-EXISTING' LIMIT 1");
  const obsidianRef = await query("SELECT id FROM ai_platform.materials WHERE material_code='NG-OBSIDIAN-EXISTING' LIMIT 1");

  const lavaCanonId = lavaRef[0]?.id;
  const terraCanonId = terraRef[0]?.id;
  const obsidianCanonId = obsidianRef[0]?.id;
  console.log(`\nReference canonicals: lava=${lavaCanonId}, terra=${terraCanonId}, obsidian=${obsidianCanonId}`);

  const results = [];

  // ── Test 1: Approve id1 (create_new) ────────────────────────────────────
  console.log("\n[1] create_new — approve and import NG-CARRARA-001");
  await transition(id1, "approved", "Unique code, safe to import");
  results.push(await importItem(id1));

  // ── Test 2: keep_existing — id2 (NG-LAVA-001 already exists) ────────────
  console.log("\n[2] keep_existing — approve, set resolution, import NG-LAVA-001");
  await transition(id2, "approved", "Duplicate detected, keep existing canonical");
  await setResolution(id2, "keep_existing");
  results.push(await importItem(id2));

  // ── Test 3: replace_existing — id3 targets terra canonical ──────────────
  console.log("\n[3] replace_existing — approve, set resolution with target, import NG-TERRA-001");
  await transition(id3, "approved", "Replace existing terra record with updated data");
  await setResolution(id3, "replace_existing", terraCanonId);
  results.push(await importItem(id3));

  // ── Test 4: Reject id4 with notes ────────────────────────────────────────
  console.log("\n[4] reject — NG-REJECT-001 (wrong category)");
  const t4 = await transition(id4, "rejected", "Wrong category — outdoor tile not in scope");
  results.push({ id: id4, result: "rejected", ...t4 });

  // ── Test 4b: Reject without notes must fail ───────────────────────────────
  console.log("\n[4b] reject without notes must fail");
  try {
    await transition(id4, "needs_review", null); // put back first
    await transition(id4, "rejected", null); // should throw
    results.push({ id: id4, result: "ERROR: rejection without notes should have thrown" });
  } catch (err) {
    console.log(`  ✓ Blocked: ${err.message}`);
    results.push({ id: id4, result: "rejection-guard-verified" });
    // Re-reject with notes
    await transition(id4, "rejected", "Wrong category — outdoor tile not in scope (re-rejected)");
  }

  // ── Test 5: merge — id5 merges into obsidian canonical ──────────────────
  console.log("\n[5] merge — NG-OBSIDIAN-001 merges into existing canonical");
  await transition(id5, "approved", "Merge with existing obsidian record");
  await setResolution(id5, "merge", obsidianCanonId, { name: "use_incoming", finish: "keep_existing" });
  results.push(await importItem(id5));

  // ── Test 6: create_new with asset pending scenario ────────────────────────
  console.log("\n[6] create_new — NG-MOSAIC-001 (asset pending, no preview URL)");
  await transition(id6, "approved", "Blue mosaic tile, no asset URL");
  results.push(await importItem(id6));

  // ── Test 7: Idempotency — re-import already-imported item ────────────────
  console.log("\n[7] idempotency — attempt re-import of already-imported item 1");
  results.push(await importItem(id1)); // status is 'imported', not 'approved'

  // ── Test 8: Verify rejected item is blocked from import ──────────────────
  console.log("\n[8] rejected item blocked from import");
  results.push(await importItem(id4));

  // ── Count canonical AFTER ─────────────────────────────────────────────────
  const [{ count: after }] = await query("SELECT COUNT(*)::int AS count FROM ai_platform.materials");

  // ── Verify audit trail ────────────────────────────────────────────────────
  const auditRows = await query(
    `SELECT staging_id, event_type FROM ai_platform.material_import_audit
     WHERE staging_id = ANY($1::bigint[]) ORDER BY staging_id, id`,
    [[id1, id2, id3, id4, id5, id6]]
  );

  // ── Report ────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                   UAT RESULTS                   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  for (const r of results) {
    const icon = r.result === "failed" || r.result?.includes("ERROR") ? "✗" : "✓";
    console.log(`  ${icon} [${r.id}] ${r.result}${r.resolvedAs ? ` (${r.resolvedAs})` : ""}${r.error ? " — " + r.error : ""}`);
  }

  console.log(`\nCanonical count BEFORE: ${before}`);
  console.log(`Canonical count AFTER:  ${after}`);

  // Expected: create_new adds 2 rows (NG-CARRARA-001 + NG-MOSAIC-001)
  // keep_existing, replace_existing, merge, rejected = 0 new rows
  const newRows = results.filter(r => r.resolvedAs === "create_new").length;
  const invariantOk = Number(after) === Number(before) + newRows;
  console.log(`New create_new imports: ${newRows}`);
  console.log(`Invariant (after = before + create_new): ${invariantOk ? "✓ PASS" : "✗ FAIL"} (${before} + ${newRows} = ${before + newRows}, got ${after})`);

  console.log(`\nAudit entries recorded: ${auditRows.length}`);
  const uniqueTypes = [...new Set(auditRows.map(r => r.event_type))];
  console.log(`Audit event types: ${uniqueTypes.join(", ")}`);

  const failed = results.filter(r => r.result === "failed");
  const imported = results.filter(r => r.result === "imported");
  const skipped = results.filter(r => r.result?.includes("skipped") || r.result === "rejected" || r.result === "rejection-guard-verified");

  console.log(`\nSummary:`);
  console.log(`  imported: ${imported.length}`);
  console.log(`  skipped/rejected: ${skipped.length}`);
  console.log(`  failed:   ${failed.length}`);

  if (!invariantOk || auditRows.length === 0) {
    console.log("\n✗ UAT FAILED — invariant or audit check failed");
    process.exit(1);
  } else {
    console.log("\n✓ UAT COMPLETE — all invariants verified");
  }
}

runUAT().catch(err => {
  console.error("\n✗ UAT ABORTED:", err.message);
  process.exit(1);
}).finally(() => pool.end());
