/**
 * V4.4 migration — ai_production_pipelines + ai_pipeline_stages
 * Hand-written DDL (avoids drizzle-kit dropping the ai_platform schema).
 * Run: pnpm migrate:v44
 */
// Use @workspace/db's pool (already configured with search_path).
// Avoids direct pg import which is not listed as api-server's own dependency.
import { pool } from "@workspace/db";

async function run() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path = ai_platform, public");

    // ── ai_production_pipelines ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_production_pipelines (
        id               SERIAL PRIMARY KEY,
        run_id           TEXT NOT NULL UNIQUE,
        project_id       INTEGER NOT NULL REFERENCES ai_platform.creative_projects(id) ON DELETE CASCADE,
        status           TEXT NOT NULL DEFAULT 'pending',
        current_stage    TEXT,
        started_at       TIMESTAMPTZ,
        completed_at     TIMESTAMPTZ,
        error_message    TEXT,
        retry_count      INTEGER NOT NULL DEFAULT 0,
        execution_summary JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_project_id
        ON ai_platform.ai_production_pipelines(project_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_status
        ON ai_platform.ai_production_pipelines(status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_prod_pipelines_run_id
        ON ai_platform.ai_production_pipelines(run_id);
    `);

    // ── ai_pipeline_stages ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_platform.ai_pipeline_stages (
        id           SERIAL PRIMARY KEY,
        run_id       INTEGER NOT NULL REFERENCES ai_platform.ai_production_pipelines(id) ON DELETE CASCADE,
        stage_name   TEXT NOT NULL,
        stage_order  INTEGER NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        input        JSONB,
        output       JSONB,
        started_at   TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        latency_ms   INTEGER,
        retry_count  INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        agent_slug   TEXT,
        model        TEXT,
        provider     TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_run_id
        ON ai_platform.ai_pipeline_stages(run_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_status
        ON ai_platform.ai_pipeline_stages(status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_pipeline_stages_stage_name
        ON ai_platform.ai_pipeline_stages(stage_name);
    `);

    console.log("✅ V4.4 migration complete: ai_production_pipelines + ai_pipeline_stages created");
  } finally {
    client.release();
    // Do NOT call pool.end() — the pool is shared with @workspace/db
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
