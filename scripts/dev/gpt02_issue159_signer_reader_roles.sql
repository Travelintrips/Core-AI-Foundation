-- DEV-only signer trusted-read roles for GPT02 Issue #159.
-- Creates NOLOGIN roles only. No passwords, no signer keys, no authority roles,
-- no task/nonce/dispatch mutation. Apply only to CST-DEV after isolated proof.

BEGIN;

DO $roles$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'gpt02_signer_hub_reader',
    'gpt02_signer_core_reader',
    'gpt02_signer_issuer_reader'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0',
        r
      );
    ELSE
      EXECUTE format(
        'ALTER ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 0',
        r
      );
    END IF;
  END LOOP;
END $roles$;

ALTER ROLE gpt02_signer_hub_reader SET default_transaction_read_only = on;
ALTER ROLE gpt02_signer_hub_reader SET search_path = pg_catalog;
ALTER ROLE gpt02_signer_hub_reader SET statement_timeout = '5s';
ALTER ROLE gpt02_signer_hub_reader SET lock_timeout = '1s';
ALTER ROLE gpt02_signer_hub_reader SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE gpt02_signer_core_reader SET default_transaction_read_only = on;
ALTER ROLE gpt02_signer_core_reader SET search_path = pg_catalog;
ALTER ROLE gpt02_signer_core_reader SET statement_timeout = '5s';
ALTER ROLE gpt02_signer_core_reader SET lock_timeout = '1s';
ALTER ROLE gpt02_signer_core_reader SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE gpt02_signer_issuer_reader SET default_transaction_read_only = on;
ALTER ROLE gpt02_signer_issuer_reader SET search_path = pg_catalog;
ALTER ROLE gpt02_signer_issuer_reader SET statement_timeout = '5s';
ALTER ROLE gpt02_signer_issuer_reader SET lock_timeout = '1s';
ALTER ROLE gpt02_signer_issuer_reader SET idle_in_transaction_session_timeout = '10s';

GRANT CONNECT ON DATABASE postgres TO
  gpt02_signer_hub_reader,
  gpt02_signer_core_reader,
  gpt02_signer_issuer_reader;

REVOKE ALL ON SCHEMA public,gpt02_stage,gpt02_private,ai_platform
  FROM gpt02_signer_hub_reader,gpt02_signer_core_reader,gpt02_signer_issuer_reader;

GRANT USAGE ON SCHEMA public,gpt02_stage,gpt02_private TO gpt02_signer_hub_reader;
GRANT USAGE ON SCHEMA ai_platform TO gpt02_signer_core_reader;
GRANT USAGE ON SCHEMA gpt02_private TO gpt02_signer_issuer_reader;

-- Hub signer trusted-read surface: exact clone of already-proven Hub evidence reader.
GRANT SELECT (
  assigned_client_id,attestation_verified,callback_verified,command_id,company_id,
  external_id,final_ack_verified,id,idempotency_key,instruction,metadata,progress,
  source,status,task_id,title,worker_id
) ON public.ai_execution_jobs TO gpt02_signer_hub_reader;

GRANT SELECT (
  assigned_to,assigned_to_id,company_id,id,status,title
) ON public.ai_tasks TO gpt02_signer_hub_reader;

GRANT SELECT (
  action,after,company_id,entity_id,id,user_email
) ON public.audit_logs TO gpt02_signer_hub_reader;

GRANT SELECT (
  company_id,id,is_active,name
) ON public.team_members TO gpt02_signer_hub_reader;

GRANT SELECT (
  company_id,email,id,is_active,role,status
) ON public.users TO gpt02_signer_hub_reader;

GRANT SELECT (
  company_id,hub_task_id,member_id,member_audit_id,operator_subject,core_task_id,
  hub_execution_id,command_candidate_id,attempt_id,config_sha256,expires_at
) ON gpt02_stage.core_preparations TO gpt02_signer_hub_reader;

GRANT SELECT (
  command_id,task_id,company_id,approver_id,claims,signature,digest
) ON gpt02_private.approvals TO gpt02_signer_hub_reader;

GRANT SELECT (
  link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
  company_id,assignee_id,accountable_owner_id,hub_operator_id,
  core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,
  claims
) ON gpt02_private.operator_links TO gpt02_signer_hub_reader;

-- Core signer trusted-read surface: exact clone of already-proven Core evidence reader.
GRANT SELECT (task_id)
  ON ai_platform.ai_coding_bridge_commands TO gpt02_signer_core_reader;
GRANT SELECT (task_id)
  ON ai_platform.ai_coding_runs TO gpt02_signer_core_reader;
GRANT SELECT (
  id,task_number,project_name,repository,branch,instruction,status
) ON ai_platform.ai_coding_tasks TO gpt02_signer_core_reader;
GRANT SELECT (
  id,role,status,must_change_password
) ON ai_platform.internal_users TO gpt02_signer_core_reader;

-- Issuer signer trusted-read surface: private GPT02 evidence only.
GRANT SELECT (
  command_id,attempt_id,nonce,task_id,company_id,approver_id,claims,signature,
  digest,expires_at,recorded_at,operator_namespace
) ON gpt02_private.approvals TO gpt02_signer_issuer_reader;

GRANT SELECT (
  link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
  attempt_number,company_id,assignee_id,accountable_owner_id,hub_operator_id,
  core_operator_user_id,approval_digest,link_digest,hub_signature,core_signature,
  claims,expires_at,created_at
) ON gpt02_private.operator_links TO gpt02_signer_issuer_reader;

GRANT SELECT (id,command_id,nonce,digest,consumed_at)
  ON gpt02_private.receipts TO gpt02_signer_issuer_reader;

GRANT SELECT (
  receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,
  link_digest,binding_verified,may_dispatch_worker,may_close_job,may_issue_grant,
  core_ledger_written,created_at
) ON gpt02_private.core_identity_receipts TO gpt02_signer_issuer_reader;

GRANT SELECT (
  fence_id,receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
  worker_id,lease_epoch,lease_started_at,lease_expires_at,dispatch_allowed,
  core_ledger_written,created_at
) ON gpt02_private.post_consumption_fences TO gpt02_signer_issuer_reader;

-- Duplicate already-proven Hub/Core predicates for signer-specific roles.
DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON public.ai_execution_jobs;
CREATE POLICY gpt02_signer_hub_reader_select ON public.ai_execution_jobs
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND task_id>136 AND source='AI_TASK' AND status='prepared');

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON public.ai_tasks;
CREATE POLICY gpt02_signer_hub_reader_select ON public.ai_tasks
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND id>136);

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON public.audit_logs;
CREATE POLICY gpt02_signer_hub_reader_select ON public.audit_logs
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND action='gpt02_pic_assigned');

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON public.team_members;
CREATE POLICY gpt02_signer_hub_reader_select ON public.team_members
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND is_active IS TRUE);

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON public.users;
CREATE POLICY gpt02_signer_hub_reader_select ON public.users
  FOR SELECT TO gpt02_signer_hub_reader
  USING (role='super_admin' AND is_active IS TRUE AND status='active' AND company_id IS NULL);

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON gpt02_stage.core_preparations;
CREATE POLICY gpt02_signer_hub_reader_select ON gpt02_stage.core_preparations
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND hub_task_id>136);

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON gpt02_private.approvals;
CREATE POLICY gpt02_signer_hub_reader_select ON gpt02_private.approvals
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND task_id>136 AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS gpt02_signer_hub_reader_select ON gpt02_private.operator_links;
CREATE POLICY gpt02_signer_hub_reader_select ON gpt02_private.operator_links
  FOR SELECT TO gpt02_signer_hub_reader
  USING (company_id='default' AND hub_task_id>136 AND attempt_number=1
         AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS gpt02_signer_core_reader_select ON ai_platform.ai_coding_tasks;
CREATE POLICY gpt02_signer_core_reader_select ON ai_platform.ai_coding_tasks
  FOR SELECT TO gpt02_signer_core_reader
  USING (project_name='GPT02 DEV coding lifecycle'
         AND repository='Travelintrips/Core-AI-Foundation'
         AND branch='develop' AND task_number LIKE 'GPT02DEV-%');

DROP POLICY IF EXISTS gpt02_signer_core_reader_select ON ai_platform.ai_coding_runs;
CREATE POLICY gpt02_signer_core_reader_select ON ai_platform.ai_coding_runs
  FOR SELECT TO gpt02_signer_core_reader
  USING (EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_tasks t
    WHERE t.id=ai_coding_runs.task_id
      AND t.project_name='GPT02 DEV coding lifecycle'
      AND t.repository='Travelintrips/Core-AI-Foundation'
      AND t.branch='develop' AND t.task_number LIKE 'GPT02DEV-%'
  ));

DROP POLICY IF EXISTS gpt02_signer_core_reader_select ON ai_platform.ai_coding_bridge_commands;
CREATE POLICY gpt02_signer_core_reader_select ON ai_platform.ai_coding_bridge_commands
  FOR SELECT TO gpt02_signer_core_reader
  USING (EXISTS (
    SELECT 1 FROM ai_platform.ai_coding_tasks t
    WHERE t.id=ai_coding_bridge_commands.task_id
      AND t.project_name='GPT02 DEV coding lifecycle'
      AND t.repository='Travelintrips/Core-AI-Foundation'
      AND t.branch='develop' AND t.task_number LIKE 'GPT02DEV-%'
  ));

DROP POLICY IF EXISTS gpt02_signer_core_reader_select ON ai_platform.internal_users;
CREATE POLICY gpt02_signer_core_reader_select ON ai_platform.internal_users
  FOR SELECT TO gpt02_signer_core_reader
  USING (role=ANY(ARRAY['owner','admin']) AND status='active'
         AND must_change_password IS FALSE);

-- Issuer-private policies bind receipts/fences back to future DEV Issue159 rows.
DROP POLICY IF EXISTS gpt02_signer_issuer_reader_select ON gpt02_private.approvals;
CREATE POLICY gpt02_signer_issuer_reader_select ON gpt02_private.approvals
  FOR SELECT TO gpt02_signer_issuer_reader
  USING (company_id='default' AND task_id>136 AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS gpt02_signer_issuer_reader_select ON gpt02_private.operator_links;
CREATE POLICY gpt02_signer_issuer_reader_select ON gpt02_private.operator_links
  FOR SELECT TO gpt02_signer_issuer_reader
  USING (company_id='default' AND hub_task_id>136 AND attempt_number=1
         AND claims->>'environment'='DEV');

DROP POLICY IF EXISTS gpt02_signer_issuer_reader_select ON gpt02_private.receipts;
CREATE POLICY gpt02_signer_issuer_reader_select ON gpt02_private.receipts
  FOR SELECT TO gpt02_signer_issuer_reader
  USING (EXISTS (
    SELECT 1 FROM gpt02_private.approvals a
    WHERE a.command_id=receipts.command_id
      AND a.company_id='default' AND a.task_id>136
      AND a.claims->>'environment'='DEV'
  ));

DROP POLICY IF EXISTS gpt02_signer_issuer_reader_select ON gpt02_private.core_identity_receipts;
CREATE POLICY gpt02_signer_issuer_reader_select ON gpt02_private.core_identity_receipts
  FOR SELECT TO gpt02_signer_issuer_reader
  USING (EXISTS (
    SELECT 1 FROM gpt02_private.operator_links l
    WHERE l.command_id=core_identity_receipts.command_id
      AND l.link_id=core_identity_receipts.link_id
      AND l.company_id='default' AND l.hub_task_id>136
      AND l.attempt_number=1 AND l.claims->>'environment'='DEV'
  ));

DROP POLICY IF EXISTS gpt02_signer_issuer_reader_select ON gpt02_private.post_consumption_fences;
CREATE POLICY gpt02_signer_issuer_reader_select ON gpt02_private.post_consumption_fences
  FOR SELECT TO gpt02_signer_issuer_reader
  USING (
    dispatch_allowed IS FALSE AND core_ledger_written IS FALSE
    AND EXISTS (
      SELECT 1 FROM gpt02_private.operator_links l
      WHERE l.command_id=post_consumption_fences.command_id
        AND l.link_id=post_consumption_fences.link_id
        AND l.company_id='default' AND l.hub_task_id>136
        AND l.attempt_number=1 AND l.claims->>'environment'='DEV'
    )
    AND EXISTS (
      SELECT 1 FROM gpt02_private.receipts r
      WHERE r.id=post_consumption_fences.receipt_id
        AND r.command_id=post_consumption_fences.command_id
    )
  );

COMMIT;
