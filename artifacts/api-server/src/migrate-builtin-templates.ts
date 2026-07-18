/**
 * migrate-builtin-templates.ts
 * Adds canvas_state, canvas_width, canvas_height, tags columns to ai_platform.ai_templates
 * Run: pnpm --filter @workspace/api-server run migrate:builtin-templates
 */

import { pool } from "@workspace/db";

async function run() {
  console.log("Adding canvas columns to ai_platform.ai_templates…");

  await pool.query(`
    ALTER TABLE ai_platform.ai_templates
      ADD COLUMN IF NOT EXISTS canvas_state   jsonb,
      ADD COLUMN IF NOT EXISTS canvas_width   integer,
      ADD COLUMN IF NOT EXISTS canvas_height  integer,
      ADD COLUMN IF NOT EXISTS tags           jsonb;
  `);

  console.log("✅ Columns added (or already exist).");
  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
