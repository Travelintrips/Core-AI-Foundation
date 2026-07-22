-- =============================================================================
-- Team 34 Rev-1: Design Cost Attribution — Schema Hardening Migration
-- File: design-cost-attribution-v2.sql
--
-- SAFE TO RUN MULTIPLE TIMES: all DDL uses IF NOT EXISTS / DO $$ blocks.
--
-- MANUAL OWNER/OPS APPROVAL REQUIRED before running against production.
-- See MIGRATION VERIFICATION section at the bottom.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PHASE 7: Fix idempotency key uniqueness scope
--
-- The original migration used a GLOBALLY unique index on idempotency_key.
-- Two tenants could in theory generate the same key (e.g. "exec-1"), which
-- would cause one tenant's insert to silently fail.
--
-- Correct constraint: UNIQUE (tenant_id, idempotency_key)
-- This allows the same key string in different tenants.
--
-- If the old global unique index exists, we must:
--   1. Drop the old global index.
--   2. Create the new composite unique index.
--
-- NOTE: On a fresh database the original migration (design-cost-attribution.sql)
-- should NOT be run before this one. If it was already run, step 1 is required.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- Drop old global unique index if it exists
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'ai_platform'
      AND tablename  = 'design_cost_attributions'
      AND indexname  = 'design_cost_attributions_idempotency_key_idx'
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS ai_platform.design_cost_attributions_idempotency_key_idx';
    RAISE NOTICE 'Dropped old global unique index on idempotency_key';
  END IF;
END
$$;

-- Create tenant-scoped composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS design_cost_attributions_tenant_idem_idx
    ON ai_platform.design_cost_attributions (tenant_id, idempotency_key);

COMMENT ON INDEX ai_platform.design_cost_attributions_tenant_idem_idx IS
  'Tenant-scoped idempotency: two tenants may use the same key string without conflict.
   Documented reason for composite (not global) scope: the idempotency contract is
   per-tenant — keys like "exec-1" or "job-<uuid>" are naturally per-tenant namespaced.
   A global unique constraint would silently reject valid inserts from tenant B when
   tenant A already used the same key string.';

-- ---------------------------------------------------------------------------
-- PHASE 8: Add timezone column to design_budget_policies (optional metadata)
--
-- Allows each policy to specify the IANA timezone used for period boundary
-- calculation (e.g. "Asia/Jakarta" for a Jakarta-based tenant).
-- Default NULL means UTC is used (backward-compatible).
-- ---------------------------------------------------------------------------

ALTER TABLE ai_platform.design_budget_policies
    ADD COLUMN IF NOT EXISTS timezone_iana TEXT DEFAULT NULL;

COMMENT ON COLUMN ai_platform.design_budget_policies.timezone_iana IS
  'IANA timezone for period boundary calculation (e.g. "Asia/Jakarta").
   NULL = UTC. Used by getWindowBoundsInTimezone() in designCostAttributionService.';

-- ---------------------------------------------------------------------------
-- PHASE 7: Additional indexes (policy lookup, job/retry reconciliation)
-- ---------------------------------------------------------------------------

-- Policy lookup by (tenant, scope_type, scope_id, active)
CREATE INDEX IF NOT EXISTS design_budget_policies_tenant_scope_active_idx
    ON ai_platform.design_budget_policies (tenant_id, scope_type, scope_id, active)
    WHERE active = TRUE;

-- Tenant + project for summary queries
CREATE INDEX IF NOT EXISTS design_cost_attributions_tenant_project_idx
    ON ai_platform.design_cost_attributions (tenant_id, project_id);

-- Tenant + order for summary queries
CREATE INDEX IF NOT EXISTS design_cost_attributions_tenant_order_idx
    ON ai_platform.design_cost_attributions (tenant_id, order_id);

-- Retry reconciliation: (job_id, attempt, operation_status)
CREATE INDEX IF NOT EXISTS design_cost_attributions_job_attempt_status_idx
    ON ai_platform.design_cost_attributions (job_id, attempt, operation_status)
    WHERE job_id IS NOT NULL;

-- Budget window queries: (tenant_id, created_at) for time-ranged aggregations
CREATE INDEX IF NOT EXISTS design_cost_attributions_tenant_created_idx
    ON ai_platform.design_cost_attributions (tenant_id, created_at);

-- =============================================================================
-- MIGRATION VERIFICATION QUERIES
-- Run these after applying the migration to confirm correctness.
-- =============================================================================

-- 1. Confirm old global index is gone
-- SELECT indexname FROM pg_indexes
-- WHERE schemaname = 'ai_platform'
--   AND tablename = 'design_cost_attributions'
--   AND indexname = 'design_cost_attributions_idempotency_key_idx';
-- Expected: 0 rows

-- 2. Confirm new composite unique index exists
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = 'ai_platform'
--   AND tablename = 'design_cost_attributions'
--   AND indexname = 'design_cost_attributions_tenant_idem_idx';
-- Expected: 1 row with UNIQUE on (tenant_id, idempotency_key)

-- 3. Confirm timezone_iana column exists
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'ai_platform'
--   AND table_name   = 'design_budget_policies'
--   AND column_name  = 'timezone_iana';
-- Expected: 1 row

-- 4. Confirm re-run is idempotent (run the migration a second time — should succeed with no errors)

-- 5. Rollback documentation:
--    To roll back:
--      DROP INDEX IF EXISTS ai_platform.design_cost_attributions_tenant_idem_idx;
--      CREATE UNIQUE INDEX design_cost_attributions_idempotency_key_idx
--          ON ai_platform.design_cost_attributions (idempotency_key);
--      ALTER TABLE ai_platform.design_budget_policies DROP COLUMN IF EXISTS timezone_iana;
--    Note: rollback loses the composite-unique guarantee. Review active inserts first.

-- =============================================================================
-- PRODUCTION STATUS: MANUAL OWNER/OPS APPROVAL REQUIRED
-- Do not apply to production without DBA review and maintenance window.
-- =============================================================================
