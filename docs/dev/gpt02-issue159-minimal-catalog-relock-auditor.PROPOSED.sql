-- GPT02 DEV Issue159 — MINIMAL boolean relock audit PROPOSAL.
-- DRAFT / NEVER APPLY TO LIVE DEV OR PROD. No service or login activated.
-- Unlike giving a catalog auditor SELECT on pg_authid (which would expose
-- ALL PostgreSQL stored password hashes), a tightly scoped owner-executed
-- function returns ONE boolean about the exact task-scoped reader.
--
-- Security tradeoff: this *is* a SECURITY DEFINER routine, deliberately
-- isolated from the existing issuer reader (which prohibits privileged
-- routines), in a private NEW schema, and restricted to a dedicated
-- NOLOGIN auditor with EXECUTE on this function alone. Independent
-- security review, owner-signed deployment, full permission audit and
-- rollback are mandatory BEFORE any live creation.

BEGIN;
DO $preflight$
BEGIN
 IF current_user <> 'postgres'
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres'
      AND rolcreaterole AND NOT rolsuper)
    OR NOT has_database_privilege(current_database(),'CREATE')
    OR NOT has_table_privilege('pg_catalog.pg_authid','SELECT')
 THEN RAISE EXCEPTION 'RELOCK_AUDITOR_MIGRATOR_PRIVILEGE_INVALID'; END IF;
 IF EXISTS (SELECT 1 FROM pg_namespace
            WHERE nspname='gpt02_relock_audit')
    OR EXISTS (SELECT 1 FROM pg_roles
               WHERE rolname='dev_gpt02_relock_catalog_auditor')
 THEN RAISE EXCEPTION 'RELOCK_AUDITOR_ALREADY_EXISTS'; END IF;
END $preflight$;

CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA gpt02_relock_audit FROM PUBLIC;
CREATE ROLE dev_gpt02_relock_catalog_auditor
 NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 0;
GRANT USAGE ON SCHEMA gpt02_relock_audit
 TO dev_gpt02_relock_catalog_auditor;

-- This function cannot read any GPT02 data rows and cannot write anything.
-- It cannot inspect arbitrary roles: only deterministic per-task identifiers.
-- The result is a cleanup *observation at the instant of the query*,
-- NOT an authorization to issue credentials or dispatch.
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
 -- The GRANT is necessary but not sufficient: a leaked future role
 -- membership or accidental extra EXECUTE must never make the privileged
 -- catalog function callable by a different PostgreSQL login.
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 THEN RAISE EXCEPTION 'RELOCK_AUDITOR_CALLER_INVALID'
   USING ERRCODE = '42501';
 END IF;
 IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[a-f0-9]{12} THEN RAISE EXCEPTION 'RELOCK_TARGET_ROLE_NOT_SCOPED'
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
COMMIT;

-- END OF DRAFT: No ALTER ROLE LOGIN, no secret, no worker dispatch.

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
COMMIT;

-- END OF DRAFT: No ALTER ROLE LOGIN, no secret, no worker dispatch.
