-- GPT02 Issue159 DEV fixed operational-role relock, adapted from the existing
-- two-phase owner-split relock design. DRAFT / DISPOSABLE PG17 TEST ONLY.
-- The existing VPS relock supervisor calls these two exact function names.
-- NOT a role-activation API, signing grant, task approval or dispatch permit.
-- Do not install into CST DEV/PROD without independent privilege review.
BEGIN;

DO $prerequisites$
DECLARE item name;
BEGIN
  IF session_user <> 'postgres' OR current_user <> 'postgres'
     OR NOT EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname='postgres' AND rolcreaterole
        AND NOT rolsuper
    )
  THEN RAISE EXCEPTION 'RELOCK_POSTGRES_CREATOR_REQUIRED'; END IF;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='gpt02_relock_audit')
  THEN RAISE EXCEPTION 'RELOCK_CATALOG_ALREADY_INSTALLED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_authid WHERE rolname='dev_gpt02_relock_catalog_auditor'
      AND NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL
      AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolbypassrls AND NOT rolinherit
  ) THEN RAISE EXCEPTION 'RELOCK_EXISTING_INERT_AUDITOR_REQUIRED'; END IF;

  FOREACH item IN ARRAY ARRAY[
    'dev_gpt02_attestor_evidence'::name,
    'dev_gpt02_issuer_evidence'::name,
    'gpt02_issuer_evidence_reader'::name
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_authid
      WHERE rolname=item AND NOT rolcanlogin AND rolconnlimit=0
        AND rolpassword IS NULL AND NOT rolsuper AND NOT rolcreaterole
        AND NOT rolcreatedb AND NOT rolbypassrls
        AND NOT rolreplication AND NOT rolinherit
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_BASELINE_NOT_DORMANT:%',item; END IF;
    IF NOT EXISTS(
      SELECT 1 FROM pg_auth_members m
      WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=item)
        AND m.member='postgres'::regrole AND m.admin_option
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_ADMIN_OPTION_REQUIRED:%',item; END IF;
    IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=item)
    THEN RAISE EXCEPTION 'RELOCK_TARGET_SESSION_ALREADY_PRESENT:%',item; END IF;
  END LOOP;
END $prerequisites$;

CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;

CREATE TABLE gpt02_relock_audit.writer_issuance_watchdog (
  role_name name NOT NULL
    CHECK (role_name::text IN (
      'dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader'
    )),
  task_id bigint NOT NULL CHECK (task_id > 139),
  scope_sha256 text NOT NULL UNIQUE
    CHECK (scope_sha256 ~ '^[0-9a-f]{64}

-- Phase A is an independently COMMITTED catalog relock. Never combine
-- it with phase B in one BEGIN/COMMIT; the service runs separate queries.
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $phase_a$
DECLARE item record; role_row record; n integer:=0;
BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor'
     OR current_user <> 'postgres'
  THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;

  FOR item IN
    SELECT role_name,task_id FROM gpt02_relock_audit.writer_issuance_watchdog
    WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
    ORDER BY role_name FOR UPDATE
  LOOP
    IF item.role_name::text NOT IN (
      'dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader'
    ) OR item.task_id <= 139
    THEN RAISE EXCEPTION 'RELOCK_TARGET_SCOPE_INVALID'; END IF;

    SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,
           r.rolbypassrls,r.rolreplication,r.rolinherit
      INTO role_row FROM pg_roles r WHERE r.rolname=item.role_name;
    IF NOT FOUND OR role_row.rolsuper OR role_row.rolcreaterole
       OR role_row.rolcreatedb OR role_row.rolbypassrls
       OR role_row.rolreplication OR role_row.rolinherit
    THEN RAISE EXCEPTION 'RELOCK_TARGET_PRIVILEGE_DRIFT'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_auth_members m
      WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=item.role_name)
        AND m.member='postgres'::regrole AND m.admin_option
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_ADMIN_OPTION_MISSING'; END IF;

    EXECUTE format(
      'ALTER ROLE %I NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL',
      item.role_name
    );
    n:=n+1;
  END LOOP;
  RETURN n;
END $phase_a$;

-- Phase B only terminates sessions and acknowledges a LOCKED role.
-- Does not remove existing narrow business-function grants, sign or dispatch.
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $phase_b$
DECLARE item record; pid_row record; locked boolean; n integer:=0;
BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor'
     OR current_user <> 'postgres'
  THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;

  FOR item IN
    SELECT role_name FROM gpt02_relock_audit.writer_issuance_watchdog
    WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
    ORDER BY role_name FOR UPDATE
  LOOP
    IF item.role_name::text NOT IN (
      'dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader'
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_SCOPE_INVALID'; END IF;

    SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 AND
           a.rolpassword IS NULL
      INTO locked FROM pg_roles r
      JOIN pg_authid a ON a.oid=r.oid
      WHERE r.rolname=item.role_name;
    IF locked IS NOT TRUE
    THEN RAISE EXCEPTION 'RELOCK_PHASE_A_NOT_COMMITTED'; END IF;

    FOR pid_row IN
      SELECT pid FROM pg_stat_activity
      WHERE usename=item.role_name AND pid<>pg_backend_pid()
    LOOP
      IF pg_terminate_backend(pid_row.pid,3000) IS NOT TRUE
      THEN RAISE EXCEPTION 'RELOCK_SESSION_TERMINATION_UNCONFIRMED'; END IF;
    END LOOP;
    -- Refresh the stats snapshot after pg_terminate_backend's bounded wait;
    -- otherwise this transaction may still see a terminated backend in a
    -- cached pg_stat_activity snapshot and falsely fail the postcondition.
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename=item.role_name)
    THEN RAISE EXCEPTION 'RELOCK_TARGET_SESSION_SURVIVED'; END IF;

    UPDATE gpt02_relock_audit.writer_issuance_watchdog
       SET cleaned_at=clock_timestamp()
       WHERE role_name=item.role_name AND cleaned_at IS NULL;
    n:=n+1;
  END LOOP;
  RETURN n;
END $phase_b$;

REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_b() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
-- Auditor gets no SELECT/INSERT/UPDATE on the watchdog table, no
-- business-table DML and no direct ALTER ROLE privilege.
COMMIT;
),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  cleaned_at timestamptz,
  PRIMARY KEY (role_name,task_id),
  CHECK (expires_at > created_at AND
         expires_at <= created_at + interval '120 seconds'),
  CHECK (cleaned_at IS NULL OR cleaned_at >= created_at)
);
-- Preserve historical rows but permit only one not-yet-cleaned window per role.
CREATE UNIQUE INDEX writer_issuance_watchdog_one_open_role
 ON gpt02_relock_audit.writer_issuance_watchdog(role_name)
 WHERE cleaned_at IS NULL;
REVOKE ALL ON gpt02_relock_audit.writer_issuance_watchdog FROM PUBLIC;

-- Phase A is an independently COMMITTED catalog relock. Never combine
-- it with phase B in one BEGIN/COMMIT; the service runs separate queries.
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_a()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $phase_a$
DECLARE item record; role_row record; n integer:=0;
BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor'
     OR current_user <> 'postgres'
  THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;

  FOR item IN
    SELECT role_name,task_id FROM gpt02_relock_audit.writer_issuance_watchdog
    WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
    ORDER BY role_name FOR UPDATE
  LOOP
    IF item.role_name::text NOT IN (
      'dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader'
    ) OR item.task_id <= 139
    THEN RAISE EXCEPTION 'RELOCK_TARGET_SCOPE_INVALID'; END IF;

    SELECT r.rolsuper,r.rolcreaterole,r.rolcreatedb,
           r.rolbypassrls,r.rolreplication,r.rolinherit
      INTO role_row FROM pg_roles r WHERE r.rolname=item.role_name;
    IF NOT FOUND OR role_row.rolsuper OR role_row.rolcreaterole
       OR role_row.rolcreatedb OR role_row.rolbypassrls
       OR role_row.rolreplication OR role_row.rolinherit
    THEN RAISE EXCEPTION 'RELOCK_TARGET_PRIVILEGE_DRIFT'; END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_auth_members m
      WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname=item.role_name)
        AND m.member='postgres'::regrole AND m.admin_option
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_ADMIN_OPTION_MISSING'; END IF;

    EXECUTE format(
      'ALTER ROLE %I NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL',
      item.role_name
    );
    n:=n+1;
  END LOOP;
  RETURN n;
END $phase_a$;

-- Phase B only terminates sessions and acknowledges a LOCKED role.
-- Does not remove existing narrow business-function grants, sign or dispatch.
CREATE FUNCTION gpt02_relock_audit.relock_expired_phase_b()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $phase_b$
DECLARE item record; pid_row record; locked boolean; n integer:=0;
BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor'
     OR current_user <> 'postgres'
  THEN RAISE EXCEPTION 'RELOCK_INDEPENDENT_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;

  FOR item IN
    SELECT role_name FROM gpt02_relock_audit.writer_issuance_watchdog
    WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
    ORDER BY role_name FOR UPDATE
  LOOP
    IF item.role_name::text NOT IN (
      'dev_gpt02_attestor_evidence',
      'dev_gpt02_issuer_evidence',
      'gpt02_issuer_evidence_reader'
    ) THEN RAISE EXCEPTION 'RELOCK_TARGET_SCOPE_INVALID'; END IF;

    SELECT NOT r.rolcanlogin AND r.rolconnlimit=0 AND
           a.rolpassword IS NULL
      INTO locked FROM pg_roles r
      JOIN pg_authid a ON a.oid=r.oid
      WHERE r.rolname=item.role_name;
    IF locked IS NOT TRUE
    THEN RAISE EXCEPTION 'RELOCK_PHASE_A_NOT_COMMITTED'; END IF;

    FOR pid_row IN
      SELECT pid FROM pg_stat_activity
      WHERE usename=item.role_name AND pid<>pg_backend_pid()
    LOOP
      IF pg_terminate_backend(pid_row.pid,3000) IS NOT TRUE
      THEN RAISE EXCEPTION 'RELOCK_SESSION_TERMINATION_UNCONFIRMED'; END IF;
    END LOOP;
    -- Refresh the stats snapshot after pg_terminate_backend's bounded wait;
    -- otherwise this transaction may still see a terminated backend in a
    -- cached pg_stat_activity snapshot and falsely fail the postcondition.
    PERFORM pg_stat_clear_snapshot();
    IF EXISTS (SELECT 1 FROM pg_stat_activity WHERE usename=item.role_name)
    THEN RAISE EXCEPTION 'RELOCK_TARGET_SESSION_SURVIVED'; END IF;

    UPDATE gpt02_relock_audit.writer_issuance_watchdog
       SET cleaned_at=clock_timestamp()
       WHERE role_name=item.role_name AND cleaned_at IS NULL;
    n:=n+1;
  END LOOP;
  RETURN n;
END $phase_b$;

REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_expired_phase_b() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_expired_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
-- Auditor gets no SELECT/INSERT/UPDATE on the watchdog table, no
-- business-table DML and no direct ALTER ROLE privilege.
COMMIT;
