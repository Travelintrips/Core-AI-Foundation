-- Migration: Graphic Design Domain (Team 15)
-- Services: logo, business-card, letterhead, flyer, poster, banner,
--           brochure, social-media, certificate, stationery
--
-- IMPORTANT: Never use drizzle-kit push for production.
-- Apply this hand-written DDL directly via psql or the Supabase dashboard.
-- Schema: ai_platform (set via search_path or explicit qualifier)

SET search_path TO ai_platform, public;

-- ── 1. Graphic Design Requests ─────────────────────────────────────────────
--
-- Extends ai_service_requests by capturing graphic-design-specific brief data.
-- brief_json is stored on the parent table; this table tracks job linkage and
-- print production metadata.

CREATE TABLE IF NOT EXISTS gd_requests (
  id                  BIGSERIAL    PRIMARY KEY,
  tenant_id           TEXT         NOT NULL DEFAULT 'default',
  service_request_id  BIGINT       NOT NULL,          -- FK → ai_service_requests.id
  service_type        TEXT         NOT NULL,           -- logo|business-card|letterhead|...
  package_tier        TEXT         NOT NULL DEFAULT 'starter',  -- starter|professional|business|enterprise
  -- Print production metadata (null for digital-only like social-media)
  print_width_mm      NUMERIC(8,3),
  print_height_mm     NUMERIC(8,3),
  bleed_mm            NUMERIC(5,3),
  safe_area_mm        NUMERIC(5,3),
  color_mode          TEXT         NOT NULL DEFAULT 'cmyk',  -- cmyk|rgb
  resolution_dpi      INTEGER      NOT NULL DEFAULT 300,
  -- QC outcome
  qc_score            INTEGER,
  qc_passed           BOOLEAN,
  qc_dimensions       JSONB,
  qc_warnings         JSONB,
  -- Deliverable
  manifest_json       JSONB,
  zip_storage_path    TEXT,
  -- Lifecycle
  status              TEXT         NOT NULL DEFAULT 'draft',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gd_requests_tenant
  ON gd_requests (tenant_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_gd_requests_service_request
  ON gd_requests (service_request_id);

COMMENT ON TABLE gd_requests IS
  'Graphic Design domain — one row per service request, tracks print spec and QC outcome.';

-- ── 2. Graphic Design Assets ───────────────────────────────────────────────
--
-- Individual deliverable files generated per request.

CREATE TABLE IF NOT EXISTS gd_assets (
  id              BIGSERIAL    PRIMARY KEY,
  gd_request_id   BIGINT       NOT NULL,              -- FK → gd_requests.id
  tenant_id       TEXT         NOT NULL DEFAULT 'default',
  asset_purpose   TEXT         NOT NULL,              -- primary|variant|source|export|thumbnail
  file_name       TEXT         NOT NULL,
  mime_type       TEXT         NOT NULL,
  storage_path    TEXT,
  file_size_bytes BIGINT,
  width_px        INTEGER,
  height_px       INTEGER,
  checksum_sha256 TEXT,
  metadata_json   JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gd_assets_request
  ON gd_assets (gd_request_id, asset_purpose);

COMMENT ON TABLE gd_assets IS
  'Individual deliverable files per Graphic Design request.';

-- ── 3. Graphic Design QC Log ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gd_qc_log (
  id              BIGSERIAL    PRIMARY KEY,
  gd_request_id   BIGINT       NOT NULL,
  tenant_id       TEXT         NOT NULL DEFAULT 'default',
  qc_score        INTEGER      NOT NULL,
  passed          BOOLEAN      NOT NULL,
  dimensions_json JSONB        NOT NULL,
  warnings_json   JSONB        NOT NULL DEFAULT '[]',
  reviewed_by     TEXT,                               -- null = auto, else staff id
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gd_qc_log_request
  ON gd_qc_log (gd_request_id, created_at DESC);

COMMENT ON TABLE gd_qc_log IS
  'QC run history per Graphic Design request. Latest row is authoritative.';
