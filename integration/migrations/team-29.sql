-- ============================================================================
-- Team 29: Architecture & Landscape Design Plugin — Migration
-- ============================================================================
-- Additive only. No DROP, no TRUNCATE, all IF NOT EXISTS.
-- Run against the ai_platform schema (same Supabase DB as the rest of the platform).
-- ============================================================================

SET search_path TO ai_platform, public;

-- ── 1. architecture_landscape_projects ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.architecture_landscape_projects (
  id                          SERIAL PRIMARY KEY,
  project_ref                 TEXT NOT NULL UNIQUE,

  tenant_id                   TEXT,
  service_request_id          INTEGER,

  project_type                TEXT NOT NULL,
  client_name                 TEXT NOT NULL,
  client_email                TEXT NOT NULL,
  project_title               TEXT NOT NULL,
  site_location               TEXT,
  site_area_m2                TEXT,
  built_area_m2               TEXT,
  climate                     TEXT,
  user_description            TEXT,

  program_json                JSONB NOT NULL DEFAULT '[]',
  constraints_json            JSONB DEFAULT '{}',
  regulation_references       JSONB NOT NULL DEFAULT '[]',

  style_preference            TEXT,
  material_preferences        JSONB NOT NULL DEFAULT '[]',
  landscape_requirements      TEXT,
  sustainability_goals        TEXT,
  accessibility_requirements  TEXT,

  site_context_json           JSONB DEFAULT '{}',
  brief_json                  JSONB DEFAULT '{}',

  current_step                TEXT NOT NULL DEFAULT 'brief',
  current_step_index          INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'draft',

  export_ready_at             TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,

  has_landscape_component     BOOLEAN NOT NULL DEFAULT FALSE,
  has_sustainability_requirements BOOLEAN NOT NULL DEFAULT FALSE,
  has_accessibility_requirements  BOOLEAN NOT NULL DEFAULT FALSE,

  additional_notes            TEXT,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_projects_status
  ON ai_platform.architecture_landscape_projects (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_arch_landscape_projects_tenant
  ON ai_platform.architecture_landscape_projects (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_arch_landscape_projects_client_email
  ON ai_platform.architecture_landscape_projects (client_email)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_arch_landscape_projects_created_at
  ON ai_platform.architecture_landscape_projects (created_at DESC)
  WHERE deleted_at IS NULL;

-- ── 2. architecture_landscape_artifacts ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.architecture_landscape_artifacts (
  id                  SERIAL PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES ai_platform.architecture_landscape_projects(id) ON DELETE CASCADE,
  artifact_type       TEXT NOT NULL,
  artifact_label      TEXT NOT NULL,
  is_preview          BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json       JSONB NOT NULL DEFAULT '{}',
  overlay_metadata_json JSONB DEFAULT '{}',
  storage_url         TEXT,
  mime_type           TEXT,
  file_size_bytes     INTEGER,
  workflow_step       TEXT,
  generated_by        TEXT NOT NULL DEFAULT 'system',
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_artifacts_project
  ON ai_platform.architecture_landscape_artifacts (project_id);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_artifacts_type
  ON ai_platform.architecture_landscape_artifacts (artifact_type);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_artifacts_status
  ON ai_platform.architecture_landscape_artifacts (status);

-- ── 3. architecture_landscape_components ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.architecture_landscape_components (
  id                    SERIAL PRIMARY KEY,
  component_code        TEXT NOT NULL UNIQUE,
  component_name        TEXT NOT NULL,
  category              TEXT NOT NULL,
  sub_category          TEXT,
  description           TEXT,
  climate_zones         JSONB NOT NULL DEFAULT '[]',
  sustainability_rating TEXT,
  locally_available     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json         JSONB NOT NULL DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_components_category
  ON ai_platform.architecture_landscape_components (category);

CREATE INDEX IF NOT EXISTS idx_arch_landscape_components_locally_available
  ON ai_platform.architecture_landscape_components (locally_available);
