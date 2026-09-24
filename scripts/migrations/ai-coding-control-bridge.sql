-- Durable ChatGPT <-> AI Core control bridge. Additive/idempotent; does not start workers.
CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_commands (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL,
 external_command_id TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chatgpt', command_type TEXT NOT NULL DEFAULT 'INSTRUCTION',
 instruction TEXT NOT NULL, authority_json JSONB NOT NULL DEFAULT '{}'::jsonb, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 status TEXT NOT NULL DEFAULT 'RECEIVED', received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT ai_coding_bridge_commands_status_check CHECK (status IN ('RECEIVED','PROCESSING','COMPLETED','FAILED','CANCELLED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_coding_bridge_commands_external_uidx ON ai_platform.ai_coding_bridge_commands(source, external_command_id);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_commands_task_idx ON ai_platform.ai_coding_bridge_commands(task_id);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_commands_status_idx ON ai_platform.ai_coding_bridge_commands(status);
CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_responses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), command_id UUID NOT NULL REFERENCES ai_platform.ai_coding_bridge_commands(id) ON DELETE CASCADE,
 task_id UUID REFERENCES ai_platform.ai_coding_tasks(id) ON DELETE SET NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
 checkpoint_json JSONB NOT NULL DEFAULT '{}'::jsonb, metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 acknowledged_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT ai_coding_bridge_responses_kind_check CHECK (kind IN ('ACK','PROGRESS','CHECKPOINT','BLOCKER','COMPLETED','FAILED'))
);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_command_idx ON ai_platform.ai_coding_bridge_responses(command_id);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_task_idx ON ai_platform.ai_coding_bridge_responses(task_id);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_responses_ack_idx ON ai_platform.ai_coding_bridge_responses(acknowledged_at);
CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_bridge_presence (
 client_id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'chatgpt', lease_token UUID NOT NULL DEFAULT gen_random_uuid(),
 lease_expires_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_coding_bridge_presence_expiry_idx ON ai_platform.ai_coding_bridge_presence(lease_expires_at);
