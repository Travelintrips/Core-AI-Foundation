-- Team 17 Addendum — Interior Design Concept Drafts
-- Additive migration — NO DROP, NO TRUNCATE, NO DESTRUCTIVE RENAME
-- Idempotent: IF NOT EXISTS throughout
-- Run against Supabase with: SET search_path TO ai_platform, public;

SET search_path TO ai_platform, public;

-- ── Interior Design Concept Drafts ───────────────────────────────────────────
-- Stores editable admin drafts of AI-generated Interior Design outputs.
-- Linked to creative_projects.project_id (UUID text), not to id_projects.
-- Preserves the original AI output alongside the current editable draft.

CREATE TABLE IF NOT EXISTS ai_platform.id_concept_drafts (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- FK to creative_projects.project_id (UUID text — the client-facing project ID).
  -- UNIQUE: one draft per creative project.
  project_uuid             TEXT NOT NULL UNIQUE,

  -- ── Original AI-generated outputs (set once at initialization, never overwritten) ──
  original_space_plan      JSONB,
  original_materials       JSONB,
  original_furniture       JSONB,
  original_lighting        JSONB,
  original_visual_concept  TEXT,

  -- ── Editable current draft (starts as copy of AI output) ──────────────────
  space_plan_draft         JSONB,
  materials_draft          JSONB,
  furniture_draft          JSONB,
  lighting_draft           JSONB,
  visual_concept_draft     TEXT,

  -- ── Review state machine ──────────────────────────────────────────────────
  review_state             TEXT NOT NULL DEFAULT 'ai_generated'
                             CHECK (review_state IN (
                               'ai_generated',
                               'edited_by_admin',
                               'ready_for_review',
                               'revision_requested',
                               'approved_for_rendering'
                             )),

  has_unsaved_edits        BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Approved snapshot (frozen when approved_for_rendering) ────────────────
  -- Preserved as an immutable record of exactly what was approved.
  -- NOT cleared when revision_requested — the snapshot stays until next approval.
  approved_space_plan      JSONB,
  approved_materials       JSONB,
  approved_furniture       JSONB,
  approved_lighting        JSONB,
  approved_visual_concept  TEXT,
  approved_at              TIMESTAMPTZ,
  approved_by              TEXT,

  -- ── Revision audit ────────────────────────────────────────────────────────
  revision_requested_by    TEXT,
  revision_requested_at    TIMESTAMPTZ,
  revision_reason          TEXT,

  -- ── Audit ─────────────────────────────────────────────────────────────────
  last_edited_by           TEXT,
  last_edited_at           TIMESTAMPTZ,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_id_concept_drafts_project_uuid
  ON ai_platform.id_concept_drafts (project_uuid);
