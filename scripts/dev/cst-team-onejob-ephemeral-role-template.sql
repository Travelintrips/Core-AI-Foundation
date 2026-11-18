-- CST AI TEAM MODEL PILOT: short-lived dedicated DB login, exact job and worker.
-- NOT a general production migration. Only generate after a disposable PostgreSQL rehearsal.
-- Replace all {{...}} placeholders with verified literal values; never execute raw template.
-- The runtime application role aicore_dev_runtime is never changed.
DO $guard$
BEGIN
 IF current_database() <> '{{EXPECTED_DATABASE}}'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{{PILOT_ROLE}}')
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_WRONG_DATABASE_OR_EXISTING_ROLE'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.ai_jobs'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='ai_platform.ai_workers'::regclass)
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_RLS_MUST_REMAIN_ENABLED'; END IF;
END $guard$;
CREATE ROLE {{PILOT_ROLE}} LOGIN PASSWORD '{{PILOT_PASSWORD}}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  VALID UNTIL '{{PILOT_EXPIRES}}';
GRANT CONNECT ON DATABASE {{EXPECTED_DATABASE}} TO {{PILOT_ROLE}};
GRANT USAGE ON SCHEMA ai_platform TO {{PILOT_ROLE}};
GRANT SELECT,INSERT,UPDATE ON TABLE ai_platform.ai_jobs,ai_platform.ai_workers TO {{PILOT_ROLE}};
GRANT INSERT ON TABLE ai_platform.ai_audit_logs TO {{PILOT_ROLE}};
GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq,ai_platform.ai_workers_id_seq,ai_platform.ai_audit_logs_id_seq TO {{PILOT_ROLE}};
-- All policies expire independently of the LOGIN password/session.
-- No DELETE grant. Only one precisely-bound model job and model-only worker.
CREATE POLICY cst_model_pilot_jobs_read ON ai_platform.ai_jobs FOR SELECT TO {{PILOT_ROLE}}
 USING (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND job_type='ollama_model_invocation' AND required_capability='ollama_inference'
   AND payload_json->>'requestId'='{{REQUEST_ID}}'
   AND payload_json->>'modelId'='qwen2.5:3b');
CREATE POLICY cst_model_pilot_jobs_insert ON ai_platform.ai_jobs FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND job_type='ollama_model_invocation' AND required_capability='ollama_inference'
   AND status='queued' AND max_retry=0 AND retry_strategy='immediate'
   AND payload_json->>'requestId'='{{REQUEST_ID}}'
   AND payload_json->>'modelId'='qwen2.5:3b');
CREATE POLICY cst_model_pilot_jobs_update ON ai_platform.ai_jobs FOR UPDATE TO {{PILOT_ROLE}}
 USING (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND job_type='ollama_model_invocation' AND payload_json->>'requestId'='{{REQUEST_ID}}')
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND job_type='ollama_model_invocation' AND required_capability='ollama_inference'
   AND payload_json->>'requestId'='{{REQUEST_ID}}'
   AND payload_json->>'modelId'='qwen2.5:3b'
   AND status IN ('queued','running','completed','failed','retrying'));
CREATE POLICY cst_model_pilot_worker_read ON ai_platform.ai_workers FOR SELECT TO {{PILOT_ROLE}}
 USING (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='cst-dev-dell-onejob-20261119'
   AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull'
   AND node_id='cst-dev-dell-onejob-20261119' AND model_id='qwen2.5:3b');
CREATE POLICY cst_model_pilot_worker_insert ON ai_platform.ai_workers FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='cst-dev-dell-onejob-20261119'
   AND worker_type='coding_worker' AND provider_slug='ollama'
   AND runtime_kind='ollama_remote_pull' AND node_id='cst-dev-dell-onejob-20261119'
   AND lease_owner='ollama-remote:cst-dev-dell-onejob-20261119'
   AND model_id='qwen2.5:3b' AND max_concurrent_jobs=1
   AND status='online' AND endpoint_url IS NULL
   AND capabilities='["ollama_inference"]'::jsonb);
CREATE POLICY cst_model_pilot_worker_update ON ai_platform.ai_workers FOR UPDATE TO {{PILOT_ROLE}}
 USING (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='cst-dev-dell-onejob-20261119'
   AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull')
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='cst-dev-dell-onejob-20261119'
   AND worker_type='coding_worker' AND provider_slug='ollama'
   AND runtime_kind='ollama_remote_pull' AND node_id='cst-dev-dell-onejob-20261119'
   AND lease_owner='ollama-remote:cst-dev-dell-onejob-20261119'
   AND model_id='qwen2.5:3b' AND max_concurrent_jobs=1
   AND status IN ('online','idle','busy','offline','stale')
   AND running_jobs BETWEEN 0 AND 1
   AND endpoint_url IS NULL AND capabilities='["ollama_inference"]'::jsonb);
CREATE POLICY cst_model_pilot_audit_insert ON ai_platform.ai_audit_logs FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND ((module='worker-cluster' AND action='worker_registered' AND resource_type='ai_worker')
      OR (module='job-engine' AND action='job_completed' AND resource_type='ai_job')));
-- Independently validate the login has no role memberships, bypassrls or unsafe extra tables.
DO $guard$
BEGIN
 IF EXISTS (
   SELECT 1 FROM pg_roles WHERE rolname='{{PILOT_ROLE}}'
     AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb)
 ) THEN RAISE EXCEPTION 'CST_MODEL_PILOT_ROLE_ESCALATED'; END IF;
 IF EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
            WHERE r.rolname='{{PILOT_ROLE}}')
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_ROLE_INHERITANCE_PRESENT'; END IF;
END $guard$;
