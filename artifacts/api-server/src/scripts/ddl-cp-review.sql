-- ddl-cp-review.sql  — Company Profile V4.2C
-- Hand-written DDL (additive only).
-- Run via:  pnpm --filter @workspace/api-server tsx src/migrate-cp-review.ts

SET search_path TO ai_platform, public;

-- ── cp_document_versions ──────────────────────────────────────────────────────
-- Tracks every document version sent to the client for review.
CREATE TABLE IF NOT EXISTS ai_platform.cp_document_versions (
  id                   SERIAL         PRIMARY KEY,
  project_id           TEXT           NOT NULL,           -- UUID → creative_projects.project_id
  review_id            INTEGER,                           -- nullable → creative_ai_client_reviews.id
  asset_id             INTEGER,                           -- nullable → creative_ai_assets.id
  version              INTEGER        NOT NULL DEFAULT 1,
  version_label        TEXT,                              -- e.g. "v1", "v2 (Revision)"
  reason               TEXT,                              -- why this version was created
  revision_notes       TEXT,                              -- what changed from previous version
  sections_json        JSONB,                             -- sectionsIncluded array
  qc_score             INTEGER,                           -- 0–100
  qc_passed            BOOLEAN,
  qc_dimensions_json   JSONB,                             -- per-dimension QC scores
  approved             BOOLEAN        NOT NULL DEFAULT FALSE,
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT,                              -- client name who approved
  sent_for_review_at   TIMESTAMPTZ,
  created_by           TEXT,                              -- admin who sent this version
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cp_document_versions_project_id_idx
  ON ai_platform.cp_document_versions (project_id);

CREATE INDEX IF NOT EXISTS cp_document_versions_review_id_idx
  ON ai_platform.cp_document_versions (review_id);

-- ── cp_page_comments ──────────────────────────────────────────────────────────
-- Per-page and per-section threaded comments for Company Profile review.
CREATE TABLE IF NOT EXISTS ai_platform.cp_page_comments (
  id                   SERIAL         PRIMARY KEY,
  review_id            INTEGER        NOT NULL REFERENCES ai_platform.creative_ai_client_reviews(id) ON DELETE CASCADE,
  project_id           TEXT           NOT NULL,           -- UUID
  document_version_id  INTEGER,                           -- nullable → cp_document_versions.id
  parent_comment_id    INTEGER,                           -- nullable — threaded reply
  -- Location
  page_number          INTEGER,                           -- page-level comment (nullable)
  position_x           REAL,                              -- optional x% on page (0–100)
  position_y           REAL,                              -- optional y% on page (0–100)
  section_id           TEXT,                              -- optional section identifier
  -- Content
  comment              TEXT           NOT NULL,
  author_name          TEXT           NOT NULL,
  author_type          TEXT           NOT NULL DEFAULT 'client',  -- client | admin
  priority             TEXT           NOT NULL DEFAULT 'normal',  -- low | normal | high | urgent
  -- Status
  status               TEXT           NOT NULL DEFAULT 'open',    -- open | resolved | archived
  resolved_by          TEXT,
  resolved_at          TIMESTAMPTZ,
  -- Timestamps
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cp_page_comments_review_id_idx
  ON ai_platform.cp_page_comments (review_id);

CREATE INDEX IF NOT EXISTS cp_page_comments_project_id_idx
  ON ai_platform.cp_page_comments (project_id);

CREATE INDEX IF NOT EXISTS cp_page_comments_parent_idx
  ON ai_platform.cp_page_comments (parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;
