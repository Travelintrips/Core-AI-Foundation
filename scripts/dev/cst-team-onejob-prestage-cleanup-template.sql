-- Final cleanup, only AFTER Owner decision or expiry. Preserve the
-- WAITING job and immutable audit even on failure. TEMPLATE ONLY.
DO $guard$
BEGIN
 IF current_database()<>'{{EXPECTED_DATABASE}}'
    OR '{{EXPECTED_DATABASE}}'<>'postgres'
    OR '{{PRESTAGE_ROLE}}' !~ '^cst_team_onejob_prestage_[0-9]{8}_[a-f0-9]{8}$'
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_CLEANUP_WRONG_DATABASE'; END IF;
END $guard$;
DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{PRESTAGE_ROLE}}' AND rolcanlogin)
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_MUST_BE_RELOCKED_FIRST'; END IF;
END $guard$;
DROP POLICY IF EXISTS cst_onejob_prestage_insert ON ai_platform.ai_jobs;
DROP POLICY IF EXISTS cst_onejob_prestage_select ON ai_platform.ai_jobs;
DROP POLICY IF EXISTS cst_onejob_owner_intent_read ON ai_platform.ai_jobs;
REVOKE INSERT(job_code,job_type,required_capability,status,max_retry,
 retry_strategy,priority,priority_score,payload_json)
 ON ai_platform.ai_jobs FROM {{PRESTAGE_ROLE}};
REVOKE SELECT(id,job_code,status,payload_json)
 ON ai_platform.ai_jobs FROM {{PRESTAGE_ROLE}};
REVOKE USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq FROM {{PRESTAGE_ROLE}};
REVOKE USAGE ON SCHEMA ai_platform FROM {{PRESTAGE_ROLE}};
REVOKE CONNECT ON DATABASE {{EXPECTED_DATABASE}} FROM {{PRESTAGE_ROLE}};
DROP ROLE IF EXISTS {{PRESTAGE_ROLE}};
DO $guard$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='ai_platform'
    AND indexname='cst_onejob_company1_one_active_waiting')
    OR NOT EXISTS(SELECT 1 FROM ai_platform.ai_jobs
      WHERE job_code='{{JOB_CODE}}'
      AND payload_json->>'requestId'='{{REQUEST_ID}}')
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_IMMUTABLE_JOB_OR_INDEX_MISSING'; END IF;
END $guard$;
