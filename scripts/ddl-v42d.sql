-- V4.2D DDL — Brand Kit Enterprise, Asset Library, ZIP Deliveries
-- Run against dev and prod Supabase (search_path = ai_platform,public already set by app)
-- Hand-written DDL because drizzle-kit push drops the whole ai_platform schema.

SET search_path = ai_platform, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ai_brand_kit_assets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_kit_assets (
  id              SERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL,
  email_hash      TEXT NOT NULL,
  slot            TEXT NOT NULL,

  -- File fields
  file_name       TEXT,
  storage_path    TEXT,
  preview_url     TEXT,
  mime_type       TEXT,
  file_size_bytes BIGINT,
  checksum        TEXT,

  -- Text/structured value
  value           TEXT,
  value_json      JSONB,

  -- Versioning
  version         INT NOT NULL DEFAULT 1,
  parent_asset_id INT REFERENCES ai_platform.ai_brand_kit_assets(id) ON DELETE SET NULL,

  -- State
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  archived        BOOLEAN NOT NULL DEFAULT FALSE,

  -- Provenance
  uploaded_by     TEXT,
  tags            JSONB,
  metadata        JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brand_kit_assets_project ON ai_platform.ai_brand_kit_assets (project_id);
CREATE INDEX IF NOT EXISTS idx_brand_kit_assets_email   ON ai_platform.ai_brand_kit_assets (email_hash);
CREATE INDEX IF NOT EXISTS idx_brand_kit_assets_slot    ON ai_platform.ai_brand_kit_assets (project_id, slot, active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ai_asset_library
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_library (
  id              SERIAL PRIMARY KEY,
  email_hash      TEXT NOT NULL,
  project_id      TEXT,

  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  storage_path    TEXT,
  preview_url     TEXT,
  mime_type       TEXT,
  file_size_bytes BIGINT,
  checksum        TEXT,

  -- Versioning
  version         INT NOT NULL DEFAULT 1,
  parent_asset_id INT REFERENCES ai_platform.ai_asset_library(id) ON DELETE SET NULL,

  -- State
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  archived        BOOLEAN NOT NULL DEFAULT FALSE,
  favorited       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Provenance
  uploaded_by     TEXT,
  source_asset_id INT,   -- FK to creative_ai_assets.id if promoted from AI generation
  tags            JSONB,
  metadata        JSONB,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_library_email    ON ai_platform.ai_asset_library (email_hash);
CREATE INDEX IF NOT EXISTS idx_asset_library_category ON ai_platform.ai_asset_library (email_hash, category);
CREATE INDEX IF NOT EXISTS idx_asset_library_project  ON ai_platform.ai_asset_library (project_id);
CREATE INDEX IF NOT EXISTS idx_asset_library_active   ON ai_platform.ai_asset_library (email_hash, active, archived);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ai_zip_deliveries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_zip_deliveries (
  id              SERIAL PRIMARY KEY,
  project_id      TEXT NOT NULL,
  job_id          INT,

  status          TEXT NOT NULL DEFAULT 'queued',

  storage_path    TEXT,
  download_url    TEXT,
  file_size_bytes BIGINT,
  checksum        TEXT,
  manifest_json   JSONB,

  error_message   TEXT,
  retry_count     INT NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zip_deliveries_project ON ai_platform.ai_zip_deliveries (project_id);
CREATE INDEX IF NOT EXISTS idx_zip_deliveries_status  ON ai_platform.ai_zip_deliveries (status);
