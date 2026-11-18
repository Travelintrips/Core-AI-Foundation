-- CST AI TEAM SHORT-LIVED MODEL PILOT ROLE REVOCATION.
-- This template must be executed only on CST-DEV project xssrfshdrtdfupgqwfdw.
-- Does not delete job records; capture evidence first and clean those separately.
DO $guard$
BEGIN
 IF current_database() <> '{{EXPECTED_DATABASE}}'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_ROLLBACK_WRONG_DB'; END IF;
END $guard$;
-- Cut active authentication and sessions for only the dedicated pilot role.
ALTER ROLE {{PILOT_ROLE}} NOLOGIN PASSWORD NULL;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename='{{PILOT_ROLE}}' AND pid <> pg_backend_pid();
DROP POLICY IF EXISTS cst_model_pilot_jobs_read ON ai_platform.ai_jobs;
DROP POLICY IF EXISTS cst_model_pilot_jobs_insert ON ai_platform.ai_jobs;
DROP POLICY IF EXISTS cst_model_pilot_jobs_update ON ai_platform.ai_jobs;
DROP POLICY IF EXISTS cst_model_pilot_worker_read ON ai_platform.ai_workers;
DROP POLICY IF EXISTS cst_model_pilot_worker_insert ON ai_platform.ai_workers;
DROP POLICY IF EXISTS cst_model_pilot_worker_update ON ai_platform.ai_workers;
DROP POLICY IF EXISTS cst_model_pilot_audit_insert ON ai_platform.ai_audit_logs;
REVOKE SELECT,INSERT,UPDATE ON TABLE ai_platform.ai_jobs,ai_platform.ai_workers FROM {{PILOT_ROLE}};
REVOKE INSERT ON TABLE ai_platform.ai_audit_logs FROM {{PILOT_ROLE}};
REVOKE USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq,ai_platform.ai_workers_id_seq,ai_platform.ai_audit_logs_id_seq FROM {{PILOT_ROLE}};
REVOKE USAGE ON SCHEMA ai_platform FROM {{PILOT_ROLE}};
REVOKE CONNECT ON DATABASE {{EXPECTED_DATABASE}} FROM {{PILOT_ROLE}};
DROP ROLE {{PILOT_ROLE}};
DO $guard$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{{PILOT_ROLE}}') THEN
   RAISE EXCEPTION 'CST_MODEL_PILOT_ROLLBACK_ROLE_STILL_EXISTS'; END IF;
END $guard$;
