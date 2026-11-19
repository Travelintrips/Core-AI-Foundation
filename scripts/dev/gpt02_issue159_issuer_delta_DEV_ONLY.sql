-- GPT02 Issue159 / DEV — incremental issuer evidence and lease only.
-- DORMANT SCHEMA: issuer signer and writer remain NOLOGIN; no signing/dispatch.
-- Does not replace any of the four existing lifecycle functions.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $preflight$
DECLARE v_count integer;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres'
 OR session_user IS DISTINCT FROM 'postgres' THEN
  RAISE EXCEPTION 'MIGRATOR_IDENTITY_MISMATCH';
 END IF;
 IF pg_has_role('postgres','gpt02_store_owner','SET') THEN
  RAISE EXCEPTION 'STORE_OWNER_SET_BASELINE_CHANGED';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
  JOIN pg_roles target ON target.oid=m.roleid
  WHERE member.rolname='postgres' AND target.rolname='gpt02_store_owner'
   AND m.admin_option AND NOT m.set_option
 ) THEN RAISE EXCEPTION 'STORE_OWNER_ESCROW_NOT_AVAILABLE'; END IF;
 IF EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname IN
  ('gpt02_store_owner','gpt02_core_prep_login','dev_gpt02_attestor_evidence',
   'dev_gpt02_issuer_evidence') AND
   (rolcanlogin OR rolsuper OR rolbypassrls)
 ) OR
 (SELECT count(*) FROM pg_roles WHERE rolname IN
  ('gpt02_store_owner','gpt02_core_prep_login','dev_gpt02_attestor_evidence',
   'dev_gpt02_issuer_evidence'))<>4 THEN
  RAISE EXCEPTION 'WRITER_ROLE_IS_NOT_DORMANT'; END IF;
 IF NOT has_schema_privilege('gpt02_store_owner','gpt02_stage','USAGE')
 OR NOT has_table_privilege('gpt02_store_owner',
 'gpt02_stage.core_preparations','SELECT')
 OR NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='gpt02_stage'
  AND tablename='core_preparations'
  AND policyname='gpt02_store_owner_preparation_read'
  AND cmd='SELECT' AND roles::text LIKE '%gpt02_store_owner%'
 ) THEN RAISE EXCEPTION 'STAGE_PROVENANCE_READ_BOUNDARY_MISSING';END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc
  WHERE oid='pg_catalog.sha256(bytea)'::regprocedure) THEN
  RAISE EXCEPTION 'NATIVE_SHA256_UNAVAILABLE'; END IF;
 SELECT count(*) INTO v_count FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (
   n.nspname='gpt02_stage' AND p.oid =
   'gpt02_stage.prepare_core_task(text,integer,text,text,text,text)'::regprocedure
   AND p.prosecdef AND pg_get_userbyid(p.proowner)='gpt02_core_prep_owner'
  ) OR (
   n.nspname='gpt02_private' AND p.oid IN
   ('gpt02_private.record_linked_approval(jsonb,text,text,jsonb,text,text,text)'::regprocedure,
    'gpt02_private.consume_linked_approval(jsonb,text,text,jsonb,text,text,text)'::regprocedure,
    'gpt02_private.reserve_post_consumption_fence(uuid,uuid,uuid,text)'::regprocedure)
   AND p.prosecdef AND pg_get_userbyid(p.proowner)='gpt02_store_owner'
  );
 IF v_count<>4 THEN RAISE EXCEPTION 'EXISTING_FOUR_RPC_CONTRACT_DRIFT';END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gpt02_private' AND p.proname IN
  ('record_issuer_evidence','consume_issuer_lease')) THEN
   RAISE EXCEPTION 'ISSUER_FUNCTION_NAME_ALREADY_TAKEN'; END IF;
 IF to_regclass('gpt02_private.issuer_evidences') IS NOT NULL
 OR to_regclass('gpt02_private.issuer_lease_consumptions') IS NOT NULL THEN
   RAISE EXCEPTION 'ISSUER_LEDGER_NAME_ALREADY_TAKEN'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n
  ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private'
  AND c.relname='post_consumption_fences'
  AND c.relrowsecurity AND c.relforcerowsecurity
  AND pg_get_userbyid(c.relowner)='gpt02_store_owner')
 OR NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n
  ON n.oid=c.relnamespace WHERE n.nspname='gpt02_stage'
  AND c.relname='core_preparations'
  AND c.relrowsecurity AND c.relforcerowsecurity
  AND pg_get_userbyid(c.relowner)='gpt02_core_prep_owner')
 THEN RAISE EXCEPTION 'BASE_RLS_OWNER_DRIFT';END IF;
END $preflight$;

-- Migration role can temporarily SET the owner inside this one transaction.
-- It must be restored before commit. The issuer login remains NOLOGIN.
GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;

CREATE TABLE gpt02_private.issuer_evidences(
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id text NOT NULL DEFAULT 'default' CHECK(company_id='default'),
 hub_task_id integer NOT NULL CHECK(hub_task_id>139),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 fence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.post_consumption_fences(fence_id),
 link_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.operator_links(link_id),
 receipt_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.receipts(id),
 attempt_id uuid NOT NULL UNIQUE,
 claims jsonb NOT NULL,
 signature text NOT NULL CHECK(signature ~ '^[A-Za-z0-9_-]{86}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 signing_grant boolean NOT NULL DEFAULT false CHECK(signing_grant=false),
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
 FOREIGN KEY(receipt_id,command_id,link_id)
  REFERENCES gpt02_private.post_consumption_fences(receipt_id,command_id,link_id),
 UNIQUE(evidence_id,command_id,fence_id)
);
CREATE TABLE gpt02_private.issuer_lease_consumptions(
 evidence_id uuid PRIMARY KEY,
 company_id text NOT NULL DEFAULT 'default' CHECK(company_id='default'),
 hub_task_id integer NOT NULL CHECK(hub_task_id>139),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 fence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.post_consumption_fences(fence_id),
 lease_epoch bigint NOT NULL DEFAULT 1 CHECK(lease_epoch=1),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false),
 FOREIGN KEY(evidence_id,command_id,fence_id)
  REFERENCES gpt02_private.issuer_evidences(evidence_id,command_id,fence_id)
);
ALTER TABLE gpt02_private.issuer_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_evidences FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_lease_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.issuer_lease_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY issuer_evidences_owner_only ON gpt02_private.issuer_evidences
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
CREATE POLICY issuer_lease_owner_only ON gpt02_private.issuer_lease_consumptions
 FOR ALL TO gpt02_store_owner USING(true) WITH CHECK(true);
-- Scoped independent read-back, no insert/update/delete privileges.
CREATE POLICY issuer_evidences_reader_select ON gpt02_private.issuer_evidences
 FOR SELECT TO gpt02_issuer_evidence_reader USING(
 company_id='default' AND hub_task_id>139
 AND claims->>'environment'='DEV'
 AND claims->>'audience'='GPT02_ISSUER_LEASE_EVIDENCE_V1');
CREATE POLICY issuer_lease_reader_select ON gpt02_private.issuer_lease_consumptions
 FOR SELECT TO gpt02_issuer_evidence_reader
 USING(company_id='default' AND hub_task_id>139);
CREATE TRIGGER issuer_evidences_reject_mutation BEFORE UPDATE OR DELETE
 ON gpt02_private.issuer_evidences FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER issuer_evidences_reject_truncate BEFORE TRUNCATE
 ON gpt02_private.issuer_evidences FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER issuer_lease_reject_mutation BEFORE UPDATE OR DELETE
 ON gpt02_private.issuer_lease_consumptions FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER issuer_lease_reject_truncate BEFORE TRUNCATE
 ON gpt02_private.issuer_lease_consumptions FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
REVOKE ALL ON gpt02_private.issuer_evidences,
 gpt02_private.issuer_lease_consumptions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gpt02_private.issuer_evidences,
 gpt02_private.issuer_lease_consumptions TO gpt02_issuer_evidence_reader;

-- Store one detached issuer evidence only after exact persisted lineage.
-- No cryptographic verification here: independent issuer signer evidence
-- must be verified by a separate trusted component BEFORE any call.
CREATE FUNCTION gpt02_private.record_issuer_evidence(
 p_claims jsonb,p_signature text,p_digest text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE
 v record; v_command uuid; v_fence uuid; v_issued timestamptz;
 v_expires timestamptz; v_now timestamptz; v_evidence_id uuid;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence'
 OR jsonb_typeof(p_claims) IS DISTINCT FROM 'object'
 OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(p_claims))<>19
 OR NOT p_claims ?& ARRAY[
 'v','environment','audience','companyId','hubTaskId','hubExecutionId',
 'coreTaskId','commandId','attemptId','workerId','receiptId','linkId',
 'fenceId','approvalDigest','nonceDigest','issuerRole','leaseEpoch',
 'issuedAt','expiresAt']
 OR p_claims->>'v' IS DISTINCT FROM '1'
 OR p_claims->>'environment' IS DISTINCT FROM 'DEV'
 OR p_claims->>'audience' IS DISTINCT FROM 'GPT02_ISSUER_LEASE_EVIDENCE_V1'
 OR p_claims->>'companyId' IS DISTINCT FROM 'default'
 OR p_claims->>'issuerRole' IS DISTINCT FROM 'dev_gpt02_issuer_evidence'
 OR p_claims->>'leaseEpoch' IS DISTINCT FROM '1'
 OR p_claims->>'workerId' IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev'
 OR coalesce(p_signature,'') !~ '^[A-Za-z0-9_-]{86}$'
 OR coalesce(p_digest,'') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_claims->>'approvalDigest','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_claims->>'nonceDigest','') !~ '^[0-9a-f]{64}$'
 OR coalesce(p_claims->>'issuedAt','') !~ '^[0-9]{13}$'
 OR coalesce(p_claims->>'expiresAt','') !~ '^[0-9]{13}$'
 OR coalesce(p_claims->>'hubTaskId','') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='ISSUER_EVIDENCE_SCOPE_DENIED';END IF;

 BEGIN
  v_command:=(p_claims->>'commandId')::uuid;
  v_fence:=(p_claims->>'fenceId')::uuid;
  v_issued:=to_timestamp((p_claims->>'issuedAt')::numeric/1000);
  v_expires:=to_timestamp((p_claims->>'expiresAt')::numeric/1000);
 EXCEPTION WHEN others THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ISSUER_EVIDENCE_TYPE_INVALID';
 END;

 SELECT f.fence_id,f.receipt_id,f.command_id,f.link_id,
        f.hub_execution_id,f.core_task_id,f.attempt_id,
        f.lease_epoch,f.lease_started_at,f.lease_expires_at,
        a.company_id,a.task_id,a.nonce,a.digest AS approval_digest,
        a.expires_at AS approval_expires,
        l.expires_at AS link_expires,r.consumed_at,
        p.expires_at AS prep_expires
 INTO v FROM gpt02_private.post_consumption_fences f
 JOIN gpt02_private.core_identity_receipts i
   ON i.receipt_id=f.receipt_id AND i.command_id=f.command_id
    AND i.link_id=f.link_id
 JOIN gpt02_private.receipts r
   ON r.id=f.receipt_id AND r.command_id=f.command_id
 JOIN gpt02_private.operator_links l
   ON l.link_id=f.link_id AND l.command_id=f.command_id
    AND l.attempt_id=f.attempt_id
 JOIN gpt02_private.approvals a
   ON a.command_id=f.command_id AND a.attempt_id=f.attempt_id
    AND a.nonce=r.nonce AND a.digest=r.digest
    AND a.task_id=l.hub_task_id AND a.company_id=l.company_id
    AND a.digest=l.approval_digest
 JOIN gpt02_stage.core_preparations p
   ON p.command_candidate_id=f.command_id
    AND p.hub_execution_id=f.hub_execution_id
    AND p.core_task_id=f.core_task_id
    AND p.attempt_id=f.attempt_id
    AND p.hub_task_id=a.task_id AND p.company_id=a.company_id
 WHERE f.fence_id=v_fence AND f.command_id=v_command
  AND f.lease_epoch=1 AND NOT f.dispatch_allowed
  AND NOT f.core_ledger_written AND i.binding_verified=false
  AND NOT i.may_dispatch_worker AND NOT i.may_issue_grant
  AND NOT i.may_close_job AND NOT i.core_ledger_written
  AND f.worker_id='openclaw-dell-chatgpt-wake-dev'
  AND a.task_id>139 AND a.company_id='default'
 LIMIT 2;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='PERSISTED_ISSUER_LINEAGE_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.command_id::text,0));
 v_now:=clock_timestamp();
 IF v.lease_expires_at<=v_now OR v.approval_expires<=v_now
 OR v.link_expires<=v_now OR v.prep_expires<=v_now
 OR v.consumed_at>v.lease_started_at
 OR v.consumed_at<v.lease_started_at-interval '15 seconds'
 OR v_issued<v.lease_started_at OR v_issued>v_now+interval '1 second'
 OR v_expires<=v_now OR v_expires<=v_issued
 OR v_expires>v.lease_expires_at
 OR v_expires-v_issued>interval '15 seconds'
 OR p_claims->>'hubTaskId' IS DISTINCT FROM v.task_id::text
 OR p_claims->>'hubExecutionId' IS DISTINCT FROM v.hub_execution_id::text
 OR p_claims->>'coreTaskId' IS DISTINCT FROM v.core_task_id::text
 OR p_claims->>'attemptId' IS DISTINCT FROM v.attempt_id::text
 OR p_claims->>'linkId' IS DISTINCT FROM v.link_id::text
 OR p_claims->>'receiptId' IS DISTINCT FROM v.receipt_id::text
 OR p_claims->>'approvalDigest' IS DISTINCT FROM v.approval_digest
 OR p_claims->>'nonceDigest' IS DISTINCT FROM
  encode(pg_catalog.sha256(pg_catalog.convert_to(v.nonce,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='ISSUER_CLAIMS_NOT_BOUND_OR_EXPIRED';END IF;
 INSERT INTO gpt02_private.issuer_evidences(
 company_id,hub_task_id,command_id,fence_id,link_id,receipt_id,
 attempt_id,claims,signature,digest,expires_at,signing_grant,dispatch_allowed)
 VALUES('default',v.task_id,v.command_id,v.fence_id,v.link_id,
 v.receipt_id,v.attempt_id,p_claims,p_signature,p_digest,
 v_expires,false,false) RETURNING evidence_id INTO v_evidence_id;
 RETURN v_evidence_id;
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.record_issuer_evidence(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.record_issuer_evidence(jsonb,text,text)
 TO dev_gpt02_issuer_evidence;

-- One-shot evidence lease consumption; never authorizes dispatch.
CREATE FUNCTION gpt02_private.consume_issuer_lease(
 p_command uuid,p_evidence uuid,p_fence uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;
BEGIN
 IF session_user<>'dev_gpt02_issuer_evidence' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_SESSION_REQUIRED';END IF;
 SELECT e.evidence_id,e.command_id,e.fence_id,e.expires_at,
 f.lease_expires_at,f.lease_epoch,f.dispatch_allowed AS fence_dispatch,
 f.core_ledger_written,a.company_id,a.task_id,p.expires_at AS prep_expires
 INTO v FROM gpt02_private.issuer_evidences e
 JOIN gpt02_private.post_consumption_fences f
  ON f.fence_id=e.fence_id AND f.command_id=e.command_id
  AND f.link_id=e.link_id AND f.receipt_id=e.receipt_id
  AND f.attempt_id=e.attempt_id
 JOIN gpt02_private.operator_links l
  ON l.link_id=f.link_id AND l.command_id=f.command_id
 JOIN gpt02_private.approvals a
  ON a.command_id=e.command_id AND a.task_id=e.hub_task_id
  AND a.company_id=e.company_id AND a.attempt_id=f.attempt_id
 JOIN gpt02_stage.core_preparations p
  ON p.command_candidate_id=e.command_id AND p.hub_task_id=a.task_id
   AND p.company_id=a.company_id AND p.hub_execution_id=f.hub_execution_id
   AND p.core_task_id=f.core_task_id AND p.attempt_id=f.attempt_id
 WHERE e.evidence_id=p_evidence AND e.command_id=p_command
  AND e.fence_id=p_fence AND a.company_id='default' AND a.task_id>139
  AND NOT e.signing_grant AND NOT e.dispatch_allowed
 LIMIT 2;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='BOUND_ISSUER_EVIDENCE_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v.command_id::text,0));
 IF v.expires_at<=clock_timestamp() OR
 v.lease_expires_at<=clock_timestamp() OR
 v.prep_expires<=clock_timestamp() OR
 v.lease_epoch<>1 OR v.fence_dispatch OR v.core_ledger_written THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_LEASE_EXPIRED';END IF;
 INSERT INTO gpt02_private.issuer_lease_consumptions(
 evidence_id,company_id,hub_task_id,command_id,fence_id,
 lease_epoch,dispatch_allowed)
 VALUES(v.evidence_id,v.company_id,v.task_id,v.command_id,v.fence_id,1,false);
 RETURN 'LEASE_CONSUMED_NO_DISPATCH';
END $fn$;
REVOKE ALL ON FUNCTION
 gpt02_private.consume_issuer_lease(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.consume_issuer_lease(uuid,uuid,uuid)
 TO dev_gpt02_issuer_evidence;
RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR (SELECT rolcanlogin FROM pg_roles
  WHERE rolname='dev_gpt02_issuer_evidence')
 OR (SELECT rolcanlogin FROM pg_roles
  WHERE rolname='dev_gpt02_attestor_evidence')
 THEN RAISE EXCEPTION 'MIGRATION_ROLE_BOUNDARY_NOT_RESTORED';END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='gpt02_private'
  AND c.relname IN ('issuer_evidences','issuer_lease_consumptions')
  AND c.relrowsecurity AND c.relforcerowsecurity
  AND pg_get_userbyid(c.relowner)='gpt02_store_owner')<>2
 THEN RAISE EXCEPTION 'NEW_EVIDENCE_RLS_NOT_FORCED';END IF;
END $postflight$;
COMMIT;