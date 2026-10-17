-- DEV ONLY. Apply AFTER application read/ACK paths bind a server-derived
-- OAuth channel with SELECT set_config('app.ai_core_mcp_channel', $channel, true)
-- inside the SAME db.transaction() as the SQL statement. Never use a
-- client-supplied conversation ID or session-level SET.
-- Role is restricted to authenticated DEV backend; not anon/authenticated.
BEGIN;
GRANT SELECT ON ai_platform.ai_coding_bridge_commands TO aicore_dev_runtime;
GRANT SELECT, UPDATE (acknowledged_at) ON ai_platform.ai_coding_bridge_responses TO aicore_dev_runtime;
-- ACK also updates metadata_json,updated_at on commands, thus both require UPDATE.
GRANT UPDATE (metadata_json, updated_at) ON ai_platform.ai_coding_bridge_commands TO aicore_dev_runtime;
CREATE POLICY dev_mcp_commands_select_channel ON ai_platform.ai_coding_bridge_commands
 FOR SELECT TO aicore_dev_runtime
 USING (
   current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
   AND metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
 );
CREATE POLICY dev_mcp_commands_update_channel ON ai_platform.ai_coding_bridge_commands
 FOR UPDATE TO aicore_dev_runtime
 USING (
   current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
   AND metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
 )
 WITH CHECK (
   current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
   AND metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
 );
CREATE POLICY dev_mcp_responses_select_channel ON ai_platform.ai_coding_bridge_responses
 FOR SELECT TO aicore_dev_runtime
 USING (EXISTS (
   SELECT 1 FROM ai_platform.ai_coding_bridge_commands cmd
   WHERE cmd.id = command_id
     AND cmd.metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
     AND current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
 ));
CREATE POLICY dev_mcp_responses_update_channel ON ai_platform.ai_coding_bridge_responses
 FOR UPDATE TO aicore_dev_runtime
 USING (EXISTS (
   SELECT 1 FROM ai_platform.ai_coding_bridge_commands cmd
   WHERE cmd.id = command_id
     AND cmd.metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
     AND current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
 ))
 WITH CHECK (EXISTS (
   SELECT 1 FROM ai_platform.ai_coding_bridge_commands cmd
   WHERE cmd.id = command_id
     AND cmd.metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
     AND current_setting('app.ai_core_mcp_channel', true) LIKE 'ai-engine-oauth:%'
 ));
COMMIT;
