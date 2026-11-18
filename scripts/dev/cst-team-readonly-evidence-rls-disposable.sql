-- DISPOSABLE PG16 ONLY — tests targeted RLS SELECT of evidence for job #482.
-- NEVER apply to CST-DEV or PROD. This is NOT a deployable migration.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'cst_team_evidence_reader_rehearsal' THEN
    RAISE EXCEPTION 'CST_EVIDENCE_READER_DISPOSABLE_DATABASE_ONLY';
  END IF;
END $guard$;
CREATE ROLE aicore_dev_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs (
  id integer PRIMARY KEY,job_code text,job_type text,status text,payload_json jsonb,
  result_json jsonb
);
CREATE TABLE ai_platform.ai_workers (
  id integer PRIMARY KEY,worker_name text,provider_slug text,runtime_kind text,model_id text
);
CREATE TABLE ai_platform.ai_events (
  event_id text PRIMARY KEY,event_type text,source_module text,source_id text,
  status text,correlation_id text,payload_json jsonb
);
CREATE TABLE ai_platform.ai_audit_logs (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,module text,action text,
  resource_id text,resource_type text,details jsonb
);
INSERT INTO ai_platform.ai_jobs VALUES
  (482,'OLLAMA-B7F9B5E2','ollama_model_invocation','completed',
   '{"requestId":"cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a","modelId":"qwen2.5:3b"}',
   '{"output":{"text":"CST_AI_TEAM_DELL_MODEL_DEV_OK"}}'),
  (483,'OTHER-COMPANY-JOB','ollama_model_invocation','completed',
   '{"requestId":"cst-ai-team-company3-dev:other","modelId":"qwen2.5:3b"}',
   '{"output":{"text":"OTHER"}}'),
  (484,'OTHER-REQUEST','ollama_model_invocation','completed',
   '{"requestId":"cst-ai-team-company1-dev:pilot-ffffffffffffffffffff","modelId":"qwen2.5:3b"}',
   '{"output":{"text":"OTHER"}}'),
  (485,'CODING-BASELINE','coding_workstream_execution','completed','{}','{}');
INSERT INTO ai_platform.ai_workers VALUES
  (3628,'cst-dev-dell-onejob-20261119','ollama','ollama_remote_pull','qwen2.5:3b'),
  (9999,'other-worker','ollama','ollama_remote_pull','qwen2.5:3b');
INSERT INTO ai_platform.ai_events VALUES
  ('event-482','job.completed','job-engine','482','published','corr-482',
    '{"jobId":482,"workerId":3628,"jobCode":"OLLAMA-B7F9B5E2","jobType":"ollama_model_invocation"}'),
  ('event-483','job.completed','job-engine','483','published','corr-483',
    '{"jobId":483,"workerId":9999,"jobCode":"OTHER-COMPANY-JOB","jobType":"ollama_model_invocation"}');
INSERT INTO ai_platform.ai_audit_logs(module,action,resource_id,resource_type,details) VALUES
  ('job-engine','job_completed','482','ai_job','{"workerId":3628}'),
  ('job-engine','job_completed','483','ai_job','{"workerId":9999}'),
  ('event-bus','event_published','event-482','ai_event',
   '{"correlationId":"corr-482","eventType":"job.completed","sourceModule":"job-engine"}'),
  ('event-bus','event_published','event-483','ai_event',
   '{"correlationId":"corr-483","eventType":"job.completed","sourceModule":"job-engine"}');

ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA ai_platform TO aicore_dev_runtime;
GRANT SELECT ON ai_platform.ai_jobs,ai_platform.ai_workers,ai_platform.ai_events,
  ai_platform.ai_audit_logs TO aicore_dev_runtime;
-- Simulates only the existing coding-job RLS visibility.
CREATE POLICY existing_coding_job_read ON ai_platform.ai_jobs FOR SELECT TO aicore_dev_runtime
  USING (job_type IN ('coding_workstream_execution','coding_repository_analyzer'));
CREATE POLICY existing_registered_worker_read ON ai_platform.ai_workers FOR SELECT TO aicore_dev_runtime
  USING (worker_name IS NOT NULL AND length(worker_name)>0);
-- Added evidence SELECT policies in disposable fixture only, exact task binding.
CREATE POLICY cst_evidence_job_482 ON ai_platform.ai_jobs FOR SELECT TO aicore_dev_runtime
  USING (id=482 AND job_type='ollama_model_invocation' AND status='completed'
    AND job_code='OLLAMA-B7F9B5E2'
    AND payload_json->>'requestId'='cst-ai-team-company1-dev:pilot-13b8cdb223d7a35a578a'
    AND payload_json->>'modelId'='qwen2.5:3b');
CREATE POLICY cst_evidence_event_482 ON ai_platform.ai_events FOR SELECT TO aicore_dev_runtime
  USING (event_type='job.completed' AND source_module='job-engine' AND source_id='482'
    AND event_id='event-482' AND correlation_id='corr-482'
    AND payload_json->>'jobId'='482' AND payload_json->>'workerId'='3628'
    AND payload_json->>'jobCode'='OLLAMA-B7F9B5E2');
CREATE POLICY cst_evidence_audit_482 ON ai_platform.ai_audit_logs FOR SELECT TO aicore_dev_runtime
  USING ((module='job-engine' AND action='job_completed' AND resource_type='ai_job'
           AND resource_id='482' AND details->>'workerId'='3628')
      OR (module='event-bus' AND action='event_published' AND resource_type='ai_event'
           AND resource_id='event-482' AND details->>'correlationId'='corr-482'));
-- Read-only, no job/event INSERT, UPDATE, DELETE, no role membership.
SET ROLE aicore_dev_runtime;
DO $test$
DECLARE visible_jobs integer; other_jobs integer; events integer; audits integer; workers integer;
BEGIN
  SELECT count(*) INTO visible_jobs FROM ai_platform.ai_jobs;
  SELECT count(*) INTO other_jobs FROM ai_platform.ai_jobs WHERE id IN (483,484);
  SELECT count(*) INTO events FROM ai_platform.ai_events;
  SELECT count(*) INTO audits FROM ai_platform.ai_audit_logs;
  SELECT count(*) INTO workers FROM ai_platform.ai_workers WHERE id=3628;
  IF visible_jobs<>2 OR other_jobs<>0 OR events<>1 OR audits<>2 OR workers<>1 THEN
    RAISE EXCEPTION 'SCOPED_EVIDENCE_READ_FAILED jobs:% others:% events:% audits:% worker:%',
      visible_jobs,other_jobs,events,audits,workers;
  END IF;
  IF has_table_privilege(current_user,'ai_platform.ai_jobs','INSERT') OR
     has_table_privilege(current_user,'ai_platform.ai_jobs','UPDATE') OR
     has_table_privilege(current_user,'ai_platform.ai_jobs','DELETE') OR
     has_table_privilege(current_user,'ai_platform.ai_events','INSERT') OR
     has_table_privilege(current_user,'ai_platform.ai_events','UPDATE') OR
     has_table_privilege(current_user,'ai_platform.ai_events','DELETE') THEN
    RAISE EXCEPTION 'READER_ROLE_ACQUIRED_WRITER_PRIVILEGES';
  END IF;
  RAISE NOTICE 'CST_EVIDENCE_READ_SCOPED_PASS: target job/event/audits visible; other company hidden; no writer access';
END $test$;
RESET ROLE;
DROP POLICY cst_evidence_job_482 ON ai_platform.ai_jobs;
DROP POLICY cst_evidence_event_482 ON ai_platform.ai_events;
DROP POLICY cst_evidence_audit_482 ON ai_platform.ai_audit_logs;
DROP POLICY existing_coding_job_read ON ai_platform.ai_jobs;
DROP POLICY existing_registered_worker_read ON ai_platform.ai_workers;
REVOKE SELECT ON ai_platform.ai_jobs,ai_platform.ai_workers,ai_platform.ai_events,
  ai_platform.ai_audit_logs FROM aicore_dev_runtime;
REVOKE USAGE ON SCHEMA ai_platform FROM aicore_dev_runtime;
DROP ROLE aicore_dev_runtime;
DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime') OR
     EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='ai_platform') THEN
    RAISE EXCEPTION 'DISPOSABLE_READER_ROLLBACK_INCOMPLETE';
  END IF;
END $verify$;
SELECT 'CST_EVIDENCE_READER_DISPOSABLE_PASS' AS result;
