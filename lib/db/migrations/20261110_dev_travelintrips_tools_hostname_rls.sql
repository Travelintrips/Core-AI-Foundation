-- DEV ONLY. Approved 2026-11-10. Supabase project CST-DEV: xssrfshdrtdfupgqwfdw.
-- Explicitly scoped RLS for a model-free hostname consumer; NO PROD and NO browser wake.
-- No GRANT, schema ownership, function, or existing policy changes.
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='ai_platform' AND tablename='ai_coding_bridge_commands'
         AND policyname='dev_travelintrips_commands_insert')
     OR NOT EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='ai_platform' AND tablename='ai_coding_bridge_presence'
         AND policyname='dev_runtime_travelintrips_presence_insert')
  THEN
    RAISE EXCEPTION 'Not the expected isolated AI Core DEV RLS baseline';
  END IF;
END
$guard$;

CREATE POLICY dev_travelintrips_tools_presence_insert_20261110
ON ai_platform.ai_coding_bridge_presence FOR INSERT TO aicore_dev_runtime
WITH CHECK (
  client_id = 'openclaw-travelintrips-tools-dev' AND source = 'openclaw'
  AND metadata_json ->> 'role' = 'bounded_device_executor'
  AND metadata_json ->> 'reportedHealth' IN ('healthy','degraded')
  AND (metadata_json -> 'capabilities') @> '["device:hostname"]'::jsonb
  AND NOT ((metadata_json -> 'capabilities') @> '["chatgpt:wake"]'::jsonb)
);
CREATE POLICY dev_travelintrips_tools_presence_select_20261110
ON ai_platform.ai_coding_bridge_presence FOR SELECT TO aicore_dev_runtime
USING (
  client_id = 'openclaw-travelintrips-tools-dev' AND source = 'openclaw'
  AND metadata_json ->> 'role' = 'bounded_device_executor'
  AND metadata_json ->> 'reportedHealth' IN ('healthy','degraded')
  AND (metadata_json -> 'capabilities') @> '["device:hostname"]'::jsonb
  AND NOT ((metadata_json -> 'capabilities') @> '["chatgpt:wake"]'::jsonb)
);
CREATE POLICY dev_travelintrips_tools_presence_update_20261110
ON ai_platform.ai_coding_bridge_presence FOR UPDATE TO aicore_dev_runtime
USING (
  client_id = 'openclaw-travelintrips-tools-dev' AND source = 'openclaw'
  AND metadata_json ->> 'role' = 'bounded_device_executor'
  AND metadata_json ->> 'reportedHealth' IN ('healthy','degraded')
  AND (metadata_json -> 'capabilities') @> '["device:hostname"]'::jsonb
  AND NOT ((metadata_json -> 'capabilities') @> '["chatgpt:wake"]'::jsonb)
) WITH CHECK (
  client_id = 'openclaw-travelintrips-tools-dev' AND source = 'openclaw'
  AND metadata_json ->> 'role' = 'bounded_device_executor'
  AND metadata_json ->> 'reportedHealth' IN ('healthy','degraded')
  AND (metadata_json -> 'capabilities') @> '["device:hostname"]'::jsonb
  AND NOT ((metadata_json -> 'capabilities') @> '["chatgpt:wake"]'::jsonb)
);

CREATE POLICY dev_travelintrips_tools_commands_insert_20261110
ON ai_platform.ai_coding_bridge_commands FOR INSERT TO aicore_dev_runtime
WITH CHECK ((
  source = 'ai-core-chat'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND task_id IS NULL
  AND lower(btrim(instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND metadata_json ->> 'executionBoundary' = 'role-scoped'
  AND NOT (metadata_json ? 'wakeBinding')
  AND COALESCE(metadata_json ->> 'capability','') <> 'chatgpt:wake'
  AND authority_json ->> 'authority' = 'ai-core'
  AND authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND (authority_json -> 'capabilities') @> '["device:hostname"]'::jsonb
) AND status = 'RECEIVED');
CREATE POLICY dev_travelintrips_tools_commands_select_20261110
ON ai_platform.ai_coding_bridge_commands FOR SELECT TO aicore_dev_runtime
USING (
  source = 'ai-core-chat'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND task_id IS NULL
  AND lower(btrim(instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND metadata_json ->> 'executionBoundary' = 'role-scoped'
  AND NOT (metadata_json ? 'wakeBinding')
  AND COALESCE(metadata_json ->> 'capability','') <> 'chatgpt:wake'
  AND authority_json ->> 'authority' = 'ai-core'
  AND authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND (authority_json -> 'capabilities') @> '["device:hostname"]'::jsonb
);
CREATE POLICY dev_travelintrips_tools_commands_update_20261110
ON ai_platform.ai_coding_bridge_commands FOR UPDATE TO aicore_dev_runtime
USING (
  source = 'ai-core-chat'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND task_id IS NULL
  AND lower(btrim(instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND metadata_json ->> 'executionBoundary' = 'role-scoped'
  AND NOT (metadata_json ? 'wakeBinding')
  AND COALESCE(metadata_json ->> 'capability','') <> 'chatgpt:wake'
  AND authority_json ->> 'authority' = 'ai-core'
  AND authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND (authority_json -> 'capabilities') @> '["device:hostname"]'::jsonb
) WITH CHECK (
  source = 'ai-core-chat'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND task_id IS NULL
  AND lower(btrim(instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND metadata_json ->> 'executionBoundary' = 'role-scoped'
  AND NOT (metadata_json ? 'wakeBinding')
  AND COALESCE(metadata_json ->> 'capability','') <> 'chatgpt:wake'
  AND authority_json ->> 'authority' = 'ai-core'
  AND authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND (authority_json -> 'capabilities') @> '["device:hostname"]'::jsonb
);

CREATE POLICY dev_travelintrips_tools_responses_insert_20261110
ON ai_platform.ai_coding_bridge_responses FOR INSERT TO aicore_dev_runtime
WITH CHECK (
  task_id IS NULL
  AND kind IN ('COMPLETED','FAILED')
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND c.source = 'ai-core-chat'
      AND c.command_type = 'EXTERNAL_AGENT_WORK'
      AND c.task_id IS NULL
      AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips','cek hostname pc travelintrips')
      AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
      AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
      AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  )
);
CREATE POLICY dev_travelintrips_tools_responses_select_20261110
ON ai_platform.ai_coding_bridge_responses FOR SELECT TO aicore_dev_runtime
USING (
  task_id IS NULL
  AND kind IN ('COMPLETED','FAILED')
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND c.source = 'ai-core-chat'
      AND c.command_type = 'EXTERNAL_AGENT_WORK'
      AND c.task_id IS NULL
      AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips','cek hostname pc travelintrips')
      AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
      AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
      AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  )
);
CREATE POLICY dev_travelintrips_tools_responses_update_20261110
ON ai_platform.ai_coding_bridge_responses FOR UPDATE TO aicore_dev_runtime
USING (
  task_id IS NULL
  AND kind IN ('COMPLETED','FAILED')
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND c.source = 'ai-core-chat'
      AND c.command_type = 'EXTERNAL_AGENT_WORK'
      AND c.task_id IS NULL
      AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips','cek hostname pc travelintrips')
      AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
      AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
      AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  )
) WITH CHECK (
  task_id IS NULL
  AND kind IN ('COMPLETED','FAILED')
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND c.source = 'ai-core-chat'
      AND c.command_type = 'EXTERNAL_AGENT_WORK'
      AND c.task_id IS NULL
      AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips','cek hostname pc travelintrips')
      AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
      AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
      AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  )
);
