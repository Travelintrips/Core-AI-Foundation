-- ─────────────────────────────────────────────────────────────────────────────
-- WP-12 Missing Indexes — ai_platform schema
-- Identified in enterprise-readiness-audit-2026-07-14.md §4
--
-- All indexes use IF NOT EXISTS to be idempotent (safe to re-run).
-- Run against both DEV and PROD.
-- ─────────────────────────────────────────────────────────────────────────────

SET search_path TO ai_platform, public;

-- ─── Audit log — resource_id filter (frequently used in route audit lookups) ─
CREATE INDEX IF NOT EXISTS idx_audit_resource_id
  ON ai_platform.ai_audit_logs(resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_resource_type
  ON ai_platform.ai_audit_logs(resource_type);

CREATE INDEX IF NOT EXISTS idx_audit_module_action
  ON ai_platform.ai_audit_logs(module, action);

CREATE INDEX IF NOT EXISTS idx_audit_created_at
  ON ai_platform.ai_audit_logs(created_at DESC);

-- ─── Customer support tickets — status filter ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_support_tickets_status
  ON ai_platform.customer_support_tickets(status);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer
  ON ai_platform.customer_support_tickets(customer_profile_id);

-- ─── Creative projects — status + sourceType (heavily filtered in workspace) ─
CREATE INDEX IF NOT EXISTS idx_creative_projects_status
  ON ai_platform.creative_projects(status);

CREATE INDEX IF NOT EXISTS idx_creative_projects_source_type
  ON ai_platform.creative_projects(source_type);

CREATE INDEX IF NOT EXISTS idx_creative_projects_service_request
  ON ai_platform.creative_projects(service_request_id);

-- ─── AI service requests — status + tenant_id (used in commercial gate flow) ─
CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON ai_platform.ai_service_requests(status);

CREATE INDEX IF NOT EXISTS idx_service_requests_tenant
  ON ai_platform.ai_service_requests(tenant_id);

CREATE INDEX IF NOT EXISTS idx_service_requests_customer_email
  ON ai_platform.ai_service_requests(customer_email);

-- ─── AI jobs — status + worker (SELECT FOR UPDATE SKIP LOCKED claim pattern) ─
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority
  ON ai_platform.ai_jobs(status, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_jobs_worker_type
  ON ai_platform.ai_jobs(worker_type, status);

-- ─── AI events — event_type + source_module (event bus subscription) ─────────
CREATE INDEX IF NOT EXISTS idx_events_type
  ON ai_platform.ai_events(event_type);

CREATE INDEX IF NOT EXISTS idx_events_source_module
  ON ai_platform.ai_events(source_module);

CREATE INDEX IF NOT EXISTS idx_events_created_at
  ON ai_platform.ai_events(created_at DESC);

-- ─── Commercial gates — quotation_id + status (polling pattern) ──────────────
CREATE INDEX IF NOT EXISTS idx_commercial_gates_quotation
  ON ai_platform.ai_commercial_gates(quotation_id);

CREATE INDEX IF NOT EXISTS idx_commercial_gates_service_request
  ON ai_platform.ai_commercial_gates(service_request_id);

CREATE INDEX IF NOT EXISTS idx_commercial_gates_status
  ON ai_platform.ai_commercial_gates(status);

-- ─── Execution logs — agent + provider (observability dashboard filters) ─────
CREATE INDEX IF NOT EXISTS idx_exec_logs_agent
  ON ai_platform.ai_execution_logs(agent);

CREATE INDEX IF NOT EXISTS idx_exec_logs_provider
  ON ai_platform.ai_execution_logs(provider);

CREATE INDEX IF NOT EXISTS idx_exec_logs_job_id
  ON ai_platform.ai_execution_logs(job_id);

-- ─── Human tasks — status + assignee (task center filtering) ─────────────────
CREATE INDEX IF NOT EXISTS idx_human_tasks_status
  ON ai_platform.ai_human_tasks(status);

CREATE INDEX IF NOT EXISTS idx_human_tasks_assignee
  ON ai_platform.ai_human_tasks(assignee_id);

-- ─── Customer dashboard tokens — email_hash (workspace lookup) ───────────────
CREATE INDEX IF NOT EXISTS idx_dashboard_tokens_email_hash
  ON ai_platform.customer_dashboard_tokens(email_hash);
