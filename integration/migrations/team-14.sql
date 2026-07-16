-- =============================================================================
-- Team 14: Universal Rendering Engine
-- Migration: ai_universal_renders table + indexes
--
-- Safe to run multiple times (IF NOT EXISTS guards on all DDL).
-- Follows project convention: ai_platform schema, search_path set at top.
-- =============================================================================

SET search_path TO ai_platform, public;

-- ---------------------------------------------------------------------------
-- Table: ai_universal_renders
-- Tracks every render request and its output artifacts.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform."ai_universal_renders" (
  "id"             serial       PRIMARY KEY,

  -- Identity
  "request_id"     text         NOT NULL UNIQUE,

  -- Source
  "source_kind"    text         NOT NULL DEFAULT 'svg',
  -- 'svg' (only kind in v1)

  "canvas_width"   integer      NOT NULL,
  "canvas_height"  integer      NOT NULL,

  -- Requested & produced formats (JSON arrays)
  "requested_formats"  jsonb    NOT NULL DEFAULT '[]',
  "produced_formats"   jsonb    NOT NULL DEFAULT '[]',

  -- Preview / watermark flag
  "preview_mode"   boolean      NOT NULL DEFAULT false,

  -- Storage prefix used for all artifacts
  "storage_prefix" text,

  -- Job reference (nullable — null for synchronous renders)
  "job_id"         integer      REFERENCES ai_platform."ai_jobs"("id") ON DELETE SET NULL,

  -- Lifecycle
  "status"         text         NOT NULL DEFAULT 'pending',
  -- pending | running | completed | failed

  -- Aggregate result (mirrors UniversalRenderResult)
  "result_json"    jsonb,

  -- Timing
  "duration_ms"    integer,

  -- Error (if failed)
  "error_message"  text,
  "error_code"     text,

  -- Soft delete
  "deleted_at"     timestamptz,

  -- Audit
  "created_at"     timestamptz  NOT NULL DEFAULT NOW(),
  "updated_at"     timestamptz  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Table: ai_universal_render_artifacts
-- One row per output file produced by a render request.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform."ai_universal_render_artifacts" (
  "id"             serial       PRIMARY KEY,

  "render_id"      integer      NOT NULL
                   REFERENCES ai_platform."ai_universal_renders"("id")
                   ON DELETE CASCADE,

  "format"         text         NOT NULL,
  -- svg | png | jpg | webp | pdf | pdf-print | thumbnail | watermarked | zip | composition

  "storage_path"   text         NOT NULL,
  "public_url"     text         NOT NULL,
  "mime_type"      text         NOT NULL,
  "file_size_bytes" integer     NOT NULL,
  "checksum"       text         NOT NULL, -- SHA-256 hex

  -- Optional raster metadata
  "width"          integer,
  "height"         integer,

  -- Optional PDF metadata
  "page_count"     integer,

  "created_at"     timestamptz  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_universal_renders_request_id
  ON ai_platform."ai_universal_renders" ("request_id");

CREATE INDEX IF NOT EXISTS idx_universal_renders_status
  ON ai_platform."ai_universal_renders" ("status");

CREATE INDEX IF NOT EXISTS idx_universal_renders_job_id
  ON ai_platform."ai_universal_renders" ("job_id")
  WHERE "job_id" IS NOT NULL;

-- Partial index for non-deleted renders (soft-delete pattern)
CREATE INDEX IF NOT EXISTS idx_universal_renders_active
  ON ai_platform."ai_universal_renders" ("created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS idx_universal_render_artifacts_render_id
  ON ai_platform."ai_universal_render_artifacts" ("render_id");

CREATE INDEX IF NOT EXISTS idx_universal_render_artifacts_format
  ON ai_platform."ai_universal_render_artifacts" ("format");

-- ---------------------------------------------------------------------------
-- Updated_at trigger (reuse existing pattern)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ai_platform.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_universal_renders_updated_at
  ON ai_platform."ai_universal_renders";

CREATE TRIGGER trg_universal_renders_updated_at
  BEFORE UPDATE ON ai_platform."ai_universal_renders"
  FOR EACH ROW EXECUTE FUNCTION ai_platform.set_updated_at();
