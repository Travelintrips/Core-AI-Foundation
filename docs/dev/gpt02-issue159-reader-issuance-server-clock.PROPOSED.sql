-- GPT02 Issue159 SOURCE-ONLY DRAFT, NEVER APPLY TO LIVE DEV/PROD.
-- Additive database-clock enforcement on the EXISTING private issuance ledger.
-- This does NOT validate Ed25519 signatures or persisted Super Admin approval.
-- ONLY the existing pinned verifier/persisted readback supplies those upstream.
-- Owner/credential custody and any privileged INSERT remain UNIMPLEMENTED.
--
-- Dependency: minimal-catalog-relock-auditor and
-- one-read-consumption-attestation PROPOSED.sql (in isolated PG16 only).
-- Deliberately requires EMPTY issuance + consumption ledgers. No ALTER LOGIN,
-- service, supervisor, signer, task, dispatch, DELL, or PROD changes.

BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname='postgres'
        AND rolcreaterole AND NOT rolsuper
    )
    OR NOT EXISTS (
      SELECT 1 FROM pg_namespace
      WHERE nspname='gpt02_relock_audit'
        AND nspowner='postgres'::regrole
    )
    OR (
      SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_relock_audit'
        AND c.relname IN ('reader_issuances','reader_consumptions')
        AND c.relkind='r'
        AND c.relowner='postgres'::regrole
        AND c.relrowsecurity AND c.relforcerowsecurity
    ) <> 2
    OR to_regprocedure(
      'gpt02_relock_audit.enforce_reader_issuance_server_clock()'
    ) IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid='gpt02_relock_audit.reader_issuances'::regclass
        AND t.tgname='issuance_server_clock'
    )
    OR EXISTS (
      SELECT 1 FROM gpt02_relock_audit.reader_issuances
    )
    OR EXISTS (
      SELECT 1 FROM gpt02_relock_audit.reader_consumptions
    )
 THEN RAISE EXCEPTION 'READER_ISSUANCE_TTL_PREFLIGHT_DENIED';
 END IF;
END $preflight$;

-- SECURITY INVOKER (not DEFINER): the INSERT is still available only to
-- a separately privileged owner. A mere consumer/auditor cannot insert.
-- The database itself replaces any user-supplied issued_at timestamp.
CREATE FUNCTION gpt02_relock_audit.enforce_reader_issuance_server_clock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $clock$
DECLARE v_now timestamptz;
BEGIN
 IF TG_OP <> 'INSERT'
    OR TG_TABLE_SCHEMA <> 'gpt02_relock_audit'
    OR TG_TABLE_NAME <> 'reader_issuances'
 THEN RAISE EXCEPTION 'READER_ISSUANCE_CLOCK_WRONG_TRIGGER';
 END IF;
 v_now := clock_timestamp();
 IF NEW.expires_at IS NULL
    OR NEW.expires_at <= v_now + interval '3.5 seconds'
    OR NEW.expires_at > v_now + interval '15 seconds'
 THEN RAISE EXCEPTION 'READER_ISSUANCE_DB_CLOCK_TTL_DENIED'
   USING ERRCODE='22023';
 END IF;
 NEW.issued_at := v_now;
 RETURN NEW;
END
$clock$;
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.enforce_reader_issuance_server_clock() FROM PUBLIC;

CREATE TRIGGER issuance_server_clock
BEFORE INSERT ON gpt02_relock_audit.reader_issuances
FOR EACH ROW EXECUTE FUNCTION
 gpt02_relock_audit.enforce_reader_issuance_server_clock();

-- Even a malformed import cannot make an issuance last >15 seconds
-- relative to the database-generated issued_at. This is not a signature
-- or approval verification; it is only a maximum server-clock TTL invariant.
ALTER TABLE gpt02_relock_audit.reader_issuances
 ADD CONSTRAINT reader_issuance_db_clock_ttl
 CHECK (
   expires_at > issued_at + interval '3.5 seconds'
   AND expires_at <= issued_at + interval '15 seconds'
 );

DO $postflight$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_trigger t
   WHERE t.tgrelid='gpt02_relock_audit.reader_issuances'::regclass
     AND t.tgname='issuance_server_clock'
     AND t.tgenabled='O' AND t.tgtype=7
     AND t.tgfoid=(
       'gpt02_relock_audit.enforce_reader_issuance_server_clock()'
     )::regprocedure
 )
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid=(
       'gpt02_relock_audit.enforce_reader_issuance_server_clock()'
      )::regprocedure
        AND p.prosecdef
    )
    OR has_table_privilege(
       'dev_gpt02_relock_catalog_auditor',
       'gpt02_relock_audit.reader_issuances','INSERT'
    )
    OR has_table_privilege(
       'dev_gpt02_relock_catalog_auditor',
       'gpt02_relock_audit.reader_issuances','SELECT'
    )
 THEN RAISE EXCEPTION 'READER_ISSUANCE_TTL_POSTFLIGHT_DENIED';
 END IF;
END $postflight$;
COMMIT;
-- Proposal remains source-only, no live permission or release.
