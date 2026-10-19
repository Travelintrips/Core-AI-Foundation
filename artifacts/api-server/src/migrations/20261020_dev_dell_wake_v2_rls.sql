-- DEV ONLY: extend the existing DELL ChatGPT wake INSERT policy to accept
-- the server-generated V2 envelope used by simple `gpt01 job N, ...` commands.
-- Apply only to CST-DEV. PROD is intentionally out of scope.
--
-- V2 remains fail-closed:
-- - exact DELL worker
-- - chatgpt:wake capability
-- - explicit worker targeting
-- - fixed verified conversation
-- - OAuth-bound conversation metadata
-- - 64-hex event/challenge
-- - bounded base64url task payload
-- - 64-hex requestedInstructionHash metadata
--
-- ROLLBACK:
-- ALTER POLICY dev_dell_wake_commands_insert
-- ON ai_platform.ai_coding_bridge_commands
-- TO aicore_dev_runtime
-- WITH CHECK (
--   source = 'ai-core'
--   AND command_type = 'EXTERNAL_AGENT_WORK'
--   AND metadata_json ->> 'assignedClientId' = 'openclaw-dell-chatgpt-wake-dev'
--   AND metadata_json ->> 'capability' = 'chatgpt:wake'
--   AND metadata_json ->> 'explicitWorkerTarget' = 'true'
--   AND metadata_json ->> 'targetConversationId' = '6ad4e0a7-9964-83ec-81a6-9db5eb8457ae'
--   AND metadata_json ->> 'conversationId' LIKE 'ai-engine-oauth:%'
--   AND metadata_json ->> 'eventId' ~ '^[a-f0-9]{64}$'
--   AND metadata_json ->> 'assistantAttestationChallenge' ~ '^[a-f0-9]{64}$'
--   AND instruction ~ '^DEV_CHATGPT_WAKE_V1 conversation=6ad4e0a7-9964-83ec-81a6-9db5eb8457ae event=[a-f0-9]{64} challenge=[a-f0-9]{64}$'
-- );

BEGIN;

DO $$
BEGIN
  IF to_regrole('aicore_dev_runtime') IS NULL THEN
    RAISE EXCEPTION 'Expected CST-DEV runtime role is absent';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'ai_platform'
      AND tablename = 'ai_coding_bridge_commands'
      AND policyname = 'dev_dell_wake_commands_insert'
      AND cmd = 'INSERT'
      AND 'aicore_dev_runtime' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Expected DEV DELL wake INSERT policy is absent';
  END IF;
END $$;

ALTER POLICY dev_dell_wake_commands_insert
ON ai_platform.ai_coding_bridge_commands
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
  AND (
    instruction ~ '^DEV_CHATGPT_WAKE_V1 conversation=6ad4e0a7-9964-83ec-81a6-9db5eb8457ae event=[a-f0-9]{64} challenge=[a-f0-9]{64}$'
    OR (
      instruction ~ '^DEV_CHATGPT_WAKE_V2 conversation=6ad4e0a7-9964-83ec-81a6-9db5eb8457ae event=[a-f0-9]{64} challenge=[a-f0-9]{64} task=[A-Za-z0-9_-]{1,4096}$'
      AND metadata_json ->> 'requestedInstructionHash' ~ '^[a-f0-9]{64}$'
    )
  )
);

COMMIT;
