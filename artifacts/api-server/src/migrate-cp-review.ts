/**
 * migrate-cp-review.ts — Apply Company Profile V4.2C DDL.
 * Creates cp_document_versions and cp_page_comments tables if they don't exist.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server tsx src/migrate-cp-review.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "@workspace/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
async function migrate() {
  const sqlPath = join(__dirname, "scripts", "ddl-cp-review.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  console.log("[migrate-cp-review] Running DDL…");
  try {
    await db.execute(sql as any);
    console.log("[migrate-cp-review] ✓ cp_document_versions created/verified");
    console.log("[migrate-cp-review] ✓ cp_page_comments created/verified");
    console.log("[migrate-cp-review] Done.");
  } catch (err) {
    console.error("[migrate-cp-review] ✗ Failed:", err);
    process.exit(1);
  }
}

migrate();
