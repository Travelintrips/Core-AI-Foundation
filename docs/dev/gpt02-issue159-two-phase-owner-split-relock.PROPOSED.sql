-- GPT02 DEV ISSUE159: existing NOLOGIN auditor + two-phase relock (DRAFT).
-- Does NOT create auditor role, enable LOGIN, set PASSWORD, dispatch/sign.
-- Requires separate owner-signed helper to be ALREADY installed.
-- Owner/ADMIN privileges are checked before any privileged role mutation.
BEGIN;
DO $prerequisites$
BEGIN
 IF current_user <> 'postgres' OR NOT (SELECT rolcreaterole AND NOT rolsuper
   FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'RELOCK_POSTGRES_OWNER_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid
    WHERE r.rolname='dev_gpt02_relock_catalog_auditor'
      AND NOT r.rolcanlogin AND r.rolconnlimit=0
      AND a.rolpassword IS NULL
      AND NOT r.rolcreaterole AND NOT r.rolsuper
      AND NOT r.rolbypassrls AND NOT r.rolinherit)
 THEN RAISE EXCEPTION 'EXISTING_INERT_AUDITOR_ROLE_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure(
       'gpt02_private.revoke_expired_scoped_reader_grants(name)')
      AND p.proowner='gpt02_store_owner'::regrole AND p.prosecdef)
 THEN RAISE EXCEPTION 'OWNER_BOUND_REVOKE_HELPER_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='gpt02_relock_audit')
 THEN RAISE EXCEPTION 'RELOCK_AUDIT_SCHEMA_ALREADY_EXISTS'; END IF;
END $prerequisites$;
CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;
CREATE TABLE gpt02_relock_audit.reader_issuance_watchdog(
 role_name name PRIMARY KEY,
 task_id bigint NOT NULL CHECK (task_id > 0),
 scope_sha256 text UNIQUE NOT NULL
    CHECK (scope_sha256 ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL,
 cleaned_at timestamptz,
 CHECK (role_name::text ~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$')
);
REVOKE ALL ON gpt02_relock_audit.reader_issuance_watchdog FROM PUBLIC;

CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $relock_a$
DECLARE item record; role_row record; count_relocked integer:=0;
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR item IN
  SELECT role_name,task_id FROM gpt02_relock_audit.reader_issuance_watchdog
  WHERE expires_at<=clock_timestamp() AND cleaned_at IS NULL
  ORDER BY role_name FOR UPDATE
 LOOP
  IF item.role_name::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'
   OR split_part(item.role_name::text,'_',4)::bigint <> item.task_id
  THEN RAISE EXCEPTION 'RELOCK_SCOPED_ROLE_MISMATCH'; END IF;
  SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolbypassrls,
     r.rolreplication INTO role_row FROM pg_roles r WHERE r.rolname=item.role_name;
  IF NOT FOUND OR role_row.rolsuper OR role_row.rolcreaterole
   OR role_row.rolcreatedb OR role_row.rolbypassrls OR role_row.rolreplication
  THEN RAISE EXCEPTION 'RELOCK_TARGET_PRIVILEGED_OR_MISSING'; END IF;
  -- PostgreSQL 17 CREATEROLE alone is insufficient: explicit ADMIN OPTION.
  IF NOT EXISTS(SELECT 1 FROM pg_auth_members m
   WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=item.role_name)
     AND m.member='postgres'::regrole AND m.admin_option)
  THEN RAISE EXCEPTION 'RELOCK_TARGET_ADMIN_OPTION_MISSING'; END IF;
  EXECUTE format('ALTER ROLE %I NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL',item.role_name);
  count_relocked:=count_relocked+1;
 END LOOP;
 RETURN count_relocked;
END $relock_a$;

CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $relock_b$
DECLARE item record; role_row record; pid_row record; count_cleaned integer:=0;
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR item IN
  SELECT role_name,task_id FROM gpt02_relock_audit.reader_issuance_watchdog
  WHERE expires_at<=clock_timestamp() AND cleaned_at IS NULL
  ORDER BY role_name FOR UPDATE
 LOOP
  IF item.role_name::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'
   OR split_part(item.role_name::text,'_',4)::bigint <> item.task_id
  THEN RAISE EXCEPTION 'RELOCK_SCOPED_ROLE_MISMATCH'; END IF;
  SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 AND a.rolpassword IS NULL
     AS locked INTO role_row FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid
   WHERE r.rolname=item.role_name;
  IF NOT FOUND OR role_row.locked IS NOT TRUE
  THEN RAISE EXCEPTION 'RELOCK_PHASE_A_NOT_COMMITTED'; END IF;
  FOR pid_row IN SELECT pid FROM pg_stat_activity
    WHERE usename=item.role_name AND pid<>pg_backend_pid()
  LOOP
   IF pg_terminate_backend(pid_row.pid,3000) IS NOT TRUE
   THEN RAISE EXCEPTION 'RELOCK_SESSION_TERMINATION_UNCONFIRMED'; END IF;
  END LOOP;
  -- A direct REVOKE can appear complete while the scoped reader still
  -- has SET-ROLE membership in another role (or another actor can SET the
  -- scoped role). Table SELECT / schema USAGE are not proof that these
  -- membership paths are gone. Preserve the durable Phase-A NOLOGIN
  -- and leave the cleanup ledger pending until separately remediated.
  -- The sole expected member of the scoped role is its postgres creator.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.member = item.role_name::regrole
       OR (m.roleid = item.role_name::regrole
           AND m.member <> 'postgres'::regrole)
  ) THEN
    RAISE EXCEPTION 'RELOCK_SCOPED_ROLE_MEMBERSHIP_PRESENT'
      USING ERRCODE='42501';
  END IF;
  -- This nested definer runs as EXISTING gpt02_store_owner. postgres
  -- lacks grant option on all five private tables in actual CST-DEV.
  PERFORM gpt02_private.revoke_expired_scoped_reader_grants(item.role_name);
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=item.role_name)
   OR has_schema_privilege(item.role_name,'gpt02_private','USAGE')
   OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='gpt02_private'
       AND c.relname IN ('approvals','operator_links','receipts',
          'core_identity_receipts','post_consumption_fences')
       AND has_table_privilege(item.role_name,c.oid,'SELECT'))
  THEN RAISE EXCEPTION 'RELOCK_SCOPE_NOT_FULLY_REVOKED'; END IF;
  UPDATE gpt02_relock_audit.reader_issuance_watchdog
   SET cleaned_at=clock_timestamp() WHERE role_name=item.role_name;
  count_cleaned:=count_cleaned+1;
 END LOOP;
 RETURN count_cleaned;
END $relock_b$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_b() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
-- NO INSERT, SELECT or UPDATE grants on the issuer ledger.
COMMIT;
