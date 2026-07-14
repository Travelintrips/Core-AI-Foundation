-- ─────────────────────────────────────────────────────────────────────────────
-- WP-12 RLS Policies — ai_platform schema
-- Production Readiness: Row Level Security
--
-- Run against Supabase DEV first, then PROD after validation.
-- Set search_path before applying (Supabase editor resets it between statements).
--
-- Strategy:
--   • Every table with a tenant_id column gets RLS enabled + a policy that
--     filters by the session variable app.current_tenant_id.
--   • App code sets this via SET LOCAL app.current_tenant_id = '<slug>' at
--     the start of each tenant-scoped request (see wp12-set-tenant-context.sql).
--   • Tables without tenant_id remain RLS-enabled but use an ALLOW ALL policy
--     (they are already protected by application-layer auth checks).
--   • Fail-closed: if no session variable is set, zero rows are visible on
--     tenant-scoped tables (COALESCE returns empty string → no match).
--   • Service-role connections bypass RLS (BYPASSRLS privilege on service key).
--     The app uses the service role, so RLS is a defence-in-depth layer, not
--     the sole enforcement layer — application-layer tenant checks (WP-01/02)
--     are the primary gate; RLS is a database-level backstop.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ─── Helper: set current tenant for a session ────────────────────────────────
-- Call this at the start of a pooled connection before any tenant-scoped query.
-- Example: SELECT set_config('app.current_tenant_id', 'default', true);
-- The third argument (true) makes it local to the current transaction only.

-- ─── 1. Tables with explicit tenant_id column ────────────────────────────────

-- ai_installed_packages
ALTER TABLE ai_platform.ai_installed_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_installed_packages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_installed_packages;
CREATE POLICY tenant_isolation ON ai_platform.ai_installed_packages
  USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true),
      'default'
    )
  );

-- ai_quotations (canonical service-catalog flow)
ALTER TABLE ai_platform.ai_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_quotations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_quotations;
CREATE POLICY tenant_isolation ON ai_platform.ai_quotations
  USING (
    tenant_id IS NULL  -- null = shared/default tenant, always visible
    OR tenant_id = COALESCE(current_setting('app.current_tenant_id', true), 'default')
  );

-- ai_commercial_gates
ALTER TABLE ai_platform.ai_commercial_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_commercial_gates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_commercial_gates;
CREATE POLICY tenant_isolation ON ai_platform.ai_commercial_gates
  USING (
    tenant_id IS NULL
    OR tenant_id = COALESCE(current_setting('app.current_tenant_id', true), 'default')
  );

-- ai_service_catalog (ai_services, ai_service_packages, ai_service_portfolios, ai_service_requests)
ALTER TABLE ai_platform.ai_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_services FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_services;
CREATE POLICY tenant_isolation ON ai_platform.ai_services
  USING (
    tenant_id IS NULL
    OR tenant_id = COALESCE(current_setting('app.current_tenant_id', true), 'default')
  );

ALTER TABLE ai_platform.ai_service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_service_packages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ai_platform.ai_service_packages;
CREATE POLICY tenant_isolation ON ai_platform.ai_service_packages
  USING (
    tenant_id IS NULL
    OR tenant_id = COALESCE(current_setting('app.current_tenant_id', true), 'default')
  );

-- ─── 2. Tables without tenant_id — allow all (auth is app-layer) ──────────────
-- These tables are not tenant-scoped today; RLS is enabled as a consistency
-- measure so that adding tenant filtering later is a policy-only change.

ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_audit_logs;
CREATE POLICY allow_authenticated ON ai_platform.ai_audit_logs USING (true);

ALTER TABLE ai_platform.creative_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.creative_projects;
CREATE POLICY allow_authenticated ON ai_platform.creative_projects USING (true);

ALTER TABLE ai_platform.creative_project_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.creative_project_steps;
CREATE POLICY allow_authenticated ON ai_platform.creative_project_steps USING (true);

ALTER TABLE ai_platform.creative_ai_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.creative_ai_assets;
CREATE POLICY allow_authenticated ON ai_platform.creative_ai_assets USING (true);

ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_jobs;
CREATE POLICY allow_authenticated ON ai_platform.ai_jobs USING (true);

ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_events;
CREATE POLICY allow_authenticated ON ai_platform.ai_events USING (true);

ALTER TABLE ai_platform.customer_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.customer_profiles;
CREATE POLICY allow_authenticated ON ai_platform.customer_profiles USING (true);

ALTER TABLE ai_platform.customer_dashboard_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.customer_dashboard_tokens;
CREATE POLICY allow_authenticated ON ai_platform.customer_dashboard_tokens USING (true);

ALTER TABLE ai_platform.ai_human_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_human_tasks;
CREATE POLICY allow_authenticated ON ai_platform.ai_human_tasks USING (true);

ALTER TABLE ai_platform.ai_cost_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_cost_records;
CREATE POLICY allow_authenticated ON ai_platform.ai_cost_records USING (true);

ALTER TABLE ai_platform.ai_execution_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated ON ai_platform.ai_execution_logs;
CREATE POLICY allow_authenticated ON ai_platform.ai_execution_logs USING (true);

-- ─── 3. Fail-closed verification query ───────────────────────────────────────
-- After applying this migration, run the following as a non-service-role user
-- (e.g. the anon key) WITHOUT setting app.current_tenant_id to confirm
-- zero rows are visible on tenant-scoped tables:
--
--   SET search_path TO ai_platform;
--   SELECT count(*) FROM ai_installed_packages;  -- must return 0
--   SELECT count(*) FROM ai_quotations;           -- must return 0
--
-- And with the correct tenant set:
--   SELECT set_config('app.current_tenant_id', 'default', true);
--   SELECT count(*) FROM ai_installed_packages;  -- must return > 0 if seeded
