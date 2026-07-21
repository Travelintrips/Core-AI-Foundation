-- =============================================================================
-- Team 08 — Design Project Lifecycle & Persistence Adapter
-- Migration: Additive columns for creative_projects
-- =============================================================================
--
-- SAFETY:
--  - All columns are additive (IF NOT EXISTS guard).
--  - All columns are nullable or have safe defaults.
--  - Zero impact on existing rows — legacy records remain fully readable.
--  - NO columns are dropped or modified.
--  - This migration is idempotent: safe to run multiple times.
--
-- ROLLBACK:
--  To roll back, drop the three columns:
--    ALTER TABLE ai_platform.creative_projects
--      DROP COLUMN IF EXISTS design_plugin_id,
--      DROP COLUMN IF EXISTS lifecycle_version,
--      DROP COLUMN IF EXISTS lifecycle_metadata;
--  This is safe because no existing code reads these columns before Team 08 ships.
--
-- TENANT ISOLATION NOTE:
--  creative_projects has no tenant_id column (WP-04 foundation note).
--  Tenant scope is enforced at the service_requests layer. These columns
--  do not change that model.
-- =============================================================================

-- 1. design_plugin_id: records which plugin domain spawned this project.
--    Nullable — legacy projects and projects not created via a plugin stay NULL.
ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS design_plugin_id TEXT;

-- 2. lifecycle_version: optimistic concurrency counter for design lifecycle transitions.
--    Default 0 — all existing rows are at version 0, meaning any concurrent transition
--    on a legacy project will succeed on first attempt (no phantom stale errors).
ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS lifecycle_version INTEGER NOT NULL DEFAULT 0;

-- 3. lifecycle_metadata: JSONB blob for design-layer supplemental data.
--    Nullable — legacy rows have no metadata. The design lifecycle service writes
--    { designStage, lastTransitionAt, lastTransitionActor } here on each transition.
ALTER TABLE ai_platform.creative_projects
  ADD COLUMN IF NOT EXISTS lifecycle_metadata JSONB;

-- Index: supports filtering / sorting by design_plugin_id in future queries.
-- Partial index — only indexes rows where the column is set (excludes NULL legacy rows).
CREATE INDEX IF NOT EXISTS idx_creative_projects_design_plugin_id
  ON ai_platform.creative_projects (design_plugin_id)
  WHERE design_plugin_id IS NOT NULL;

-- Comment block for DB documentation
COMMENT ON COLUMN ai_platform.creative_projects.design_plugin_id
  IS 'Team 08: Plugin domain that created this project (e.g. "fashion", "interior"). NULL for legacy/direct projects.';

COMMENT ON COLUMN ai_platform.creative_projects.lifecycle_version
  IS 'Team 08: Optimistic concurrency counter. Incremented on every design lifecycle transition.';

COMMENT ON COLUMN ai_platform.creative_projects.lifecycle_metadata
  IS 'Team 08: Design-layer supplemental metadata (designStage, lastTransitionAt, lastTransitionActor). NULL for pre-Team-08 rows.';
