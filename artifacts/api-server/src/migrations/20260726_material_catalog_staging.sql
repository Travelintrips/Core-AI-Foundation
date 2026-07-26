-- Migration: Universal Material Catalog Import Engine — Phase 4A
-- Creates staging tables for the universal catalog import pipeline.
-- No data from these tables ever enters canonical materials automatically.
-- All changes are additive — does not touch Phase 1/2/3 tables.

-- ── Import jobs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.material_catalog_import_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type     TEXT        NOT NULL,
  source_name     TEXT        NOT NULL,
  source_url      TEXT,
  filename        TEXT,
  checksum        TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','complete','partial','failed')),
  total_raw       INTEGER     NOT NULL DEFAULT 0,
  total_normalized INTEGER    NOT NULL DEFAULT 0,
  total_new       INTEGER     NOT NULL DEFAULT 0,
  total_duplicate INTEGER     NOT NULL DEFAULT 0,
  total_invalid   INTEGER     NOT NULL DEFAULT 0,
  total_needs_review INTEGER  NOT NULL DEFAULT 0,
  processed_pages INTEGER,
  total_pages     INTEGER,
  warnings        TEXT[]      NOT NULL DEFAULT '{}',
  errors          TEXT[]      NOT NULL DEFAULT '{}',
  options         JSONB,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mat_catalog_jobs_status
  ON ai_platform.material_catalog_import_jobs (status);
CREATE INDEX IF NOT EXISTS idx_mat_catalog_jobs_checksum
  ON ai_platform.material_catalog_import_jobs (checksum);
CREATE INDEX IF NOT EXISTS idx_mat_catalog_jobs_created
  ON ai_platform.material_catalog_import_jobs (created_at DESC);

-- ── Staging items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.material_catalog_staging (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id       UUID        NOT NULL
                      REFERENCES ai_platform.material_catalog_import_jobs(id) ON DELETE CASCADE,
  status              TEXT        NOT NULL DEFAULT 'extracted'
                      CHECK (status IN ('draft','extracted','normalized','duplicate','approved','rejected','needs_review')),
  -- Source provenance
  source_type         TEXT        NOT NULL,
  source_name         TEXT        NOT NULL,
  source_version      TEXT,
  source_url          TEXT,
  source_page         INTEGER,
  source_row          INTEGER,
  source_section      TEXT,
  source_metadata     JSONB,
  -- Raw extracted data (pre-normalization)
  raw_data            JSONB       NOT NULL DEFAULT '{}',
  -- Normalized universal fields
  brand               TEXT,
  collection          TEXT,
  series              TEXT,
  product_code        TEXT,
  product_name        TEXT,
  variant             TEXT,
  category            TEXT,
  subcategory         TEXT,
  material_type       TEXT,
  description         TEXT,
  colors              TEXT[]      DEFAULT '{}',
  finish              TEXT[]      DEFAULT '{}',
  texture             TEXT,
  pattern             TEXT,
  dimensions          JSONB,
  working_size        TEXT,
  thickness           TEXT,
  number_of_faces     INTEGER,
  pei_rating          INTEGER,
  shade_variation     TEXT,
  technical_specs     JSONB,
  application         TEXT[]      DEFAULT '{}',
  certifications      TEXT[]      DEFAULT '{}',
  thumbnail_reference TEXT,
  preview_references  TEXT[]      DEFAULT '{}',
  -- Classification
  duplicate_info      JSONB,
  validation_errors   TEXT[]      DEFAULT '{}',
  -- Timestamps
  extracted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalized_at       TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mat_staging_job_id
  ON ai_platform.material_catalog_staging (import_job_id);
CREATE INDEX IF NOT EXISTS idx_mat_staging_status
  ON ai_platform.material_catalog_staging (status);
CREATE INDEX IF NOT EXISTS idx_mat_staging_brand
  ON ai_platform.material_catalog_staging (brand);
CREATE INDEX IF NOT EXISTS idx_mat_staging_product_code
  ON ai_platform.material_catalog_staging (product_code);
