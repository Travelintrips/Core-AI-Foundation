import { pool } from "@workspace/db";
const client = await pool.connect();
const r = await client.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'ai_platform' AND table_name = 'ai_service_requests'
  ORDER BY ordinal_position
`);
console.log("DB columns:");
for (const row of r.rows) {
  console.log(`  ${row.column_name} (${row.data_type}, nullable=${row.is_nullable})`);
}
client.release();
await pool.end();
