-- ============================================================
-- Preview Pipeline: Two-Stage Image Generation
-- Apply with: psql $SUPABASE_DEV_DATABASE_URL -f this_file
-- ============================================================

SET search_path TO ai_platform, public;

-- ── New table: creative_render_sessions ──────────────────────────────────────
-- One session per "Preview → Select → Final" cycle.
-- A project can have multiple sessions (e.g. customer requests more previews).

CREATE TABLE IF NOT EXISTS ai_platform.creative_render_sessions (
  id                    SERIAL PRIMARY KEY,
  project_id            TEXT NOT NULL,           -- UUID matching creative_projects.project_id
  session_status        TEXT NOT NULL DEFAULT 'planning',
    -- planning | preview_generating | preview_ready | waiting_customer
    -- | concept_selected | final_generating | quality_check | completed
  package_tier          TEXT NOT NULL DEFAULT 'standard',
    -- standard | premium | enterprise
  preview_count         INTEGER NOT NULL DEFAULT 4,
  preview_cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
  final_cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  qc_cost_usd           NUMERIC(10,6) NOT NULL DEFAULT 0,
  total_cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  selected_concept_id   INTEGER,                 -- FK to creative_ai_assets.id (set on concept selection)
  customer_feedback     TEXT,                    -- feedback submitted with concept selection
  requested_final_count INTEGER NOT NULL DEFAULT 1,
  metadata              JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_render_sessions_project_id
  ON ai_platform.creative_render_sessions(project_id);

CREATE INDEX IF NOT EXISTS idx_creative_render_sessions_status
  ON ai_platform.creative_render_sessions(session_status);

-- ── Add preview pipeline columns to creative_ai_assets ─────────────────────
-- render_stage distinguishes legacy direct-renders from preview/final assets.
-- All existing rows default to 'legacy' for backward compatibility.

ALTER TABLE ai_platform.creative_ai_assets
  ADD COLUMN IF NOT EXISTS render_stage         TEXT NOT NULL DEFAULT 'legacy',
    -- 'legacy' | 'preview' | 'final'
  ADD COLUMN IF NOT EXISTS render_session_id    INTEGER
    REFERENCES ai_platform.creative_render_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concept_index        INTEGER,
    -- Slot (1–4) for preview concepts
  ADD COLUMN IF NOT EXISTS ai_explanation       TEXT,
    -- AI-generated rationale for this concept
  ADD COLUMN IF NOT EXISTS estimated_final_cost_usd  NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS estimated_render_time_ms  INTEGER;

CREATE INDEX IF NOT EXISTS idx_creative_ai_assets_render_stage
  ON ai_platform.creative_ai_assets(render_stage);

CREATE INDEX IF NOT EXISTS idx_creative_ai_assets_render_session
  ON ai_platform.creative_ai_assets(render_session_id);
