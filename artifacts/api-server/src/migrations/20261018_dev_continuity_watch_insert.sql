-- DEV ONLY: apply exclusively to the verified CST-DEV database after explicit
-- approval for this RLS policy addition. This file has no automatic apply hook.
--
-- Purpose: permit one approved MCP owner and one paired ChatGPT conversation to
-- register passive DEV_CONTINUITY_WATCH records. Existing command INSERT policy
-- permits only EXTERNAL_AGENT_WORK, so it intentionally does not cover these.
-- No grants, role changes, UPDATE/SELECT policy changes, or existing-policy edits.
-- The owner-channel fingerprint below is an identity, not a bearer credential.
-- A different owner/target requires its own reviewed authorization.
--
-- ROLLBACK (only on CST-DEV, after reviewing any active watch):
-- DROP POLICY dev_continuity_watch_insert ON ai_platform.ai_coding_bridge_commands;

BEGIN;

-- Fail closed if the expected DEV role, RLS boundary, or existing DEV worker
-- policy is absent. Verify the Supabase project identity separately before use.
DO $$
BEGIN
  IF to_regrole('aicore_dev_runtime') IS NULL THEN
    RAISE EXCEPTION 'Expected CST-DEV runtime role is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ai_platform'
      AND c.relname = 'ai_coding_bridge_commands'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS-enabled DEV bridge table is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ai_platform'
      AND tablename = 'ai_coding_bridge_commands'
      AND policyname = 'dev_travelintrips_commands_insert'
      AND cmd = 'INSERT'
      AND 'aicore_dev_runtime' = ANY(roles)
  ) THEN
    RAISE EXCEPTION 'Expected scoped DEV worker INSERT policy is absent';
  END IF;
END $$;

-- CREATE intentionally fails if this policy already exists; do not silently
-- replace an independently changed security policy during a repeated apply.
CREATE POLICY dev_continuity_watch_insert
ON ai_platform.ai_coding_bridge_commands
AS PERMISSIVE
FOR INSERT
TO aicore_dev_runtime
WITH CHECK (
  source = 'ai-core'
  AND command_type = 'DEV_CONTINUITY_WATCH'
  AND status = 'RECEIVED'
  AND task_id IS NULL
  AND external_command_id ~ '^dev-continuity-watch:[a-f0-9]{64}$'
  AND instruction = 'Passive DEV continuity deadline; never worker-executable.'
  AND current_setting('app.ai_core_mcp_channel', true) =
    'ai-engine-oauth:84e4810f3b3b392675d0fd655ea01c3ee82c9160616adc35c1dfe06ac1568a67'
  AND metadata_json ->> 'conversationId' = current_setting('app.ai_core_mcp_channel', true)
  AND metadata_json ->> 'targetConversationId' = '6ad3a9a6-97e4-83ec-af32-a0a5d580b649'
  AND metadata_json ->> 'assignedClientId' = 'openclaw-travelintrips-dev'
  AND metadata_json @> '{"explicitWorkerTarget":true}'::jsonb
  AND authority_json = '{"environment":"DEV","passive":true,"allowedActions":["chatgpt:wake"]}'::jsonb
  AND jsonb_typeof(metadata_json -> 'devContinuity') = 'object'
  AND metadata_json -> 'devContinuity' @> '{
    "version":1,
    "active":true,
    "revision":1,
    "state":"RUNNING",
    "wakeCount":0,
    "claimToken":null,
    "claimLeaseUntil":null,
    "wakeEventId":null,
    "wakeCommandId":null,
    "triggeredAt":null,
    "evidence":{}
  }'::jsonb
  AND metadata_json #> '{devContinuity,evidence}' = '{}'::jsonb
  AND metadata_json #>> '{devContinuity,jobId}' ~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$'
  AND metadata_json #>> '{devContinuity,checkpointSha}' ~ '^[a-f0-9]{40}$'
);

COMMIT;
