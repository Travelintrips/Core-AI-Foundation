CREATE TABLE IF NOT EXISTS ai_platform.ai_coding_planner_authority (
  scope text PRIMARY KEY,
  holder_id text NOT NULL,
  holder_type text NOT NULL,
  lease_token uuid NOT NULL,
  fencing_generation bigint NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'PRIMARY_ACTIVE',
  lease_expires_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_coding_planner_authority_expiry_idx ON ai_platform.ai_coding_planner_authority (lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_coding_planner_authority_holder_idx ON ai_platform.ai_coding_planner_authority (holder_id);
