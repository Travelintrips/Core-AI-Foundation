import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  const cats = await client.query(
    `SELECT name, visibility, is_active FROM ai_platform.ai_service_categories ORDER BY name`
  );
  const svcs = await client.query(
    `SELECT count(*) as cnt FROM ai_platform.ai_services`
  );
  console.log(`Categories: ${cats.rows.length}`);
  for (const r of cats.rows) {
    console.log(`  [${r.visibility}] ${r.name} (active=${r.is_active})`);
  }
  console.log(`\nServices total: ${svcs.rows[0].cnt}`);
} finally {
  client.release();
  await pool.end();
}
