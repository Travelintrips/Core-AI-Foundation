-- Manual CST-DEV-only target replacement authorized by Boss on 2026-10-18.
-- Verified project: xssrfshdrtdfupgqwfdw. Confirm that project in the connector
-- before running this file; PostgreSQL role names are not project identity proof.
-- Replace one destination, retaining the same OAuth owner, worker and DEV scope.
-- Original CREATE migration remains immutable; this file has no startup hook.
-- No grants, role changes, row edits, policy deletion or PROD execution.
--
-- ROLLBACK: first terminate any new-target watches through the authenticated
-- checkpoint protocol. Prepare a separately reviewed inverse of this script:
-- swap only old_target/new_target and pin expected_before_md5 to the verified
-- after_expression_md5 recorded below. Retain every guard and the zero-watch gate.
-- Do not drop the policy or reapply the historical CREATE migration.

BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '20s';

-- Fence registration and policy changes between the precheck and ALTER.
LOCK TABLE ai_platform.ai_coding_bridge_commands IN SHARE ROW EXCLUSIVE MODE;

DO $retarget$
DECLARE
  old_target CONSTANT text := '6ad3a9a6-97e4-83ec-af32-a0a5d580b649';
  new_target CONSTANT text := '6ad4a482-5368-83ec-a520-43a4b08d38a6';
  owner_channel CONSTANT text :=
    'ai-engine-oauth:84e4810f3b3b392675d0fd655ea01c3ee82c9160616adc35c1dfe06ac1568a67';
  expected_before_md5 CONSTANT text := '85c089fec894985234498df3bf1c6ae2';
  runtime_role oid := to_regrole('aicore_dev_runtime');
  target_table oid := to_regclass('ai_platform.ai_coding_bridge_commands');
  before_policy record;
  after_policy record;
  before_force_rls boolean;
  after_force_rls boolean;
  old_literal text := quote_literal(old_target);
  new_literal text := quote_literal(new_target);
  expected_after text;
BEGIN
  IF runtime_role IS NULL OR target_table IS NULL THEN
    RAISE EXCEPTION 'DEV_RETARGET_EXPECTED_ROLE_OR_TABLE_MISSING';
  END IF;
  IF row_security_active(target_table) THEN
    RAISE EXCEPTION 'DEV_RETARGET_REQUIRES_UNFILTERED_WATCH_VISIBILITY';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = runtime_role AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'DEV_RETARGET_RUNTIME_ROLE_PRIVILEGE_DRIFT';
  END IF;

  SELECT c.relforcerowsecurity INTO before_force_rls
  FROM pg_class c
  WHERE c.oid = target_table AND c.relrowsecurity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEV_RETARGET_EXPECTED_RLS_ENABLED';
  END IF;

  SELECT p.oid, p.polcmd, p.polpermissive, p.polroles,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
  INTO before_policy
  FROM pg_policy p
  WHERE p.polrelid = target_table
    AND p.polname = 'dev_continuity_watch_insert';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEV_RETARGET_EXPECTED_POLICY_MISSING';
  END IF;

  IF before_policy.polcmd <> 'a'
    OR before_policy.polpermissive IS NOT TRUE
    OR before_policy.polroles IS DISTINCT FROM ARRAY[runtime_role]::oid[]
    OR before_policy.using_expression IS NOT NULL
    OR md5(before_policy.check_expression) IS DISTINCT FROM expected_before_md5
  THEN
    RAISE EXCEPTION 'DEV_RETARGET_REVIEWED_POLICY_DRIFT';
  END IF;

  IF position(owner_channel IN before_policy.check_expression) = 0
    OR position('openclaw-travelintrips-dev' IN before_policy.check_expression) = 0
    OR position('targetConversationId' IN before_policy.check_expression) = 0
    OR position(new_literal IN before_policy.check_expression) <> 0
    OR length(before_policy.check_expression)
      - length(replace(before_policy.check_expression, old_literal, ''))
      <> length(old_literal)
  THEN
    RAISE EXCEPTION 'DEV_RETARGET_EXPECTED_SINGLE_DESTINATION';
  END IF;

  -- Global zero-watch gate, including inconsistent records that still describe
  -- a running/waiting/in-flight watch even if their active flag says otherwise.
  IF EXISTS (
    SELECT 1
    FROM ai_platform.ai_coding_bridge_commands
    WHERE command_type = 'DEV_CONTINUITY_WATCH'
      AND (
        metadata_json #>> '{devContinuity,active}' = 'true'
        OR metadata_json #>> '{devContinuity,state}' IN (
          'RUNNING', 'WAITING_CI', 'WAITING_APPROVAL',
          'FIRING', 'WAKE_QUEUED', 'WAKE_CONFIRMED'
        )
      )
  ) THEN
    RAISE EXCEPTION 'DEV_RETARGET_ACTIVE_WATCHES_PRESENT';
  END IF;

  expected_after := replace(
    before_policy.check_expression, old_literal, new_literal
  );
  -- The catalog expression is the reviewed source; only its one quoted UUID
  -- literal changes. Omitting TO and USING preserves those policy attributes.
  EXECUTE format(
    'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
    'dev_continuity_watch_insert', 'ai_platform',
    'ai_coding_bridge_commands', expected_after
  );

  SELECT p.oid, p.polcmd, p.polpermissive, p.polroles,
    pg_get_expr(p.polqual, p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
  INTO after_policy
  FROM pg_policy p
  WHERE p.polrelid = target_table
    AND p.polname = 'dev_continuity_watch_insert';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEV_RETARGET_POLICY_POSTCHECK_MISSING';
  END IF;

  IF after_policy.oid IS DISTINCT FROM before_policy.oid
    OR after_policy.polcmd IS DISTINCT FROM before_policy.polcmd
    OR after_policy.polpermissive IS DISTINCT FROM before_policy.polpermissive
    OR after_policy.polroles IS DISTINCT FROM before_policy.polroles
    OR after_policy.using_expression IS DISTINCT FROM before_policy.using_expression
    OR after_policy.check_expression IS DISTINCT FROM expected_after
    OR replace(after_policy.check_expression, new_literal, old_literal)
      IS DISTINCT FROM before_policy.check_expression
  THEN
    RAISE EXCEPTION 'DEV_RETARGET_POLICY_POSTCHECK_FAILED';
  END IF;

  SELECT c.relforcerowsecurity INTO after_force_rls
  FROM pg_class c
  WHERE c.oid = target_table AND c.relrowsecurity;
  IF NOT FOUND OR after_force_rls IS DISTINCT FROM before_force_rls THEN
    RAISE EXCEPTION 'DEV_RETARGET_RLS_POSTCHECK_FAILED';
  END IF;
END
$retarget$;

SELECT
  'DEV_TARGET_POLICY_REPLACED' AS result,
  p.polname AS policy,
  md5(pg_get_expr(p.polwithcheck, p.polrelid)) AS after_expression_md5,
  '6ad4a482-5368-83ec-a520-43a4b08d38a6' AS target_conversation_id
FROM pg_policy p
WHERE p.polrelid = 'ai_platform.ai_coding_bridge_commands'::regclass
  AND p.polname = 'dev_continuity_watch_insert';

COMMIT;
