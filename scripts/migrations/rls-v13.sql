-- ─────────────────────────────────────────────────────────────────────────────
-- WP-13 RLS Completion — ai_platform schema
-- Security Hardening: Phase 5 Import Tables
--
-- Closes the RLS gap identified in the Phase 6 Entry Approval Report
-- (docs/phase6-entry-approval-report.md, Section 2).
--
-- Root cause: material_import_staging and material_import_audit were created
-- on 2026-07-26 via 20260726_material_import_phase5.sql. The prior RLS
-- migration (rls-v12.sql, 2026-07-14) predates these tables by 12 days and
-- therefore could not cover them. This migration closes the gap.
--
-- Policy design:
--   • Identical to the 11 non-tenant-scoped tables already in rls-v12.sql.
--   • Both tables are admin-only (no tenant_id column, no customer data).
--   • Policy: allow_authenticated TO authenticated USING (true) — permits all
--     operations for authenticated Supabase roles; anonymous connections are
--     excluded explicitly by the policy.
--   • Service-role (used by the API server) continues to bypass RLS via
--     BYPASSRLS privilege — zero application behaviour change.
--   • FORCE ROW LEVEL SECURITY ensures table owner cannot bypass the policy.
--
-- Apply to: dev first, then production (see docs/production-migration-runbook.md)
-- Idempotent: DROP POLICY IF EXISTS / ENABLE is safe to re-run.
--
-- Rollback DDL (if needed):
--   ALTER TABLE ai_platform.material_import_staging  DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE ai_platform.material_import_audit    DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_staging;
--   DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_audit;
--
-- Verification query (run as service-role after applying):
--   SELECT tablename, policyname, cmd, qual
--   FROM pg_policies
--   WHERE schemaname = 'ai_platform'
--     AND tablename IN ('material_import_staging', 'material_import_audit');
--   -- Must return 2 rows (one per table), policyname = 'allow_authenticated'
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ── material_import_staging ──────────────────────────────────────────────────

ALTER TABLE ai_platform.material_import_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.material_import_staging FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_staging;
CREATE POLICY allow_authenticated ON ai_platform.material_import_staging
  TO authenticated
  USING (true);

-- ── material_import_audit ────────────────────────────────────────────────────

ALTER TABLE ai_platform.material_import_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.material_import_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated ON ai_platform.material_import_audit;
CREATE POLICY allow_authenticated ON ai_platform.material_import_audit
  TO authenticated
  USING (true);

-- ── Post-apply verification ───────────────────────────────────────────────────
-- Run this block after applying to confirm policies are in place:
--
--   SELECT
--     tablename,
--     policyname,
--     permissive,
--     roles,
--     cmd,
--     qual
--   FROM pg_policies
--   WHERE schemaname = 'ai_platform'
--     AND tablename IN ('material_import_staging', 'material_import_audit')
--   ORDER BY tablename;
--
-- Expected: 2 rows
--   material_import_audit    | allow_authenticated | PERMISSIVE | {authenticated} | ALL | true
--   material_import_staging | allow_authenticated | PERMISSIVE | {authenticated} | ALL | true
--
-- Fail-closed check (run as anon key — expect no rows and no writes because
-- the policy targets authenticated only; service-role remains unaffected via
-- BYPASSRLS):
--   This is a defence-in-depth measure. The primary gate remains the
--   application-layer ADMIN_API_KEY check on all /ai/material-import/* routes.
