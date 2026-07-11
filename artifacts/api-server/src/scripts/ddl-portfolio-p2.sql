-- DDL: Sprint P2 Portfolio Growth Engine
-- Additive only. Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema.

SET search_path TO ai_platform, public;

-- ── Additive columns on ai_service_portfolios ─────────────────────────────────

ALTER TABLE ai_platform.ai_service_portfolios
  ADD COLUMN IF NOT EXISTS portfolio_code    TEXT,
  ADD COLUMN IF NOT EXISTS slug              TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT,
  ADD COLUMN IF NOT EXISTS business_type     TEXT,
  ADD COLUMN IF NOT EXISTS primary_color     TEXT,
  ADD COLUMN IF NOT EXISTS secondary_color   TEXT,
  ADD COLUMN IF NOT EXISTS package_level     TEXT,
  ADD COLUMN IF NOT EXISTS delivery_days     INTEGER,
  ADD COLUMN IF NOT EXISTS total_reviews     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_clicks      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_checkouts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_status    TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS metadata_json     JSONB,
  ADD COLUMN IF NOT EXISTS is_demo           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trademark_risk    TEXT NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS qc_score          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS source_project_id INTEGER;

-- Partial unique index — only enforces uniqueness when the value is non-null
CREATE UNIQUE INDEX IF NOT EXISTS ai_service_portfolios_slug_uidx
  ON ai_platform.ai_service_portfolios(slug)
  WHERE slug IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_service_portfolios_portfolio_code_uidx
  ON ai_platform.ai_service_portfolios(portfolio_code)
  WHERE portfolio_code IS NOT NULL;

-- ── ai_portfolio_assets ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_assets (
  id                  SERIAL PRIMARY KEY,
  portfolio_id        INTEGER NOT NULL REFERENCES ai_platform.ai_service_portfolios(id) ON DELETE CASCADE,
  creative_asset_id   INTEGER,
  asset_type          TEXT NOT NULL,
  asset_role          TEXT NOT NULL,
  title               TEXT,
  alt_text            TEXT,
  file_name           TEXT,
  thumbnail_url       TEXT,
  preview_url         TEXT,
  storage_path        TEXT,
  mime_type           TEXT,
  width               INTEGER,
  height              INTEGER,
  display_order       INTEGER NOT NULL DEFAULT 0,
  downloadable        BOOLEAN NOT NULL DEFAULT false,
  watermark_required  BOOLEAN NOT NULL DEFAULT false,
  metadata_json       JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ai_portfolio_generation_batches ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_generation_batches (
  id               SERIAL PRIMARY KEY,
  batch_code       TEXT NOT NULL UNIQUE,
  service_id       INTEGER,
  industry         TEXT NOT NULL,
  style            TEXT NOT NULL,
  package_level    TEXT NOT NULL DEFAULT 'standard',
  requested_count  INTEGER NOT NULL DEFAULT 3,
  generated_count  INTEGER NOT NULL DEFAULT 0,
  approved_count   INTEGER NOT NULL DEFAULT 0,
  rejected_count   INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'draft',
  max_cost         NUMERIC(10,2),
  actual_cost      NUMERIC(10,2) NOT NULL DEFAULT 0,
  auto_publish     BOOLEAN NOT NULL DEFAULT false,
  qc_threshold     INTEGER NOT NULL DEFAULT 70,
  created_by       TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── ai_portfolio_permissions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_permissions (
  id                 SERIAL PRIMARY KEY,
  project_id         INTEGER NOT NULL,
  customer_id        INTEGER,
  permission_status  TEXT NOT NULL DEFAULT 'not_requested',
  requested_at       TIMESTAMPTZ,
  approved_at        TIMESTAMPTZ,
  rejected_at        TIMESTAMPTZ,
  scope_json         JSONB,
  approved_by        TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
