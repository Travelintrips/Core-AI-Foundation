-- GPT02 Issue159 -- EXISTING CST-DEV auditor extension, REVIEW ONLY.
-- Source-only variant of the previously tested minimal auditor proposal.
-- Preserves the EXACT original SECURITY DEFINER function body and postflight;
-- never recreates the existing schema or NOLOGIN auditor role.
--
-- Not a live authorized migration. Independent DBA/security actor must
-- review the existing role, grants, ownership, managed credentials,
-- zero sessions, and rollback plan before applying any write to CST-DEV.
-- This file is meant for disposable PG16/17 owner-context compatibility QA.
-- It does not enable LOGIN or credential issuance, alter the historical
-- writer watchdog, grant DELL dispatch or add signer authority.
--
-- Historical proposal "minimal-catalog-relock-auditor.PROPOSED.sql" does
-- CREATE SCHEMA and CREATE ROLE, and conflicts with CST-DEV pre-existing
-- gpt02_relock_audit / dev_gpt02_relock_catalog_auditor. Do not replay it.
BEGIN;

DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (
       SELECT 1 FROM pg_roles WHERE rolname='postgres'
         AND NOT rolsuper AND rolcreaterole
    )
    OR NOT has_table_privilege('pg_catalog.pg_authid','SELECT')
    OR NOT EXISTS (
       SELECT 1 FROM pg_namespace
       WHERE nspname='gpt02_relock_audit'
         AND nspowner='postgres'::regrole
    )
    OR NOT EXISTS (
       SELECT 1 FROM pg_roles
       WHERE rolname='dev_gpt02_relock_catalog_auditor'
         AND NOT rolcanlogin AND NOT rolinherit
         AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
         AND NOT rolreplication AND NOT rolbypassrls
         AND rolconnlimit=0
    )
    OR EXISTS (
       SELECT 1 FROM pg_stat_activity
       WHERE usename='dev_gpt02_relock_catalog_auditor'
    )
    OR to_regprocedure(
       'gpt02_relock_audit.scoped_reader_fully_locked(name)'
    ) IS NOT NULL
    OR (
       SELECT count(*) FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='gpt02_relock_audit'
         AND p.proname IN (
           'relock_expired_phase_a',
           'relock_expired_phase_b'
         )
         AND p.proowner='postgres'::regrole
         AND p.prosecdef
    ) <> 2
    OR (
       SELECT count(*) FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='gpt02_private'
         AND c.relname IN (
           'approvals','operator_links','receipts',
           'core_identity_receipts','post_consumption_fences'
         )
         AND c.relkind='r'
         AND c.relowner='gpt02_store_owner'::regrole
         AND c.relrowsecurity AND c.relforcerowsecurity
    ) <> 5
 THEN RAISE EXCEPTION 'ISSUE159_EXISTING_AUDITOR_ADDITION_PREFLIGHT_DENIED'
      USING ERRCODE='42501';
 END IF;
END $preflight$;

-- Existing CREATE FUNCTION body / roles/custody check unchanged from the
-- original already tested proposal; only this preflight differs.
CREATE FUNCTION gpt02_relock_audit.scoped_reader_fully_locked(p_role name)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
 v_locked boolean;
BEGIN
 -- The GRANT is necessary but not sufficient: any future extra EXECUTE
 -- or membership must not let another native LOGIN call this SECDEF RPC.
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 THEN RAISE EXCEPTION 'RELOCK_AUDITOR_CALLER_INVALID'
   USING ERRCODE = '42501';
 END IF;
 IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12}$'
 THEN RAISE EXCEPTION 'RELOCK_TARGET_ROLE_NOT_SCOPED'
   USING ERRCODE = '22023';
 END IF;
 SELECT
   (NOT r.rolcanlogin)
   AND r.rolconnlimit = 0
   AND r.rolpassword IS NULL
   AND NOT r.rolinherit
   AND NOT r.rolsuper
   AND NOT r.rolcreaterole
   AND NOT r.rolcreatedb
   AND NOT r.rolreplication
   AND NOT r.rolbypassrls
   AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid
   )
   AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_stat_activity a
      WHERE a.usename = r.rolname
   )
   AND NOT pg_catalog.has_schema_privilege(
      r.rolname, 'gpt02_private', 'USAGE'
   )
   -- A role with revoked direct table SELECT might STILL read the private
   -- ledger through a callable, user-defined SECURITY DEFINER function in
   -- a different schema (including a PUBLIC-executable function). Requiring
   -- no such effective EXECUTE is conservative and fail-closed. The issuer
   -- and current lineage roles remain unchanged; do not relax this merely
   -- to make a probe return TRUE.
   AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       JOIN pg_catalog.pg_namespace fn ON fn.oid = p.pronamespace
       WHERE p.prosecdef
         AND fn.nspname NOT IN (
           'pg_catalog','information_schema','pg_toast'
         )
         AND pg_catalog.has_schema_privilege(
           r.rolname, fn.oid, 'USAGE'
         )
         AND pg_catalog.has_function_privilege(
           r.rolname, p.oid, 'EXECUTE'
         )
   )
   -- A default/owner-privileged VIEW may expose GPT02 rows despite
   -- zero direct base-table grants (and despite FORCE RLS). Materialized
   -- views may copy those rows too. A security_invoker=true view checks
   -- the reader's own base-table privileges and is not this bypass.
   AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class v
       JOIN pg_catalog.pg_namespace vn ON vn.oid = v.relnamespace
       WHERE v.relkind IN ('v','m')
         AND vn.nspname NOT IN (
           'pg_catalog','information_schema','pg_toast'
         )
         AND (
           v.relkind = 'm'
           OR NOT COALESCE(
               'security_invoker=true' = ANY(v.reloptions), FALSE
           )
         )
         AND pg_catalog.has_schema_privilege(
           r.rolname, vn.oid, 'USAGE'
         )
         AND (
           pg_catalog.has_table_privilege(
             r.rolname, v.oid, 'SELECT'
           )
           OR pg_catalog.has_any_column_privilege(
             r.rolname, v.oid, 'SELECT'
           )
         )
   )
   AND (
       SELECT COUNT(*) FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'gpt02_private'
         AND c.relname IN (
           'approvals','operator_links','receipts',
           'core_identity_receipts','post_consumption_fences'
         )
         AND c.relkind = 'r'
         AND c.relrowsecurity AND c.relforcerowsecurity
   ) = 5
   AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'gpt02_private'
         AND c.relname IN (
           'approvals','operator_links','receipts',
           'core_identity_receipts','post_consumption_fences'
         )
         AND (
           pg_catalog.has_table_privilege(r.rolname,c.oid,'SELECT')
           OR pg_catalog.has_any_column_privilege(r.rolname,c.oid,'SELECT')
         )
   )
 INTO v_locked
 FROM pg_catalog.pg_authid r
 WHERE r.rolname = p_role;

 RETURN COALESCE(v_locked, FALSE);
END
$function$;

-- No public function execution, and NEVER grant this to the existing issuer
-- or active shared lineage identities; it is a separate bounded audit role.
REVOKE ALL ON FUNCTION
 gpt02_relock_audit.scoped_reader_fully_locked(name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 gpt02_relock_audit.scoped_reader_fully_locked(name)
 TO dev_gpt02_relock_catalog_auditor;

DO $postflight$
BEGIN
 IF has_table_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'pg_catalog.pg_authid','SELECT'
    ) OR
    has_schema_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_private','USAGE'
    ) OR
    has_schema_privilege(
      'dev_gpt02_relock_catalog_auditor',
      'gpt02_relock_audit','CREATE'
    ) OR
    (SELECT rolcanlogin OR rolinherit OR rolcreaterole OR rolbypassrls
     FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor')
 THEN RAISE EXCEPTION 'RELOCK_AUDITOR_PRIVILEGE_ESCALATION'; END IF;
END $postflight$;

-- Verify role/credential flags were not opened or elevated by installation.
DO $existing_postflight$
BEGIN
 IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname='dev_gpt02_relock_catalog_auditor'
      AND NOT rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
      AND NOT rolreplication AND NOT rolbypassrls AND rolconnlimit=0
 )
 OR EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE usename='dev_gpt02_relock_catalog_auditor'
 )
 OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='gpt02_relock_audit'
      AND p.proname='scoped_reader_fully_locked'
      AND pg_get_function_identity_arguments(p.oid)='p_role name'
      AND p.proowner='postgres'::regrole AND p.prosecdef
 )
 THEN RAISE EXCEPTION 'ISSUE159_EXISTING_AUDITOR_POSTFLIGHT_DENIED'
      USING ERRCODE='42501';
 END IF;
END $existing_postflight$;

COMMIT;

-- NO-GO: This SOURCE-ONLY DRAFT does not operate the supervisor. Independent
-- owner/custody release and live one-task/one-read/relock evidence missing.
