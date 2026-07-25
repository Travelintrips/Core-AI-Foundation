-- Team 17 Addendum V2 — Approved Snapshot + Revision Tracking for id_concept_drafts
-- Additive migration — NO DROP, NO TRUNCATE, NO DESTRUCTIVE RENAME
-- Idempotent: ADD COLUMN IF NOT EXISTS throughout
-- Run against Supabase with: SET search_path TO ai_platform, public;

SET search_path TO ai_platform, public;

-- ── Approved snapshot columns ─────────────────────────────────────────────────
-- Captured once on transition to approved_for_rendering; never overwritten by draft edits.
-- Survives revision cycles as an immutable record of what was last approved.

ALTER TABLE ai_platform.id_concept_drafts
  ADD COLUMN IF NOT EXISTS approved_space_plan     JSONB,
  ADD COLUMN IF NOT EXISTS approved_materials      JSONB,
  ADD COLUMN IF NOT EXISTS approved_furniture      JSONB,
  ADD COLUMN IF NOT EXISTS approved_lighting       JSONB,
  ADD COLUMN IF NOT EXISTS approved_visual_concept TEXT,
  ADD COLUMN IF NOT EXISTS approved_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by             TEXT;

-- ── Revision tracking columns ─────────────────────────────────────────────────
-- Written by requestRevision() when an admin requests changes on an approved draft.

ALTER TABLE ai_platform.id_concept_drafts
  ADD COLUMN IF NOT EXISTS revision_requested_by  TEXT,
  ADD COLUMN IF NOT EXISTS revision_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revision_reason        TEXT;
