CREATE TABLE IF NOT EXISTS ai_platform.ai_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  risk_class TEXT NOT NULL DEFAULT 'GUARDED',
  status TEXT NOT NULL DEFAULT 'OPEN',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  repository TEXT,
  branch TEXT,
  head_sha TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  repair_task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
  last_error TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_incidents_source_check CHECK (source IN ('github','supabase','hostinger','system')),
  CONSTRAINT ai_incidents_risk_check CHECK (risk_class IN ('SAFE','GUARDED','OWNER_APPROVAL')),
  CONSTRAINT ai_incidents_status_check CHECK (status IN ('OPEN','TRIAGED','REPAIR_QUEUED','REPAIRING','VERIFYING','RESOLVED','BLOCKED','FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_incidents_fingerprint_uidx ON ai_platform.ai_incidents(fingerprint);
CREATE INDEX IF NOT EXISTS ai_incidents_status_source_idx ON ai_platform.ai_incidents(status, source);
CREATE INDEX IF NOT EXISTS ai_incidents_repo_sha_idx ON ai_platform.ai_incidents(repository, head_sha);
