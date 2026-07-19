-- Migration: ai_goals + ai_goal_service_mappings
-- Phase V4.2C — Goal Taxonomy Foundation (Team 02)
--
-- ADDITIVE ONLY. Does NOT alter any existing table.
-- Apply via psql or Supabase dashboard.
--
-- IMPORTANT: Replit rule — never use `drizzle-kit push` for production.
-- Apply this hand-written DDL directly.

SET search_path TO ai_platform, public;

-- ── ai_goals ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_goals (
  id              BIGSERIAL    PRIMARY KEY,

  -- URL-safe, human-readable identifier used in API routes and slugs.
  -- e.g. "launch-brand", "grow-social-presence", "build-pitch-deck"
  slug            TEXT         NOT NULL UNIQUE,

  -- Customer-facing label.
  name            TEXT         NOT NULL,

  -- Short description (1-2 sentences) for customer-facing surfaces.
  description     TEXT,

  -- Emoji or icon name for UI. No business logic depends on this.
  icon            TEXT,

  -- Self-referential FK for two-level hierarchy (parent → child goals).
  -- NULL = top-level goal.
  parent_goal_id  BIGINT       REFERENCES ai_goals(id) ON DELETE SET NULL,

  -- Extensible JSON metadata: keywords, tags, AB variants, copy overrides.
  -- Shape is additive — never remove keys; only add or deprecate.
  metadata_json   JSONB,

  -- Lower display_order = shown first in customer-facing lists.
  display_order   INTEGER      NOT NULL DEFAULT 0,

  -- Lifecycle: active | draft | archived
  -- Only "active" goals are returned to public/customer endpoints.
  status          TEXT         NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'draft', 'archived')),

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_goals IS
  'Goal Taxonomy — top-level abstraction above categories and services. '
  'Customers browse goals; system resolves to services deterministically.';

COMMENT ON COLUMN ai_goals.slug IS
  'Stable, URL-safe slug. Never rename after initial publish — old slugs must '
  'remain valid (backward-compatibility rule from MASTER-00.md).';

COMMENT ON COLUMN ai_goals.parent_goal_id IS
  'Optional parent for two-level hierarchy. Max depth = 2 (enforced in service layer).';

-- ── ai_goal_service_mappings ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_goal_service_mappings (
  id              BIGSERIAL    PRIMARY KEY,

  goal_id         BIGINT       NOT NULL REFERENCES ai_goals(id) ON DELETE CASCADE,
  service_id      BIGINT       NOT NULL REFERENCES ai_services(id) ON DELETE CASCADE,

  -- 0-100. Higher = more relevant. Set by admin; never computed by AI.
  relevance_score INTEGER      NOT NULL DEFAULT 50
                  CHECK (relevance_score BETWEEN 0 AND 100),

  -- Controls order within the goal's service list. Lower = first.
  display_order   INTEGER      NOT NULL DEFAULT 0,

  -- At most one mapping per goal should have is_primary = TRUE.
  -- Marks the recommended entry-point service for the goal.
  is_primary      BOOLEAN      NOT NULL DEFAULT FALSE,

  -- active | disabled. Soft-disable without deleting the mapping.
  status          TEXT         NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'disabled')),

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Prevent duplicate mappings for the same goal+service pair.
  UNIQUE (goal_id, service_id)
);

COMMENT ON TABLE ai_goal_service_mappings IS
  'Maps Goals to Services with a relevance score. Deterministic — scores are '
  'admin-set, not AI-computed (MASTER-00.md determinism rule).';

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fast lookup by slug (primary customer-facing query pattern).
CREATE INDEX IF NOT EXISTS idx_ai_goals_slug
  ON ai_goals (slug)
  WHERE status = 'active';

-- Hierarchy queries: fetch all children of a parent goal.
CREATE INDEX IF NOT EXISTS idx_ai_goals_parent
  ON ai_goals (parent_goal_id)
  WHERE parent_goal_id IS NOT NULL;

-- Ordered listing by display_order.
CREATE INDEX IF NOT EXISTS idx_ai_goals_display_order
  ON ai_goals (display_order, id);

-- Fetch all service mappings for a goal (most common read path).
CREATE INDEX IF NOT EXISTS idx_ai_goal_svc_goal_id
  ON ai_goal_service_mappings (goal_id, display_order)
  WHERE status = 'active';

-- Reverse lookup: which goals does a service belong to?
CREATE INDEX IF NOT EXISTS idx_ai_goal_svc_service_id
  ON ai_goal_service_mappings (service_id)
  WHERE status = 'active';
