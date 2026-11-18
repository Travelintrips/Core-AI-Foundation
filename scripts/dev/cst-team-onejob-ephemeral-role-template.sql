-- CST AI TEAM MODEL PILOT: short-lived dedicated DB login, exact job and worker.
-- NOT a general production migration. Only generate after a disposable PostgreSQL rehearsal.
-- Replace every named template placeholder with a verified literal; never execute raw template.
-- The runtime application role aicore_dev_runtime is never changed.
DO $guard$
BEGIN
 IF current_database() <> '{{EXPECTED_DATABASE}}'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime')
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{{PILOT_ROLE}}')
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_WRONG_DATABASE_OR_EXISTING_ROLE'; END IF;
 IF '{{PILOT_WORKER_NAME}}' !~ '^cst-dev-dell-onejob-[0-9]{8}-[0-9a-f]{8}$'
    OR EXISTS(SELECT 1 FROM ai_platform.ai_workers WHERE worker_name='{{PILOT_WORKER_NAME}}')
 THEN RAISE EXCEPTION 'CST_MODEL_PILOT_FRESH_WORKER_REQUIRED'; END IF;
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
-- Existing event-bus publish() uses INSERT ... RETURNING, so both SELECT
-- and INSERT are needed. No event UPDATE, subscription access or dispatch grant.
GRANT SELECT,INSERT ON TABLE ai_platform.ai_events TO {{PILOT_ROLE}};
GRANT INSERT ON TABLE ai_platform.ai_audit_logs TO {{PILOT_ROLE}};
GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq,ai_platform.ai_workers_id_seq,ai_platform.ai_audit_logs_id_seq,ai_platform.ai_events_id_seq TO {{PILOT_ROLE}};
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
   AND worker_name='{{PILOT_WORKER_NAME}}'
   AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull'
   AND node_id='{{PILOT_WORKER_NAME}}' AND model_id='qwen2.5:3b');
CREATE POLICY cst_model_pilot_worker_insert ON ai_platform.ai_workers FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='{{PILOT_WORKER_NAME}}'
   AND worker_type='coding_worker' AND provider_slug='ollama'
   AND runtime_kind='ollama_remote_pull' AND node_id='{{PILOT_WORKER_NAME}}'
   AND lease_owner='ollama-remote:{{PILOT_WORKER_NAME}}'
   AND model_id='qwen2.5:3b' AND max_concurrent_jobs=1
   AND status='online' AND endpoint_url IS NULL
   AND capabilities='["ollama_inference"]'::jsonb);
CREATE POLICY cst_model_pilot_worker_update ON ai_platform.ai_workers FOR UPDATE TO {{PILOT_ROLE}}
 USING (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='{{PILOT_WORKER_NAME}}'
   AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull')
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND worker_name='{{PILOT_WORKER_NAME}}'
   AND worker_type='coding_worker' AND provider_slug='ollama'
   AND runtime_kind='ollama_remote_pull' AND node_id='{{PILOT_WORKER_NAME}}'
   AND lease_owner='ollama-remote:{{PILOT_WORKER_NAME}}'
   AND model_id='qwen2.5:3b' AND max_concurrent_jobs=1
   AND status IN ('online','idle','busy','offline','stale')
   AND running_jobs BETWEEN 0 AND 1
   AND endpoint_url IS NULL AND capabilities='["ollama_inference"]'::jsonb);
-- Every permitted audit must point to THIS fresh worker or THIS one approved
-- completed model job. A pilot login must never fabricate unrelated audit rows.
CREATE POLICY cst_model_pilot_audit_insert ON ai_platform.ai_audit_logs FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND status='success'
   AND ((module='worker-cluster' AND action='worker_registered' AND resource_type='ai_worker'
       AND EXISTS (
         SELECT 1 FROM ai_platform.ai_workers w
         WHERE w.id::text=ai_audit_logs.resource_id
           AND w.worker_name='{{PILOT_WORKER_NAME}}'
           AND w.worker_type='coding_worker'
           AND w.provider_slug='ollama' AND w.runtime_kind='ollama_remote_pull'
           AND w.lease_owner='ollama-remote:{{PILOT_WORKER_NAME}}'
           AND ai_audit_logs.details->>'workerName'=w.worker_name
           AND ai_audit_logs.details->>'workerType'=w.worker_type
           AND ai_audit_logs.details->>'leaseOwner'=w.lease_owner
           AND ai_audit_logs.details->'capabilities'='["ollama_inference"]'::jsonb
       ))
      OR (module='job-engine' AND action='job_completed' AND resource_type='ai_job'
       AND EXISTS (
         SELECT 1 FROM ai_platform.ai_jobs j
         JOIN ai_platform.ai_workers w ON w.worker_name='{{PILOT_WORKER_NAME}}'
         WHERE j.id::text=ai_audit_logs.resource_id
           AND j.status='completed' AND j.job_type='ollama_model_invocation'
           AND j.payload_json->>'requestId'='{{REQUEST_ID}}'
           AND j.payload_json->>'modelId'='qwen2.5:3b'
           AND w.provider_slug='ollama' AND w.runtime_kind='ollama_remote_pull'
           AND ai_audit_logs.details->>'workerId'=w.id::text
       ))
      OR (module='event-bus' AND action='event_published' AND resource_type='ai_event'
        AND details->>'eventType'='job.completed'
        AND details->>'sourceModule'='job-engine'
        AND EXISTS (
          SELECT 1 FROM ai_platform.ai_events e
          WHERE e.event_id=ai_audit_logs.resource_id
            AND e.correlation_id=ai_audit_logs.details->>'correlationId'
            AND e.event_type='job.completed'
            AND e.source_module='job-engine'
            AND e.status='published'
        ))));
-- Exactly one permitted event shape: a persisted completion for a previously
-- completed Company-1 model job, with matching jobCode/jobId/workerId.
-- No event-bus subscription read or event processing privileges are granted.
CREATE POLICY cst_model_pilot_event_read ON ai_platform.ai_events FOR SELECT TO {{PILOT_ROLE}}
 USING (
   clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND event_type='job.completed'
   AND source_module='job-engine'
   AND status='published'
   AND EXISTS (
     SELECT 1 FROM ai_platform.ai_jobs j
     JOIN ai_platform.ai_workers w
       ON w.worker_name='{{PILOT_WORKER_NAME}}'
     WHERE j.id::text = ai_events.source_id
       AND j.job_type='ollama_model_invocation'
       AND j.status='completed'
       AND j.payload_json->>'requestId'='{{REQUEST_ID}}'
       AND j.payload_json->>'modelId'='qwen2.5:3b'
       AND ai_events.payload_json->>'jobId'=j.id::text
       AND ai_events.payload_json->>'jobCode'=j.job_code
       AND ai_events.payload_json->>'jobType'=j.job_type
       AND ai_events.payload_json->>'workerId'=w.id::text
   )
 );
CREATE POLICY cst_model_pilot_event_insert ON ai_platform.ai_events FOR INSERT TO {{PILOT_ROLE}}
 WITH CHECK (
   clock_timestamp() < '{{PILOT_EXPIRES}}'::timestamptz
   AND event_type='job.completed'
   AND source_module='job-engine'
   AND status='published'
   AND EXISTS (
     SELECT 1 FROM ai_platform.ai_jobs j
     JOIN ai_platform.ai_workers w
       ON w.worker_name='{{PILOT_WORKER_NAME}}'
     WHERE j.id::text = ai_events.source_id
       AND j.job_type='ollama_model_invocation'
       AND j.status='completed'
       AND j.payload_json->>'requestId'='{{REQUEST_ID}}'
       AND j.payload_json->>'modelId'='qwen2.5:3b'
       AND ai_events.payload_json->>'jobId'=j.id::text
       AND ai_events.payload_json->>'jobCode'=j.job_code
       AND ai_events.payload_json->>'jobType'=j.job_type
       AND ai_events.payload_json->>'workerId'=w.id::text
   )
 );
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
