-- Manual rollback-only probes for the approved CST-DEV target replacement.
-- Execute only against verified project xssrfshdrtdfupgqwfdw after the migration.
-- No probe row commits; each successful INSERT is rolled back immediately.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';
SET LOCAL row_security = on;
SET LOCAL ROLE aicore_dev_runtime;

DO $test$
DECLARE
  owner_id CONSTANT text := 'ai-engine-oauth:84e4810f3b3b392675d0fd655ea01c3ee82c9160616adc35c1dfe06ac1568a67';
  new_target CONSTANT text := '6ad4a482-5368-83ec-a520-43a4b08d38a6';
  old_target CONSTANT text := '6ad3a9a6-97e4-83ec-af32-a0a5d580b649';
  meta jsonb;
  item record;
  accepted boolean;
  denied boolean;
  message_text_value text;
  row_count_value bigint;
BEGIN
  IF current_user <> 'aicore_dev_runtime'
    OR row_security_active('ai_platform.ai_coding_bridge_commands'::regclass)
      IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'Validation not running under enforced runtime RLS';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('new target allowed', new_target, owner_id, owner_id, 'openclaw-travelintrips-dev', true),
    ('old target denied', old_target, owner_id, owner_id, 'openclaw-travelintrips-dev', false),
    ('wrong owner denied', new_target, owner_id || ':wrong', owner_id || ':wrong', 'openclaw-travelintrips-dev', false),
    ('wrong worker denied', new_target, owner_id, owner_id, 'wrong-worker', false),
    ('row owner mismatch denied', new_target, owner_id, owner_id || ':wrong', 'openclaw-travelintrips-dev', false)
  ) AS cases(label, target_id, session_owner, row_owner, worker_id, should_allow)
  LOOP
    PERFORM set_config('app.ai_core_mcp_channel', item.session_owner, true);
    meta := jsonb_build_object(
      'conversationId', item.row_owner,
      'targetConversationId', item.target_id,
      'assignedClientId', item.worker_id,
      'explicitWorkerTarget', true,
      'devContinuity', jsonb_build_object(
        'version',1,'active',true,'revision',1,'state','RUNNING',
        'wakeCount',0,'claimToken',NULL,'claimLeaseUntil',NULL,
        'wakeEventId',NULL,'wakeCommandId',NULL,'triggeredAt',NULL,
        'evidence','{}'::jsonb,'jobId','retarget-rls-rollback-probe',
        'checkpointSha',repeat('0',40)
      )
    );
    accepted := false;
    denied := false;
    BEGIN
      INSERT INTO ai_platform.ai_coding_bridge_commands
        (external_command_id,source,command_type,instruction,authority_json,metadata_json,status)
      VALUES (
        'dev-continuity-watch:' || md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text),
        'ai-core','DEV_CONTINUITY_WATCH',
        'Passive DEV continuity deadline; never worker-executable.',
        '{"environment":"DEV","passive":true,"allowedActions":["chatgpt:wake"]}'::jsonb,
        meta,'RECEIVED'
      );
      GET DIAGNOSTICS row_count_value = ROW_COUNT;
      IF row_count_value <> 1 THEN
        RAISE EXCEPTION 'Unexpected inserted row count';
      END IF;
      RAISE EXCEPTION USING ERRCODE='ZX001', MESSAGE='ROLLBACK_ACCEPTED_RLS_PROBE';
    EXCEPTION
      WHEN SQLSTATE 'ZX001' THEN
        GET STACKED DIAGNOSTICS message_text_value = MESSAGE_TEXT;
        IF message_text_value <> 'ROLLBACK_ACCEPTED_RLS_PROBE' THEN RAISE; END IF;
        accepted := true;
      WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS message_text_value = MESSAGE_TEXT;
        IF position('row-level security' IN message_text_value) = 0
          OR position('ai_coding_bridge_commands' IN message_text_value) = 0
        THEN
          RAISE;
        END IF;
        denied := true;
    END;
    IF accepted IS DISTINCT FROM item.should_allow
      OR denied IS DISTINCT FROM (NOT item.should_allow)
    THEN
      RAISE EXCEPTION 'RLS case failed: %, accepted=%, denied=%',
        item.label, accepted, denied;
    END IF;
    RAISE NOTICE 'PASS: %', item.label;
  END LOOP;
END
$test$;

SELECT 'RLS_RETARGET_PROBES_PASSED' AS result, 5 AS checked_cases;
ROLLBACK;
