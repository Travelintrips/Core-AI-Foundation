-- REVIEW ONLY. This is a NEW proposed Owner security scope, not Phase B authority.
-- Do not execute against CST DEV without explicit approval of this complete artifact,
-- its immutable Phase B source, target connection, fresh baseline and rollback plan.
-- No connection URL or credentials belong in this file.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
SET LOCAL idle_in_transaction_session_timeout = '10s';
SET LOCAL transaction_timeout = '30s';
SET LOCAL search_path = pg_catalog;

DO $delegation_preflight$
DECLARE
  actor_oid oid;
  owner_oid oid;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR session_user <> 'postgres' OR current_user <> 'postgres'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'GPT02_1782_DIRECT_PG17_POSTGRES_SESSION_REQUIRED';
  END IF;
  SELECT oid INTO STRICT actor_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'postgres' AND NOT rolsuper AND rolcanlogin;
  SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles
    WHERE rolname = 'gpt02_relock_owner_approval_owner'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(1782, 20261125) THEN
    RAISE EXCEPTION 'GPT02_1782_DELEGATION_ALREADY_IN_PROGRESS';
  END IF;
  IF pg_catalog.pg_has_role(actor_oid, owner_oid, 'SET')
     OR pg_catalog.pg_has_role(actor_oid, owner_oid, 'USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members
         WHERE roleid = owner_oid AND member = actor_oid) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members AS m
       JOIN pg_catalog.pg_roles AS g ON g.oid = m.grantor
       WHERE m.roleid = owner_oid AND m.member = actor_oid
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
         AND m.grantor <> actor_oid AND g.rolsuper
     ) THEN
    RAISE EXCEPTION 'GPT02_1782_ADMIN_ONLY_BASELINE_REQUIRED';
  END IF;
END;
$delegation_preflight$;

-- Record every membership field, including the original row OID and grantor.
CREATE TEMP TABLE gpt02_1782_membership_before ON COMMIT DROP AS
  SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
  FROM pg_catalog.pg_auth_members;
CREATE TEMP TABLE gpt02_1782_role_attributes_before ON COMMIT DROP AS
  SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
         rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil
  FROM pg_catalog.pg_roles;
CREATE TEMP TABLE gpt02_1782_owner_tables_before ON COMMIT DROP AS
  SELECT c.oid, c.relowner, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n
    ON n.oid = c.relnamespace
  WHERE n.nspname = 'gpt02_owner_approval'
    AND c.relname IN ('gpt02_relock_owner_approval_challenges',
                      'gpt02_relock_owner_approval_decisions');
CREATE TEMP TABLE gpt02_1782_policies_before ON COMMIT DROP AS
  SELECT p.oid, p.polname, p.polrelid, p.polcmd, p.polpermissive, p.polroles,
         p.polqual::text AS polqual, p.polwithcheck::text AS polwithcheck
  FROM pg_catalog.pg_policy AS p
  WHERE p.polrelid IN (SELECT oid FROM pg_temp.gpt02_1782_owner_tables_before);
CREATE TEMP TABLE gpt02_1782_transaction_identity ON COMMIT DROP AS
  SELECT pg_catalog.pg_backend_pid() AS backend_pid,
         pg_catalog.pg_current_xact_id() AS transaction_id;

-- CHECKPOINT_BEFORE_TEMPORARY_GRANT
GRANT gpt02_relock_owner_approval_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;

DO $grant_insert_guard$
DECLARE
  actor_oid oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'postgres');
  owner_oid oid := (SELECT oid FROM pg_catalog.pg_roles
                   WHERE rolname = 'gpt02_relock_owner_approval_owner');
  temporary_oid oid;
BEGIN
  -- GRANT locks this target role until transaction end. Prove that it inserted
  -- our own row, rather than updating a concurrent administrator's prior row.
  -- PG17 AddRoleMems creates the grantor ACL dependency only on the INSERT path.
  SELECT m.oid INTO STRICT temporary_oid FROM pg_catalog.pg_auth_members AS m
  WHERE m.roleid = owner_oid AND m.member = actor_oid AND m.grantor = actor_oid
    AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option
    AND m.xmin = pg_catalog.pg_current_xact_id()::xid;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend AS d
    WHERE d.dbid = 0 AND d.classid = 'pg_catalog.pg_auth_members'::regclass
      AND d.objid = temporary_oid AND d.objsubid = 0
      AND d.refclassid = 'pg_catalog.pg_authid'::regclass
      AND d.refobjid = actor_oid AND d.deptype = 'a'
      AND d.xmin = pg_catalog.pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_TEMPORARY_GRANT_NOT_CREATED_BY_THIS_TRANSACTION';
  END IF;
  IF EXISTS (
    (SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members WHERE oid <> temporary_oid
     EXCEPT SELECT * FROM pg_temp.gpt02_1782_membership_before)
    UNION ALL
    (SELECT * FROM pg_temp.gpt02_1782_membership_before
     EXCEPT SELECT oid, roleid, member, grantor, admin_option, inherit_option, set_option
       FROM pg_catalog.pg_auth_members WHERE oid <> temporary_oid)
  ) THEN
    RAISE EXCEPTION 'GPT02_1782_MEMBERSHIP_BASELINE_CHANGED';
  END IF;
END;
$grant_insert_guard$;
-- CHECKPOINT_AFTER_TEMPORARY_GRANT
SET LOCAL ROLE gpt02_relock_owner_approval_owner;

-- BEGIN_PINNED_PHASE_B_BODY
