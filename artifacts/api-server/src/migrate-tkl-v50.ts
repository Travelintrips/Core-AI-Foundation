/**
 * migrate-tkl-v50.ts — DDL for Enterprise Template Knowledge Library V5.0
 *
 * Creates: ai_style_knowledge, ai_industry_knowledge, ai_template_sections,
 *          ai_template_knowledge, ai_generated_templates
 *
 * Idempotent — uses IF NOT EXISTS. Safe to re-run.
 * Run: pnpm --filter @workspace/api-server run migrate:tkl-v50
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { pool } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(__dirname, "../../../integration/migrations/tkl-v50.sql");
const DDL = readFileSync(sqlPath, "utf8");

async function run() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log("✅ TKL V5.0 migration completed successfully");
  } catch (err) {
    console.error("❌ Migration failed:", (err as Error).message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

void run();
