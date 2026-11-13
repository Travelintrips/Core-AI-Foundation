-- DEV Issue159: PROPOSED / NOT APPLIED / NO DEPLOY / NEVER PROD.
-- Separate, one-use positive permit ledger. Does NOT alter the six existing
-- lifecycle RPCs or any historical NO_DISPATCH CHECK/rows.
-- The database cannot verify Ed25519 with built-in PostgreSQL functions.
-- An independently authenticated, pinned-key four-signature verifier MUST
-- validate the exact packet and trusted owner approval before a dedicated,
-- short-lived release writer invokes either RPC. SHA-256 is an audit binding,
-- NOT a substitute for verifying signatures. No writer LOGIN is enabled here.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $preflight$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_MIGRATOR_MISMATCH'; END IF;
 IF to_regclass('gpt02_private.positive_dispatch_permits') IS NOT NULL
 OR to_regclass('gpt02_private.positive_dispatch_consumptions') IS NOT NULL
 OR to_regclass('gpt02_private.positive_dispatch_outbox') IS NOT NULL
 OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN
   ('dev_gpt02_release_writer','dev_gpt02_release_reader'))
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_ALREADY_PRESENT'; END IF;
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 THEN RAISE EXCEPTION 'STORE_OWNER_BASELINE_CHANGED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_store_owner'
   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_issuer_evidence'
   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 THEN RAISE EXCEPTION 'DORMANT_ROLE_BASELINE_MISSING'; END IF;
 IF (SELECT count(*) FROM pg_constraint con
     JOIN pg_class c ON c.oid=con.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='gpt02_private'
       AND ((c.relname='issuer_evidences' AND
             con.conname IN ('issuer_evidences_signing_grant_check',
                             'issuer_evidences_dispatch_allowed_check'))
         OR (c.relname='issuer_lease_consumptions' AND
             con.conname='issuer_lease_consumptions_dispatch_allowed_check')
         OR (c.relname='post_consumption_fences' AND
             con.conname='post_consumption_fences_dispatch_allowed_check'))
       AND pg_get_constraintdef(con.oid) LIKE '%false%') <> 4
 THEN RAISE EXCEPTION 'LEGACY_NO_DISPATCH_GUARDS_CHANGED'; END IF;
 IF to_regprocedure('gpt02_private.record_issuer_evidence(jsonb,text,text)') IS NULL
 OR to_regprocedure('gpt02_private.consume_issuer_lease(uuid,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION 'ISSUER_LINEAGE_RPC_MISSING'; END IF;
END $preflight$;

CREATE ROLE dev_gpt02_release_writer NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
CREATE ROLE dev_gpt02_release_reader NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT gpt02_store_owner TO postgres WITH SET TRUE;
SET ROLE gpt02_store_owner;
-- The private schema owner, not the migration account, must grant USAGE.
-- PostgreSQL can only WARN (rather than error) when a non-grantor tries.
GRANT USAGE ON SCHEMA gpt02_private TO
 dev_gpt02_release_writer,dev_gpt02_release_reader;

CREATE TABLE gpt02_private.positive_dispatch_permits (
 permit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id text NOT NULL DEFAULT 'default' CHECK (company_id='default'),
 hub_task_id integer NOT NULL CHECK (hub_task_id>139),
 command_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.approvals(command_id),
 attempt_id uuid NOT NULL UNIQUE,
 issuer_evidence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.issuer_evidences(evidence_id),
 fence_id uuid NOT NULL UNIQUE REFERENCES gpt02_private.post_consumption_fences(fence_id),
 worker_id text NOT NULL DEFAULT 'openclaw-dell-chatgpt-wake-dev'
   CHECK (worker_id='openclaw-dell-chatgpt-wake-dev'),
 verified_packet_sha256 text NOT NULL
   CHECK (verified_packet_sha256 ~ '^[0-9a-f]{64}$'),
 authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 UNIQUE (permit_id,command_id)
);
CREATE TABLE gpt02_private.positive_dispatch_consumptions (
 permit_id uuid PRIMARY KEY,
 command_id uuid NOT NULL UNIQUE,
 consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (permit_id,command_id)
   REFERENCES gpt02_private.positive_dispatch_permits(permit_id,command_id)
);
-- The outbox is committed atomically with permit consumption. The recorded
-- row is NOT a dispatch, a bridge command, or a success acknowledgement.
-- A separately authorized dispatcher must later use exact command IDs with
-- its own idempotency/fencing protocol and independent Final ACK verification.
CREATE TABLE gpt02_private.positive_dispatch_outbox (
 command_id uuid PRIMARY KEY,
 permit_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 core_task_id uuid NOT NULL UNIQUE,
 hub_task_id integer NOT NULL CHECK (hub_task_id>139),
 worker_id text NOT NULL DEFAULT 'openclaw-dell-chatgpt-wake-dev'
   CHECK (worker_id='openclaw-dell-chatgpt-wake-dev'),
 packet_sha256 text NOT NULL CHECK (packet_sha256 ~ '^[0-9a-f]{64}
ALTER TABLE gpt02_private.positive_dispatch_permits FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY positive_permits_owner ON gpt02_private.positive_dispatch_permits
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_consumptions_owner ON gpt02_private.positive_dispatch_consumptions
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_outbox_owner ON gpt02_private.positive_dispatch_outbox
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_permits_reader ON gpt02_private.positive_dispatch_permits
 FOR SELECT TO dev_gpt02_release_reader USING (company_id='default');
CREATE POLICY positive_consumptions_reader ON gpt02_private.positive_dispatch_consumptions
 FOR SELECT TO dev_gpt02_release_reader USING (true);
CREATE POLICY positive_outbox_reader ON gpt02_private.positive_dispatch_outbox
 FOR SELECT TO dev_gpt02_release_reader USING (delivery_state='HELD_NO_DISPATCH');
CREATE TRIGGER positive_outbox_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_outbox FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_outbox_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_outbox FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_permits_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_permits FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_permits_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_permits FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();

REVOKE ALL ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions,
 gpt02_private.positive_dispatch_outbox
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions,
 gpt02_private.positive_dispatch_outbox TO dev_gpt02_release_reader;

-- This is a durable permit RESERVATION, not a worker dispatch and not a
-- verifier. The dedicated writer credential must only become operational
-- after separate four-signature, pinned-key, exact-command verifier review.
CREATE FUNCTION gpt02_private.reserve_positive_dispatch_permit(
 p_command uuid,p_issuer_evidence uuid,p_verified_packet_sha256 text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record; v_now timestamptz; v_permit uuid;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_AND_PACKET_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 v_now:=clock_timestamp();
 SELECT e.evidence_id,e.command_id,e.attempt_id,e.hub_task_id,e.fence_id,
        e.expires_at AS evidence_expiry,
        a.expires_at AS approval_expiry,
        l.expires_at AS link_expiry,
        p.expires_at AS prep_expiry,
        f.lease_expires_at AS fence_expiry,
        f.lease_started_at,
        c.consumed_at AS lease_consumed_at
 INTO v
 FROM gpt02_private.issuer_evidences e
 JOIN gpt02_private.issuer_lease_consumptions c
   ON c.evidence_id=e.evidence_id AND c.command_id=e.command_id
   AND c.fence_id=e.fence_id AND c.hub_task_id=e.hub_task_id
 JOIN gpt02_private.post_consumption_fences f
   ON f.fence_id=e.fence_id AND f.command_id=e.command_id
   AND f.link_id=e.link_id AND f.receipt_id=e.receipt_id
   AND f.attempt_id=e.attempt_id
 JOIN gpt02_private.operator_links l
   ON l.link_id=e.link_id AND l.command_id=e.command_id
   AND l.attempt_id=e.attempt_id AND l.hub_task_id=e.hub_task_id
 JOIN gpt02_private.approvals a
   ON a.command_id=e.command_id AND a.attempt_id=e.attempt_id
   AND a.task_id=e.hub_task_id AND a.digest=l.approval_digest
   AND a.company_id='default'
 JOIN gpt02_stage.core_preparations p
   ON p.command_candidate_id=e.command_id AND p.attempt_id=e.attempt_id
   AND p.hub_task_id=e.hub_task_id AND p.core_task_id=f.core_task_id
   AND p.hub_execution_id=f.hub_execution_id AND p.company_id='default'
 WHERE e.evidence_id=p_issuer_evidence AND e.command_id=p_command
   AND e.company_id='default' AND e.hub_task_id>139
   AND e.claims->>'environment'='DEV'
   AND e.claims->>'audience'='GPT02_ISSUER_LEASE_EVIDENCE_V1'
   AND e.claims->>'commandId'=e.command_id::text
   AND e.claims->>'attemptId'=e.attempt_id::text
   -- Original proof-only rows stay NO_DISPATCH, forever.
   AND NOT e.signing_grant AND NOT e.dispatch_allowed
   AND NOT c.dispatch_allowed AND NOT f.dispatch_allowed
   AND NOT f.core_ledger_written
 LIMIT 2;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='PERSISTED_LINKED_ISSUER_PROOF_REQUIRED'; END IF;
 IF (v.evidence_expiry<=v_now+interval '2 seconds'
     OR v.approval_expiry<=v_now+interval '2 seconds'
     OR v.link_expiry<=v_now+interval '2 seconds'
     OR v.prep_expiry<=v_now+interval '2 seconds'
     OR v.fence_expiry<=v_now+interval '2 seconds'
     OR v.lease_consumed_at>v_now
     OR v.lease_consumed_at<v.lease_started_at-interval '15 seconds')
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_LINEAGE_EXPIRED_OR_UNBOUND'; END IF;
 INSERT INTO gpt02_private.positive_dispatch_permits
 (company_id,hub_task_id,command_id,attempt_id,issuer_evidence_id,
  fence_id,worker_id,verified_packet_sha256,expires_at)
 VALUES ('default',v.hub_task_id,v.command_id,v.attempt_id,v.evidence_id,
         v.fence_id,'openclaw-dell-chatgpt-wake-dev',p_verified_packet_sha256,
         LEAST(v.evidence_expiry,v.fence_expiry,v.approval_expiry,v.link_expiry,v.prep_expiry))
 RETURNING permit_id INTO v_permit;
 RETURN v_permit;
END $fn$;

-- Concurrency/replay safety is on the immutable PRIMARY KEY/UNIQUE ledger,
-- in addition to the per-command advisory transaction lock.
CREATE FUNCTION gpt02_private.consume_positive_dispatch_permit(
 p_permit uuid,p_command uuid,p_verified_packet_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}

REVOKE ALL ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text)
 TO dev_gpt02_release_writer;

RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_writer')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_reader')
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;),
 delivery_state text NOT NULL DEFAULT 'HELD_NO_DISPATCH'
   CHECK (delivery_state='HELD_NO_DISPATCH'),
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (permit_id,command_id)
   REFERENCES gpt02_private.positive_dispatch_permits(permit_id,command_id)
);
ALTER TABLE gpt02_private.positive_dispatch_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_permits FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY positive_permits_owner ON gpt02_private.positive_dispatch_permits
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_consumptions_owner ON gpt02_private.positive_dispatch_consumptions
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_permits_reader ON gpt02_private.positive_dispatch_permits
 FOR SELECT TO dev_gpt02_release_reader USING (company_id='default');
CREATE POLICY positive_consumptions_reader ON gpt02_private.positive_dispatch_consumptions
 FOR SELECT TO dev_gpt02_release_reader USING (true);
CREATE TRIGGER positive_permits_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_permits FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_permits_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_permits FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();

REVOKE ALL ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions TO dev_gpt02_release_reader;

-- This is a durable permit RESERVATION, not a worker dispatch and not a
-- verifier. The dedicated writer credential must only become operational
-- after separate four-signature, pinned-key, exact-command verifier review.
CREATE FUNCTION gpt02_private.reserve_positive_dispatch_permit(
 p_command uuid,p_issuer_evidence uuid,p_verified_packet_sha256 text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record; v_now timestamptz; v_permit uuid;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_AND_PACKET_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 v_now:=clock_timestamp();
 SELECT e.evidence_id,e.command_id,e.attempt_id,e.hub_task_id,e.fence_id,
        e.expires_at AS evidence_expiry,
        a.expires_at AS approval_expiry,
        l.expires_at AS link_expiry,
        p.expires_at AS prep_expiry,
        f.lease_expires_at AS fence_expiry,
        f.lease_started_at,
        c.consumed_at AS lease_consumed_at
 INTO v
 FROM gpt02_private.issuer_evidences e
 JOIN gpt02_private.issuer_lease_consumptions c
   ON c.evidence_id=e.evidence_id AND c.command_id=e.command_id
   AND c.fence_id=e.fence_id AND c.hub_task_id=e.hub_task_id
 JOIN gpt02_private.post_consumption_fences f
   ON f.fence_id=e.fence_id AND f.command_id=e.command_id
   AND f.link_id=e.link_id AND f.receipt_id=e.receipt_id
   AND f.attempt_id=e.attempt_id
 JOIN gpt02_private.operator_links l
   ON l.link_id=e.link_id AND l.command_id=e.command_id
   AND l.attempt_id=e.attempt_id AND l.hub_task_id=e.hub_task_id
 JOIN gpt02_private.approvals a
   ON a.command_id=e.command_id AND a.attempt_id=e.attempt_id
   AND a.task_id=e.hub_task_id AND a.digest=l.approval_digest
   AND a.company_id='default'
 JOIN gpt02_stage.core_preparations p
   ON p.command_candidate_id=e.command_id AND p.attempt_id=e.attempt_id
   AND p.hub_task_id=e.hub_task_id AND p.core_task_id=f.core_task_id
   AND p.hub_execution_id=f.hub_execution_id AND p.company_id='default'
 WHERE e.evidence_id=p_issuer_evidence AND e.command_id=p_command
   AND e.company_id='default' AND e.hub_task_id>139
   AND e.claims->>'environment'='DEV'
   AND e.claims->>'audience'='GPT02_ISSUER_LEASE_EVIDENCE_V1'
   AND e.claims->>'commandId'=e.command_id::text
   AND e.claims->>'attemptId'=e.attempt_id::text
   -- Original proof-only rows stay NO_DISPATCH, forever.
   AND NOT e.signing_grant AND NOT e.dispatch_allowed
   AND NOT c.dispatch_allowed AND NOT f.dispatch_allowed
   AND NOT f.core_ledger_written
 LIMIT 2;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='PERSISTED_LINKED_ISSUER_PROOF_REQUIRED'; END IF;
 IF (v.evidence_expiry<=v_now+interval '2 seconds'
     OR v.approval_expiry<=v_now+interval '2 seconds'
     OR v.link_expiry<=v_now+interval '2 seconds'
     OR v.prep_expiry<=v_now+interval '2 seconds'
     OR v.fence_expiry<=v_now+interval '2 seconds'
     OR v.lease_consumed_at>v_now
     OR v.lease_consumed_at<v.lease_started_at-interval '15 seconds')
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_LINEAGE_EXPIRED_OR_UNBOUND'; END IF;
 INSERT INTO gpt02_private.positive_dispatch_permits
 (company_id,hub_task_id,command_id,attempt_id,issuer_evidence_id,
  fence_id,worker_id,verified_packet_sha256,expires_at)
 VALUES ('default',v.hub_task_id,v.command_id,v.attempt_id,v.evidence_id,
         v.fence_id,'openclaw-dell-chatgpt-wake-dev',p_verified_packet_sha256,
         LEAST(v.evidence_expiry,v.fence_expiry,v.approval_expiry,v.link_expiry,v.prep_expiry))
 RETURNING permit_id INTO v_permit;
 RETURN v_permit;
END $fn$;

-- Concurrency/replay safety is on the immutable PRIMARY KEY/UNIQUE ledger,
-- in addition to the per-command advisory transaction lock.
CREATE FUNCTION gpt02_private.consume_positive_dispatch_permit(
 p_permit uuid,p_command uuid,p_verified_packet_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 SELECT permit_id,command_id,expires_at INTO v
 FROM gpt02_private.positive_dispatch_permits
 WHERE permit_id=p_permit AND command_id=p_command
   AND verified_packet_sha256=p_verified_packet_sha256;
 IF NOT FOUND OR v.expires_at<=clock_timestamp()+interval '1 second'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='POSITIVE_PERMIT_NOT_VALID'; END IF;
 INSERT INTO gpt02_private.positive_dispatch_consumptions(permit_id,command_id)
 VALUES(v.permit_id,v.command_id);
 RETURN 'ONE_USE_PERMIT_CONSUMED_FOR_AUTHORIZED_BROKER';
END $fn$;

REVOKE ALL ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text)
 TO dev_gpt02_release_writer;

RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_writer')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_reader')
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 SELECT p.permit_id,p.command_id,p.expires_at,p.attempt_id,p.hub_task_id,
        p.worker_id,p.verified_packet_sha256,prep.core_task_id
 INTO v
 FROM gpt02_private.positive_dispatch_permits p
 JOIN gpt02_stage.core_preparations prep
   ON prep.command_candidate_id=p.command_id
   AND prep.attempt_id=p.attempt_id
   AND prep.hub_task_id=p.hub_task_id
   AND prep.company_id=p.company_id
 WHERE p.permit_id=p_permit AND p.command_id=p_command
   AND p.verified_packet_sha256=p_verified_packet_sha256;
 IF NOT FOUND OR v.expires_at<=clock_timestamp()+interval '1 second'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='POSITIVE_PERMIT_NOT_VALID'; END IF;
 -- Single RPC transaction: either both immutable rows appear or neither.
 -- This deliberately queues NO command to AI Core / GPT02 DELL.
 INSERT INTO gpt02_private.positive_dispatch_consumptions(permit_id,command_id)
 VALUES(v.permit_id,v.command_id);
 INSERT INTO gpt02_private.positive_dispatch_outbox
   (permit_id,command_id,attempt_id,hub_task_id,core_task_id,
    worker_id,packet_sha256,delivery_state)
 VALUES(v.permit_id,v.command_id,v.attempt_id,v.hub_task_id,v.core_task_id,
        v.worker_id,v.verified_packet_sha256,'HELD_NO_DISPATCH');
 RETURN 'OUTBOX_RECORDED_NO_WORKER_DISPATCH';
END $fn$;

REVOKE ALL ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text)
 TO dev_gpt02_release_writer;

RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_writer')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_reader')
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;),
 delivery_state text NOT NULL DEFAULT 'HELD_NO_DISPATCH'
   CHECK (delivery_state='HELD_NO_DISPATCH'),
 queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY (permit_id,command_id)
   REFERENCES gpt02_private.positive_dispatch_permits(permit_id,command_id)
);
ALTER TABLE gpt02_private.positive_dispatch_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_permits FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_private.positive_dispatch_consumptions FORCE ROW LEVEL SECURITY;
CREATE POLICY positive_permits_owner ON gpt02_private.positive_dispatch_permits
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_consumptions_owner ON gpt02_private.positive_dispatch_consumptions
 FOR ALL TO gpt02_store_owner USING (true) WITH CHECK (true);
CREATE POLICY positive_permits_reader ON gpt02_private.positive_dispatch_permits
 FOR SELECT TO dev_gpt02_release_reader USING (company_id='default');
CREATE POLICY positive_consumptions_reader ON gpt02_private.positive_dispatch_consumptions
 FOR SELECT TO dev_gpt02_release_reader USING (true);
CREATE TRIGGER positive_permits_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_permits FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_permits_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_permits FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_immutable BEFORE UPDATE OR DELETE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH ROW
 EXECUTE FUNCTION gpt02_private.reject_mutation();
CREATE TRIGGER positive_consumptions_no_truncate BEFORE TRUNCATE
 ON gpt02_private.positive_dispatch_consumptions FOR EACH STATEMENT
 EXECUTE FUNCTION gpt02_private.reject_mutation();

REVOKE ALL ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions
 FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON gpt02_private.positive_dispatch_permits,
 gpt02_private.positive_dispatch_consumptions TO dev_gpt02_release_reader;

-- This is a durable permit RESERVATION, not a worker dispatch and not a
-- verifier. The dedicated writer credential must only become operational
-- after separate four-signature, pinned-key, exact-command verifier review.
CREATE FUNCTION gpt02_private.reserve_positive_dispatch_permit(
 p_command uuid,p_issuer_evidence uuid,p_verified_packet_sha256 text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record; v_now timestamptz; v_permit uuid;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_AND_PACKET_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 v_now:=clock_timestamp();
 SELECT e.evidence_id,e.command_id,e.attempt_id,e.hub_task_id,e.fence_id,
        e.expires_at AS evidence_expiry,
        a.expires_at AS approval_expiry,
        l.expires_at AS link_expiry,
        p.expires_at AS prep_expiry,
        f.lease_expires_at AS fence_expiry,
        f.lease_started_at,
        c.consumed_at AS lease_consumed_at
 INTO v
 FROM gpt02_private.issuer_evidences e
 JOIN gpt02_private.issuer_lease_consumptions c
   ON c.evidence_id=e.evidence_id AND c.command_id=e.command_id
   AND c.fence_id=e.fence_id AND c.hub_task_id=e.hub_task_id
 JOIN gpt02_private.post_consumption_fences f
   ON f.fence_id=e.fence_id AND f.command_id=e.command_id
   AND f.link_id=e.link_id AND f.receipt_id=e.receipt_id
   AND f.attempt_id=e.attempt_id
 JOIN gpt02_private.operator_links l
   ON l.link_id=e.link_id AND l.command_id=e.command_id
   AND l.attempt_id=e.attempt_id AND l.hub_task_id=e.hub_task_id
 JOIN gpt02_private.approvals a
   ON a.command_id=e.command_id AND a.attempt_id=e.attempt_id
   AND a.task_id=e.hub_task_id AND a.digest=l.approval_digest
   AND a.company_id='default'
 JOIN gpt02_stage.core_preparations p
   ON p.command_candidate_id=e.command_id AND p.attempt_id=e.attempt_id
   AND p.hub_task_id=e.hub_task_id AND p.core_task_id=f.core_task_id
   AND p.hub_execution_id=f.hub_execution_id AND p.company_id='default'
 WHERE e.evidence_id=p_issuer_evidence AND e.command_id=p_command
   AND e.company_id='default' AND e.hub_task_id>139
   AND e.claims->>'environment'='DEV'
   AND e.claims->>'audience'='GPT02_ISSUER_LEASE_EVIDENCE_V1'
   AND e.claims->>'commandId'=e.command_id::text
   AND e.claims->>'attemptId'=e.attempt_id::text
   -- Original proof-only rows stay NO_DISPATCH, forever.
   AND NOT e.signing_grant AND NOT e.dispatch_allowed
   AND NOT c.dispatch_allowed AND NOT f.dispatch_allowed
   AND NOT f.core_ledger_written
 LIMIT 2;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='PERSISTED_LINKED_ISSUER_PROOF_REQUIRED'; END IF;
 IF (v.evidence_expiry<=v_now+interval '2 seconds'
     OR v.approval_expiry<=v_now+interval '2 seconds'
     OR v.link_expiry<=v_now+interval '2 seconds'
     OR v.prep_expiry<=v_now+interval '2 seconds'
     OR v.fence_expiry<=v_now+interval '2 seconds'
     OR v.lease_consumed_at>v_now
     OR v.lease_consumed_at<v.lease_started_at-interval '15 seconds')
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='RELEASE_LINEAGE_EXPIRED_OR_UNBOUND'; END IF;
 INSERT INTO gpt02_private.positive_dispatch_permits
 (company_id,hub_task_id,command_id,attempt_id,issuer_evidence_id,
  fence_id,worker_id,verified_packet_sha256,expires_at)
 VALUES ('default',v.hub_task_id,v.command_id,v.attempt_id,v.evidence_id,
         v.fence_id,'openclaw-dell-chatgpt-wake-dev',p_verified_packet_sha256,
         LEAST(v.evidence_expiry,v.fence_expiry,v.approval_expiry,v.link_expiry,v.prep_expiry))
 RETURNING permit_id INTO v_permit;
 RETURN v_permit;
END $fn$;

-- Concurrency/replay safety is on the immutable PRIMARY KEY/UNIQUE ledger,
-- in addition to the per-command advisory transaction lock.
CREATE FUNCTION gpt02_private.consume_positive_dispatch_permit(
 p_permit uuid,p_command uuid,p_verified_packet_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE v record;
BEGIN
 IF session_user <> 'dev_gpt02_release_writer'
 OR p_verified_packet_sha256 IS NULL
 OR p_verified_packet_sha256 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='TRUSTED_RELEASE_WRITER_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
 SELECT permit_id,command_id,expires_at INTO v
 FROM gpt02_private.positive_dispatch_permits
 WHERE permit_id=p_permit AND command_id=p_command
   AND verified_packet_sha256=p_verified_packet_sha256;
 IF NOT FOUND OR v.expires_at<=clock_timestamp()+interval '1 second'
 THEN RAISE EXCEPTION USING ERRCODE='42501',
  MESSAGE='POSITIVE_PERMIT_NOT_VALID'; END IF;
 INSERT INTO gpt02_private.positive_dispatch_consumptions(permit_id,command_id)
 VALUES(v.permit_id,v.command_id);
 RETURN 'ONE_USE_PERMIT_CONSUMED_FOR_AUTHORIZED_BROKER';
END $fn$;

REVOKE ALL ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_private.reserve_positive_dispatch_permit(uuid,uuid,text),
 gpt02_private.consume_positive_dispatch_permit(uuid,uuid,text)
 TO dev_gpt02_release_writer;

RESET ROLE;
GRANT gpt02_store_owner TO postgres WITH SET FALSE;
DO $postflight$
BEGIN
 IF pg_has_role('postgres','gpt02_store_owner','SET')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_writer')
 OR (SELECT rolcanlogin FROM pg_roles WHERE rolname='dev_gpt02_release_reader')
 THEN RAISE EXCEPTION 'POSITIVE_PERMIT_POSTFLIGHT_SECURITY_DRIFT'; END IF;
END $postflight$;
COMMIT;