-- Team 36 (Design Security) — Tenant Isolation for AI Design Studio
-- Hand-written DDL; do NOT use drizzle-kit push (it proposes full schema drop).
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS.
-- Run against both DEV and PROD Supabase databases.

SET search_path TO ai_platform, public;

-- ── Add tenant_id to ai_design_projects ──────────────────────────────────────
-- DEFAULT 'default' makes this backward-compatible: all existing rows get the
-- correct single-tenant value without a data migration.

ALTER TABLE ai_platform.ai_design_projects
  ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- Index supports the most common query pattern: list all projects for a tenant.
CREATE INDEX IF NOT EXISTS idx_design_projects_tenant_id
  ON ai_platform.ai_design_projects (tenant_id);

-- Composite index for the common filtered list (tenant + status).
CREATE INDEX IF NOT EXISTS idx_design_projects_tenant_status
  ON ai_platform.ai_design_projects (tenant_id, status);

-- Note: ai_design_versions does NOT get a tenant_id column.
-- Versions are always accessed through a parent project ownership check
-- (getDesignProject with tenantId filter), so the tenant constraint is
-- enforced at the project level — adding tenant_id to versions would be
-- redundant and require a JOIN or denormalization that adds no real safety.
