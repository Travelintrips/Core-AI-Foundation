-- Team 17 — Interior Design Planning
-- Additive migration — NO DROP, NO TRUNCATE, NO DESTRUCTIVE RENAME
-- Idempotent: IF NOT EXISTS throughout
-- Run against Supabase with: SET search_path TO ai_platform, public;

SET search_path TO ai_platform, public;

-- ── Interior Design Projects ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.id_projects (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title         TEXT    NOT NULL,
  room_type     TEXT    NOT NULL
                  CHECK (room_type IN (
                    'living_room','bedroom','kitchen','office',
                    'cafe','restaurant','hotel','lobby','booth'
                  )),
  status        TEXT    NOT NULL DEFAULT 'draft'
                  CHECK (status IN (
                    'draft','brief_submitted','analyzing',
                    'outputs_ready','revision_requested','completed'
                  )),
  client_name   TEXT,
  client_email  TEXT,
  notes         TEXT,
  -- Ownership token: returned once at creation; required for all public reads/writes.
  -- This is the IDOR guard for public customer routes.
  access_token  TEXT    NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent column additions (for rows created before access_token existed)
DO $$ BEGIN
  ALTER TABLE ai_platform.id_projects ADD COLUMN IF NOT EXISTS access_token TEXT NOT NULL DEFAULT '';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_id_projects_status
  ON ai_platform.id_projects (status);
CREATE INDEX IF NOT EXISTS idx_id_projects_room_type
  ON ai_platform.id_projects (room_type);
CREATE INDEX IF NOT EXISTS idx_id_projects_created_at
  ON ai_platform.id_projects (created_at DESC);
-- Index for token lookup (public IDOR guard)
CREATE INDEX IF NOT EXISTS idx_id_projects_access_token
  ON ai_platform.id_projects (access_token);

-- ── Interior Design Briefs ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.id_briefs (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            BIGINT NOT NULL
                          REFERENCES ai_platform.id_projects (id)
                          ON DELETE CASCADE,

  -- Room geometry
  room_length_m         NUMERIC(8,2)  NOT NULL,
  room_width_m          NUMERIC(8,2)  NOT NULL,
  ceiling_height_m      NUMERIC(6,2)  NOT NULL,

  -- Structural elements (JSONB arrays)
  doors                 JSONB NOT NULL DEFAULT '[]',
  windows               JSONB NOT NULL DEFAULT '[]',
  columns               JSONB NOT NULL DEFAULT '[]',
  immutable_zones       JSONB NOT NULL DEFAULT '[]',

  -- Preference snapshot (project-specific overrides of brand defaults)
  -- Brand Intelligence V2 is the source of truth; these values are overrides only.
  style                 TEXT  NOT NULL,
  primary_colors        TEXT[] NOT NULL DEFAULT '{}',
  secondary_colors      TEXT[] NOT NULL DEFAULT '{}',
  materials_preference  JSONB NOT NULL DEFAULT '{}',
  lighting_preference   JSONB NOT NULL DEFAULT '{}',

  -- Functional
  furniture_needs       TEXT[] NOT NULL DEFAULT '{}',
  budget_notes          TEXT,

  -- Media
  photo_urls            TEXT[] NOT NULL DEFAULT '{}',
  floor_plan_url        TEXT,
  additional_notes      TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (project_id)   -- one brief per project; revise via UPDATE
);

CREATE INDEX IF NOT EXISTS idx_id_briefs_project_id
  ON ai_platform.id_briefs (project_id);

-- ── Interior Design Outputs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_platform.id_outputs (
  id                          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                  BIGINT NOT NULL
                                REFERENCES ai_platform.id_projects (id)
                                ON DELETE CASCADE,

  -- AI-generated deliverables
  moodboard                   JSONB,
  space_plan                  JSONB,
  furniture_placement         JSONB,
  circulation_analysis        TEXT,
  material_recommendations    JSONB,
  lighting_recommendations    JSONB,
  visual_concept              TEXT,
  vendor_categories           JSONB,

  -- Validation & disclaimers
  validation_results          JSONB,
  safety_disclaimers          TEXT[] NOT NULL DEFAULT '{}',

  -- Brand Intelligence V2 reference (NOT a data copy).
  -- Interior Design stores only which brand profile version was used,
  -- so output traceability and regeneration are possible without duplicating brand data.
  source_brand_profile_id      TEXT,
  source_brand_profile_version TEXT,

  -- Project-specific style overrides applied on top of brand profile snapshot
  project_style_overrides     JSONB,

  -- Meta
  ai_model_used               TEXT,
  generation_duration_ms      INTEGER,
  is_latest                   BOOLEAN NOT NULL DEFAULT TRUE,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE ai_platform.id_outputs ADD COLUMN IF NOT EXISTS source_brand_profile_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ai_platform.id_outputs ADD COLUMN IF NOT EXISTS source_brand_profile_version TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ai_platform.id_outputs ADD COLUMN IF NOT EXISTS project_style_overrides JSONB;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_id_outputs_project_id
  ON ai_platform.id_outputs (project_id);
CREATE INDEX IF NOT EXISTS idx_id_outputs_is_latest
  ON ai_platform.id_outputs (project_id, is_latest)
  WHERE is_latest = TRUE;
