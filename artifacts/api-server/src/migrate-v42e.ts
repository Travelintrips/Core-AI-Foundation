/**
 * migrate-v42e.ts — DDL migration for V4.2E tables
 *
 * Creates ai_brand_dna and ai_asset_intelligence tables in the ai_platform schema.
 * Idempotent: uses IF NOT EXISTS.
 * Run: pnpm --filter @workspace/api-server run migrate:v42e
 */
import { pool } from "@workspace/db";

const DDL = `
SET search_path TO ai_platform, public;

-- V4.2E: Brand DNA table
CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_dna (
  id                    SERIAL PRIMARY KEY,
  client_id             TEXT NOT NULL UNIQUE,
  brand_personality     JSONB,
  brand_voice           TEXT,
  writing_style         TEXT,
  photography_style     TEXT,
  illustration_style    TEXT,
  icon_style            TEXT,
  layout_style          TEXT,
  visual_density        TEXT,
  spacing_style         TEXT,
  detected_colors       JSONB,
  color_psychology      JSONB,
  detected_typography   JSONB,
  target_audience       JSONB,
  industry              TEXT,
  risk_profile          TEXT,
  completeness_score    INTEGER,
  consistency_score     INTEGER,
  confidence_score      NUMERIC(4,3),
  data_sources_summary  JSONB,
  analysis_version      TEXT NOT NULL DEFAULT 'v1',
  metadata              JSONB,
  analyzed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- V4.2E: Asset Intelligence table
CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_intelligence (
  id                  SERIAL PRIMARY KEY,
  asset_id            INTEGER NOT NULL,
  asset_source        TEXT NOT NULL,
  client_id           TEXT NOT NULL,
  detected_subjects   JSONB,
  auto_tags           JSONB,
  auto_category       TEXT,
  search_keywords     JSONB,
  suggested_usage     JSONB,
  color_palette       JSONB,
  dominant_colors     JSONB,
  perceptual_hash     TEXT,
  is_duplicate        BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_id     INTEGER,
  version_type        TEXT,
  version_chain_id    INTEGER,
  quality_score       INTEGER,
  resolution_info     JSONB,
  has_transparency    BOOLEAN,
  analysis_failed     BOOLEAN NOT NULL DEFAULT FALSE,
  failure_reason      TEXT,
  confidence_score    NUMERIC(4,3),
  metadata            JSONB,
  analyzed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_brand_dna_client_id ON ai_platform.ai_brand_dna(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_client_id ON ai_platform.ai_asset_intelligence(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_asset_id ON ai_platform.ai_asset_intelligence(asset_id, asset_source);
CREATE INDEX IF NOT EXISTS idx_ai_asset_intelligence_hash ON ai_platform.ai_asset_intelligence(perceptual_hash);
`;

async function run() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log("✅ V4.2E migration complete: ai_brand_dna + ai_asset_intelligence created");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
