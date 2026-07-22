-- Team 37 performance indexes
-- Applied: hand-written DDL (drizzle-kit push NOT used — it proposes dropping the schema)
-- These are additive, backward-compatible changes with no lock escalation risk.

-- ai_design_versions: project_id is queried in WHERE on every canvas/version load
-- and in GROUP BY for version-count aggregation. Without this index every scan
-- is sequential over the entire versions table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_design_versions_project_id
  ON ai_platform.ai_design_versions (project_id);

-- ai_design_versions: version_number + project_id for the ORDER BY DESC used in
-- listDesignVersions and the "get last version" sub-query in saveDesignCanvas.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_design_versions_project_version
  ON ai_platform.ai_design_versions (project_id, version_number DESC);

-- ai_design_projects: status is used as an optional WHERE filter on project list.
-- Also helps the count(*) query when filtering by status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_design_projects_status
  ON ai_platform.ai_design_projects (status);

-- ai_design_projects: updated_at is the default ORDER BY for project list.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_design_projects_updated_at
  ON ai_platform.ai_design_projects (updated_at DESC);

-- ai_asset_library: (email_hash, active, archived) is the base filter on every
-- listAssetLibrary call; a composite index avoids a full-table scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_asset_library_owner_state
  ON ai_platform.ai_asset_library (email_hash, active, archived);

-- ai_asset_library: category is an optional additional WHERE filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_asset_library_category
  ON ai_platform.ai_asset_library (email_hash, category)
  WHERE active = true AND archived = false;
