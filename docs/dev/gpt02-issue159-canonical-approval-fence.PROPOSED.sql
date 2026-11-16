-- GPT02 Issue159 DRAFT PROPOSAL ONLY — NOT applied to live DEV or PROD.
-- MODEL for a future canonical PostgreSQL approval/revocation authority.
-- Does NOT import SQLite approval data, mint approvals, verify signatures,
-- provision reader credentials or dispatch any worker.
-- DO NOT APPLY: canonical approval source migration and independent SECURITY
-- review of owner privileges, revocation semantics and recovery remain NO_GO.
-- This test-only model uses the existing private reader issuance ledger,
-- one-read consumer RPC, and server-clock TTL. It does not rewrite them.
-- Owner can still forge authority: upstream signed evidence/custody is MISSING.

BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres'
                   AND rolcreaterole AND NOT rolsuper)
    OR NOT EXISTS (SELECT 1 FROM pg_namespace
                   WHERE nspname='gpt02_relock_audit'
                     AND nspowner='postgres'::regrole)
    OR to_regclass('gpt02_relock_audit.reader_approval_fences') IS NOT NULL
    OR to_regclass('gpt02_relock_audit.reader_issuances') IS NULL
    OR to_regclass('gpt02_relock_audit.reader_consumptions') IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.consume_reader_once(name,text,text,uuid,uuid,uuid,uuid,text)'
    ) IS NULL
    OR to_regprocedure(
      'gpt02_relock_audit.enforce_reader_issuance_server_clock()'
    ) IS NULL
    OR EXISTS (SELECT 1 FROM gpt02_relock_audit.reader_issuances)
    OR EXISTS (SELECT 1 FROM gpt02_relock_audit.reader_consumptions)
 THEN RAISE EXCEPTION 'CANONICAL_APPROVAL_FENCE_PREFLIGHT_DENIED';
 END IF;
END $preflight$;

-- A synthetic PostgreSQL canonical authority model, NOT a mirror of SQLite.
-- Future production design must prove how a genuine Super Admin approval
-- and its revocation are written to this table, with no split-brain state.
CREATE TABLE gpt02_relock_audit.reader_approval_fences (
 scope_sha text PRIMARY KEY CHECK(scope_sha ~ '^[a-f0-9]{64}$'),
 packet_sha text NOT NULL UNIQUE CHECK(packet_sha ~ '^[a-f0-9]{64}$'),
 role_name name NOT NULL UNIQUE,
 task_id integer NOT NULL CHECK(task_id>139),
 company_id text NOT NULL CHECK(company_id='default'),
 command_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 receipt_id uuid NOT NULL UNIQUE,
 fence_id uuid NOT NULL UNIQUE,
 approval_expires_at timestamptz NOT NULL,
 revoked_at timestamptz NULL
);
ALTER TABLE gpt02_relock_audit.reader_approval_fences
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_relock_audit.reader_approval_fences
 FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_relock_audit.reader_approval_fences
 FOR ALL TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON gpt02_relock_audit.reader_approval_fences FROM PUBLIC;

-- One-way revocation: the same row cannot be reactivated or rebound to
-- another packet, task, command, attempt, receipt, role or expiry.
CREATE FUNCTION gpt02_relock_audit.enforce_one_way_approval_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $revocation$
BEGIN
 IF TG_OP <> 'UPDATE' OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
    OR (to_jsonb(NEW)-'revoked_at')
       IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
 THEN RAISE EXCEPTION 'CANONICAL_APPROVAL_FENCE_MUTATION_DENIED';
 END IF;
 NEW.revoked_at := clock_timestamp();
 RETURN NEW;
END
$revocation$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.enforce_one_way_approval_revocation()
 FROM PUBLIC;
CREATE TRIGGER revoke_once
 BEFORE UPDATE ON gpt02_relock_audit.reader_approval_fences
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.enforce_one_way_approval_revocation();
CREATE TRIGGER immutable_delete
 BEFORE DELETE ON gpt02_relock_audit.reader_approval_fences
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.reject_reader_ledger_mutation();
CREATE TRIGGER immutable_truncate
 BEFORE TRUNCATE ON gpt02_relock_audit.reader_approval_fences
 FOR EACH STATEMENT EXECUTE FUNCTION
 gpt02_relock_audit.reject_reader_ledger_mutation();

-- Acquiring FOR SHARE on the canonical row serializes with UPDATE revoke.
-- If revocation COMMITs first, a waiting INSERT must recheck and DENY.
CREATE FUNCTION gpt02_relock_audit.enforce_approval_fence_on_issue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $issue$
BEGIN
 IF TG_OP <> 'INSERT'
 THEN RAISE EXCEPTION 'CANONICAL_ISSUANCE_TRIGGER_INVALID'; END IF;
 PERFORM 1
 FROM gpt02_relock_audit.reader_approval_fences f
 WHERE f.scope_sha=NEW.scope_sha AND f.packet_sha=NEW.packet_sha
   AND f.role_name=NEW.role_name AND f.task_id=NEW.task_id
   AND f.company_id=NEW.company_id
   AND f.command_id=NEW.command_id AND f.attempt_id=NEW.attempt_id
   AND f.receipt_id=NEW.receipt_id AND f.fence_id=NEW.fence_id
   AND f.revoked_at IS NULL
   AND f.approval_expires_at>clock_timestamp()+interval '3.5 seconds'
   AND NEW.expires_at<=f.approval_expires_at
 FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'CANONICAL_ISSUANCE_REVOKED_OR_SCOPE_DENIED';
 END IF;
 RETURN NEW;
END
$issue$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.enforce_approval_fence_on_issue() FROM PUBLIC;
CREATE TRIGGER issuance_approval_fence
 BEFORE INSERT ON gpt02_relock_audit.reader_issuances
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.enforce_approval_fence_on_issue();

-- Same-row lock also serializes first consume vs revocation. If approval
-- is revoked before consumption, no one-read claim can be recorded.
-- IMPORTANT: a successful claim is NOT a durable proof of still-active
-- approval AFTER COMMIT. Final reader admission/revocation remains NO_GO.
CREATE FUNCTION gpt02_relock_audit.enforce_approval_fence_on_consume()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $consume$
BEGIN
 IF TG_OP <> 'INSERT'
 THEN RAISE EXCEPTION 'CANONICAL_CONSUME_TRIGGER_INVALID'; END IF;
 PERFORM 1
 FROM gpt02_relock_audit.reader_approval_fences f
 JOIN gpt02_relock_audit.reader_issuances i
   ON i.scope_sha=f.scope_sha
 WHERE i.scope_sha=NEW.scope_sha
   AND f.packet_sha=i.packet_sha AND f.role_name=i.role_name
   AND f.task_id=i.task_id AND f.company_id=i.company_id
   AND f.command_id=i.command_id AND f.attempt_id=i.attempt_id
   AND f.receipt_id=i.receipt_id AND f.fence_id=i.fence_id
   AND f.revoked_at IS NULL
   AND f.approval_expires_at>clock_timestamp()+interval '2 seconds'
   AND i.expires_at>clock_timestamp()+interval '2 seconds'
 FOR SHARE OF f;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'CANONICAL_CONSUME_REVOKED_OR_SCOPE_DENIED';
 END IF;
 RETURN NEW;
END
$consume$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.enforce_approval_fence_on_consume() FROM PUBLIC;
CREATE TRIGGER consume_approval_fence
 BEFORE INSERT ON gpt02_relock_audit.reader_consumptions
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.enforce_approval_fence_on_consume();

DO $postflight$
BEGIN
 IF (SELECT count(*) FROM pg_trigger t
     WHERE t.tgrelid IN (
       'gpt02_relock_audit.reader_issuances'::regclass,
       'gpt02_relock_audit.reader_consumptions'::regclass)
       AND t.tgname IN ('issuance_approval_fence','consume_approval_fence')
       AND t.tgenabled='O' AND t.tgtype=7) <> 2
    OR has_table_privilege('dev_gpt02_relock_catalog_auditor',
       'gpt02_relock_audit.reader_approval_fences','SELECT')
    OR has_table_privilege('dev_gpt02_reader_claim_consumer',
       'gpt02_relock_audit.reader_approval_fences','SELECT')
    OR has_table_privilege('dev_gpt02_reader_claim_consumer',
       'gpt02_relock_audit.reader_approval_fences','UPDATE')
 THEN RAISE EXCEPTION 'CANONICAL_APPROVAL_FENCE_POSTFLIGHT_DENIED';
 END IF;
END $postflight$;
COMMIT;
-- SOURCE-ONLY SECURITY MODEL. NO LIVE APPROVAL, CREDENTIAL, OR DISPATCH.
