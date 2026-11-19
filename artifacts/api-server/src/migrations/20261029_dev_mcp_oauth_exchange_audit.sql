-- DEV-only OAuth exchange evidence; no access/refresh tokens, codes, or raw client IDs.
CREATE TABLE IF NOT EXISTS ai_platform.mcp_oauth_exchange_audit (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL CHECK (event_type IN ('authorization_code_exchanged', 'refresh_token_exchanged')),
  issuer text NOT NULL,
  user_id integer NOT NULL,
  client_id_sha256 text NOT NULL CHECK (client_id_sha256 ~ '^[a-f0-9]{64}$'),
  client_kind text NOT NULL,
  receiver_channel text NOT NULL CHECK (receiver_channel ~ '^ai-engine-oauth:[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS mcp_oauth_exchange_audit_channel_time_idx
  ON ai_platform.mcp_oauth_exchange_audit (receiver_channel, occurred_at DESC);
ALTER TABLE ai_platform.mcp_oauth_exchange_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_platform.mcp_oauth_exchange_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON ai_platform.mcp_oauth_exchange_audit TO service_role;
DROP POLICY IF EXISTS mcp_oauth_exchange_audit_service_role ON ai_platform.mcp_oauth_exchange_audit;
CREATE POLICY mcp_oauth_exchange_audit_service_role
  ON ai_platform.mcp_oauth_exchange_audit TO service_role
  USING (true) WITH CHECK (true);
