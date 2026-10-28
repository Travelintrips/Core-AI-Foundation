-- DEV only: least-privilege audit writes by the isolated AI Core runtime.
-- OAuth bearer tokens, authorization codes, and raw client IDs are never stored.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aicore_dev_runtime') THEN
    RAISE EXCEPTION 'Expected isolated AI Core DEV runtime database role is absent';
  END IF;
END $$;

GRANT INSERT ON ai_platform.mcp_oauth_exchange_audit TO aicore_dev_runtime;
GRANT USAGE ON SEQUENCE ai_platform.mcp_oauth_exchange_audit_id_seq TO aicore_dev_runtime;

DROP POLICY IF EXISTS mcp_oauth_exchange_audit_runtime_insert
  ON ai_platform.mcp_oauth_exchange_audit;
CREATE POLICY mcp_oauth_exchange_audit_runtime_insert
  ON ai_platform.mcp_oauth_exchange_audit
  FOR INSERT TO aicore_dev_runtime WITH CHECK (true);
