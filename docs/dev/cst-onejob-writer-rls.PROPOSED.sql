-- PROPOSED DEV-ONLY — NOT APPLIED to CST-DEV xssrfshdrtdfupgqwfdw.
-- Test in disposable PostgreSQL 16 --network none before any deployment.
-- This role intentionally has NOLOGIN, NOINHERIT, no memberships and
-- no UPDATE/DELETE grants. No database credential or role assumption here.
-- Live Core AI global pool remains aicore_dev_runtime and is NOT modified.
CREATE ROLE cst_team_model_pilot_writer NOLOGIN NOINHERIT
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA ai_platform TO cst_team_model_pilot_writer;

-- Owner is verified from a signed application session and current DB read.
-- Only active internal owners are visible. No ownership UPDATE is granted.
CREATE POLICY cst_onejob_stage_owner_select ON ai_platform.internal_users
  FOR SELECT TO cst_team_model_pilot_writer
  USING (role='owner' AND status='active' AND account_type='internal');
GRANT SELECT (id,role,status,account_type)
  ON ai_platform.internal_users TO cst_team_model_pilot_writer;

-- Only a single minimal, nonclaimable probe payload can be staged.
CREATE POLICY cst_onejob_stage_insert ON ai_platform.ai_jobs
  FOR INSERT TO cst_team_model_pilot_writer
  WITH CHECK (
    job_type='ollama_model_invocation'
    AND required_capability='ollama_inference'
    AND status='waiting'
    AND max_retry=0 AND retry_strategy='immediate'
    AND priority=70 AND priority_score=70
    AND job_code ~ '^OLLAMA-[A-F0-9]{8}$'
    AND payload_json->>'requestId' ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
    AND payload_json->>'modelId'='qwen2.5:3b'
    AND payload_json->'responseFormat'->>'type'='text'
    AND payload_json->>'maxOutputTokens'='24'
    AND payload_json->>'input' =
      '{"version":1,"system":"DEV-only model liveness check. Reply exactly with the requested token.","user":"Reply CST_DEV_ONEJOB_PROBE_OK"}'
  );
CREATE POLICY cst_onejob_stage_select ON ai_platform.ai_jobs
  FOR SELECT TO cst_team_model_pilot_writer
  USING (
    job_type='ollama_model_invocation'
    AND required_capability='ollama_inference'
    AND status='waiting'
    AND max_retry=0
    AND payload_json->>'requestId' ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
    AND payload_json->>'modelId'='qwen2.5:3b'
  );
GRANT INSERT (job_code,job_type,required_capability,payload_json,priority,
              priority_score,status,max_retry,retry_strategy,created_at,updated_at)
  ON ai_platform.ai_jobs TO cst_team_model_pilot_writer;
GRANT SELECT (id,job_code,job_type,required_capability,payload_json,status,max_retry)
  ON ai_platform.ai_jobs TO cst_team_model_pilot_writer;
GRANT USAGE ON SEQUENCE ai_platform.ai_jobs_id_seq
  TO cst_team_model_pilot_writer;

-- The approval must refer back to the exact staged, still WAITING job
-- and one valid Owner. The single-active unique index also applies.
CREATE POLICY cst_onejob_stage_approval_insert
 ON ai_platform.cst_onejob_owner_approvals
 FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   purpose='CST_DEV_ONEJOB_MODEL'
   AND status='APPROVED' AND consumed_at IS NULL
   AND company_id='1' AND model_id='qwen2.5:3b'
   AND request_id ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'
   AND worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
   AND source_sha ~ '^[a-f0-9]{40}$'
   AND expires_at>approved_at AND expires_at<=approved_at+interval '30 minutes'
   AND EXISTS (
     SELECT 1 FROM ai_platform.internal_users u
     WHERE u.id=approved_by_user_id AND u.role='owner'
       AND u.status='active' AND u.account_type='internal'
   )
   AND EXISTS (
     SELECT 1 FROM ai_platform.ai_jobs j
     WHERE j.id=job_id AND j.status='waiting'
       AND j.job_type='ollama_model_invocation'
       AND j.payload_json->>'requestId'=request_id
       AND j.payload_json->>'modelId'=model_id
   )
 );
CREATE POLICY cst_onejob_stage_approval_select
 ON ai_platform.cst_onejob_owner_approvals
 FOR SELECT TO cst_team_model_pilot_writer
 USING (company_id='1' AND model_id='qwen2.5:3b'
        AND status='APPROVED' AND consumed_at IS NULL);
GRANT INSERT (purpose,status,company_id,model_id,approved_by_user_id,
              request_id,worker_name,source_sha,job_id,expires_at)
 ON ai_platform.cst_onejob_owner_approvals TO cst_team_model_pilot_writer;
GRANT SELECT (id,expires_at,job_id,company_id,model_id,status,
              approved_by_user_id,request_id,worker_name,source_sha,consumed_at)
 ON ai_platform.cst_onejob_owner_approvals TO cst_team_model_pilot_writer;

-- Audit cannot be an arbitrary marker or a claim of dispatch permission.
CREATE POLICY cst_onejob_stage_audit_insert ON ai_platform.ai_audit_logs
 FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   module='cst-onejob' AND action='owner_approved_waiting_job'
   AND resource_type='ai_job'
   AND resource_id ~ '^[1-9][0-9]*$'
   AND status='success'
   AND details->>'dispatchPermitted'='false'
   AND EXISTS (
     SELECT 1 FROM ai_platform.cst_onejob_owner_approvals a
     WHERE a.id::text=details->>'approvalId'
       AND a.job_id::text=resource_id
       AND a.approved_by_user_id::text=details->>'ownerUserId'
       AND a.request_id=details->>'requestId'
       AND a.worker_name=details->>'workerName'
       AND a.source_sha=details->>'sourceSha'
       AND a.status='APPROVED'
   )
 );
GRANT INSERT (module,action,resource_type,resource_id,status,details)
 ON ai_platform.ai_audit_logs TO cst_team_model_pilot_writer;
-- Additional RESTRICTIVE policy combines with the original permissive
-- audit policy: every writer INSERT must pin the exact public candidate
-- root and keep technical trust / QA / dispatch explicitly FALSE.
-- No new rights are granted; other roles and existing policies are untouched.
CREATE POLICY cst_onejob_stage_ops_root_binding ON ai_platform.ai_audit_logs
 AS RESTRICTIVE FOR INSERT TO cst_team_model_pilot_writer
 WITH CHECK (
   module='cst-onejob' AND action='owner_approved_waiting_job'
   AND resource_type='ai_job' AND status='success'
   AND details->>'operationsRootCandidateSha256'=
     '65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b'
   AND details->>'sameSuperAdminRootSelection'='true'
   AND details->>'operationsRootTrusted'='false'
   AND details->>'independentQaAdmissionVerified'='false'
   AND details->>'dispatchPermitted'='false'
 );
GRANT USAGE ON SEQUENCE ai_platform.ai_audit_logs_id_seq
 TO cst_team_model_pilot_writer;

-- No UPDATE/DELETE on any of the four tables, no worker/dispatcher GRANT,
-- no change to existing policies on aicore_dev_runtime. The role is NOLOGIN
-- and has no members; connecting an independently scoped service principal
-- and verifying session provenance is a later reviewed DEV-only release step.
-- Job insertion precedes approval in the same transaction. RLS by itself
-- does not enforce commit-time existence of an approval: authenticated app
-- staging/rollback is mandatory. These policies are defense in depth.
