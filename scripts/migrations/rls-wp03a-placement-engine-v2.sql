-- =============================================================================
-- WP-03A Placement Engine — RLS Policies (v2 rebuild)
-- Migration: rls-wp03a-placement-engine-v2.sql
--
-- Strategy (identical to rls-wp01 and rls-wp02):
--   Both layout_sessions and placements are tenant-scoped.
--   ENABLE RLS + FORCE RLS on both tables.
--   4 policies per table: SELECT, INSERT, UPDATE, DELETE.
--   NULL tenant_id = platform-wide (visible to all via service role).
--   Non-NULL tenant_id = scoped via app.current_tenant_id session variable.
--   Service-role connections bypass RLS (BYPASSRLS on service key).
--
-- Rules:
--   • Idempotent — DROP POLICY IF EXISTS before CREATE POLICY
--   • Must run AFTER wp03a-placement-engine-v2.sql
--   • Do NOT apply automatically to PROD
--
-- Total policies: 8 (4 per table)
-- =============================================================================

SET search_path TO ai_platform, public;

-- =============================================================================
-- layout_sessions
-- =============================================================================

ALTER TABLE ai_platform.layout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.layout_sessions FORCE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS sessions_select_tenant ON ai_platform.layout_sessions;
CREATE POLICY sessions_select_tenant
  ON ai_platform.layout_sessions
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- INSERT
DROP POLICY IF EXISTS sessions_insert_tenant ON ai_platform.layout_sessions;
CREATE POLICY sessions_insert_tenant
  ON ai_platform.layout_sessions
  FOR INSERT
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- UPDATE
DROP POLICY IF EXISTS sessions_update_tenant ON ai_platform.layout_sessions;
CREATE POLICY sessions_update_tenant
  ON ai_platform.layout_sessions
  FOR UPDATE
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- DELETE
DROP POLICY IF EXISTS sessions_delete_tenant ON ai_platform.layout_sessions;
CREATE POLICY sessions_delete_tenant
  ON ai_platform.layout_sessions
  FOR DELETE
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- =============================================================================
-- placements
-- =============================================================================

ALTER TABLE ai_platform.placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.placements FORCE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS placements_select_tenant ON ai_platform.placements;
CREATE POLICY placements_select_tenant
  ON ai_platform.placements
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- INSERT
DROP POLICY IF EXISTS placements_insert_tenant ON ai_platform.placements;
CREATE POLICY placements_insert_tenant
  ON ai_platform.placements
  FOR INSERT
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- UPDATE
DROP POLICY IF EXISTS placements_update_tenant ON ai_platform.placements;
CREATE POLICY placements_update_tenant
  ON ai_platform.placements
  FOR UPDATE
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  )
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- DELETE
DROP POLICY IF EXISTS placements_delete_tenant ON ai_platform.placements;
CREATE POLICY placements_delete_tenant
  ON ai_platform.placements
  FOR DELETE
  USING (
    tenant_id IS NULL
    OR tenant_id::text = COALESCE(current_setting('app.current_tenant_id', true), '')
  );

-- =============================================================================
-- Verification queries (run after applying):
--
-- 1. Check RLS enabled:
--    SELECT tablename, rowsecurity, forcerls
--    FROM pg_tables
--    WHERE schemaname = 'ai_platform'
--    AND tablename IN ('layout_sessions', 'placements');
--    Expected: rowsecurity=true, forcerls=true for both rows.
--
-- 2. Count policies:
--    SELECT tablename, COUNT(*) as policy_count
--    FROM pg_policies
--    WHERE schemaname = 'ai_platform'
--    AND tablename IN ('layout_sessions', 'placements')
--    GROUP BY tablename;
--    Expected: 4 policies per table (8 total).
-- =============================================================================
