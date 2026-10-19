-- DEV ONLY: permit the dedicated DELL ChatGPT wake worker to queue and
-- report challenge-bound browser wake commands. Apply only to CST-DEV.
--
-- No anon/authenticated grants. No PROD changes.
-- This intentionally mirrors the existing isolated worker boundary while
-- narrowing DELL access to the chatgpt:wake command shape.
--
-- ROLLBACK:
-- DROP POLICY dev_dell_wake_commands_insert ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_dell_wake_commands_select ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_dell_wake_commands_update ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_dell_wake_responses_insert ON ai_platform.ai_coding_bridge_responses;
-- DROP POLICY dev_dell_wake_responses_select ON ai_platform.ai_coding_bridge_responses;
-- DROP POLICY dev_dell_wake_responses_update ON ai_platform.ai_coding_bridge_responses;

BEGIN;

DO $$
BEGIN
  IF to_regrole('aicore_dev_runtime') IS NULL THEN
    RAISE EXCEPTION 'Expected CST-DEV runtime role is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ai_platform'
      AND c.relname = 'ai_coding_bridge_commands'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS-enabled DEV command table is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ai_platform'
      AND c.relname = 'ai_coding_bridge_responses'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS-enabled DEV response table is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ai_platform'
      AND tablename = 'ai_coding_bridge_presence'
      AND policyname = 'dev_runtime_dell_wake_presence_insert'
      AND cmd = 'INSERT'
      AND 'aicore_dev_runtime' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Expected DELL DEV presence policy is absent';
  END IF;
END $$;

CREATE POLICY dev_dell_wake_commands_insert
ON ai_platform.ai_coding_bridge_commands
AS PERMISSIVE
FOR INSERT
TO aicore_dev_runtime
WITH CHECK (
  source = 'ai-core'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
  AND metadata_json ->> 'capability' = 'chatgpt:wake'
  AND metadata_json ->> 'explicitWorkerTarget' = 'true'
  AND metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
  AND metadata_json ->> 'conversationId' LIKE 'ai-engine-oauth:%'
  AND metadata_json ->> 'eventId' ~ '^[a-f0-9]{64}$'
  AND metadata_json ->> 'assistantAttestationChallenge' ~ '^[a-f0-9]{64}$'
  AND instruction ~ '^DEV_CHATGPT_WAKE_V1 conversation=6ad4e0a7-9964-83ec-81a6-9db5eb8457ae event=[a-f0-9]{64} challenge=[a-f0-9]{64}$'
);

CREATE POLICY dev_dell_wake_commands_select
ON ai_platform.ai_coding_bridge_commands
AS PERMISSIVE
FOR SELECT
TO aicore_dev_runtime
USING (
  source = 'ai-core'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
  AND metadata_json ->> 'capability' = 'chatgpt:wake'
  AND metadata_json ->> 'explicitWorkerTarget' = 'true'
  AND metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
);

CREATE POLICY dev_dell_wake_commands_update
ON ai_platform.ai_coding_bridge_commands
AS PERMISSIVE
FOR UPDATE
TO aicore_dev_runtime
USING (
  source = 'ai-core'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
  AND metadata_json ->> 'capability' = 'chatgpt:wake'
  AND metadata_json ->> 'explicitWorkerTarget' = 'true'
  AND metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
)
WITH CHECK (
  source = 'ai-core'
  AND command_type = 'EXTERNAL_AGENT_WORK'
  AND metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
  AND metadata_json ->> 'capability' = 'chatgpt:wake'
  AND metadata_json ->> 'explicitWorkerTarget' = 'true'
  AND metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
);

CREATE POLICY dev_dell_wake_responses_insert
ON ai_platform.ai_coding_bridge_responses
AS PERMISSIVE
FOR INSERT
TO aicore_dev_runtime
WITH CHECK (EXISTS (
  SELECT 1
  FROM ai_platform.ai_coding_bridge_commands c
  WHERE c.id = command_id
    AND c.source = 'ai-core'
    AND c.command_type = 'EXTERNAL_AGENT_WORK'
    AND c.metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
    AND c.metadata_json ->> 'capability' = 'chatgpt:wake'
    AND c.metadata_json ->> 'explicitWorkerTarget' = 'true'
    AND c.metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
));

CREATE POLICY dev_dell_wake_responses_select
ON ai_platform.ai_coding_bridge_responses
AS PERMISSIVE
FOR SELECT
TO aicore_dev_runtime
USING (EXISTS (
  SELECT 1
  FROM ai_platform.ai_coding_bridge_commands c
  WHERE c.id = command_id
    AND c.source = 'ai-core'
    AND c.command_type = 'EXTERNAL_AGENT_WORK'
    AND c.metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
    AND c.metadata_json ->> 'capability' = 'chatgpt:wake'
    AND c.metadata_json ->> 'explicitWorkerTarget' = 'true'
    AND c.metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
));

CREATE POLICY dev_dell_wake_responses_update
ON ai_platform.ai_coding_bridge_responses
AS PERMISSIVE
FOR UPDATE
TO aicore_dev_runtime
USING (EXISTS (
  SELECT 1
  FROM ai_platform.ai_coding_bridge_commands c
  WHERE c.id = command_id
    AND c.source = 'ai-core'
    AND c.command_type = 'EXTERNAL_AGENT_WORK'
    AND c.metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
    AND c.metadata_json ->> 'capability' = 'chatgpt:wake'
    AND c.metadata_json ->> 'explicitWorkerTarget' = 'true'
    AND c.metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
))
WITH CHECK (EXISTS (
  SELECT 1
  FROM ai_platform.ai_coding_bridge_commands c
  WHERE c.id = command_id
    AND c.source = 'ai-core'
    AND c.command_type = 'EXTERNAL_AGENT_WORK'
    AND c.metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
    AND c.metadata_json ->> 'capability' = 'chatgpt:wake'
    AND c.metadata_json ->> 'explicitWorkerTarget' = 'true'
    AND c.metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
));

COMMIT;
