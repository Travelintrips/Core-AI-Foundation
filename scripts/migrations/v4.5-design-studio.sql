-- V4.5 AI Design Studio — additive migration
-- Run against the Supabase project with search_path = ai_platform

SET search_path TO ai_platform, public;

-- ── Design Projects ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_design_projects (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT    NOT NULL,
  description     TEXT,
  canvas_width    INTEGER NOT NULL DEFAULT 1920,
  canvas_height   INTEGER NOT NULL DEFAULT 1080,
  template_id     BIGINT,
  brand_dna_id    BIGINT,
  current_version_id BIGINT,
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'active', 'archived')),
  tags            TEXT[]  NOT NULL DEFAULT '{}',
  thumbnail_url   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_design_projects_status
  ON ai_platform.ai_design_projects (status);

CREATE INDEX IF NOT EXISTS idx_design_projects_created_at
  ON ai_platform.ai_design_projects (created_at DESC);

-- ── Design Versions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_design_versions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id      BIGINT NOT NULL
                    REFERENCES ai_platform.ai_design_projects (id)
                    ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  label           TEXT,
  canvas_state    JSONB   NOT NULL,
  element_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_design_versions_project_id
  ON ai_platform.ai_design_versions (project_id);

CREATE INDEX IF NOT EXISTS idx_design_versions_created_at
  ON ai_platform.ai_design_versions (project_id, created_at DESC);
