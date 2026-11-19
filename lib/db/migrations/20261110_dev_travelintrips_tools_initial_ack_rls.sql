-- DEV ONLY: required initial ACK for the exact hostname worker.
-- CST-DEV project xssrfshdrtdfupgqwfdw. Does not modify PROD, old policies or browser-wake guards.
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='ai_platform' AND tablename='ai_coding_bridge_responses'
      AND policyname='dev_travelintrips_tools_responses_insert_20261110')
 OR NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname='ai_platform' AND tablename='ai_coding_bridge_commands'
      AND policyname='dev_travelintrips_tools_commands_insert_20261110')
 THEN
   RAISE EXCEPTION 'Unexpected CST-DEV worker RLS baseline';
 END IF;
END $guard$;

CREATE POLICY dev_travelintrips_tools_ack_insert_20261110
ON ai_platform.ai_coding_bridge_responses
FOR INSERT TO aicore_dev_runtime
WITH CHECK (
  kind='ACK'
  AND task_id IS NULL
  AND checkpoint_json ->> 'status' = 'RECEIVED'
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND c.status = 'RECEIVED'
      AND (
  c.source = 'ai-core-chat'
  AND c.command_type = 'EXTERNAL_AGENT_WORK'
  AND c.task_id IS NULL
  AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND c.authority_json ->> 'authority' = 'ai-core'
  AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND NOT (c.metadata_json ? 'wakeBinding')
)
  )
);

CREATE POLICY dev_travelintrips_tools_ack_select_20261110
ON ai_platform.ai_coding_bridge_responses
FOR SELECT TO aicore_dev_runtime
USING (
  kind='ACK'
  AND task_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_bridge_commands c
    WHERE c.id = ai_coding_bridge_responses.command_id
      AND (
  c.source = 'ai-core-chat'
  AND c.command_type = 'EXTERNAL_AGENT_WORK'
  AND c.task_id IS NULL
  AND lower(btrim(c.instruction)) IN ('@cek hostname pc travelintrips', 'cek hostname pc travelintrips')
  AND c.metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-tools-dev'
  AND c.metadata_json ->> 'requiredCapability' = 'device:hostname'
  AND c.authority_json ->> 'authority' = 'ai-core'
  AND c.authority_json ->> 'clientId' = 'openclaw-travelintrips-tools-dev'
  AND NOT (c.metadata_json ? 'wakeBinding')
)
  )
);
