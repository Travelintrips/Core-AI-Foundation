import { pool } from "@workspace/db";
async function main() {
  const client = await pool.connect();
  const res = await client.query(`
    SELECT asp.id, asp.title, asp.cover_image, s.service_code
    FROM ai_service_portfolios asp
    JOIN ai_services s ON s.id = asp.service_id
    ORDER BY s.service_code, asp.display_order
  `);
  for (const r of res.rows) {
    const t = r.cover_image?.startsWith("data:") ? "SVG" :
              r.cover_image?.includes("unsplash") ? "UNSPLASH" : "OTHER";
    console.log(`${t}|${r.service_code}|${r.title}`);
  }
  client.release(); await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
