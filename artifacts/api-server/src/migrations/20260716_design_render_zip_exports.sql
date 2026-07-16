-- Migration: design_render_zip_exports table
-- Phase 4 Template Library (Team 3) — run on dev/prod after integration branch merge
--
-- IMPORTANT: Replit rule — never use `drizzle-kit push` for production.
-- Apply this hand-written DDL directly via psql or the Supabase dashboard.
-- Schema: ai_platform (set via search_path or explicit qualifier)

SET search_path TO ai_platform, public;

CREATE TABLE IF NOT EXISTS design_render_zip_exports (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          TEXT        NOT NULL DEFAULT 'default',
  batch_id           BIGINT      NOT NULL,
  -- Status lifecycle: queued → generating → completed | failed
  status             TEXT        NOT NULL DEFAULT 'queued',
  -- sha256 of sorted {item_id, output_storage_path, checksum} for all completed
  -- render items. Same output set → same fingerprint (idempotent).
  source_fingerprint TEXT        NOT NULL,
  -- Object storage path once ZIP is generated
  zip_storage_path   TEXT,
  file_size_bytes    BIGINT,
  -- JSON manifest embedded in ZIP. Shape: { batchId, tenantId, exportedAt, sourceFingerprint, items[] }
  manifest_json      JSONB,
  error_message      TEXT,
  retry_count        INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant + batch lookup (poll endpoint)
CREATE INDEX IF NOT EXISTS idx_drze_tenant_batch
  ON design_render_zip_exports (tenant_id, batch_id, created_at DESC);

-- Idempotency check: one completed export per fingerprint per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_drze_fingerprint_tenant
  ON design_render_zip_exports (tenant_id, source_fingerprint)
  WHERE status = 'completed';

COMMENT ON TABLE design_render_zip_exports IS
  'Tracks ZIP export jobs for design render batches. Idempotent via source_fingerprint.';
