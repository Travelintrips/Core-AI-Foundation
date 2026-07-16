-- Team 17 — Interior Design Planning
-- Additive migration: safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- Run against Supabase with: SET search_path TO ai_platform, public;

SET search_path TO ai_platform, public;

-- ── Interior Design Projects ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.id_projects (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title           TEXT    NOT NULL,
  room_type       TEXT    NOT NULL
                    CHECK (room_type IN (
                      'living_room','bedroom','kitchen','office',
                      'cafe','restaurant','hotel','lobby','booth'
                    )),
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN (
                      'draft','brief_submitted','analyzing',
                      'outputs_ready','revision_requested','completed'
                    )),
  client_name     TEXT,
  client_email    TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_id_projects_status
  ON ai_platform.id_projects (status);
CREATE INDEX IF NOT EXISTS idx_id_projects_room_type
  ON ai_platform.id_projects (room_type);
CREATE INDEX IF NOT EXISTS idx_id_projects_created_at
  ON ai_platform.id_projects (created_at DESC);

-- ── Interior Design Briefs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.id_briefs (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id            BIGINT NOT NULL
                          REFERENCES ai_platform.id_projects (id)
                          ON DELETE CASCADE,

  -- Room geometry
  room_length_m         NUMERIC(8,2) NOT NULL,
  room_width_m          NUMERIC(8,2) NOT NULL,
  ceiling_height_m      NUMERIC(6,2) NOT NULL,

  -- Structural elements (JSONB arrays)
  doors                 JSONB NOT NULL DEFAULT '[]',
  windows               JSONB NOT NULL DEFAULT '[]',
  columns               JSONB NOT NULL DEFAULT '[]',
  immutable_zones       JSONB NOT NULL DEFAULT '[]',

  -- Aesthetic
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

  UNIQUE (project_id)   -- one brief per project; use UPDATE to revise
);

CREATE INDEX IF NOT EXISTS idx_id_briefs_project_id
  ON ai_platform.id_briefs (project_id);

-- ── Interior Design Outputs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.id_outputs (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id              BIGINT NOT NULL
                            REFERENCES ai_platform.id_projects (id)
                            ON DELETE CASCADE,

  -- AI-generated deliverables
  moodboard               JSONB,
  space_plan              JSONB,
  furniture_placement     JSONB,
  circulation_analysis    TEXT,
  material_recommendations JSONB,
  lighting_recommendations JSONB,
  visual_concept          TEXT,
  vendor_categories       JSONB,

  -- Validation & disclaimers
  validation_results      JSONB,
  safety_disclaimers      TEXT[] NOT NULL DEFAULT '{}',

  -- Meta
  ai_model_used           TEXT,
  generation_duration_ms  INTEGER,
  is_latest               BOOLEAN NOT NULL DEFAULT TRUE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_id_outputs_project_id
  ON ai_platform.id_outputs (project_id);
CREATE INDEX IF NOT EXISTS idx_id_outputs_is_latest
  ON ai_platform.id_outputs (project_id, is_latest)
  WHERE is_latest = TRUE;
