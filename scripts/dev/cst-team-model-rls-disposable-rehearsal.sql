-- DISPOSABLE REHEARSAL ONLY. NO CST-DEV/PROD DATABASE CHANGES.
-- Requires database EXACTLY cst_team_rls_rehearsal, container PostgreSQL 16.
\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'cst_team_rls_rehearsal' THEN
    RAISE EXCEPTION 'DISPOSABLE_RLS_REHEARSAL_DATABASE_ONLY';
  END IF;
END
$guard$;
CREATE ROLE cst_team_rls_fixture_runtime NOLOGIN;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_code text UNIQUE NOT NULL,
 job_type text NOT NULL,
 required_capability text NOT NULL,
 status text NOT NULL,
 payload_json jsonb NOT NULL,
 max_retry integer NOT NULL,
 retry_strategy text NOT NULL,
 started_at timestamptz,
 completed_at timestamptz
);
CREATE TABLE ai_platform.ai_workers (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 worker_name text UNIQUE NOT NULL,
 provider_slug text NOT NULL,
 runtime_kind text NOT NULL,
 model_id text NOT NULL,
 status text NOT NULL,
 running_jobs integer NOT NULL DEFAULT 0,
 heartbeat_token text NOT NULL
);
ALTER TABLE ai_platform.ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_workers ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA ai_platform TO cst_team_rls_fixture_runtime;
GRANT SELECT, INSERT ON ai_platform.ai_jobs,ai_platform.ai_workers TO cst_team_rls_fixture_runtime;
GRANT UPDATE (status, started_at, completed_at) ON ai_platform.ai_jobs TO cst_team_rls_fixture_runtime;
GRANT UPDATE (status, running_jobs) ON ai_platform.ai_workers TO cst_team_rls_fixture_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ai_platform TO cst_team_rls_fixture_runtime;

-- Unique synthetic Company-1 job + worker. These policies cannot authorize
-- any normal job or worker. Real DEV would require independent review and expiry.
CREATE POLICY model_select ON ai_platform.ai_jobs FOR SELECT TO cst_team_rls_fixture_runtime
 USING (job_type='ollama_model_invocation' AND payload_json->>'requestId' =
  'cst-ai-team-company1-dev:rls-rehearsal');
CREATE POLICY model_insert ON ai_platform.ai_jobs FOR INSERT TO cst_team_rls_fixture_runtime
 WITH CHECK (job_type='ollama_model_invocation' AND required_capability='ollama_inference'
  AND status='queued' AND max_retry=0 AND retry_strategy='immediate'
  AND payload_json->>'requestId'='cst-ai-team-company1-dev:rls-rehearsal'
  AND payload_json->>'modelId'='qwen2.5:3b');
CREATE POLICY model_update ON ai_platform.ai_jobs FOR UPDATE TO cst_team_rls_fixture_runtime
 USING (job_type='ollama_model_invocation' AND payload_json->>'requestId'=
  'cst-ai-team-company1-dev:rls-rehearsal')
 WITH CHECK (job_type='ollama_model_invocation' AND payload_json->>'requestId'=
  'cst-ai-team-company1-dev:rls-rehearsal' AND status IN ('queued','running','completed','failed'));
CREATE POLICY worker_select ON ai_platform.ai_workers FOR SELECT TO cst_team_rls_fixture_runtime
 USING (worker_name='cst-dev-dell-onejob-rls-rehearsal' AND provider_slug='ollama'
  AND runtime_kind='ollama_remote_pull');
CREATE POLICY worker_insert ON ai_platform.ai_workers FOR INSERT TO cst_team_rls_fixture_runtime
 WITH CHECK (worker_name='cst-dev-dell-onejob-rls-rehearsal'
  AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull'
  AND model_id='qwen2.5:3b' AND status='online');
CREATE POLICY worker_update ON ai_platform.ai_workers FOR UPDATE TO cst_team_rls_fixture_runtime
 USING (worker_name='cst-dev-dell-onejob-rls-rehearsal'
  AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull')
 WITH CHECK (worker_name='cst-dev-dell-onejob-rls-rehearsal'
  AND provider_slug='ollama' AND runtime_kind='ollama_remote_pull'
  AND model_id='qwen2.5:3b' AND status IN ('online','idle','busy','offline'));

-- Add an unrelated row as the fixture owner; the runtime must not see it.
INSERT INTO ai_platform.ai_jobs(job_code,job_type,required_capability,status,payload_json,max_retry,retry_strategy)
 VALUES ('UNRELATED-COMPANY3','ollama_model_invocation','ollama_inference','queued',
 '{"requestId":"cst-ai-team-company3-dev:other","modelId":"qwen2.5:3b"}',0,'immediate');
SET ROLE cst_team_rls_fixture_runtime;
DO $test$
BEGIN
  -- Wrong company must fail the INSERT RLS predicate, not silently succeed.
  BEGIN
    INSERT INTO ai_platform.ai_jobs(job_code,job_type,required_capability,status,payload_json,max_retry,retry_strategy)
      VALUES ('WRONG-COMPANY','ollama_model_invocation','ollama_inference','queued',
        '{"requestId":"cst-ai-team-company3-dev:other","modelId":"qwen2.5:3b"}',0,'immediate');
    RAISE EXCEPTION 'WRONG_COMPANY_JOB_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Correct company but wrong job type must fail.
  BEGIN
    INSERT INTO ai_platform.ai_jobs(job_code,job_type,required_capability,status,payload_json,max_retry,retry_strategy)
      VALUES ('WRONG-TYPE','coding_workstream_execution','coding_workstream','queued',
        '{"requestId":"cst-ai-team-company1-dev:rls-rehearsal","modelId":"qwen2.5:3b"}',0,'immediate');
    RAISE EXCEPTION 'WRONG_JOB_TYPE_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Unapproved worker identity must fail.
  BEGIN
    INSERT INTO ai_platform.ai_workers(worker_name,provider_slug,runtime_kind,model_id,status,heartbeat_token)
      VALUES ('other-device','ollama','ollama_remote_pull','qwen2.5:3b','online','synthetic');
    RAISE EXCEPTION 'UNAPPROVED_WORKER_UNEXPECTEDLY_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
INSERT INTO ai_platform.ai_workers(worker_name,provider_slug,runtime_kind,model_id,status,heartbeat_token)
 VALUES ('cst-dev-dell-onejob-rls-rehearsal','ollama','ollama_remote_pull','qwen2.5:3b','online','synthetic');
INSERT INTO ai_platform.ai_jobs(job_code,job_type,required_capability,status,payload_json,max_retry,retry_strategy)
 VALUES ('APPROVED-ONE','ollama_model_invocation','ollama_inference','queued',
 '{"requestId":"cst-ai-team-company1-dev:rls-rehearsal","modelId":"qwen2.5:3b"}',0,'immediate');
UPDATE ai_platform.ai_jobs SET status='running',started_at=now()
 WHERE job_code='APPROVED-ONE';
UPDATE ai_platform.ai_workers SET status='busy',running_jobs=1
 WHERE worker_name='cst-dev-dell-onejob-rls-rehearsal';
UPDATE ai_platform.ai_jobs SET status='completed',completed_at=now()
 WHERE job_code='APPROVED-ONE';
UPDATE ai_platform.ai_workers SET status='idle',running_jobs=0
 WHERE worker_name='cst-dev-dell-onejob-rls-rehearsal';
DO $assert$
DECLARE n integer; completed integer; idle integer;
BEGIN
 SELECT count(*) INTO n FROM ai_platform.ai_jobs;
 SELECT count(*) INTO completed FROM ai_platform.ai_jobs WHERE status='completed';
 SELECT count(*) INTO idle FROM ai_platform.ai_workers WHERE status='idle';
 IF n<>1 OR completed<>1 OR idle<>1 THEN RAISE EXCEPTION 'DISPOSABLE_RLS_TEST_FAILED'; END IF;
 RAISE NOTICE 'DISPOSABLE_RLS_SCOPE_PASS: one job completed; unrelated company hidden; worker restricted';
END
$assert$;
RESET ROLE;
SELECT 'DISPOSABLE_RLS_REHEARSAL_PASS' AS result,
 count(*) FILTER (WHERE job_code='UNRELATED-COMPANY3') AS unrelated_row_unchanged
 FROM ai_platform.ai_jobs;
