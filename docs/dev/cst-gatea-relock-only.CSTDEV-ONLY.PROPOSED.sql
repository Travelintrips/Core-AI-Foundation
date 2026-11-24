-- CST-DEV ONLY, SOURCE CANDIDATE; NEVER RUN ON PROD.
-- Requires independent review and explicit authorization before deployment.
-- No operational LOGIN, secret, signer, dispatcher or JIT-open is created.
-- Privileged SECURITY DEFINER is justified ONLY to expose a fixed relock
-- operation without granting CREATEROLE (which could reopen LOGIN).
-- The function has zero arguments, an exact session_user gate, private schema,
-- a pinned search_path, explicit EXECUTE revoke, and no configurable SQL.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
DO $preflight$
BEGIN
 IF current_database() <> 'postgres'
    OR to_regclass('ai_platform.cst_gatea_stage_leases') IS NULL
    OR to_regclass('ai_platform.cst_onejob_owner_approvals') IS NULL
    OR to_regnamespace('cst_gatea_relock_private') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_roles
        WHERE rolname='cst_gatea_watchdog_relock')
    OR NOT EXISTS(SELECT 1 FROM pg_roles
        WHERE rolname='cst_team_model_pilot_stage_login'
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
        AND NOT rolinherit AND rolconnlimit=1)
    OR EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE usename='cst_team_model_pilot_stage_login')
    OR EXISTS(SELECT 1 FROM ai_platform.cst_onejob_owner_approvals
        WHERE status IN ('APPROVED','CONSUMED'))
    OR EXISTS(SELECT 1 FROM ai_platform.cst_gatea_stage_leases)
    OR NOT EXISTS(SELECT 1 FROM pg_class c
        WHERE c.oid='ai_platform.cst_gatea_stage_leases'::regclass
        AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS(SELECT 1 FROM pg_policies
        WHERE schemaname='ai_platform' AND tablename='cst_gatea_stage_leases')
 THEN RAISE EXCEPTION 'CST_GATEA_RELOCK_ONLY_PRECONDITION_DENIED';
 END IF;
END
$preflight$;
CREATE ROLE cst_gatea_watchdog_relock NOLOGIN NOINHERIT
 NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
 CONNECTION LIMIT 1;
CREATE SCHEMA cst_gatea_relock_private;
REVOKE ALL ON SCHEMA cst_gatea_relock_private FROM PUBLIC;
GRANT USAGE ON SCHEMA cst_gatea_relock_private TO cst_gatea_watchdog_relock;

-- Only the exact lease row is visible; no INSERT, UPDATE or DELETE privilege.
GRANT USAGE ON SCHEMA ai_platform TO cst_gatea_watchdog_relock;
GRANT SELECT (project,nonce,source_sha,issued_at,expires_at,heartbeat_at,state)
 ON ai_platform.cst_gatea_stage_leases TO cst_gatea_watchdog_relock;
CREATE POLICY cst_gatea_watchdog_exact_lease_read
 ON ai_platform.cst_gatea_stage_leases
 FOR SELECT TO cst_gatea_watchdog_relock
 USING (project='xssrfshdrtdfupgqwfdw');

CREATE FUNCTION cst_gatea_relock_private.relock_stage_now()
RETURNS TABLE(role_login boolean, remaining_sessions bigint, scope_ok boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $relock$
DECLARE
  v_pid integer;
  v_login boolean;
  v_super boolean;
  v_bypass boolean;
  v_inherit boolean;
  v_limit integer;
  v_remaining bigint;
  v_attempt integer;
BEGIN
  -- session_user stays the authenticated login even inside SECURITY DEFINER.
  -- The function never accepts role names, SQL strings or arbitrary inputs.
  IF SESSION_USER <> 'cst_gatea_watchdog_relock' THEN
    RAISE EXCEPTION 'CST_GATEA_RELOCK_ONLY_SESSION_DENIED';
  END IF;
  EXECUTE 'ALTER ROLE cst_team_model_pilot_stage_login NOLOGIN CONNECTION LIMIT 1';
  FOR v_attempt IN 1..5 LOOP
    -- pg_stat_activity is cached inside a transaction by PostgreSQL.
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    FOR v_pid IN
      SELECT pid FROM pg_catalog.pg_stat_activity
       WHERE usename='cst_team_model_pilot_stage_login'
         AND pid<>pg_catalog.pg_backend_pid()
    LOOP
      BEGIN
        PERFORM pg_catalog.pg_terminate_backend(v_pid);
      EXCEPTION WHEN OTHERS THEN
        -- Do not roll back NOLOGIN because one termination failed.
        -- Return remaining sessions so caller reports NO-GO and retries.
        NULL;
      END;
    END LOOP;
    PERFORM pg_catalog.pg_stat_clear_snapshot();
    SELECT count(*) INTO v_remaining
      FROM pg_catalog.pg_stat_activity
      WHERE usename='cst_team_model_pilot_stage_login'
        AND pid<>pg_catalog.pg_backend_pid();
    EXIT WHEN v_remaining=0;
    PERFORM pg_catalog.pg_sleep(0.1);
  END LOOP;
  SELECT r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolinherit,r.rolconnlimit
    INTO v_login,v_super,v_bypass,v_inherit,v_limit
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname='cst_team_model_pilot_stage_login';
  IF NOT FOUND THEN
    -- Even after privileged operation, never report PASS on catalog loss.
    RETURN QUERY SELECT TRUE,v_remaining,FALSE;
    RETURN;
  END IF;
  RETURN QUERY SELECT v_login,v_remaining,
    (NOT v_login AND NOT v_super AND NOT v_bypass
     AND NOT v_inherit AND v_limit=1);
END
$relock$;

-- PostgreSQL grants EXECUTE to PUBLIC by default. Revoke within the SAME
-- transaction, before any other session could ever invoke the function.
REVOKE ALL ON FUNCTION cst_gatea_relock_private.relock_stage_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cst_gatea_relock_private.relock_stage_now()
 TO cst_gatea_watchdog_relock;
-- No new LOGIN grants, no CREATEROLE to service role, and no other SQL writes.
COMMIT;