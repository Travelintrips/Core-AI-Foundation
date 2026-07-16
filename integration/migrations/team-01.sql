-- =============================================================================
-- Team 01 — Creative Workflow Engine v2 — Migration Draft
-- Branch: feature/01-creative-workflow
-- Status: DRAFT — DO NOT RUN directly. Team 24 reviews and runs after approval.
-- Schema: ai_platform (not public)
-- =============================================================================
-- Rules:
--   - Additive only (no DROP, TRUNCATE, destructive renames)
--   - No changes to tables outside Team 1's ownership
--   - All indexes use CREATE INDEX IF NOT EXISTS
--   - All tables use CREATE TABLE IF NOT EXISTS
-- =============================================================================

SET search_path TO ai_platform, public;

-- ---------------------------------------------------------------------------
-- 1. Workflow Definitions
--    Stores versioned, immutable workflow blueprints (DAG definitions).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.cwf_workflow_definitions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL,
  version              INTEGER     NOT NULL DEFAULT 1,
  description          TEXT,
  -- Full definition stored as JSONB (nodes, edges, milestones, retry policies)
  definition_json      JSONB       NOT NULL DEFAULT '{}',
  tags                 TEXT[]      NOT NULL DEFAULT '{}',
  -- Soft delete
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cwf_workflow_definitions_version_positive CHECK (version > 0)
);

COMMENT ON TABLE ai_platform.cwf_workflow_definitions IS
  'Versioned workflow blueprints for the Creative Workflow Engine v2 (Team 01). '
  'Each row is an immutable snapshot at a given version. '
  'Managed by feature/01-creative-workflow.';

CREATE INDEX IF NOT EXISTS cwf_wdef_name_idx
  ON ai_platform.cwf_workflow_definitions (name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cwf_wdef_tags_idx
  ON ai_platform.cwf_workflow_definitions USING GIN (tags)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS cwf_wdef_updated_idx
  ON ai_platform.cwf_workflow_definitions (updated_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Execution Plans
--    One plan per (workflow_definition_id, context) execution attempt.
--    Stores the full computed plan (parallel groups, critical path, nodes)
--    as JSONB alongside denormalised status counters for fast queries.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.cwf_execution_plans (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id  UUID        NOT NULL
    REFERENCES ai_platform.cwf_workflow_definitions (id) ON DELETE RESTRICT,
  workflow_version        INTEGER     NOT NULL,

  -- External context (e.g. creative_project UUID)
  context_id              TEXT        NOT NULL,
  context_type            TEXT        NOT NULL,

  -- Plan lifecycle status
  status                  TEXT        NOT NULL DEFAULT 'pending'
    CONSTRAINT cwf_plan_status_check
      CHECK (status IN ('pending','running','paused','completed','cancelled','failed')),

  -- Computed topology (immutable after build)
  parallel_groups_json    JSONB       NOT NULL DEFAULT '[]',
  critical_path_json      JSONB       NOT NULL DEFAULT '[]',
  topological_order_json  JSONB       NOT NULL DEFAULT '[]',

  -- Live node states
  nodes_json              JSONB       NOT NULL DEFAULT '[]',

  -- Milestones
  milestones_json         JSONB       NOT NULL DEFAULT '[]',

  -- Denormalised progress counters (updated on each node transition)
  progress_pct            NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  total_nodes             INTEGER      NOT NULL DEFAULT 0,
  completed_nodes         INTEGER      NOT NULL DEFAULT 0,
  failed_nodes            INTEGER      NOT NULL DEFAULT 0,
  running_nodes           INTEGER      NOT NULL DEFAULT 0,
  skipped_nodes           INTEGER      NOT NULL DEFAULT 0,
  pending_nodes           INTEGER      NOT NULL DEFAULT 0,
  ready_nodes             INTEGER      NOT NULL DEFAULT 0,

  -- Lifecycle timestamps
  started_at              TIMESTAMPTZ,
  paused_at               TIMESTAMPTZ,
  resumed_at              TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  cancel_reason           TEXT,
  completed_at            TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,

  -- Arbitrary metadata
  metadata_json           JSONB       NOT NULL DEFAULT '{}',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cwf_plan_progress_range CHECK (progress_pct BETWEEN 0 AND 100)
);

COMMENT ON TABLE ai_platform.cwf_execution_plans IS
  'Runtime execution plans derived from workflow definitions (Team 01). '
  'Each plan tracks live node statuses, topology, and progress. '
  'Managed by feature/01-creative-workflow.';

CREATE INDEX IF NOT EXISTS cwf_plan_definition_idx
  ON ai_platform.cwf_execution_plans (workflow_definition_id);

CREATE INDEX IF NOT EXISTS cwf_plan_context_idx
  ON ai_platform.cwf_execution_plans (context_id, context_type);

CREATE INDEX IF NOT EXISTS cwf_plan_status_idx
  ON ai_platform.cwf_execution_plans (status)
  WHERE status NOT IN ('completed', 'cancelled', 'failed');

CREATE INDEX IF NOT EXISTS cwf_plan_updated_idx
  ON ai_platform.cwf_execution_plans (updated_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Audit / event log (append-only)
--    Lightweight record of every plan-level and node-level state change.
--    Does NOT replace the shared ai_events table — this is domain-local.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_platform.cwf_plan_events (
  id           BIGSERIAL   PRIMARY KEY,
  plan_id      UUID        NOT NULL
    REFERENCES ai_platform.cwf_execution_plans (id) ON DELETE CASCADE,
  event_type   TEXT        NOT NULL,   -- e.g. plan_started, node_completed, plan_paused
  node_id      TEXT,                   -- null for plan-level events
  payload_json JSONB       NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_platform.cwf_plan_events IS
  'Append-only audit trail for execution plan and node state changes (Team 01).';

CREATE INDEX IF NOT EXISTS cwf_plan_events_plan_idx
  ON ai_platform.cwf_plan_events (plan_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS cwf_plan_events_type_idx
  ON ai_platform.cwf_plan_events (event_type);

-- ---------------------------------------------------------------------------
-- End of Team 01 migration draft
-- ---------------------------------------------------------------------------
