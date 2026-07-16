-- ============================================================
-- TEAM 12 — Layout Composer Migration Draft
-- Status: DRAFT — DO NOT RUN until Team 24 integrates
-- All statements are additive (no DROP, no TRUNCATE, no rename)
-- ============================================================

-- Optional persistence table for saved layout plans.
-- The core solver is purely in-memory; this table is only
-- needed if consumers want to store and retrieve solved plans.

CREATE TABLE IF NOT EXISTS ai_platform.ai_layout_plans (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request metadata
  request_id      TEXT,
  canvas_width    INTEGER     NOT NULL,
  canvas_height   INTEGER     NOT NULL,

  -- Solver result (stored as JSONB for schema flexibility)
  elements_json   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  operations_json JSONB       NOT NULL DEFAULT '[]'::jsonb,
  violations_json JSONB       NOT NULL DEFAULT '[]'::jsonb,
  zones_json      JSONB       NOT NULL DEFAULT '[]'::jsonb,

  -- Quality metrics
  satisfaction_score  NUMERIC(5, 4) NOT NULL DEFAULT 0,
  iterations          INTEGER       NOT NULL DEFAULT 0,
  converged           BOOLEAN       NOT NULL DEFAULT false,

  -- Responsive variants (keyed by breakpoint name)
  responsive_variants JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,       -- optional: who/what triggered this solve
  tags            TEXT[]      NOT NULL DEFAULT '{}'
);

-- Index for lookup by request_id (if consumers track external IDs)
CREATE INDEX IF NOT EXISTS idx_ai_layout_plans_request_id
  ON ai_platform.ai_layout_plans (request_id)
  WHERE request_id IS NOT NULL;

-- Index for created_at to support time-range queries
CREATE INDEX IF NOT EXISTS idx_ai_layout_plans_created_at
  ON ai_platform.ai_layout_plans (created_at DESC);

-- Index for tag filtering (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_ai_layout_plans_tags
  ON ai_platform.ai_layout_plans USING GIN (tags);

-- GIN index on elements for JSON queries (e.g. find plans with element id X)
CREATE INDEX IF NOT EXISTS idx_ai_layout_plans_elements
  ON ai_platform.ai_layout_plans USING GIN (elements_json);

-- ============================================================
-- NOTE: No foreign keys to other teams' tables.
-- No shared enum usage.
-- No DROP or ALTER on existing tables.
-- ============================================================
