#!/usr/bin/env tsx
/**
 * Bulk Interior Design Asset Enrichment Script
 *
 * Fetches images for Interior Design items (materials, furniture, lighting, space_plan)
 * that do not yet have a thumbnail_url in id_interior_asset_images.
 *
 * Requires PEXELS_API_KEY environment variable.
 *
 * Usage:
 *   pnpm run enrich:interior-assets
 *   pnpm run enrich:interior-assets -- --type=materials --limit=50 --dry-run
 *
 * Flags:
 *   --type=materials|furniture|lighting|space_plan  (default: all)
 *   --limit=N                                        (default: 100)
 *   --dry-run                                        (no writes)
 *   --force                                          (re-enrich items that already have images)
 *   --project=<uuid>                                 (restrict to one project)
 */

import pg from "pg";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

// ── CLI argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getFlag(name: string): string | undefined {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.split("=").slice(1).join("=") : undefined;
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const TYPE_MAP: Record<string, string> = {
  materials:  "material",
  furniture:  "furniture",
  lighting:   "lighting",
  "space-plans": "space_plan",
  "space_plan":  "space_plan",
  material:   "material",
};

const typeArg = getFlag("type");
const filterType  = typeArg ? (TYPE_MAP[typeArg] ?? typeArg) : null;
const limitArg    = parseInt(getFlag("limit") ?? "100", 10);
const limit       = isNaN(limitArg) ? 100 : limitArg;
const dryRun      = hasFlag("dry-run");
const force       = hasFlag("force") || getFlag("force") === "true";
const projectUuidArg = getFlag("project");

// ── DB connection ──────────────────────────────────────────────────────────────

const dbUrl = process.env["SUPABASE_DEV_DATABASE_URL"]
  ?? process.env["SUPABASE_DATABASE_URL_DEV"]
  ?? process.env["SUPABASE_DATABASE_URL"];

if (!dbUrl) {
  console.error("ERROR: No database URL found. Set SUPABASE_DEV_DATABASE_URL.");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

// ── Log file ───────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir    = path.resolve(__dirname, "../../logs");
const logFile   = path.join(logDir, `enrich-interior-assets-${Date.now()}.log`);

const logLines: string[] = [];
function log(line: string): void {
  console.log(line);
  logLines.push(`${new Date().toISOString()} ${line}`);
}

// ── Pexels helpers (inline — no import from api-server to keep script standalone) ──

const PEXELS_API_KEY = process.env["PEXELS_API_KEY"];

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === maxAttempts) {
        log(`  WARN ${label} failed after ${maxAttempts} attempts: ${msg}`);
        return null;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      log(`  WARN ${label} attempt ${attempt} failed (${msg}), retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

async function searchPexels(query: string): Promise<{ id: number; url: string; photographer: string; src: { medium: string } } | null> {
  if (!PEXELS_API_KEY) return null;
  return withRetry(async () => {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=square`,
      { headers: { Authorization: PEXELS_API_KEY! }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`Pexels HTTP ${res.status} for "${query}"`);
    const data = await res.json() as { photos: Array<{ id: number; url: string; photographer: string; src: { medium: string } }> };
    return data.photos[0] ?? null;
  }, `searchPexels("${query.slice(0, 40)}")`);
}

function buildQuery(itemType: string, item: Record<string, unknown>): string {
  const parts: string[] = [];
  switch (itemType) {
    case "material":
      if (item["color"]) parts.push(String(item["color"]));
      if (item["materialType"]) parts.push(String(item["materialType"]));
      parts.push("texture close-up");
      break;
    case "furniture":
      if (item["item"]) parts.push(String(item["item"]));
      parts.push("furniture product white background");
      break;
    case "lighting":
      parts.push(String(item["lightingType"] ?? item["fixtureType"] ?? "light fixture"));
      parts.push("lamp fixture");
      break;
    case "space_plan":
      parts.push(String(item["name"] ?? item["zone"] ?? "room"));
      parts.push("floor plan top view layout");
      break;
  }
  return parts.filter(Boolean).join(" ").slice(0, 120);
}

// ── Supabase upload (standalone) ───────────────────────────────────────────────

const isDev = process.env["NODE_ENV"] !== "production";
const SUPABASE_URL = isDev
  ? (process.env["SUPABASE_URL_DEV"] ?? "")
  : (process.env["SUPABASE_URL"] ?? "");
const SUPABASE_KEY = isDev
  ? (process.env["SUPABASE_SERVICE_ROLE_KEY_DEV"] ?? "")
  : (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "");
const BUCKET = "interior-assets";

const FOLDER_MAP: Record<string, string> = {
  material: "materials", furniture: "furniture", lighting: "lighting", space_plan: "space-plans",
};

async function ensureBucket(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
  });
  if (!res.ok) return;
  const buckets = await res.json() as Array<{ name: string }>;
  if (buckets.some((b) => b.name === BUCKET)) return;
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
}

async function uploadBuffer(storagePath: string, buffer: Buffer, contentType: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY,
      "Content-Type": contentType, "x-upsert": "true",
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Creative-AI-Studio/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error(`Not an image: ${contentType}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength < 1024) throw new Error(`File too small (${buffer.byteLength} bytes)`);
    return { buffer, contentType };
  }, `downloadImage(${url.slice(-50)})`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("=== Interior Design Asset Enrichment ===");
  log(`dry-run: ${dryRun}, force: ${force}, type: ${filterType ?? "all"}, limit: ${limit}`);
  if (!PEXELS_API_KEY) log("WARN: PEXELS_API_KEY not set — search will return no results");
  if (!SUPABASE_URL || !SUPABASE_KEY) log("WARN: Supabase credentials not set — uploads will be skipped");

  if (!dryRun && SUPABASE_URL && SUPABASE_KEY) await ensureBucket();

  // Pull all concept drafts (optionally filtered by project)
  const draftQuery = projectUuidArg
    ? `SELECT id, project_uuid, materials_draft, furniture_draft, lighting_draft, space_plan_draft
       FROM ai_platform.id_concept_drafts WHERE project_uuid = $1`
    : `SELECT id, project_uuid, materials_draft, furniture_draft, lighting_draft, space_plan_draft
       FROM ai_platform.id_concept_drafts`;
  const draftRes = await pool.query(draftQuery, projectUuidArg ? [projectUuidArg] : []);
  log(`Found ${draftRes.rows.length} concept draft(s)`);

  // Fetch existing image records to skip already-enriched items
  const existingRes = await pool.query<{ project_uuid: string; item_type: string; item_id: string; is_manual_upload: boolean; thumbnail_url: string | null }>(
    `SELECT project_uuid, item_type, item_id, is_manual_upload, thumbnail_url
     FROM ai_platform.id_interior_asset_images`,
  );
  const existingSet = new Set(
    existingRes.rows.map((r) => `${r.project_uuid}:${r.item_type}:${r.item_id}`),
  );
  const manualSet = new Set(
    existingRes.rows.filter((r) => r.is_manual_upload).map((r) => `${r.project_uuid}:${r.item_type}:${r.item_id}`),
  );
  const enrichedSet = new Set(
    existingRes.rows.filter((r) => r.thumbnail_url).map((r) => `${r.project_uuid}:${r.item_type}:${r.item_id}`),
  );

  type WorkItem = {
    projectUuid: string;
    itemType: string;
    itemId: string;
    data: Record<string, unknown>;
  };

  // Collect all work items
  const workQueue: WorkItem[] = [];
  for (const draft of draftRes.rows as Array<Record<string, unknown>>) {
    const projectUuid = draft["project_uuid"] as string;

    const typeMap: Array<[string, unknown]> = [
      ["material",   draft["materials_draft"]],
      ["furniture",  draft["furniture_draft"]],
      ["lighting",   draft["lighting_draft"]],
      ["space_plan", draft["space_plan_draft"]],
    ];

    for (const [itemType, raw] of typeMap) {
      if (filterType && filterType !== itemType) continue;

      const items: Array<Record<string, unknown>> = Array.isArray((raw as Record<string,unknown>)?.["items"])
        ? (raw as Record<string,unknown>)["items"] as Array<Record<string,unknown>>
        : Array.isArray(raw) ? raw as Array<Record<string,unknown>> : [];

      for (const item of items) {
        const itemId = String(item["id"] ?? "");
        if (!itemId) continue;
        const key = `${projectUuid}:${itemType}:${itemId}`;
        if (manualSet.has(key)) continue;          // never overwrite manual
        if (!force && enrichedSet.has(key)) continue; // already has image, skip
        workQueue.push({ projectUuid, itemType, itemId, data: item });
      }
    }
  }

  log(`Work queue: ${workQueue.length} item(s) to enrich (limit: ${limit})`);

  const batch = workQueue.slice(0, limit);
  let enriched = 0, skipped = 0, failed = 0, noResults = 0;
  const results: Array<{ itemId: string; itemType: string; status: string; error?: string }> = [];

  for (const work of batch) {
    const { projectUuid, itemType, itemId, data } = work;
    const query = buildQuery(itemType, data);
    log(`  [${itemType}:${itemId.slice(0,8)}] query: "${query}"`);

    const photo = await searchPexels(query);
    if (!photo) {
      noResults++;
      results.push({ itemId, itemType, status: PEXELS_API_KEY ? "no_results" : "no_key" });
      log(`    → no results`);
      continue;
    }

    if (dryRun) {
      log(`    [dry-run] would upload: ${photo.src.medium}`);
      enriched++;
      results.push({ itemId, itemType, status: "enriched(dry-run)" });
      continue;
    }

    // Download + upload
    const img = await downloadImage(photo.src.medium);
    if (!img) {
      failed++;
      results.push({ itemId, itemType, status: "error", error: "download failed" });
      log(`    → download failed`);
      continue;
    }

    const folder = FOLDER_MAP[itemType] ?? "misc";
    const ext = img.contentType.includes("webp") ? "webp" : img.contentType.includes("png") ? "png" : "jpg";
    const storagePath = `${folder}/${projectUuid}/${itemId}-${photo.id}.${ext}`;

    try {
      const thumbnailUrl = SUPABASE_URL && SUPABASE_KEY
        ? await uploadBuffer(storagePath, img.buffer, img.contentType)
        : `[no-supabase] ${photo.src.medium}`;

      await pool.query(
        `INSERT INTO ai_platform.id_interior_asset_images
           (project_uuid, item_type, item_id, thumbnail_url, image_url, image_alt,
            image_source, image_source_url, image_license, image_attribution,
            is_manual_upload, storage_path, mime_type, file_size_bytes, image_updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
         ON CONFLICT (project_uuid, item_type, item_id) DO UPDATE SET
           thumbnail_url=$4, image_url=$5, image_alt=$6, image_source=$7,
           image_source_url=$8, image_license=$9, image_attribution=$10,
           is_manual_upload=FALSE, storage_path=$12, mime_type=$13,
           file_size_bytes=$14, image_updated_at=NOW(), updated_at=NOW()`,
        [
          projectUuid, itemType, itemId,
          thumbnailUrl, thumbnailUrl,
          photo.url.includes("?") ? photo.url.split("?")[0] : photo.url,
          "pexels", photo.url, "Pexels License", photo.photographer,
          false, storagePath, img.contentType, img.buffer.byteLength,
        ],
      );

      enriched++;
      results.push({ itemId, itemType, status: "enriched" });
      log(`    ✓ uploaded ${thumbnailUrl.slice(-60)}`);

      // Rate limit: 200 req/min for Pexels free
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ itemId, itemType, status: "error", error: msg });
      log(`    ✗ ${msg}`);
    }
  }

  log("=== Summary ===");
  log(`enriched: ${enriched}, no_results: ${noResults}, failed: ${failed}, skipped: ${skipped}`);
  log(`total processed: ${batch.length} of ${workQueue.length} queued`);

  // Write log
  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(logFile, logLines.join("\n") + "\n");
    log(`Log written to ${logFile}`);
  } catch {
    // non-fatal
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
