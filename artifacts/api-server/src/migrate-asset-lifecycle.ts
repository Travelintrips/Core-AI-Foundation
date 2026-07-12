/**
 * migrate-asset-lifecycle.ts — Run once to apply Sprint P2.1.1 DDL
 * (background archiving / asset lifecycle columns on ai_portfolio_assets).
 * Usage: pnpm --filter @workspace/api-server tsx src/migrate-asset-lifecycle.ts
 */
import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DDL = readFileSync(join(__dirname, "scripts/ddl-asset-lifecycle.sql"), "utf-8");

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("🚀 Running Sprint P2.1.1 asset-lifecycle DDL migration...");
    await client.query(DDL);
    console.log("✅ Migration complete — asset lifecycle columns applied successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
