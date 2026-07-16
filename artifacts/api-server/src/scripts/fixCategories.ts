/**
 * Sets ALL ai_service_categories to visibility = 'public'
 * so they appear in the customer portal public catalog.
 */
import { pool } from "@workspace/db";

const client = await pool.connect();

try {
  // Show current state
  const before = await client.query(
    `SELECT id, code, name, visibility FROM ai_platform.ai_service_categories ORDER BY id`
  );
  console.log(`\n=== Current categories (${before.rowCount}) ===`);
  for (const r of before.rows) {
    console.log(`  [${r.id}] ${r.code} — "${r.name}" → visibility: ${r.visibility}`);
  }

  // Set all to public
  const updated = await client.query(
    `UPDATE ai_platform.ai_service_categories
     SET visibility = 'public'
     WHERE visibility != 'public' OR visibility IS NULL
     RETURNING id, code, name`
  );
  console.log(`\n✅ Updated ${updated.rowCount} categories to visibility='public':`);
  for (const r of updated.rows) {
    console.log(`  [${r.id}] ${r.code} — "${r.name}"`);
  }

  // Verify
  const after = await client.query(
    `SELECT COUNT(*) AS n FROM ai_platform.ai_service_categories WHERE visibility = 'public'`
  );
  const total = await client.query(
    `SELECT COUNT(*) AS n FROM ai_platform.ai_service_categories`
  );
  console.log(`\n📊 ${after.rows[0].n}/${total.rows[0].n} categories now public`);

} finally {
  client.release();
  await pool.end();
}
console.log("\n✔ Done.");
