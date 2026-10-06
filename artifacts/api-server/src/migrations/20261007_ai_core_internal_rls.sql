-- Internal AI Core tables are server-side only.
-- Keep them inaccessible to Supabase anon/authenticated Data API roles.

SET search_path TO ai_platform, public;

ALTER TABLE ai_platform.mcp_oauth_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_core_mcp_event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_core_mcp_event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_core_chat_inbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_coding_active_file_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ai_platform.mcp_oauth_pairings FROM anon, authenticated;
REVOKE ALL ON TABLE ai_platform.ai_core_mcp_event_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE ai_platform.ai_core_mcp_event_deliveries FROM anon, authenticated;
REVOKE ALL ON TABLE ai_platform.ai_core_chat_inbox_messages FROM anon, authenticated;
REVOKE ALL ON TABLE ai_platform.ai_coding_active_file_reservations FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_platform.mcp_oauth_pairings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_platform.ai_core_mcp_event_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_platform.ai_core_mcp_event_deliveries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_platform.ai_core_chat_inbox_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_platform.ai_coding_active_file_reservations TO service_role;

DROP POLICY IF EXISTS service_role_only ON ai_platform.mcp_oauth_pairings;
CREATE POLICY service_role_only ON ai_platform.mcp_oauth_pairings TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_only ON ai_platform.ai_core_mcp_event_subscriptions;
CREATE POLICY service_role_only ON ai_platform.ai_core_mcp_event_subscriptions TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_only ON ai_platform.ai_core_mcp_event_deliveries;
CREATE POLICY service_role_only ON ai_platform.ai_core_mcp_event_deliveries TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_only ON ai_platform.ai_core_chat_inbox_messages;
CREATE POLICY service_role_only ON ai_platform.ai_core_chat_inbox_messages TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS service_role_only ON ai_platform.ai_coding_active_file_reservations;
CREATE POLICY service_role_only ON ai_platform.ai_coding_active_file_reservations TO service_role USING (true) WITH CHECK (true);
