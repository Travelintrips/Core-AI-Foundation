-- CST-DEV GPT02 Issue159: genuine-Owner-source -> canonical DB fence binding.
-- SOURCE / SECURITY REVIEW ONLY. NEVER APPLY WITHOUT DBA/CUSTODIAN AUTHORITY.
-- This migration DOES NOT manufacture a human approval, create a login,
-- sign a packet, grant a reader, or dispatch. PostgreSQL becomes fail-closed:
-- neither an issuer row nor a one-read claim may commit without BOTH the
-- pre-issuer persisted-Owner source and post-issuer signed-scope binding.
-- Source can be imported BEFORE fourth issuer proof to avoid circular bootstrap.
-- The single human consent is NOT repeated in PostgreSQL.
BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS (SELECT 1 FROM pg_roles
    WHERE rolname='postgres' AND rolcreaterole AND NOT rolsuper)
 OR NOT EXISTS (SELECT 1 FROM pg_namespace
    WHERE nspname='gpt02_relock_audit'
    AND nspowner='postgres'::regrole)
 OR to_regclass('gpt02_relock_audit.owner_source_decisions') IS NOT NULL
 OR to_regclass('gpt02_relock_audit.reader_owner_source_bindings') IS NOT NULL
 OR to_regclass('gpt02_relock_audit.reader_approval_fences') IS NULL
 OR to_regclass('gpt02_relock_audit.reader_issuances') IS NULL
 OR to_regclass('gpt02_relock_audit.reader_consumptions') IS NULL
 OR (SELECT count(*) FROM pg_trigger t
   WHERE t.tgrelid IN (
     'gpt02_relock_audit.reader_issuances'::regclass,
     'gpt02_relock_audit.reader_consumptions'::regclass)
     AND t.tgname IN ('issuance_approval_fence','consume_approval_fence')
     AND t.tgenabled='O') <> 2
 OR EXISTS (SELECT 1 FROM gpt02_relock_audit.reader_issuances)
 OR EXISTS (SELECT 1 FROM gpt02_relock_audit.reader_consumptions)
 THEN RAISE EXCEPTION 'OWNER_SOURCE_BINDING_PREFLIGHT_DENIED'
   USING ERRCODE='42501'; END IF;
END $preflight$;

-- Stage 1 (before issuer): imported ONLY by an independently trusted
-- server relay reading the already committed SQLite Owner decision.
-- PostgreSQL cannot authenticate SQLite directly; row presence alone is NOT
-- proof that the authorized relay has performed its signed/source check.
CREATE TABLE gpt02_relock_audit.owner_source_decisions(
 source_decision_id uuid PRIMARY KEY,
 claims_sha256 text NOT NULL UNIQUE
   CHECK(claims_sha256 ~ '^[0-9a-f]{64}$'),
 owner_actor_id text NOT NULL
   CHECK(owner_actor_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$'
         AND owner_actor_id <> 'dev_approval_token'),
 auth_method text NOT NULL
   CHECK(auth_method IN ('supabase_admin_session','supabase_aal2')),
 role_at_decision text NOT NULL CHECK(role_at_decision='super_admin'),
 company_id text NOT NULL CHECK(company_id='default'),
 task_id integer NOT NULL CHECK(task_id>171),
 command_id uuid NOT NULL UNIQUE,
 attempt_id uuid NOT NULL UNIQUE,
 recorded_at_ms bigint NOT NULL CHECK(recorded_at_ms>0),
 expires_at_ms bigint NOT NULL
   CHECK(expires_at_ms>recorded_at_ms
         AND expires_at_ms-recorded_at_ms<=300000),
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 UNIQUE(task_id,command_id,attempt_id),
 CHECK(command_id<>attempt_id)
);
ALTER TABLE gpt02_relock_audit.owner_source_decisions
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_relock_audit.owner_source_decisions
 FORCE ROW LEVEL SECURITY;
CREATE POLICY postgres_source_owner_only
 ON gpt02_relock_audit.owner_source_decisions
 FOR ALL TO postgres USING(true) WITH CHECK(true);
REVOKE ALL ON gpt02_relock_audit.owner_source_decisions FROM PUBLIC;

-- Stage 2 (after issuer): exact signed packet/receipt maps back to the
-- immutable source decision. ONE source decision can bind ONE scope only.
CREATE TABLE gpt02_relock_audit.reader_owner_source_bindings(
 scope_sha text PRIMARY KEY
   REFERENCES gpt02_relock_audit.reader_approval_fences(scope_sha),
 source_decision_id uuid NOT NULL UNIQUE
   REFERENCES gpt02_relock_audit.owner_source_decisions(source_decision_id),
 packet_sha text NOT NULL UNIQUE CHECK(packet_sha ~ '^[0-9a-f]{64}$'),
 bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gpt02_relock_audit.reader_owner_source_bindings
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_relock_audit.reader_owner_source_bindings
 FORCE ROW LEVEL SECURITY;
CREATE POLICY postgres_source_link_only
 ON gpt02_relock_audit.reader_owner_source_bindings
 FOR ALL TO postgres USING(true) WITH CHECK(true);
REVOKE ALL ON gpt02_relock_audit.reader_owner_source_bindings FROM PUBLIC;

-- Permanent one-way Owner-source revocation. Never silently rebind the
-- source, alter source facts, un-revoke or delete an approved decision.
CREATE FUNCTION gpt02_relock_audit.revoke_source_once()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,pg_temp
AS $rev$
BEGIN
 IF TG_OP<>'UPDATE' OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL
    OR (to_jsonb(NEW)-'revoked_at')
       IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
 THEN RAISE EXCEPTION 'OWNER_SOURCE_IMMUTABLE_OR_REVOKED'
   USING ERRCODE='42501'; END IF;
 NEW.revoked_at:=clock_timestamp();
 RETURN NEW;
END $rev$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.revoke_source_once()
 FROM PUBLIC;
CREATE TRIGGER source_revoke_once
 BEFORE UPDATE ON gpt02_relock_audit.owner_source_decisions
 FOR EACH ROW EXECUTE FUNCTION gpt02_relock_audit.revoke_source_once();
CREATE TRIGGER source_no_delete
 BEFORE DELETE ON gpt02_relock_audit.owner_source_decisions
 FOR EACH ROW EXECUTE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation();
CREATE TRIGGER source_no_truncate
 BEFORE TRUNCATE ON gpt02_relock_audit.owner_source_decisions
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation();
CREATE TRIGGER binding_no_update
 BEFORE UPDATE ON gpt02_relock_audit.reader_owner_source_bindings
 FOR EACH ROW EXECUTE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation();
CREATE TRIGGER binding_no_delete
 BEFORE DELETE ON gpt02_relock_audit.reader_owner_source_bindings
 FOR EACH ROW EXECUTE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation();
CREATE TRIGGER binding_no_truncate
 BEFORE TRUNCATE ON gpt02_relock_audit.reader_owner_source_bindings
 FOR EACH STATEMENT EXECUTE FUNCTION gpt02_relock_audit.reject_reader_ledger_mutation();

-- Defense in depth atop original canonical fence trigger. Even an
-- apparently signed issuer packet with an already inserted synthetic
-- canonical fence is NOT permission to issue without a genuine source link.
CREATE FUNCTION gpt02_relock_audit.require_owner_source_for_issue()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $issue$
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION 'OWNER_SOURCE_ISSUE_WRONG_OPERATION'; END IF;
 PERFORM 1 FROM gpt02_relock_audit.reader_owner_source_bindings b
 JOIN gpt02_relock_audit.owner_source_decisions s
   ON s.source_decision_id=b.source_decision_id
 JOIN gpt02_relock_audit.reader_approval_fences f
   ON f.scope_sha=b.scope_sha
 WHERE b.scope_sha=NEW.scope_sha AND b.packet_sha=NEW.packet_sha
   AND f.scope_sha=NEW.scope_sha AND f.packet_sha=NEW.packet_sha
   AND f.role_name=NEW.role_name AND f.task_id=NEW.task_id
   AND f.company_id=NEW.company_id AND f.command_id=NEW.command_id
   AND f.attempt_id=NEW.attempt_id AND f.receipt_id=NEW.receipt_id
   AND f.fence_id=NEW.fence_id
   AND s.task_id=NEW.task_id AND s.company_id=NEW.company_id
   AND s.command_id=NEW.command_id AND s.attempt_id=NEW.attempt_id
   AND s.revoked_at IS NULL AND f.revoked_at IS NULL
   AND to_timestamp(s.expires_at_ms/1000.0)>
     clock_timestamp()+interval '3.5 seconds'
   AND NEW.expires_at<=to_timestamp(s.expires_at_ms/1000.0)
   AND NEW.expires_at<=f.approval_expires_at
 FOR SHARE OF b,s,f;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'PERSISTED_OWNER_SOURCE_OR_FENCE_REQUIRED'
    USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $issue$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.require_owner_source_for_issue()
 FROM PUBLIC;
CREATE TRIGGER issuance_owner_source_required
 BEFORE INSERT ON gpt02_relock_audit.reader_issuances
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.require_owner_source_for_issue();

-- Recheck the exact same source immediately before the ONE allowed read
-- consumption. PostgreSQL row locks serialize with a canonical revocation.
CREATE FUNCTION gpt02_relock_audit.require_owner_source_for_consume()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $claim$
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION 'OWNER_SOURCE_CONSUME_WRONG_OPERATION'; END IF;
 PERFORM 1 FROM gpt02_relock_audit.reader_issuances i
 JOIN gpt02_relock_audit.reader_owner_source_bindings b
   ON b.scope_sha=i.scope_sha
 JOIN gpt02_relock_audit.owner_source_decisions s
   ON s.source_decision_id=b.source_decision_id
 JOIN gpt02_relock_audit.reader_approval_fences f
   ON f.scope_sha=b.scope_sha
 WHERE i.scope_sha=NEW.scope_sha
   AND b.scope_sha=i.scope_sha AND b.packet_sha=i.packet_sha
   AND f.packet_sha=i.packet_sha AND f.role_name=i.role_name
   AND f.task_id=i.task_id AND f.command_id=i.command_id
   AND f.attempt_id=i.attempt_id AND f.receipt_id=i.receipt_id
   AND f.fence_id=i.fence_id
   AND s.task_id=i.task_id AND s.company_id=i.company_id
   AND s.command_id=i.command_id AND s.attempt_id=i.attempt_id
   AND s.revoked_at IS NULL AND f.revoked_at IS NULL
   AND to_timestamp(s.expires_at_ms/1000.0)>
      clock_timestamp()+interval '2 seconds'
   AND i.expires_at>clock_timestamp()+interval '2 seconds'
 FOR SHARE OF b,s,f;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'PERSISTED_OWNER_SOURCE_REVOKED_OR_EXPIRED'
     USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $claim$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.require_owner_source_for_consume()
 FROM PUBLIC;
CREATE TRIGGER consumption_owner_source_required
 BEFORE INSERT ON gpt02_relock_audit.reader_consumptions
 FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.require_owner_source_for_consume();

DO $postflight$
BEGIN
 IF (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid IN (
      'gpt02_relock_audit.reader_issuances'::regclass,
      'gpt02_relock_audit.reader_consumptions'::regclass)
    AND t.tgname IN ('issuance_owner_source_required',
       'consumption_owner_source_required') AND t.tgenabled='O') <> 2
 OR has_table_privilege('authenticated',
    'gpt02_relock_audit.owner_source_decisions','SELECT')
 OR has_table_privilege('anon',
    'gpt02_relock_audit.reader_owner_source_bindings','SELECT')
 THEN RAISE EXCEPTION 'OWNER_SOURCE_POSTFLIGHT_DENIED'
   USING ERRCODE='42501'; END IF;
END $postflight$;
COMMIT;
-- No source row, incomplete staged bridge, expired/revoked source or wrong
-- exact task/command/attempt -> DENY BEFORE any reader issuance/consumption.
-- A trusted signed SQLite relay and native DB import are STILL REQUIRED;
-- cannot infer human consent from any PostgreSQL row created by postgres.
