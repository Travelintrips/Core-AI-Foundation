-- DEV-ONLY: apply to Supabase project xssrfshdrtdfupgqwfdw after review.
-- This grants the dedicated DEV runtime role access only to MCP bridge presence.
-- It does NOT grant access to unrelated webhook subscription secrets.
BEGIN;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
GRANT SELECT, INSERT, UPDATE ON TABLE ai_platform.ai_coding_bridge_presence TO aicore_dev_runtime;
-- RLS remains ENABLED. The application authenticates OAuth and derives
-- channel IDs server-side; no untrusted conversationId is used for OAuth.
CREATE POLICY dev_runtime_mcp_presence_select
ON ai_platform.ai_coding_bridge_presence FOR SELECT TO aicore_dev_runtime
USING (source = 'chatgpt-mcp' AND client_id LIKE 'chatgpt:ai-engine-oauth:%');
CREATE POLICY dev_runtime_mcp_presence_insert
ON ai_platform.ai_coding_bridge_presence FOR INSERT TO aicore_dev_runtime
WITH CHECK (source = 'chatgpt-mcp' AND client_id LIKE 'chatgpt:ai-engine-oauth:%');
CREATE POLICY dev_runtime_mcp_presence_update
ON ai_platform.ai_coding_bridge_presence FOR UPDATE TO aicore_dev_runtime
USING (source = 'chatgpt-mcp' AND client_id LIKE 'chatgpt:ai-engine-oauth:%')
WITH CHECK (source = 'chatgpt-mcp' AND client_id LIKE 'chatgpt:ai-engine-oauth:%');
COMMIT;
