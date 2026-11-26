-- CST-DEV ONLY: project xssrfshdrtdfupgqwfdw, GPT02-1782.
-- PHASE A: administrative role staging only; ZERO ledger grants or policies.
-- Explicitly select/verify the authorized DEV project connection outside SQL.
-- No password material, LOGIN activation, Task190 role or owner/SET changes.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL search_path = pg_catalog;
SET LOCAL createrole_self_grant = '';

DO $guard$
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres'
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
       WHERE rolname = current_user AND (rolcreaterole OR rolsuper)
     ) THEN
    RAISE EXCEPTION 'GPT02_1782_DEV_ROLE_ADMIN_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev') THEN
    RAISE EXCEPTION 'GPT02_1782_READER_ALREADY_EXISTS_RECONCILE';
  END IF;
  -- The administrative session can verify the original decision. This
  -- read-only guard does not claim table-owner authority or grant any access.
  IF (
    SELECT count(*)
    FROM gpt02_owner_approval.gpt02_relock_owner_approval_challenges AS c
    JOIN gpt02_owner_approval.gpt02_relock_owner_approval_decisions AS d ON d.challenge_id = c.id
    WHERE c.id = '9c4f21e1-48af-4f7f-9830-931b84e3e846'::uuid
      AND c.scope = 'GPT02_RELOCK_CST_DEV' AND c.environment = 'DEV'
      AND c.project_id = 'xssrfshdrtdfupgqwfdw'
      AND c.worker_principal = 'openclaw-vps-main'
      AND lower(c.owner_email) = 'admcst001@gmail.com'
      AND c.status = 'CONSUMED' AND d.decision = 'APPROVED'
      AND d.scope = c.scope AND d.worker_principal = c.worker_principal
      AND lower(d.owner_email) = lower(c.owner_email)
      AND d.owner_subject = c.owner_subject
      AND d.owner_auth_supabase_id = c.owner_auth_supabase_id
      AND d.manifest_sha256 = c.manifest_sha256
      AND d.approval_method = 'FRESH_CST_HUB_SIGNED_GOOGLE_OWNER_SESSION'
      AND d.decided_at = c.consumed_at
      AND d.decided_at >= c.issued_at AND d.decided_at < c.expires_at
  ) <> 1 THEN
    RAISE EXCEPTION 'GPT02_1782_ORIGINAL_OWNER_DECISION_REQUIRED';
  END IF;
END;
$guard$;

CREATE ROLE gpt02_owner_ledger_reader_1782_dev
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 1 PASSWORD NULL VALID UNTIL '1970-01-01 00:00:00+00';
ALTER ROLE gpt02_owner_ledger_reader_1782_dev SET default_transaction_read_only = 'on';
ALTER ROLE gpt02_owner_ledger_reader_1782_dev SET statement_timeout = '5s';
ALTER ROLE gpt02_owner_ledger_reader_1782_dev SET idle_in_transaction_session_timeout = '5s';
ALTER ROLE gpt02_owner_ledger_reader_1782_dev SET search_path = pg_catalog;

GRANT CONNECT ON DATABASE postgres TO gpt02_owner_ledger_reader_1782_dev;

DO $verify_role$
DECLARE reader_oid oid;
BEGIN
  SELECT oid INTO STRICT reader_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'gpt02_owner_ledger_reader_1782_dev'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
      AND rolconnlimit = 1 AND rolvaliduntil < now();
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = reader_oid) THEN
    RAISE EXCEPTION 'GPT02_1782_READER_MUST_HAVE_NO_PARENT_ROLE';
  END IF;
END;
$verify_role$;
COMMIT;
