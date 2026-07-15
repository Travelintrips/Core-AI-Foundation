import { Pool } from 'pg';

async function main() {
  const pool = new Pool({
    connectionString: process.env.SUPABASE_PROD_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // Check categories visibility
  const cats = await pool.query(
    `SELECT name, visibility, is_active FROM ai_platform.ai_service_categories ORDER BY name`
  );
  console.log('=== CATEGORIES ===');
  console.log(JSON.stringify(cats.rows, null, 2));

  // Check missing columns on ai_service_requests
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'ai_platform' AND table_name = 'ai_service_requests'
     AND column_name IN ('deleted_at','archived_at')`
  );
  console.log('=== MISSING COLUMNS CHECK ===');
  console.log(JSON.stringify(cols.rows, null, 2));

  await pool.end();
}

main().catch(console.error);
