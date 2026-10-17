-- REVIEW ONLY. Requires explicit Boss approval before execution.
-- Target: CST-DEV project xssrfshdrtdfupgqwfdw ONLY, using the authorized owner connector.
-- Purpose: one isolated PC identity may claim/report exact 'ping' canaries for 30 minutes.
-- No grants, ownership changes, service-role sharing, RLS disablement or PROD changes.
-- Run only after verifying the target project and no existing PC DEV executor/claim.
BEGIN;
DO $reviewed_canary$
DECLARE
  deadline timestamptz := clock_timestamp() + interval '30 minutes';
  predicate text;
  response_predicate text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
    RAISE EXCEPTION 'Expected DEV runtime role is absent';
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ai_platform' AND c.relname IN ('ai_coding_bridge_commands','ai_coding_bridge_responses')
      AND c.relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'Expected existing RLS boundaries are absent';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ai_platform'
             AND policyname LIKE 'dev_pc_event1340_%') THEN
    RAISE EXCEPTION 'Canary policies already exist; inspect before rerunning';
  END IF;
  predicate := format(
    'source = %L AND command_type = %L AND metadata_json->>%L = %L AND metadata_json->>%L = %L AND instruction = %L AND current_timestamp < %L::timestamptz',
    'ai-core-chat','EXTERNAL_AGENT_WORK','assignedClientId','openclaw-pc-worker-dev',
    'eventTransportCanary','1340','ping',deadline
  );
  EXECUTE format('CREATE POLICY dev_pc_event1340_commands_select ON ai_platform.ai_coding_bridge_commands FOR SELECT TO aicore_dev_runtime USING (%s)',predicate);
  EXECUTE format('CREATE POLICY dev_pc_event1340_commands_insert ON ai_platform.ai_coding_bridge_commands FOR INSERT TO aicore_dev_runtime WITH CHECK (%s)',predicate);
  EXECUTE format('CREATE POLICY dev_pc_event1340_commands_update ON ai_platform.ai_coding_bridge_commands FOR UPDATE TO aicore_dev_runtime USING (%s) WITH CHECK (%s)',predicate,predicate);
  response_predicate := format(
    'EXISTS (SELECT 1 FROM ai_platform.ai_coding_bridge_commands c WHERE c.id = command_id AND c.source = %L AND c.command_type = %L AND c.metadata_json->>%L = %L AND c.metadata_json->>%L = %L AND c.instruction = %L AND current_timestamp < %L::timestamptz)',
    'ai-core-chat','EXTERNAL_AGENT_WORK','assignedClientId','openclaw-pc-worker-dev',
    'eventTransportCanary','1340','ping',deadline
  );
  EXECUTE format('CREATE POLICY dev_pc_event1340_responses_select ON ai_platform.ai_coding_bridge_responses FOR SELECT TO aicore_dev_runtime USING (%s)',response_predicate);
  EXECUTE format('CREATE POLICY dev_pc_event1340_responses_insert ON ai_platform.ai_coding_bridge_responses FOR INSERT TO aicore_dev_runtime WITH CHECK (%s)',response_predicate);
  RAISE NOTICE 'PC DEV ping canary expires at %',deadline;
END;
$reviewed_canary$;
COMMIT;

-- Post-test rollback, separately executed by the approved owner connector:
-- BEGIN;
-- DROP POLICY dev_pc_event1340_commands_select ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_pc_event1340_commands_insert ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_pc_event1340_commands_update ON ai_platform.ai_coding_bridge_commands;
-- DROP POLICY dev_pc_event1340_responses_select ON ai_platform.ai_coding_bridge_responses;
-- DROP POLICY dev_pc_event1340_responses_insert ON ai_platform.ai_coding_bridge_responses;
-- COMMIT;
