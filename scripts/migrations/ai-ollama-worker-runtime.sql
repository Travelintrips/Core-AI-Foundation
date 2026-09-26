-- Distributed Ollama worker runtime metadata.
-- Additive and backward-compatible with existing ai_workers rows.

ALTER TABLE ai_platform.ai_workers
  ADD COLUMN IF NOT EXISTS provider_slug text,
  ADD COLUMN IF NOT EXISTS model_id text,
  ADD COLUMN IF NOT EXISTS endpoint_url text,
  ADD COLUMN IF NOT EXISTS runtime_kind text;

CREATE INDEX IF NOT EXISTS ai_workers_provider_model_status_idx
  ON ai_platform.ai_workers (provider_slug, model_id, status);

CREATE INDEX IF NOT EXISTS ai_workers_lease_capacity_idx
  ON ai_platform.ai_workers (lease_expires_at, running_jobs, max_concurrent_jobs);
