-- GPT02 Issue159 — PROPOSED real DEV schema RPC migration.
-- REVIEW ONLY: DO NOT APPLY TO LIVE DEV OR PROD.
-- Stores non-authorizing evidence; cannot cryptographically validate Ed25519
-- inside PostgreSQL. The independent writer broker must verify persisted
-- Super Admin approval and all detached Ed25519 signatures before calling RPCs.
-- Writer login is deliberately NOLOGIN until independently approved.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
-- Role-membership SET escrows are transaction-local and must be restored
-- to the original NO-SET boundary BEFORE COMMIT. Migration account is postgres.
DO $role_preflight$
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR
 pg_has_role('postgres','gpt02_core_prep_owner','SET') OR
 pg_has_role('postgres','gpt02_store_owner','SET') THEN
  RAISE EXCEPTION 'MIGRATOR_ROLE_CUSTODY_BASELINE_MISMATCH';
 END IF;
END $role_preflight$;
GRANT gpt02_core_prep_owner TO postgres WITH SET TRUE;
GRANT gpt02_store_owner TO postgres WITH SET TRUE;
DO $guard$
DECLARE r record; v_functions integer;
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM pg_roles WHERE rolname='gpt02_core_prep_login'
  AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolsuper
 ) THEN
  RAISE EXCEPTION 'DEV_WRITER_ROLE_NOT_DORMANT';
 END IF;
 FOR r IN
  SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity,c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='gpt02_stage' AND c.relname='core_preparations')
    OR (n.nspname='gpt02_private' AND c.relname IN (
    'approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences'))
 LOOP
  IF NOT r.relrowsecurity OR NOT r.relforcerowsecurity OR
   (r.nspname='gpt02_stage' AND r.owner<>'gpt02_core_prep_owner') OR
   (r.nspname='gpt02_private' AND r.owner<>'gpt02_store_owner') THEN
   RAISE EXCEPTION 'GPT02_LIFECYCLE_SCHEMA_DRIFT %.%',r.nspname,r.relname;
  END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='gpt02_stage' AND c.relname='core_preparations' AND c.relkind='r')
     OR (n.nspname='gpt02_private' AND c.relkind='r' AND c.relname IN
     ('approvals','operator_links','receipts','core_identity_receipts','post_consumption_fences')))<>6 THEN
  RAISE EXCEPTION 'GPT02_LIFECYCLE_TABLE_COUNT_DRIFT';
 END IF;
 IF NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_stage'
  AND p.proname='prepare_core_task_dormant'
  AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
  AND p.prosecdef
 ) THEN RAISE EXCEPTION 'DORMANT_PREPARER_MISSING';END IF;
END $guard$;

-- The private storage owner may read immutable preparation lineage, not write it.
GRANT USAGE ON SCHEMA extensions TO gpt02_store_owner;
SET ROLE gpt02_core_prep_owner;
GRANT USAGE ON SCHEMA gpt02_stage TO gpt02_store_owner,gpt02_core_prep_login;
GRANT SELECT ON gpt02_stage.core_preparations TO gpt02_store_owner;
DO $policy$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='gpt02_stage'
  AND tablename='core_preparations' AND policyname='gpt02_store_owner_prep_readonly') THEN
  CREATE POLICY gpt02_store_owner_prep_readonly ON gpt02_stage.core_preparations
 FOR SELECT TO gpt02_store_owner
 USING(company_id='default' AND hub_task_id>139);
 END IF;
END $policy$;
CREATE OR REPLACE FUNCTION gpt02_stage.prepare_core_task(
 p_company text, p_task integer,p_project text,p_repo text,p_branch text,p_instruction text)
RETURNS TABLE(core_task_id uuid,command_candidate_id uuid,attempt_id uuid,
 hub_execution_id uuid,created boolean,dispatch_permitted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR p_company IS DISTINCT FROM 'default'
 OR p_task IS NULL OR p_task<=139 OR p_project IS DISTINCT FROM 'GPT02 DEV coding lifecycle'
 OR p_repo IS DISTINCT FROM 'Travelintrips/Core-AI-Foundation'
 OR p_branch IS DISTINCT FROM 'develop' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='DEV_PREPARATION_SCOPE_DENIED';
 END IF;
 RETURN QUERY
 SELECT q.core_task_id,q.command_candidate_id,q.attempt_id,q.hub_execution_id,
        q.created,q.dispatch_permitted
 FROM gpt02_stage.prepare_core_task_dormant(
  p_company,p_task,p_project,p_repo,p_branch,p_instruction) AS q;
END $fn$;
REVOKE ALL ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_stage.prepare_core_task(text,integer,text,text,text,text)
 TO gpt02_core_prep_login;
RESET ROLE;

SET ROLE gpt02_store_owner;
CREATE TABLE IF NOT EXISTS gpt02_private.issuer_evidences(
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 fence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.post_consumption_fences(fence_id),
 claims jsonb NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[A-Za-z0-9_-]{86}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 signing_grant boolean NOT NULL DEFAULT false CHECK(signing_grant=false),
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false)
);
CREATE TABLE IF NOT EXISTS gpt02_private.issuer_lease_consumptions(
 evidence_id uuid PRIMARY KEY REFERENCES gpt02_private.issuer_evidences(evidence_id),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 fence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.post_consumption_fences(fence_id),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_epoch bigint NOT NULL DEFAULT 1 CHECK(lease_epoch=1),
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false)
);
ALTER TABLE gpt02_private.issuer_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_evidences FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_lease_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_lease_consumptions FORCE ROW LEVEL SECURITY;
DO $policy$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='gpt02_private'
  AND tablename='issuer_evidences' AND policyname='issuer_evidences_owner_only') THEN
  CREATE POLICY issuer_evidences_owner_only ON gpt02_private.issuer_evidences
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
 END IF;
END $policy$;
DO $policy$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='gpt02_private'
  AND tablename='issuer_lease_consumptions' AND policyname='issuer_lease_consumptions_owner_only') THEN
  CREATE POLICY issuer_lease_consumptions_owner_only ON gpt02_private.issuer_lease_consumptions
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
 END IF;
END $policy$;
CREATE OR REPLACE TRIGGER issuer_evidences_immutable_rows BEFORE UPDATE OR DELETE
 ON gpt02_private.issuer_evidences FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE OR REPLACE TRIGGER issuer_evidences_immutable_truncate BEFORE TRUNCATE
 ON gpt02_private.issuer_evidences FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE OR REPLACE TRIGGER issuer_lease_consumptions_immutable_rows BEFORE UPDATE OR DELETE
 ON gpt02_private.issuer_lease_consumptions FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE OR REPLACE TRIGGER issuer_lease_consumptions_immutable_truncate BEFORE TRUNCATE
 ON gpt02_private.issuer_lease_consumptions FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
REVOKE ALL ON gpt02_private.issuer_evidences,gpt02_private.issuer_lease_consumptions
 FROM PUBLIC,anon,authenticated,service_role;

-- Signatures are stored only. Their verification MUST take place in a
-- separately authenticated signer/broker. This SQL NEVER enables dispatch.
CREATE OR REPLACE FUNCTION gpt02_private.record_linked_approval(
 p_approval jsonb,p_approval_signature text,p_approval_digest text,
 p_link jsonb,p_hub_signature text,p_core_signature text,p_link_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_p gpt02_stage.core_preparations%ROWTYPE;
 v_task integer;v_command uuid;v_attempt uuid;v_link_id uuid;
 v_expiry timestamptz;v_link_expiry timestamptz;v_now timestamptz;
BEGIN
 IF session_user<>'gpt02_core_prep_login' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WRITER_IDENTITY_DENIED';END IF;
 IF jsonb_typeof(p_approval) IS DISTINCT FROM 'object' OR
 jsonb_typeof(p_link) IS DISTINCT FROM 'object' OR
 p_approval->>'audience' IS DISTINCT FROM 'GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL'
 OR p_approval->>'environment' IS DISTINCT FROM 'DEV'
 OR p_approval->>'companyId' IS DISTINCT FROM 'default'
 OR p_approval->>'operatorNamespace' IS DISTINCT FROM 'ai-task-hub.public.users'
 OR p_approval->>'v' IS DISTINCT FROM '2'
 OR p_link->>'audience' IS DISTINCT FROM 'GPT02_DUAL_ACCOUNT_COMMAND_LINK'
 OR p_link->>'environment' IS DISTINCT FROM 'DEV'
 OR p_link->>'companyId' IS DISTINCT FROM 'default'
 OR p_link->>'v' IS DISTINCT FROM '1'
 OR p_link->>'attemptNumber' IS DISTINCT FROM '1'
 OR p_link->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
 OR p_link->>'hubRole' IS DISTINCT FROM 'super_admin'
 OR p_link->>'hubActive' IS DISTINCT FROM 'true'
 OR p_link->>'coreRole' IS NULL OR p_link->>'coreRole' NOT IN ('owner','admin')
 OR p_link->>'coreActive' IS DISTINCT FROM 'true'
 OR p_link->>'corePasswordChanged' IS DISTINCT FROM 'true'
 OR p_link->>'hubOperatorNamespace' IS DISTINCT FROM 'ai-task-hub.public.users'
 OR p_link->>'coreOperatorNamespace' IS DISTINCT FROM 'ai-core.ai_platform.internal_users'
 OR p_approval_signature IS NULL OR p_approval_signature !~ '^[A-Za-z0-9_-]{86}$'
 OR p_hub_signature IS NULL OR p_hub_signature !~ '^[A-Za-z0-9_-]{86}$'
 OR p_core_signature IS NULL OR p_core_signature !~ '^[A-Za-z0-9_-]{86}$'
 OR p_approval_digest IS NULL OR p_approval_digest !~ '^[0-9a-f]{64}$'
 OR p_link_digest IS NULL OR p_link_digest !~ '^[0-9a-f]{64}$'
 OR (p_approval->>'nonce') IS NULL OR
    (p_approval->>'nonce') !~ '^[A-Za-z0-9_-]{32,128}$'
 OR p_link->>'nonce' IS DISTINCT FROM p_approval->>'nonce'
 OR p_link->>'approvalDigest' IS DISTINCT FROM p_approval_digest
 OR p_link->>'hubOperatorId' IS DISTINCT FROM p_approval->>'superAdminId'
 OR p_link->>'hubTaskId' IS DISTINCT FROM p_approval->>'taskId'
 OR p_link->>'attemptId' IS DISTINCT FROM p_approval->>'attemptId'
 OR p_link->>'coreCommandId' IS DISTINCT FROM p_approval->>'commandId'
 OR (p_link->>'assigneeId') IS NULL
 OR (p_link->>'coreOperatorUserId') IS NULL
 OR (p_link->>'coreOperatorUserId') !~ '^[1-9][0-9]*$'
 OR (p_link->>'assigneeId') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SIGNED_EVIDENCE_SCOPE_DENIED';END IF;
 v_task := (p_approval->>'taskId')::integer;
 IF v_task<=139 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='HISTORIC_TASK_NOT_REUSABLE';END IF;
 v_command := (p_approval->>'commandId')::uuid;
 v_attempt := (p_approval->>'attemptId')::uuid;
 v_link_id := (p_link->>'linkId')::uuid;
 IF v_command=v_attempt OR v_command=v_link_id OR v_attempt=v_link_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EVIDENCE_UUID_COLLISION';END IF;
 v_now := clock_timestamp();
 v_expiry := to_timestamp((p_approval->>'expiresAt')::numeric/1000);
 v_link_expiry := to_timestamp((p_link->>'expiresAt')::numeric/1000);
 IF v_expiry<=v_now OR v_link_expiry<=v_now OR v_link_expiry>v_expiry OR
  to_timestamp((p_approval->>'issuedAt')::numeric/1000)>v_now OR
  to_timestamp((p_link->>'issuedAt')::numeric/1000)>v_now OR
  to_timestamp((p_link->>'issuedAt')::numeric/1000)<
  to_timestamp((p_approval->>'issuedAt')::numeric/1000) OR
  v_expiry-to_timestamp((p_approval->>'issuedAt')::numeric/1000)>interval '5 minutes' OR
  v_link_expiry-to_timestamp((p_link->>'issuedAt')::numeric/1000)>interval '5 minutes'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APPROVAL_OR_LINK_EXPIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:'||v_task::text,0));
 SELECT * INTO v_p FROM gpt02_stage.core_preparations
 WHERE company_id='default' AND hub_task_id=v_task;
 IF NOT FOUND OR v_p.expires_at<=v_now OR
   v_p.operator_subject IS DISTINCT FROM p_approval->>'superAdminId' OR
   v_p.command_candidate_id IS DISTINCT FROM v_command OR
   v_p.attempt_id IS DISTINCT FROM v_attempt OR
   v_p.core_task_id::text IS DISTINCT FROM p_link->>'coreTaskId' OR
   v_p.hub_execution_id::text IS DISTINCT FROM p_link->>'hubExecutionId' OR
   v_p.member_id::text IS DISTINCT FROM p_link->>'assigneeId'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='IMMUTABLE_PREPARATION_BINDING_REQUIRED';END IF;
 INSERT INTO gpt02_private.approvals(
 command_id,attempt_id,nonce,task_id,company_id,approver_id,
 claims,signature,digest,expires_at,operator_namespace)
 VALUES(v_command,v_attempt,p_approval->>'nonce',v_task,'default',
 p_approval->>'superAdminId',p_approval,p_approval_signature,
 p_approval_digest,v_expiry,'ai-task-hub.public.users');
 INSERT INTO gpt02_private.operator_links(
 link_id,command_id,hub_execution_id,core_task_id,hub_task_id,attempt_id,
 attempt_number,company_id,assignee_id,accountable_owner_id,
 hub_operator_id,core_operator_user_id,approval_digest,link_digest,
 hub_signature,core_signature,claims,expires_at)
 VALUES(v_link_id,v_command,v_p.hub_execution_id,v_p.core_task_id,
 v_task,v_attempt,1,'default',v_p.member_id,p_link->>'accountableOwnerId',
 p_link->>'hubOperatorId',(p_link->>'coreOperatorUserId')::integer,
 p_approval_digest,p_link_digest,p_hub_signature,p_core_signature,p_link,v_link_expiry);
 RETURN v_link_id;
END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.record_linked_approval(
 jsonb,text,text,jsonb,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION gpt02_private.consume_linked_approval(
 p_command uuid,p_attempt uuid,p_link_id uuid,p_nonce text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v_a gpt02_private.approvals%ROWTYPE;
 v_link gpt02_private.operator_links%ROWTYPE;v_id uuid;v_now timestamptz;
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR p_nonce IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONSUMER_SCOPE_DENIED';END IF;
 SELECT * INTO v_a FROM gpt02_private.approvals
 WHERE command_id=p_command AND attempt_id=p_attempt AND nonce=p_nonce
 AND company_id='default' AND task_id>139 AND expires_at>clock_timestamp();
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FRESH_APPROVAL_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:'||v_a.task_id::text,0));
 SELECT * INTO v_link FROM gpt02_private.operator_links
 WHERE command_id=v_a.command_id AND attempt_id=v_a.attempt_id
 AND link_id=p_link_id AND hub_task_id=v_a.task_id
 AND company_id='default' AND approval_digest=v_a.digest
 AND hub_operator_id=v_a.approver_id AND expires_at>clock_timestamp();
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TWO_SIGNER_LINK_REQUIRED';END IF;
 INSERT INTO gpt02_private.receipts(command_id,nonce,digest)
 VALUES(v_a.command_id,v_a.nonce,v_a.digest) RETURNING id INTO v_id;
 RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.consume_linked_approval(uuid,uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION gpt02_private.reserve_post_consumption_fence(
 p_command uuid,p_link_id uuid,p_receipt_id uuid,p_worker text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;v_started timestamptz;v_expires timestamptz;v_fence_id uuid;
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR
 p_worker IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FENCE_SCOPE_DENIED';END IF;
 SELECT l.*,a.expires_at AS approval_expires,
        r.consumed_at AS nonce_consumed_at
 INTO v
 FROM gpt02_private.operator_links l
 JOIN gpt02_private.approvals a ON a.command_id=l.command_id
  AND a.attempt_id=l.attempt_id AND a.task_id=l.hub_task_id
  AND a.company_id=l.company_id AND a.digest=l.approval_digest
 JOIN gpt02_private.receipts r ON r.command_id=a.command_id
  AND r.nonce=a.nonce AND r.digest=a.digest
 WHERE l.link_id=p_link_id AND l.command_id=p_command
  AND r.id=p_receipt_id AND l.company_id='default'
  AND l.hub_task_id>139;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='IMMUTABLE_LINKED_NONCE_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:'||v.hub_task_id::text,0));
 v_started:=clock_timestamp();
 IF v.nonce_consumed_at>v_started OR
 v.nonce_consumed_at<v_started-interval '15 seconds' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='NONCE_CONSUMPTION_EXPIRED';END IF;
 v_expires:=least(v_started+interval '14 seconds',
   v.expires_at,v.approval_expires);
 IF v_expires<=v_started THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FENCE_EXPIRED';END IF;
 INSERT INTO gpt02_private.core_identity_receipts(
 receipt_id,command_id,link_id,operator_user_id,recorded_by,hub_operator_id,
 link_digest,binding_verified,may_dispatch_worker,may_close_job,
 may_issue_grant,core_ledger_written)
 VALUES(p_receipt_id,p_command,p_link_id,v.core_operator_user_id,
 'internal:'||v.core_operator_user_id::text,v.hub_operator_id,
 v.link_digest,false,false,false,false,false);
 INSERT INTO gpt02_private.post_consumption_fences(
 receipt_id,command_id,link_id,hub_execution_id,core_task_id,attempt_id,
 worker_id,lease_epoch,lease_started_at,lease_expires_at,
 dispatch_allowed,core_ledger_written)
 VALUES(p_receipt_id,p_command,p_link_id,v.hub_execution_id,v.core_task_id,
 v.attempt_id,p_worker,1,v_started,v_expires,false,false)
 RETURNING fence_id INTO v_fence_id;
 RETURN v_fence_id;
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION gpt02_private.record_issuer_evidence(
 p_claims jsonb,p_signature text,p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;v_command uuid;v_fence_id uuid;
 v_now timestamptz;v_expires timestamptz;v_issued timestamptz;v_evidence uuid;
BEGIN
 IF session_user<>'gpt02_core_prep_login' OR
 jsonb_typeof(p_claims) IS DISTINCT FROM 'object' OR
 p_claims->>'environment' IS DISTINCT FROM 'DEV' OR
 p_claims->>'audience' IS DISTINCT FROM 'GPT02_ISSUER_LEASE_EVIDENCE_V1' OR
 p_claims->>'v' IS DISTINCT FROM '1' OR
 p_claims->>'companyId' IS DISTINCT FROM 'default' OR
 p_claims->>'issuerRole' IS DISTINCT FROM 'dev_gpt02_issuer_evidence' OR
 p_claims->>'leaseEpoch' IS DISTINCT FROM '1' OR
 p_claims->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' OR
 p_signature IS NULL OR p_signature !~ '^[A-Za-z0-9_-]{86}$' OR
 p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_SCOPE_DENIED'; END IF;
 v_command:=(p_claims->>'commandId')::uuid;
 v_fence_id:=(p_claims->>'fenceId')::uuid;
 SELECT f.*,l.hub_task_id,l.hub_execution_id AS link_execution,
 l.core_task_id AS link_core,l.attempt_id AS link_attempt,
 l.link_id AS checked_link,l.expires_at AS link_expires,
 a.task_id,a.company_id,a.digest AS approval_digest,
 a.nonce,a.expires_at AS approval_expires,
 r.id AS receipt_pk
 INTO v
 FROM gpt02_private.post_consumption_fences f
 JOIN gpt02_private.operator_links l ON l.link_id=f.link_id
   AND l.command_id=f.command_id AND l.attempt_id=f.attempt_id
 JOIN gpt02_private.approvals a ON a.command_id=l.command_id
   AND a.attempt_id=l.attempt_id AND a.task_id=l.hub_task_id
   AND a.digest=l.approval_digest AND a.company_id='default'
 JOIN gpt02_private.receipts r ON r.id=f.receipt_id AND r.command_id=a.command_id
   AND r.nonce=a.nonce AND r.digest=a.digest
 WHERE f.fence_id=v_fence_id AND f.command_id=v_command
  AND f.lease_epoch=1 AND NOT f.dispatch_allowed AND NOT f.core_ledger_written
  AND l.hub_task_id>139;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='FENCE_LINEAGE_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:'||v.hub_task_id::text,0));
 v_now:=clock_timestamp();
 v_expires:=to_timestamp((p_claims->>'expiresAt')::numeric/1000);
 v_issued:=to_timestamp((p_claims->>'issuedAt')::numeric/1000);
 IF v.lease_expires_at<=v_now OR v_expires<=v_now OR
 v_expires>v.lease_expires_at OR v_expires-v_issued>interval '15 seconds' OR
 v_issued<v.lease_started_at OR v_issued>v_now+interval '1 second' OR
 p_claims->>'hubTaskId' IS DISTINCT FROM v.hub_task_id::text OR
 p_claims->>'hubExecutionId' IS DISTINCT FROM v.hub_execution_id::text OR
 p_claims->>'coreTaskId' IS DISTINCT FROM v.core_task_id::text OR
 p_claims->>'attemptId' IS DISTINCT FROM v.attempt_id::text OR
 p_claims->>'linkId' IS DISTINCT FROM v.link_id::text OR
 p_claims->>'receiptId' IS DISTINCT FROM v.receipt_id::text OR
 p_claims->>'approvalDigest' IS DISTINCT FROM v.approval_digest OR
 p_claims->>'nonceDigest' IS DISTINCT FROM
   encode(extensions.digest(v.nonce,'sha256'),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_LINEAGE_MISMATCH';END IF;
 INSERT INTO gpt02_private.issuer_evidences(
 command_id,fence_id,claims,signature,digest,expires_at,signing_grant,dispatch_allowed)
 VALUES(v_command,v_fence_id,p_claims,p_signature,p_digest,v_expires,false,false)
 RETURNING evidence_id INTO v_evidence;
 RETURN v_evidence;
END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.record_issuer_evidence(jsonb,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION gpt02_private.consume_issuer_lease(
 p_command uuid,p_evidence uuid,p_fence uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;
BEGIN
 IF session_user<>'gpt02_core_prep_login' THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LEASE_CONSUMER_IDENTITY_DENIED';END IF;
 SELECT e.evidence_id,e.command_id,e.fence_id,e.expires_at,
    f.lease_epoch,f.lease_expires_at,f.dispatch_allowed AS fence_dispatch,
    f.core_ledger_written,l.hub_task_id
 INTO v
 FROM gpt02_private.issuer_evidences e
 JOIN gpt02_private.post_consumption_fences f ON f.fence_id=e.fence_id
 AND f.command_id=e.command_id
 JOIN gpt02_private.operator_links l ON l.link_id=f.link_id
 AND l.command_id=f.command_id
 WHERE e.evidence_id=p_evidence AND e.command_id=p_command
 AND e.fence_id=p_fence AND l.company_id='default' AND l.hub_task_id>139
 AND NOT e.signing_grant AND NOT e.dispatch_allowed;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='BOUND_ISSUER_EVIDENCE_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('default:'||v.hub_task_id::text,0));
 IF v.expires_at<=clock_timestamp() OR
 v.lease_expires_at<=clock_timestamp() OR
 v.lease_epoch<>1 OR v.fence_dispatch OR v.core_ledger_written THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_LEASE_EXPIRED';END IF;
 INSERT INTO gpt02_private.issuer_lease_consumptions(
 evidence_id,command_id,fence_id,lease_epoch,dispatch_allowed)
 VALUES(p_evidence,p_command,p_fence,1,false);
 RETURN 'LEASE_CONSUMED_NO_DISPATCH';
END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.consume_issuer_lease(uuid,uuid,uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_private TO gpt02_core_prep_login;
GRANT EXECUTE ON FUNCTION
 gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text),
 gpt02_private.consume_linked_approval(uuid,uuid,uuid,text),
 gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text),
 gpt02_private.record_issuer_evidence(jsonb,text,text),
 gpt02_private.consume_issuer_lease(uuid,uuid,uuid)
 TO gpt02_core_prep_login;
RESET ROLE;
-- All six entry points remain inaccessible until the dedicated writer logs in.
-- Return both role memberships to their pre-existing SET=FALSE state.
GRANT gpt02_core_prep_owner TO postgres WITH SET FALSE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $role_postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_core_prep_owner','SET') OR
 pg_has_role('postgres','gpt02_store_owner','SET') THEN
  RAISE EXCEPTION 'MIGRATOR_ROLE_SET_OPTION_NOT_RESTORED';
 END IF;
END $role_postflight$;
COMMIT;