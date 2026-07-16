import { pool } from "@workspace/db";

const client = await pool.connect();
try {
  // List schemas
  const schemas = await client.query(
    `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`
  );
  console.log("=== SCHEMAS ===");
  console.log(schemas.rows.map((r: any) => r.schema_name).join(', '));

  // List tables in ai_platform schema if exists
  const tables = await client.query(
    `SELECT table_schema, table_name 
     FROM information_schema.tables 
     WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
     ORDER BY table_schema, table_name`
  );
  console.log("\n=== TABLES ===");
  for (const r of tables.rows) {
    console.log(`  ${r.table_schema}.${r.table_name}`);
  }
} finally {
  client.release();
  await pool.end();
}
