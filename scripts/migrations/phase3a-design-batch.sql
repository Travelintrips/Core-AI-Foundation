-- ============================================================================
-- Phase 3A: Batch Orchestration — Design Template Engine
--
-- Additive-only migration. Adds dispatch marker columns to design_render_items
-- and a cancelled_items counter + new status constants to design_render_batches.
-- Nothing existing is dropped or modified.
-- ============================================================================

-- ── design_render_items: dispatch marker columns ─────────────────────────────

ALTER TABLE ai_platform.design_render_items
  ADD COLUMN IF NOT EXISTS dispatch_status        TEXT    NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS dispatch_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_dispatched_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_job_id           TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id              TEXT,
  ADD COLUMN IF NOT EXISTS lease_expires_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at           TIMESTAMPTZ;

-- ── design_render_batches: extra counter + dispatching/cancelling statuses ───
-- Statuses are stored as TEXT — no enum DDL change required.
-- Just add the cancelled_items counter which was missing.

ALTER TABLE ai_platform.design_render_batches
  ADD COLUMN IF NOT EXISTS cancelled_items INTEGER NOT NULL DEFAULT 0;

-- ── Indexes for recovery and fairness queries ────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dri_dispatch_status
  ON ai_platform.design_render_items (batch_id, dispatch_status);

CREATE INDEX IF NOT EXISTS idx_dri_lease_recovery
  ON ai_platform.design_render_items (status, lease_expires_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_drb_active_tenant
  ON ai_platform.design_render_batches (tenant_id, status)
  WHERE status NOT IN ('completed', 'partially_failed', 'failed', 'cancelled');
