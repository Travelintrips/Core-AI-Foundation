-- GPT02 Issue159 CST-DEV scoped-reader cleanup: ADD-ONLY, REVIEW ONLY.
-- NEVER APPLY TO LIVE CST-DEV / PROD WITHOUT EXACT AUTHORIZED DBA REVIEW.
-- Extends the already existing Phase-A/Phase-B watchdog with ONE scoped-reader
-- workload. It does NOT ALTER or REPLACE historical writer Phase A/B; it
-- creates no LOGIN, credential, issuer, signer, approval, dispatch, or timer.
-- The existing timer can call both workflows after separate review.
BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres'
   AND rolcreaterole AND NOT rolsuper)
 OR NOT pg_has_role('postgres','pg_signal_backend','USAGE')
 OR NOT EXISTS(SELECT 1 FROM pg_namespace
   WHERE nspname='gpt02_relock_audit'
    AND nspowner='postgres'::regrole)
 OR NOT EXISTS(SELECT 1 FROM pg_roles
   WHERE rolname='dev_gpt02_relock_catalog_auditor'
   AND NOT rolcanlogin AND rolconnlimit=0 AND NOT rolinherit
   AND NOT rolsuper AND NOT rolcreaterole AND NOT rolbypassrls)
 OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n
    ON n.oid=p.pronamespace WHERE n.nspname='gpt02_relock_audit'
    AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
    AND p.proowner='postgres'::regrole AND p.prosecdef) <> 2
 OR to_regclass('gpt02_relock_audit.writer_issuance_watchdog') IS NULL
 OR to_regclass('gpt02_relock_audit.reader_issuance_watchdog') IS NOT NULL
 OR to_regprocedure('gpt02_relock_audit.relock_reader_phase_a()') IS NOT NULL
 OR to_regprocedure('gpt02_relock_audit.relock_reader_phase_b()') IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(
     'gpt02_private.revoke_expired_scoped_reader_grants(name)')
   AND p.proowner='gpt02_store_owner'::regrole AND p.prosecdef)
 OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n
    ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private'
    AND c.relname IN ('approvals','operator_links','receipts',
      'core_identity_receipts','post_consumption_fences',
      'issuer_evidences','issuer_lease_consumptions')
    AND c.relkind='r' AND c.relowner='gpt02_store_owner'::regrole
    AND c.relrowsecurity AND c.relforcerowsecurity) <> 7
 THEN RAISE EXCEPTION 'SCOPED_RELOCK_ADD_ONLY_PREFLIGHT_DENIED'
   USING ERRCODE='42501'; END IF;
END $preflight$;

-- Independent, append-only issuance identity: trusted, signed issuer writer
-- (NOT this low-privilege auditor) must insert before enabling reader LOGIN.
-- A database-time TTL strictly limits any reader window to <= 15 seconds.
CREATE TABLE gpt02_relock_audit.reader_issuance_watchdog(
 role_name name PRIMARY KEY
    CHECK (role_name::text ~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'),
 task_id bigint NOT NULL CHECK (task_id > 139),
 scope_sha256 text NOT NULL UNIQUE CHECK (scope_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,
 cleaned_at timestamptz,
 CHECK (expires_at > issued_at),
 CHECK (expires_at <= issued_at + interval '15 seconds'),
 CHECK (cleaned_at IS NULL OR cleaned_at >= issued_at)
);
ALTER TABLE gpt02_relock_audit.reader_issuance_watchdog
 ENABLE ROW LEVEL SECURITY;
ALTER TABLE gpt02_relock_audit.reader_issuance_watchdog
 FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON gpt02_relock_audit.reader_issuance_watchdog
 FOR ALL TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE gpt02_relock_audit.reader_issuance_watchdog FROM PUBLIC;

-- PHASE A: atomically revoke the ability to form a *new* session. Commit
-- this operation BEFORE phase B and BEFORE final readback.
CREATE FUNCTION gpt02_relock_audit.relock_reader_phase_a()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $phase_a$
DECLARE item record; role_rec record; n integer:=0;
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 OR current_user <> 'postgres' THEN
  RAISE EXCEPTION 'SCOPED_RELOCK_INDEPENDENT_AUDITOR_REQUIRED'
  USING ERRCODE='42501'; END IF;
 FOR item IN
 SELECT role_name,task_id FROM gpt02_relock_audit.reader_issuance_watchdog
 WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
 ORDER BY role_name FOR UPDATE
 LOOP
   IF item.role_name::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'
      OR pg_catalog.split_part(item.role_name::text,'_',4)::bigint <> item.task_id
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_ROLE_TASK_MISMATCH'; END IF;
   SELECT rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,
          rolinherit INTO role_rec
   FROM pg_roles WHERE rolname=item.role_name;
   IF NOT FOUND OR role_rec.rolsuper OR role_rec.rolcreaterole
      OR role_rec.rolcreatedb OR role_rec.rolreplication
      OR role_rec.rolbypassrls OR role_rec.rolinherit
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_ROLE_PRIVILEGE_DRIFT'; END IF;
   IF (SELECT count(*) FROM pg_auth_members m
       WHERE m.roleid=item.role_name::regrole) <> 1
      OR NOT EXISTS(SELECT 1 FROM pg_auth_members m
       WHERE m.roleid=item.role_name::regrole
         AND m.member='postgres'::regrole AND m.admin_option
         AND NOT m.set_option AND NOT m.inherit_option)
      OR EXISTS(SELECT 1 FROM pg_auth_members m
       WHERE m.member=item.role_name::regrole)
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_ROLE_MEMBERSHIP_DRIFT'
     USING ERRCODE='42501'; END IF;
   EXECUTE pg_catalog.format(
     'ALTER ROLE %I NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL',item.role_name);
   n:=n+1;
 END LOOP;
 RETURN n;
END $phase_a$;

-- PHASE B: only after Phase A committed. Disconnect the old session,
-- delegate all seven private TABLE+column ACL revocations to EXISTING owner-
-- held helper, then independently re-query SQL catalogs before cleanup mark.
CREATE FUNCTION gpt02_relock_audit.relock_reader_phase_b()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $phase_b$
DECLARE item record; pid_row record; locked boolean; n integer:=0;
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 OR current_user <> 'postgres' THEN
  RAISE EXCEPTION 'SCOPED_RELOCK_INDEPENDENT_AUDITOR_REQUIRED'
  USING ERRCODE='42501'; END IF;
 FOR item IN
 SELECT role_name,task_id FROM gpt02_relock_audit.reader_issuance_watchdog
 WHERE expires_at <= clock_timestamp() AND cleaned_at IS NULL
 ORDER BY role_name FOR UPDATE
 LOOP
   IF item.role_name::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'
      OR pg_catalog.split_part(item.role_name::text,'_',4)::bigint <> item.task_id
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_ROLE_TASK_MISMATCH'; END IF;
   SELECT NOT r.rolcanlogin AND r.rolconnlimit=0
     AND a.rolpassword IS NULL
   INTO locked FROM pg_roles r JOIN pg_authid a ON a.oid=r.oid
   WHERE r.rolname=item.role_name;
   IF locked IS NOT TRUE THEN RAISE EXCEPTION
     'SCOPED_RELOCK_PHASE_A_NOT_COMMITTED'; END IF;
   IF (SELECT count(*) FROM pg_auth_members m
       WHERE m.roleid=item.role_name::regrole) <> 1
      OR NOT EXISTS(SELECT 1 FROM pg_auth_members m
       WHERE m.roleid=item.role_name::regrole
        AND m.member='postgres'::regrole AND m.admin_option
        AND NOT m.inherit_option AND NOT m.set_option)
      OR EXISTS(SELECT 1 FROM pg_auth_members m
       WHERE m.member=item.role_name::regrole)
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_ROLE_MEMBERSHIP_DRIFT'
     USING ERRCODE='42501'; END IF;
   FOR pid_row IN SELECT pid FROM pg_stat_activity
     WHERE usename=item.role_name AND pid<>pg_backend_pid()
   LOOP
     IF pg_terminate_backend(pid_row.pid,3000) IS NOT TRUE
     THEN RAISE EXCEPTION 'SCOPED_RELOCK_SESSION_TERMINATION_UNCONFIRMED';
     END IF;
   END LOOP;
   PERFORM pg_stat_clear_snapshot();
   IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=item.role_name)
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_SESSION_SURVIVED'; END IF;
   -- Existing owner-held helper rejects other native callers and must
   -- revoke all seven base-table and column SELECT privileges.
   PERFORM gpt02_private.revoke_expired_scoped_reader_grants(item.role_name);
   IF pg_catalog.has_schema_privilege(item.role_name,'gpt02_private','USAGE')
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n
       ON n.oid=c.relnamespace WHERE n.nspname='gpt02_private'
       AND c.relname IN ('approvals','operator_links','receipts',
         'core_identity_receipts','post_consumption_fences',
         'issuer_evidences','issuer_lease_consumptions')
       AND (has_table_privilege(item.role_name,c.oid,'SELECT')
         OR has_any_column_privilege(item.role_name,c.oid,'SELECT')))
    OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=item.role_name)
   THEN RAISE EXCEPTION 'SCOPED_RELOCK_GRANTS_OR_SESSION_REMAIN'; END IF;
   UPDATE gpt02_relock_audit.reader_issuance_watchdog
     SET cleaned_at=clock_timestamp()
   WHERE role_name=item.role_name AND cleaned_at IS NULL;
   n:=n+1;
 END LOOP;
 RETURN n;
END $phase_b$;

REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_reader_phase_a() FROM PUBLIC;
REVOKE ALL ON FUNCTION gpt02_relock_audit.relock_reader_phase_b() FROM PUBLIC;
GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_reader_phase_a()
 TO dev_gpt02_relock_catalog_auditor;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.relock_reader_phase_b()
 TO dev_gpt02_relock_catalog_auditor;
DO $postflight$
BEGIN
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gpt02_relock_audit'
      AND p.proname IN ('relock_expired_phase_a','relock_expired_phase_b')
      AND p.proowner='postgres'::regrole AND p.prosecdef) <> 2
 OR EXISTS(SELECT 1 FROM pg_roles
   WHERE rolname='dev_gpt02_relock_catalog_auditor' AND rolcanlogin)
 OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gpt02_relock_audit'
      AND p.proname IN ('relock_reader_phase_a','relock_reader_phase_b')
      AND p.proowner='postgres'::regrole AND p.prosecdef) <> 2
 THEN RAISE EXCEPTION 'SCOPED_RELOCK_ADD_ONLY_POSTFLIGHT_DENIED'
  USING ERRCODE='42501'; END IF;
END $postflight$;
COMMIT;
-- NO LIVE APPLY. Future DB owner approval, one-use credential issuance,
-- private ledger attestation and native DELL Final ACK remain independent.
