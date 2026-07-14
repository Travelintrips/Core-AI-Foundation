-- DDL: WP-03 Canonical Audit Log — additive tenant_id + actor_type columns
-- Run once against the Supabase dev/prod database. All tables live in the
-- ai_platform schema. Both columns are nullable — no existing row or
-- existing logAudit(...) call site needs to change for this to apply
-- cleanly (see docs/implementation/wp03-audit-log-report.md).

SET search_path TO ai_platform, public;

ALTER TABLE ai_platform.ai_audit_logs
  ADD COLUMN IF NOT EXISTS tenant_id  text,
  ADD COLUMN IF NOT EXISTS actor_type text;

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_tenant_id ON ai_platform.ai_audit_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_created_at ON ai_platform.ai_audit_logs (created_at DESC);
