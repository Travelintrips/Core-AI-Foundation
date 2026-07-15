/**
 * Lists all tables in ai_platform schema for either dev or prod
 * Usage: NODE_ENV=production npx tsx src/scripts/diffSchemas.ts
 */
import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  const res = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'ai_platform'
     ORDER BY table_name`
  );
  const tables = res.rows.map((r: any) => r.table_name);
  console.log(`ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Count: ${tables.length}`);
  console.log(tables.join('\n'));
} finally {
  client.release();
  await pool.end();
}
