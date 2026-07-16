/**
 * Adds columns that exist in the Drizzle schema but are missing from the DB:
 *   - ai_service_requests.deleted_at
 *   - ai_service_requests.archived_at
 */
import { pool } from "@workspace/db";

const client = await pool.connect();

try {
  await client.query(`
    ALTER TABLE ai_platform.ai_service_requests
      ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ
  `);
  console.log("✅ Added deleted_at, archived_at to ai_service_requests");

  // Verify
  const r = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'ai_platform'
      AND table_name   = 'ai_service_requests'
      AND column_name IN ('deleted_at','archived_at')
    ORDER BY column_name
  `);
  console.log("   Confirmed columns:", r.rows.map(x => x.column_name).join(", "));

} finally {
  client.release();
  await pool.end();
}
console.log("✔ Done.");
