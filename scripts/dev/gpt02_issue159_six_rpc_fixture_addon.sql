-- GPT02 Issue159 disposable-only continuation of split-owner fixture.
-- This is NOT an operational migration. Inputs are synthetic, signatures are
-- NOT cryptographically verified here, and dispatch is always denied.
BEGIN;
SET ROLE gpt02_fixture_store_owner;

CREATE TABLE gpt02_fixture_store.nonce_receipts (
 receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id bigint NOT NULL UNIQUE REFERENCES gpt02_fixture_store.approvals(task_id),
 command_id uuid NOT NULL UNIQUE,
 nonce text NOT NULL UNIQUE,
 approval_digest text NOT NULL CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(receipt_id,task_id,command_id)
);
CREATE TABLE gpt02_fixture_store.fences (
 fence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 receipt_id uuid NOT NULL UNIQUE,
 task_id bigint NOT NULL UNIQUE,
 command_id uuid NOT NULL UNIQUE,
 worker_id text NOT NULL CHECK (worker_id='openclaw-dell-chatgpt-wake-dev'),
 lease_epoch bigint NOT NULL DEFAULT 1 CHECK (lease_epoch=1),
 lease_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_expires_at timestamptz NOT NULL,
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK (dispatch_allowed=false),
 UNIQUE(fence_id,task_id,command_id),
 FOREIGN KEY(receipt_id,task_id,command_id)
 REFERENCES gpt02_fixture_store.nonce_receipts(receipt_id,task_id,command_id),
 CHECK (lease_expires_at>lease_started_at AND lease_expires_at<=lease_started_at+interval '15 seconds')
);
CREATE TABLE gpt02_fixture_store.issuer_evidence (
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 fence_id uuid NOT NULL UNIQUE,
 task_id bigint NOT NULL UNIQUE,
 command_id uuid NOT NULL UNIQUE,
 evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 signing_grant boolean NOT NULL DEFAULT false CHECK(signing_grant=false),
 FOREIGN KEY(fence_id,task_id,command_id)
 REFERENCES gpt02_fixture_store.fences(fence_id,task_id,command_id)
);
CREATE TABLE gpt02_fixture_store.lease_consumptions (
 evidence_id uuid PRIMARY KEY REFERENCES gpt02_fixture_store.issuer_evidence(evidence_id),
 task_id bigint NOT NULL UNIQUE,
 command_id uuid NOT NULL UNIQUE,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatch_allowed boolean NOT NULL DEFAULT false CHECK(dispatch_allowed=false)
);

ALTER TABLE gpt02_fixture_store.nonce_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.nonce_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.fences FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.issuer_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.issuer_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.lease_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.lease_consumptions FORCE ROW LEVEL SECURITY;

CREATE POLICY nonce_owner_only ON gpt02_fixture_store.nonce_receipts
 FOR ALL TO gpt02_fixture_store_owner USING(true) WITH CHECK(true);
CREATE POLICY fence_owner_only ON gpt02_fixture_store.fences
 FOR ALL TO gpt02_fixture_store_owner USING(true) WITH CHECK(true);
CREATE POLICY issuer_owner_only ON gpt02_fixture_store.issuer_evidence
 FOR ALL TO gpt02_fixture_store_owner USING(true) WITH CHECK(true);
CREATE POLICY consumption_owner_only ON gpt02_fixture_store.lease_consumptions
 FOR ALL TO gpt02_fixture_store_owner USING(true) WITH CHECK(true);

CREATE TRIGGER immutable_nonce_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_store.nonce_receipts
 FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_nonce_truncate BEFORE TRUNCATE ON gpt02_fixture_store.nonce_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_fence_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_store.fences
 FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_fence_truncate BEFORE TRUNCATE ON gpt02_fixture_store.fences
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_issuer_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_store.issuer_evidence
 FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_issuer_truncate BEFORE TRUNCATE ON gpt02_fixture_store.issuer_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_consumption_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_store.lease_consumptions
 FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_consumption_truncate BEFORE TRUNCATE ON gpt02_fixture_store.lease_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();

CREATE OR REPLACE FUNCTION gpt02_fixture_store.consume_linked_approval(
 p_task bigint,p_command uuid,p_nonce text,p_digest text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r uuid;
BEGIN
 IF session_user<>'gpt02_fixture_writer' OR p_task<=139 OR
    p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CONSUMPTION_SCOPE_DENIED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 IF NOT EXISTS (
  SELECT 1 FROM gpt02_fixture_store.approvals a
  WHERE a.task_id=p_task AND a.command_id=p_command AND a.nonce=p_nonce
  AND a.approved_by='fixture-super-admin' AND a.created_at>clock_timestamp()-interval '5 minutes'
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PERSISTED_APPROVAL_REQUIRED'; END IF;
 INSERT INTO gpt02_fixture_store.nonce_receipts(task_id,command_id,nonce,approval_digest)
 VALUES(p_task,p_command,p_nonce,p_digest) RETURNING receipt_id INTO r;
 RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION gpt02_fixture_store.reserve_post_consumption_fence(
 p_task bigint,p_command uuid,p_nonce text,p_worker text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r uuid; v_started timestamptz;
BEGIN
 IF session_user<>'gpt02_fixture_writer' OR p_task<=139 OR
 p_worker IS DISTINCT FROM 'openclaw-dell-chatgpt-wake-dev' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FENCE_SCOPE_DENIED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 IF NOT EXISTS(
  SELECT 1 FROM gpt02_fixture_store.nonce_receipts n
  WHERE n.task_id=p_task AND n.command_id=p_command AND n.nonce=p_nonce
  AND n.consumed_at>clock_timestamp()-interval '15 seconds'
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='FRESH_CONSUMED_NONCE_REQUIRED'; END IF;
 v_started:=clock_timestamp();
 INSERT INTO gpt02_fixture_store.fences(receipt_id,task_id,command_id,worker_id,lease_started_at,lease_expires_at)
 SELECT n.receipt_id,p_task,p_command,p_worker,v_started,v_started+interval '14 seconds'
 FROM gpt02_fixture_store.nonce_receipts n
 WHERE n.task_id=p_task AND n.command_id=p_command AND n.nonce=p_nonce
 RETURNING fence_id INTO r;
 RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION gpt02_fixture_store.record_issuer_evidence(
 p_task bigint,p_command uuid,p_fence uuid,p_digest text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE r uuid;
BEGIN
 IF session_user<>'gpt02_fixture_writer' OR p_task<=139 OR
 p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ISSUER_SCOPE_DENIED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 IF NOT EXISTS(
  SELECT 1 FROM gpt02_fixture_store.fences f
  WHERE f.task_id=p_task AND f.command_id=p_command AND f.fence_id=p_fence
  AND f.lease_expires_at>clock_timestamp() AND NOT f.dispatch_allowed
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACTIVE_FENCE_REQUIRED';END IF;
 INSERT INTO gpt02_fixture_store.issuer_evidence(fence_id,task_id,command_id,evidence_digest)
 VALUES(p_fence,p_task,p_command,p_digest) RETURNING evidence_id INTO r;
 RETURN r;
END $fn$;

CREATE OR REPLACE FUNCTION gpt02_fixture_store.consume_issuer_lease(
 p_task bigint,p_command uuid,p_evidence uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF session_user<>'gpt02_fixture_writer' OR p_task<=139 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LEASE_SCOPE_DENIED'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 IF NOT EXISTS(
  SELECT 1 FROM gpt02_fixture_store.issuer_evidence e
  JOIN gpt02_fixture_store.fences f ON f.fence_id=e.fence_id
  WHERE e.task_id=p_task AND e.command_id=p_command AND e.evidence_id=p_evidence
  AND f.lease_expires_at>clock_timestamp() AND NOT f.dispatch_allowed
  AND NOT e.signing_grant
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='LIVE_BOUND_ISSUER_EVIDENCE_REQUIRED'; END IF;
 INSERT INTO gpt02_fixture_store.lease_consumptions(evidence_id,task_id,command_id)
 VALUES(p_evidence,p_task,p_command);
 RETURN 'LEASE_CONSUMED_NO_DISPATCH';
END $fn$;

REVOKE ALL ON FUNCTION gpt02_fixture_store.consume_linked_approval(bigint,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_fixture_store.reserve_post_consumption_fence(bigint,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_fixture_store.record_issuer_evidence(bigint,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_fixture_store.consume_issuer_lease(bigint,uuid,uuid) FROM PUBLIC;
RESET ROLE;

GRANT EXECUTE ON FUNCTION gpt02_fixture_store.consume_linked_approval(bigint,uuid,text,text) TO gpt02_fixture_writer;
GRANT EXECUTE ON FUNCTION gpt02_fixture_store.reserve_post_consumption_fence(bigint,uuid,text,text) TO gpt02_fixture_writer;
GRANT EXECUTE ON FUNCTION gpt02_fixture_store.record_issuer_evidence(bigint,uuid,uuid,text) TO gpt02_fixture_writer;
GRANT EXECUTE ON FUNCTION gpt02_fixture_store.consume_issuer_lease(bigint,uuid,uuid) TO gpt02_fixture_writer;
COMMIT;

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]