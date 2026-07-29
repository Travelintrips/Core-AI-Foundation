-- ============================================================
-- WP-03A: Placement Engine — RLS policies (v2)
-- Schema: ai_platform
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY
-- Do NOT apply to production without a dry-run review.
-- ============================================================

SET search_path TO ai_platform, public;

-- ── Enable RLS ────────────────────────────────────────────────────────────────

ALTER TABLE ai_platform.layout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.placements      ENABLE ROW LEVEL SECURITY;

-- ── layout_sessions RLS policies ─────────────────────────────────────────────
-- Tenants can only see their own sessions.
-- Platform-scope service role bypasses RLS by default.

DROP POLICY IF EXISTS layout_sessions_tenant_select  ON ai_platform.layout_sessions;
DROP POLICY IF EXISTS layout_sessions_tenant_insert  ON ai_platform.layout_sessions;
DROP POLICY IF EXISTS layout_sessions_tenant_update  ON ai_platform.layout_sessions;
DROP POLICY IF EXISTS layout_sessions_tenant_delete  ON ai_platform.layout_sessions;

CREATE POLICY layout_sessions_tenant_select ON ai_platform.layout_sessions
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY layout_sessions_tenant_insert ON ai_platform.layout_sessions
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY layout_sessions_tenant_update ON ai_platform.layout_sessions
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY layout_sessions_tenant_delete ON ai_platform.layout_sessions
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── placements RLS policies ───────────────────────────────────────────────────
-- Placements carry a denormalised tenant_id matching the parent session.
-- This allows efficient RLS without a join.

DROP POLICY IF EXISTS placements_tenant_select  ON ai_platform.placements;
DROP POLICY IF EXISTS placements_tenant_insert  ON ai_platform.placements;
DROP POLICY IF EXISTS placements_tenant_update  ON ai_platform.placements;
DROP POLICY IF EXISTS placements_tenant_delete  ON ai_platform.placements;

CREATE POLICY placements_tenant_select ON ai_platform.placements
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY placements_tenant_insert ON ai_platform.placements
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY placements_tenant_update ON ai_platform.placements
  FOR UPDATE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY placements_tenant_delete ON ai_platform.placements
  FOR DELETE USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Rollback notes:
--   DROP POLICY IF EXISTS placements_tenant_select  ON ai_platform.placements;
--   DROP POLICY IF EXISTS placements_tenant_insert  ON ai_platform.placements;
--   DROP POLICY IF EXISTS placements_tenant_update  ON ai_platform.placements;
--   DROP POLICY IF EXISTS placements_tenant_delete  ON ai_platform.placements;
--   DROP POLICY IF EXISTS layout_sessions_tenant_select ON ai_platform.layout_sessions;
--   DROP POLICY IF EXISTS layout_sessions_tenant_insert ON ai_platform.layout_sessions;
--   DROP POLICY IF EXISTS layout_sessions_tenant_update ON ai_platform.layout_sessions;
--   DROP POLICY IF EXISTS layout_sessions_tenant_delete ON ai_platform.layout_sessions;
--   ALTER TABLE ai_platform.placements      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE ai_platform.layout_sessions DISABLE ROW LEVEL SECURITY;
-- ============================================================
