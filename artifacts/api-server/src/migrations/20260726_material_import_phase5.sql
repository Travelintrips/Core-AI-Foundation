-- 20260726_material_import_phase5.sql
-- Phase 5: Controlled Material Import & Human Review
-- Idempotent — safe to run multiple times.
-- Run this migration before starting the API server.
-- Do NOT apply to production automatically; apply via the controlled migration process.

-- ── Phase 5 Staging Table ─────────────────────────────────────────────────────
-- Holds materials pending human review before canonical import.
-- Phase 4A staging rows are referenced via source_staging_id / source_job_id.

CREATE TABLE IF NOT EXISTS ai_platform.material_import_staging (
  id                     BIGSERIAL PRIMARY KEY,

  -- Phase 4A provenance (populated when handoff comes from Phase 4A)
  source_staging_id      BIGINT,
  source_job_id          BIGINT,
  source_checksum        TEXT,

  -- Material fields (from Phase 4A extracted payload or manual entry)
  collection             TEXT,
  product_code           TEXT NOT NULL,
  variant                TEXT,
  brand                  TEXT,
  category               TEXT NOT NULL,
  material_type          TEXT,
  name                   TEXT,
  description            TEXT,
  finish                 TEXT,
  texture                TEXT,
  pattern                TEXT,
  dimensions             TEXT,
  thickness              TEXT,
  working_size           TEXT,
  pei                    TEXT,
  shade_variation        TEXT,
  application            TEXT,
  technical_specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings               JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_image_url      TEXT,
  duplicate_score        NUMERIC(5,4),
  asset_urls             JSONB NOT NULL DEFAULT '[]'::jsonb,
  source                 TEXT,

  -- Lifecycle status
  status                 TEXT NOT NULL DEFAULT 'needs_review',

  -- Reviewer fields (set by human reviewer)
  reviewer_id            TEXT,
  reviewer_name          TEXT,
  reviewer_notes         TEXT,
  reviewed_at            TIMESTAMPTZ,

  -- Duplicate resolution (set via POST /duplicates/:id/resolve before import)
  duplicate_resolution   TEXT,
  target_canonical_id    INTEGER,
  merge_field_map        JSONB,

  -- Import execution tracking
  import_started_at      TIMESTAMPTZ,
  imported_at            TIMESTAMPTZ,
  import_duration_ms     INTEGER,
  canonical_material_id  INTEGER,
  failure_reason         TEXT,

  -- Asset processing
  asset_status           TEXT NOT NULL DEFAULT 'not_started',
  asset_storage_path     TEXT,
  asset_storage_url      TEXT,
  asset_checksum         TEXT,
  asset_error            TEXT,

  -- Timestamps
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT material_import_staging_status_ck CHECK (
    status IN ('draft','needs_review','approved','rejected','importing','imported','failed','rolled_back')
  ),
  CONSTRAINT material_import_staging_dup_resolution_ck CHECK (
    duplicate_resolution IS NULL OR duplicate_resolution IN ('keep_existing','replace_existing','merge','create_new')
  ),
  -- replace_existing and merge require a target canonical ID
  CONSTRAINT material_import_staging_target_required_ck CHECK (
    duplicate_resolution NOT IN ('replace_existing','merge') OR target_canonical_id IS NOT NULL
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_import_staging_status
  ON ai_platform.material_import_staging(status);
CREATE INDEX IF NOT EXISTS idx_material_import_staging_product_code
  ON ai_platform.material_import_staging(product_code);
CREATE INDEX IF NOT EXISTS idx_material_import_staging_duplicate_score
  ON ai_platform.material_import_staging(duplicate_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_material_import_staging_source_staging
  ON ai_platform.material_import_staging(source_staging_id)
  WHERE source_staging_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_import_staging_canonical
  ON ai_platform.material_import_staging(canonical_material_id)
  WHERE canonical_material_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_import_staging_updated
  ON ai_platform.material_import_staging(updated_at DESC);

-- ── Phase 5 Audit Table ───────────────────────────────────────────────────────
-- Append-only log of every state transition and action on a staging row.

CREATE TABLE IF NOT EXISTS ai_platform.material_import_audit (
  id                   BIGSERIAL PRIMARY KEY,
  staging_id           BIGINT NOT NULL
                         REFERENCES ai_platform.material_import_staging(id)
                         ON DELETE CASCADE,
  event_type           TEXT NOT NULL,
  from_status          TEXT,
  to_status            TEXT,
  reviewer_id          TEXT,
  reviewer_name        TEXT,
  notes                TEXT,
  changed_fields       JSONB NOT NULL DEFAULT '[]'::jsonb,
  duplicate_resolution TEXT,
  target_canonical_id  INTEGER,
  merge_field_map      JSONB,
  asset_result         JSONB,
  rollback_reason      TEXT,
  duration_ms          INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_import_audit_staging
  ON ai_platform.material_import_audit(staging_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_import_audit_event_type
  ON ai_platform.material_import_audit(event_type);
