/**
 * Fix production database:
 * 1. Set all ai_service_categories visibility = 'public'
 * 2. Add missing columns deleted_at, archived_at to ai_service_requests
 */
import { pool } from "@workspace/db";

const client = await pool.connect();

try {
  // 1. Check categories
  const before = await client.query(
    `SELECT name, visibility FROM ai_platform.ai_service_categories ORDER BY name`
  );
  console.log("=== BEFORE (categories) ===");
  for (const r of before.rows) {
    console.log(`  ${r.visibility.padEnd(10)} ${r.name}`);
  }

  // 2. Fix visibility
  const upd = await client.query(
    `UPDATE ai_platform.ai_service_categories
     SET visibility = 'public'
     WHERE visibility != 'public'
     RETURNING name`
  );
  console.log(`\n✅ Updated ${upd.rowCount} categories to visibility='public'`);
  if (upd.rowCount && upd.rowCount > 0) {
    for (const r of upd.rows) console.log(`  → ${r.name}`);
  }

  // 3. Add missing columns
  await client.query(`
    ALTER TABLE ai_platform.ai_service_requests
      ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
  `);
  console.log("\n✅ Ensured deleted_at, archived_at exist on ai_service_requests");

  // 4. Verify
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'ai_platform'
       AND table_name   = 'ai_service_requests'
       AND column_name  IN ('deleted_at','archived_at')`
  );
  console.log(`\n✅ Verified columns: ${cols.rows.map((r: any) => r.column_name).join(', ')}`);

} finally {
  client.release();
  await pool.end();
}
