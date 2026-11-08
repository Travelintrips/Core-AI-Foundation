-- DEV ONLY. Narrow, owner-executed read-only claim exclusion for recovery
-- candidates/linked children, even when command metadata is absent or false.
-- Do not install on PROD; no commands, reservations or leases are created.
BEGIN;
DO $guard$
DECLARE tab text;
BEGIN
 IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
   RAISE EXCEPTION 'GPT02_DEV_RUNTIME_ROLE_MISSING';
 END IF;
 FOREACH tab IN ARRAY ARRAY[
   'gpt02_dev_recovery_reservations',
   'gpt02_dev_recovery_command_links'
 ] LOOP
   IF to_regclass('ai_platform.'||tab) IS NULL OR
     NOT EXISTS(
       SELECT 1 FROM pg_class c
       WHERE c.oid=to_regclass('ai_platform.'||tab)
         AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
         AND c.relrowsecurity IS TRUE AND c.relforcerowsecurity IS FALSE
     ) THEN
     RAISE EXCEPTION 'GPT02_GENERIC_CLAIM_OWNER_OR_RLS_MISMATCH:%',tab;
   END IF;
   IF has_table_privilege('aicore_dev_runtime',to_regclass('ai_platform.'||tab),'SELECT') THEN
     RAISE EXCEPTION 'GPT02_GENERIC_CLAIM_RUNTIME_SELECT_DRIFT:%',tab;
   END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_generic_claim_allowed(
  p_command_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ai_platform
AS $func$
  SELECT p_command_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ai_platform.gpt02_dev_recovery_reservations r
    WHERE r.candidate_command_id=p_command_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM ai_platform.gpt02_dev_recovery_command_links l
    WHERE l.child_command_id=p_command_id
  )
$func$;

REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_generic_claim_allowed(uuid) FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
    EXECUTE format('REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_generic_claim_allowed(uuid) FROM %I',r);
  END IF;
 END LOOP;
END $roles$;
GRANT EXECUTE ON FUNCTION ai_platform.gpt02_dev_generic_claim_allowed(uuid)
 TO aicore_dev_runtime;
COMMIT;
