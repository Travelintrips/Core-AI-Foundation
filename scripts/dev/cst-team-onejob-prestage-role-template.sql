-- CST-DEV Company 1 one-job WAITING-only preparation; TEMPLATE, NOT EXECUTED.
-- A fresh waiting job is prepared BEFORE one authenticated Owner approval,
-- but is NOT queued/dispatched and conveys ZERO Owner approval authority.
-- One ephemeral prestage role, NO membership in the existing stage WRITER
-- role, no access to approval or event tables, no UPDATE or DELETE grants.
-- Allowed project: Supabase CST-DEV xssrfshdrtdfupgqwfdw ONLY.
-- Client must independently validate Supabase project identity and strict TLS.
BEGIN;
DO $guard$
BEGIN
 IF current_database()<>'{{EXPECTED_DATABASE}}'
    OR '{{EXPECTED_DATABASE}}'<>'postgres'
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aicore_dev_runtime' AND rolcanlogin)
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cst_team_model_pilot_writer' AND NOT rolcanlogin)
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{{PRESTAGE_ROLE}}')
    OR '{{PRESTAGE_ROLE}}' !~ '^cst_team_onejob_prestage_[0-9]{8}_[a-f0-9]{8}$'
    OR '{{REQUEST_ID}}' !~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
    OR '{{JOB_CODE}}' !~ '^OLLAMA-[A-F0-9]{8}$'
    OR '{{SOURCE_SHA}}' !~ '^[a-f0-9]{40}$'
    OR '{{EXPIRES}}'::timestamptz NOT BETWEEN
      clock_timestamp()+interval '2 minutes'
      AND clock_timestamp()+interval '20 minutes'
    OR NOT EXISTS(SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ai_platform' AND c.relname='ai_jobs' AND c.relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_index ix
      JOIN pg_class idx ON idx.oid=ix.indexrelid
      WHERE idx.relname='ai_jobs_company1_pilot_request_unique'
        AND ix.indisunique AND ix.indisvalid)
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_WRONG_PROJECT_OR_UNSAFE_ROLE'; END IF;
END $guard$;

-- An existing historical completed job (#482) does not conflict. This is a
-- persistent one-active-pilot invariant; it is NOT dropped by role rollback.
CREATE UNIQUE INDEX IF NOT EXISTS cst_onejob_company1_one_active_waiting
 ON ai_platform.ai_jobs ((1))
 WHERE job_type='ollama_model_invocation'
 AND status IN ('waiting','queued','running')
 AND payload_json->>'requestId' LIKE 'cst-ai-team-company1-dev:pilot-%';

CREATE ROLE {{PRESTAGE_ROLE}} LOGIN PASSWORD '{{PRESTAGE_SECRET}}'
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
 VALID UNTIL '{{EXPIRES}}';
GRANT CONNECT ON DATABASE {{EXPECTED_DATABASE}} TO {{PRESTAGE_ROLE}};
GRANT USAGE ON SCHEMA ai_platform TO {{PRESTAGE_ROLE}};
GRANT INSERT(job_code,job_type,required_capability,status,max_retry,
 retry_strategy,priority,priority_score,payload_json)
 ON ai_platform.ai_jobs TO {{PRESTAGE_ROLE}};
GRANT SELECT(id,job_code,status,payload_json)
 ON ai_platform.ai_jobs TO {{PRESTAGE_ROLE}};
GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq TO {{PRESTAGE_ROLE}};

CREATE POLICY cst_onejob_prestage_insert ON ai_platform.ai_jobs
 FOR INSERT TO {{PRESTAGE_ROLE}}
 WITH CHECK (
  clock_timestamp()<'{{EXPIRES}}'::timestamptz
  AND job_code='{{JOB_CODE}}'
  AND job_type='ollama_model_invocation'
  AND required_capability='ollama_inference'
  AND status='waiting'
  AND max_retry=0
  AND retry_strategy='immediate'
  AND priority=70 AND priority_score=70
  AND payload_json->>'requestId'='{{REQUEST_ID}}'
  AND payload_json->>'modelId'='qwen2.5:3b'
  AND payload_json->'responseFormat'->>'type'='text'
  AND payload_json->>'maxOutputTokens'='24'
  AND payload_json->>'input'=
    '{"version":1,"system":"DEV-only model liveness check. Reply exactly with the requested token.","user":"Reply CST_DEV_ONEJOB_PROBE_OK"}'
 );
CREATE POLICY cst_onejob_prestage_select ON ai_platform.ai_jobs
 FOR SELECT TO {{PRESTAGE_ROLE}}
 USING (
  clock_timestamp()<'{{EXPIRES}}'::timestamptz
  AND job_code='{{JOB_CODE}}'
  AND job_type='ollama_model_invocation'
  AND required_capability='ollama_inference'
  AND status='waiting'
  AND payload_json->>'requestId'='{{REQUEST_ID}}'
 );

-- Owner consent route uses existing Core auth/session and READS one waiting
-- job only, with no extra UPDATE/INSERT grants to the application role.
CREATE POLICY cst_onejob_owner_intent_read ON ai_platform.ai_jobs
 FOR SELECT TO aicore_dev_runtime
 USING (
  clock_timestamp()<'{{EXPIRES}}'::timestamptz
  AND status='waiting'
  AND job_code='{{JOB_CODE}}'
  AND job_type='ollama_model_invocation'
  AND required_capability='ollama_inference'
  AND payload_json->>'requestId'='{{REQUEST_ID}}'
  AND payload_json->>'modelId'='qwen2.5:3b'
 );

DO $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.member WHERE r.rolname='{{PRESTAGE_ROLE}}')
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname='ai_platform'
          AND policyname IN ('cst_onejob_prestage_insert',
              'cst_onejob_prestage_select',
              'cst_onejob_owner_intent_read'))<>3
    OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname='{{PRESTAGE_ROLE}}'
      AND (r.rolsuper OR r.rolbypassrls OR r.rolinherit OR r.rolcreaterole))
    OR has_table_privilege('{{PRESTAGE_ROLE}}','ai_platform.cst_onejob_owner_approvals','INSERT')
    OR has_table_privilege('{{PRESTAGE_ROLE}}','ai_platform.ai_jobs','UPDATE')
    OR has_table_privilege('{{PRESTAGE_ROLE}}','ai_platform.ai_events','INSERT')
 THEN RAISE EXCEPTION 'CST_ONEJOB_PRESTAGE_PRIVILEGE_BOUNDARY_INVALID'; END IF;
END $guard$;
COMMIT;
