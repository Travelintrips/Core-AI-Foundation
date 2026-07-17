import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DEV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tables = ['ai_service_requests','ai_quotations','ai_quotation_items','ai_invoices','ai_payment_schedule','ai_commercial_gates'];
for (const t of tables) {
  const r = await pool.query('SELECT COUNT(*) FROM ai_platform.' + t);
  console.log(t + ': ' + r.rows[0].count + ' rows');
}
await pool.end();
