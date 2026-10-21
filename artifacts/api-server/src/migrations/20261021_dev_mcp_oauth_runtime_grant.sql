-- DEV runtime permission for OAuth pairing.
-- Guarded so environments without the DEV-only role are unchanged.

SET search_path TO ai_platform, public;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aicore_dev_runtime') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE ai_platform.mcp_oauth_pairings TO aicore_dev_runtime';
    EXECUTE 'REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE ai_platform.mcp_oauth_pairings FROM aicore_dev_runtime';

    EXECUTE 'DROP POLICY IF EXISTS aicore_dev_runtime_pairing_select ON ai_platform.mcp_oauth_pairings';
    EXECUTE 'DROP POLICY IF EXISTS aicore_dev_runtime_pairing_insert ON ai_platform.mcp_oauth_pairings';
    EXECUTE 'DROP POLICY IF EXISTS aicore_dev_runtime_pairing_update ON ai_platform.mcp_oauth_pairings';

    EXECUTE 'CREATE POLICY aicore_dev_runtime_pairing_select ON ai_platform.mcp_oauth_pairings FOR SELECT TO aicore_dev_runtime USING (true)';
    EXECUTE 'CREATE POLICY aicore_dev_runtime_pairing_insert ON ai_platform.mcp_oauth_pairings FOR INSERT TO aicore_dev_runtime WITH CHECK (true)';
    EXECUTE 'CREATE POLICY aicore_dev_runtime_pairing_update ON ai_platform.mcp_oauth_pairings FOR UPDATE TO aicore_dev_runtime USING (true) WITH CHECK (true)';
  END IF;
END
$$;
