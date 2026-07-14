/**
 * V4.3 Team 1 migration — ai_portfolio_favorites
 * Hand-written DDL (avoids drizzle-kit dropping the ai_platform schema).
 * Purely additive: new table only, no changes to any existing table.
 * Reuses the shared @workspace/db connection pool (already environment-aware
 * via resolveDatabaseUrl) instead of adding a raw `pg` dependency to this package.
 * Run: pnpm migrate:v43-gallery
 */
import { pool } from "@workspace/db";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_favorites (
        id           SERIAL PRIMARY KEY,
        client_id    TEXT NOT NULL,
        portfolio_id INTEGER NOT NULL REFERENCES ai_platform.ai_service_portfolios(id) ON DELETE CASCADE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (client_id, portfolio_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolio_favorites_client
        ON ai_platform.ai_portfolio_favorites (client_id);
    `);

    console.log("✅ V4.3 Portfolio Gallery migration complete (ai_portfolio_favorites)");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
