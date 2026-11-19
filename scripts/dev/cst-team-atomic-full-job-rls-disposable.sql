-- DISPOSABLE PostgreSQL16 TEST ONLY. NOT a CST-DEV/PROD migration.
-- Model the entire one-job state machine atomically, including worker release,
-- one job_completed audit, one job.completed event and event_published audit.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
 IF current_database()<>'cst_team_atomic_job_fixture' THEN
   RAISE EXCEPTION 'CST_ATOMIC_COMPLETION_DISPOSABLE_DATABASE_ONLY';
 END IF;
END $guard$;
CREATE ROLE cst_team_atomic_fixture NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs(
 id integer PRIMARY KEY, job_code text NOT NULL, job_type text NOT NULL,
 required_capability text NOT NULL, status text NOT NULL,
 payload_json jsonb NOT NULL, result_json jsonb
);
CREATE TABLE ai_platform.ai_workers(
 id integer PRIMARY KEY, worker_name text NOT NULL, worker_type text NOT NULL,
 provider_slug text NOT NULL, runtime_kind text NOT NULL,
 model_id text NOT NULL, capabilities jsonb NOT NULL,
 status text NOT NULL, running_jobs integer NOT NULL, current_job integer
);
CREATE TABLE ai_platform.ai_events(
 event_id text PRIMARY KEY, event_type text NOT NULL, source_module text NOT NULL,
 source_id text NOT NULL, correlation_id text NOT NULL,
 payload_json jsonb NOT NULL,status text NOT NULL
);
CREATE TABLE ai_platform.ai_audit_logs(
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 module text NOT NULL, action text NOT NULL, resource_type text NOT NULL,
 resource_id text NOT NULL, status text NOT NULL,details jsonb
);
INSERT INTO ai_platform.ai_jobs VALUES
 (482,'OLLAMA-B7F9B5E2','ollama_model_invocation','ollama_inference','running',
 '{"requestId":"cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a","modelId":"qwen2.5:3b","_claimedByWorkerId":3628}',NULL),
 (483,'COMPANY3-OTHER','ollama_model_invocation','ollama_inference','running',
 '{"requestId":"cst-ai-team-company3-dev:other","modelId":"qwen2.5:3b","_claimedByWorkerId":9999}',NULL);
INSERT INTO ai_platform.ai_workers VALUES
 (3628,'cst-dev-dell-onejob-20261119','coding_worker','ollama','ollama_remote_pull',
  'qwen2.5:3b','["ollama_inference"]','busy',1,482),
 (9999,'other-company-worker','coding_worker','ollama','ollama_remote_pull',
  'qwen2.5:3b','["ollama_inference"]','busy',1,483);
ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA ai_platform TO cst_team_atomic_fixture;
GRANT SELECT,UPDATE ON ai_platform.ai_jobs,ai_platform.ai_workers TO cst_team_atomic_fixture;
GRANT SELECT,INSERT ON ai_platform.ai_events TO cst_team_atomic_fixture;
GRANT SELECT,INSERT ON ai_platform.ai_audit_logs TO cst_team_atomic_fixture;
GRANT USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq TO cst_team_atomic_fixture;
CREATE POLICY job_read ON ai_platform.ai_jobs FOR SELECT TO cst_team_atomic_fixture
 USING (id=482 AND job_type='ollama_model_invocation' AND required_capability='ollama_inference'
 AND payload_json->>'requestId'='cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a');
CREATE POLICY job_update ON ai_platform.ai_jobs FOR UPDATE TO cst_team_atomic_fixture
 USING (id=482 AND status='running' AND
  payload_json->>'requestId'='cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a')
 WITH CHECK (id=482 AND status='completed' AND
  payload_json->>'requestId'='cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a');
CREATE POLICY worker_read ON ai_platform.ai_workers FOR SELECT TO cst_team_atomic_fixture
 USING (id=3628 AND worker_name='cst-dev-dell-onejob-20261119'
  AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull');
CREATE POLICY worker_update ON ai_platform.ai_workers FOR UPDATE TO cst_team_atomic_fixture
 USING (id=3628 AND worker_name='cst-dev-dell-onejob-20261119' AND status='busy' AND running_jobs=1)
 WITH CHECK (id=3628 AND worker_name='cst-dev-dell-onejob-20261119' AND status='idle'
   AND running_jobs=0 AND current_job IS NULL AND capabilities='["ollama_inference"]'::jsonb);
CREATE POLICY event_read ON ai_platform.ai_events FOR SELECT TO cst_team_atomic_fixture
 USING (event_type='job.completed' AND source_module='job-engine' AND source_id='482'
  AND payload_json->>'jobId'='482' AND payload_json->>'workerId'='3628');
CREATE POLICY event_insert ON ai_platform.ai_events FOR INSERT TO cst_team_atomic_fixture
 WITH CHECK (event_type='job.completed' AND source_module='job-engine' AND source_id='482'
  AND status='published'
  AND payload_json->>'jobId'='482' AND payload_json->>'workerId'='3628'
  AND payload_json->>'jobCode'='OLLAMA-B7F9B5E2'
  AND EXISTS (SELECT 1 FROM ai_platform.ai_jobs j
   WHERE j.id=482 AND j.status='completed'));
CREATE POLICY audit_read ON ai_platform.ai_audit_logs FOR SELECT TO cst_team_atomic_fixture
 USING (
  (module='job-engine' AND action='job_completed' AND resource_id='482')
  OR (module='event-bus' AND action='event_published' AND resource_id IN
      (SELECT event_id FROM ai_platform.ai_events WHERE source_id='482'))
 );
CREATE POLICY audit_insert ON ai_platform.ai_audit_logs FOR INSERT TO cst_team_atomic_fixture
 WITH CHECK (
  (module='job-engine' AND action='job_completed' AND resource_type='ai_job'
      AND resource_id='482' AND details->>'workerId'='3628')
  OR (module='event-bus' AND action='event_published' AND resource_type='ai_event'
    AND resource_id IN
      (SELECT event_id FROM ai_platform.ai_events
        WHERE source_id='482' AND event_type='job.completed'))
 );

-- Simulate an event-audit RLS 42501 failure after the job and worker updates.
-- PostgreSQL must undo ALL statements, not merely event insertion.
BEGIN;
SET LOCAL ROLE cst_team_atomic_fixture;
DO $negative$
BEGIN
 BEGIN
  UPDATE ai_platform.ai_jobs SET status='completed',
      result_json='{"output":{"text":"CST_AI_TEAM_DELL_MODEL_DEV_OK"}}'
    WHERE id=482 AND status='running';
  UPDATE ai_platform.ai_workers SET status='idle',running_jobs=0,current_job=NULL
    WHERE id=3628 AND status='busy';
  INSERT INTO ai_platform.ai_audit_logs(module,action,resource_type,resource_id,status,details)
    VALUES('job-engine','job_completed','ai_job','482','success','{"workerId":3628}');
  INSERT INTO ai_platform.ai_events(event_id,event_type,source_module,source_id,
    correlation_id,payload_json,status)
    VALUES ('EVENT-ROLLBACK-PROBE','job.completed','job-engine','482','corr-probe',
      '{"jobId":482,"workerId":3628,"jobCode":"OLLAMA-B7F9B5E2"}','published');
  INSERT INTO ai_platform.ai_audit_logs(module,action,resource_type,resource_id,status,details)
    VALUES ('event-bus','event_published','ai_event','FORGED-UNRELATED-EVENT',
      'success','{"eventType":"job.completed","correlationId":"corr-probe"}');
  RAISE EXCEPTION 'AUDIT_DENIAL_UNEXPECTEDLY_SUCCEEDED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF (SELECT status FROM ai_platform.ai_jobs WHERE id=482)<>'running'
 OR (SELECT status FROM ai_platform.ai_workers WHERE id=3628)<>'busy'
 OR (SELECT running_jobs FROM ai_platform.ai_workers WHERE id=3628)<>1
 OR EXISTS (SELECT 1 FROM ai_platform.ai_events WHERE source_id='482')
 OR EXISTS (SELECT 1 FROM ai_platform.ai_audit_logs WHERE resource_id='482')
 THEN RAISE EXCEPTION 'ATOMIC_ROLLBACK_FAILED_AFTER_AUDIT_RLS_DENIAL'; END IF;
 RAISE NOTICE 'CST_MODEL_ATOMIC_ROLLBACK_ON_EVENT_AUDIT_DENIAL_PASS';
END $negative$;
ROLLBACK;

-- Positive path: all five records commit or none.
BEGIN;
SET LOCAL ROLE cst_team_atomic_fixture;
UPDATE ai_platform.ai_jobs SET status='completed',
 result_json='{"output":{"text":"CST_AI_TEAM_DELL_MODEL_DEV_OK"}}'
 WHERE id=482 AND status='running' AND payload_json->>'_claimedByWorkerId'='3628';
UPDATE ai_platform.ai_workers SET status='idle',running_jobs=0,current_job=NULL
 WHERE id=3628 AND status='busy' AND current_job=482 AND running_jobs=1;
INSERT INTO ai_platform.ai_audit_logs(module,action,resource_type,resource_id,status,details)
 VALUES('job-engine','job_completed','ai_job','482','success','{"workerId":3628}');
INSERT INTO ai_platform.ai_events(event_id,event_type,source_module,source_id,
 correlation_id,payload_json,status)
 VALUES ('EVENT-482-SCOPED','job.completed','job-engine','482','corr-482',
   '{"jobId":482,"workerId":3628,"jobCode":"OLLAMA-B7F9B5E2"}','published');
INSERT INTO ai_platform.ai_audit_logs(module,action,resource_type,resource_id,status,details)
 VALUES ('event-bus','event_published','ai_event','EVENT-482-SCOPED','success',
   '{"eventType":"job.completed","sourceModule":"job-engine","correlationId":"corr-482"}');
DO $positive$
BEGIN
 IF (SELECT status FROM ai_platform.ai_jobs WHERE id=482)<>'completed'
 OR (SELECT status FROM ai_platform.ai_workers WHERE id=3628)<>'idle'
 OR (SELECT running_jobs FROM ai_platform.ai_workers WHERE id=3628)<>0
 OR (SELECT count(*) FROM ai_platform.ai_events WHERE source_id='482')<>1
 OR (SELECT count(*) FROM ai_platform.ai_audit_logs)<>2
 THEN RAISE EXCEPTION 'ATOMIC_COMPLETION_COMMIT_INCOMPLETE'; END IF;
 RAISE NOTICE 'CST_MODEL_ATOMIC_FIVE_RECORD_COMMIT_PASS';
END $positive$;
COMMIT;

-- Replaying a terminal job cannot mutate it back through the scoped UPDATE.
BEGIN;
SET LOCAL ROLE cst_team_atomic_fixture;
DO $replay$
DECLARE changed integer;
BEGIN
 UPDATE ai_platform.ai_jobs SET status='completed'
   WHERE id=482 AND status='running';
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'TERMINAL_JOB_WAS_REPLAYED'; END IF;
 IF EXISTS (SELECT 1 FROM ai_platform.ai_jobs WHERE id=483)
   OR EXISTS (SELECT 1 FROM ai_platform.ai_workers WHERE id=9999)
 THEN RAISE EXCEPTION 'OTHER_COMPANY_VISIBLE_TO_PILOT'; END IF;
 RAISE NOTICE 'CST_MODEL_TERMINAL_REPLAY_AND_TENANT_ISOLATION_PASS';
END $replay$;
ROLLBACK;
DO $verify$
BEGIN
 IF (SELECT status FROM ai_platform.ai_jobs WHERE id=483)<>'running'
 OR (SELECT status FROM ai_platform.ai_workers WHERE id=9999)<>'busy'
 OR (SELECT count(*) FROM ai_platform.ai_events)<>1
 OR (SELECT count(*) FROM ai_platform.ai_audit_logs)<>2
 THEN RAISE EXCEPTION 'MODEL_FIXTURE_GLOBAL_INVARIANT_FAILED'; END IF;
END $verify$;
DROP POLICY job_read ON ai_platform.ai_jobs;
DROP POLICY job_update ON ai_platform.ai_jobs;
DROP POLICY worker_read ON ai_platform.ai_workers;
DROP POLICY worker_update ON ai_platform.ai_workers;
DROP POLICY event_read ON ai_platform.ai_events;
DROP POLICY event_insert ON ai_platform.ai_events;
DROP POLICY audit_read ON ai_platform.ai_audit_logs;
DROP POLICY audit_insert ON ai_platform.ai_audit_logs;
REVOKE SELECT,UPDATE ON ai_platform.ai_jobs,ai_platform.ai_workers FROM cst_team_atomic_fixture;
REVOKE SELECT,INSERT ON ai_platform.ai_events,ai_platform.ai_audit_logs FROM cst_team_atomic_fixture;
REVOKE USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq FROM cst_team_atomic_fixture;
REVOKE USAGE ON SCHEMA ai_platform FROM cst_team_atomic_fixture;
DROP ROLE cst_team_atomic_fixture;
SELECT 'CST_MODEL_ATOMIC_JOB_WORKER_EVENTS_AUDITS_DISPOSABLE_PASS' AS result;
