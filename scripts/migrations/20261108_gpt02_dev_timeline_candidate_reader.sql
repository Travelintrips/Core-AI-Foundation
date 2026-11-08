-- DEV-only, narrowly scoped read-only candidate reader. No issuer/dispatch.
BEGIN;
DO $guard$
BEGIN
 IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED';
 END IF;
 IF to_regclass('ai_platform.gpt02_dev_recovery_reservations') IS NULL OR
    to_regclass('ai_platform.ai_human_tasks') IS NULL THEN
  RAISE EXCEPTION 'GPT02_TIMELINE_REQUIRED_SCHEMA_MISSING';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') THEN
  RAISE EXCEPTION 'GPT02_DEV_RUNTIME_ROLE_MISSING';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION ai_platform.gpt02_dev_timeline_candidate_reader(
 p_review_id integer,p_job_id integer,p_parent_id uuid)
RETURNS TABLE(candidate_command_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,ai_platform
AS $func$
 SELECT r.candidate_command_id FROM ai_platform.gpt02_dev_recovery_reservations r
 JOIN ai_platform.ai_human_tasks t ON t.id=r.human_review_id
 WHERE p_review_id>0 AND p_job_id>0 AND p_parent_id IS NOT NULL
 AND r.human_review_id=p_review_id AND r.job_id=p_job_id
 AND r.parent_command_id=p_parent_id AND t.source_module='ai_core_lifecycle'
 AND t.payload_json->>'taskId'=p_job_id::text
 AND t.payload_json->>'commandId'=p_parent_id::text LIMIT 1
$func$;
REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid) FROM PUBLIC;
DO $roles$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid) FROM %I',r);
  END IF;
 END LOOP;
END $roles$;
GRANT EXECUTE ON FUNCTION ai_platform.gpt02_dev_timeline_candidate_reader(integer,integer,uuid)
 TO aicore_dev_runtime;
COMMIT;
