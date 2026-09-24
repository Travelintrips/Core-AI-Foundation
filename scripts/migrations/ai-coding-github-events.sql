CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_github_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id TEXT NOT NULL, event_name TEXT NOT NULL, repository TEXT NOT NULL,
 head_sha TEXT, payload_json JSONB NOT NULL DEFAULT '{}'::jsonb, status TEXT NOT NULL DEFAULT 'RECEIVED',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
 CONSTRAINT ai_coding_github_deliveries_status_check CHECK(status IN('RECEIVED','PUBLISHED','IGNORED','FAILED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_github_deliveries_delivery_uidx ON ai_platform.ai_coding_github_deliveries(delivery_id);
CREATE INDEX IF NOT EXISTS ai_coding_github_deliveries_repo_sha_idx ON ai_platform.ai_coding_github_deliveries(repository,head_sha);
