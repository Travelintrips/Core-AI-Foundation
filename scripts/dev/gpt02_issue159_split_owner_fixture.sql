-- GPT02 #159 / DISPOSABLE PG16 FIXTURE ONLY.
-- Demonstrates the split-owner / one-session-writer model, without real approval
-- or real lifecycle tables. Do NOT apply to live DEV or PROD.
BEGIN;
CREATE ROLE gpt02_fixture_prep_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE gpt02_fixture_store_owner NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE gpt02_fixture_writer LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE CONNECTION LIMIT 1;
CREATE ROLE gpt02_fixture_reader LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE SCHEMA gpt02_fixture_prep AUTHORIZATION gpt02_fixture_prep_owner;
CREATE SCHEMA gpt02_fixture_store AUTHORIZATION gpt02_fixture_store_owner;
REVOKE ALL ON SCHEMA gpt02_fixture_prep, gpt02_fixture_store FROM PUBLIC;
CREATE TABLE gpt02_fixture_prep.preparations (
  task_id bigint PRIMARY KEY CHECK (task_id > 139),
  command_id uuid NOT NULL UNIQUE,
  nonce text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE gpt02_fixture_store.approvals (
  task_id bigint PRIMARY KEY CHECK (task_id > 139),
  command_id uuid NOT NULL UNIQUE,
  nonce text NOT NULL UNIQUE,
  approved_by text NOT NULL CHECK (approved_by = 'fixture-super-admin'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gpt02_fixture_prep.preparations OWNER TO gpt02_fixture_prep_owner;
ALTER TABLE gpt02_fixture_store.approvals OWNER TO gpt02_fixture_store_owner;
ALTER TABLE gpt02_fixture_prep.preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_prep.preparations FORCE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_fixture_store.approvals FORCE ROW LEVEL SECURITY;
SET ROLE gpt02_fixture_prep_owner;
CREATE OR REPLACE FUNCTION gpt02_fixture_prep.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='PREPARATION_IMMUTABLE'; END $fn$;
CREATE TRIGGER immutable_prep_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_prep.preparations
FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_prep.reject_mutation();
CREATE TRIGGER immutable_prep_truncate BEFORE TRUNCATE ON gpt02_fixture_prep.preparations
FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_prep.reject_mutation();
CREATE POLICY preparation_owner_only ON gpt02_fixture_prep.preparations
  FOR ALL TO gpt02_fixture_prep_owner USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION gpt02_fixture_prep.prepare_core_task(p_task bigint,p_command uuid,p_nonce text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF session_user <> 'gpt02_fixture_writer' OR p_task <= 139 OR
    p_nonce IS NULL OR length(p_nonce) < 32 OR length(p_nonce) > 128 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PREPARATION_SCOPE_DENIED';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 INSERT INTO gpt02_fixture_prep.preparations(task_id,command_id,nonce)
 VALUES(p_task,p_command,p_nonce);
 RETURN 'PREPARED_NO_DISPATCH';
END $fn$;
REVOKE ALL ON FUNCTION gpt02_fixture_prep.prepare_core_task(bigint,uuid,text) FROM PUBLIC;
RESET ROLE;
SET ROLE gpt02_fixture_store_owner;
CREATE OR REPLACE FUNCTION gpt02_fixture_store.reject_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='APPROVAL_IMMUTABLE'; END $fn$;
CREATE TRIGGER immutable_approval_rows BEFORE UPDATE OR DELETE ON gpt02_fixture_store.approvals
FOR EACH ROW EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE TRIGGER immutable_approval_truncate BEFORE TRUNCATE ON gpt02_fixture_store.approvals
FOR EACH STATEMENT EXECUTE FUNCTION gpt02_fixture_store.reject_mutation();
CREATE POLICY approval_owner_only ON gpt02_fixture_store.approvals
  FOR ALL TO gpt02_fixture_store_owner USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION gpt02_fixture_store.record_linked_approval(p_task bigint,p_command uuid,p_nonce text,p_admin text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF session_user <> 'gpt02_fixture_writer' OR p_task <= 139 OR
    p_admin IS DISTINCT FROM 'fixture-super-admin' OR
    p_nonce IS NULL OR length(p_nonce) < 32 OR length(p_nonce) > 128 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='APPROVAL_SCOPE_DENIED';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_task::text,0));
 -- This fixture proves atomic exclusion only; it is not a real approval signer.
 INSERT INTO gpt02_fixture_store.approvals(task_id,command_id,nonce,approved_by)
 VALUES(p_task,p_command,p_nonce,p_admin);
 RETURN 'RECORD_ONLY_NO_DISPATCH';
END $fn$;
REVOKE ALL ON FUNCTION gpt02_fixture_store.record_linked_approval(bigint,uuid,text,text) FROM PUBLIC;
RESET ROLE;
GRANT USAGE ON SCHEMA gpt02_fixture_prep,gpt02_fixture_store TO gpt02_fixture_writer;
GRANT EXECUTE ON FUNCTION gpt02_fixture_prep.prepare_core_task(bigint,uuid,text) TO gpt02_fixture_writer;
GRANT EXECUTE ON FUNCTION gpt02_fixture_store.record_linked_approval(bigint,uuid,text,text) TO gpt02_fixture_writer;
COMMIT;

[executed on device: srv1792369 (0891e23a-6a6b-4f8c-a16a-962e888e2014)]