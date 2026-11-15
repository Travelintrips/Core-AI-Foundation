-- GPT02 Issue159 live CST-DEV exact-task credential release gate (READ ONLY).
-- This gate deliberately fails closed while the active shared reader LOGIN
-- inherits SELECT on the five private ledger tables.
-- Do not interpret FORCE RLS, the socket's peer gate, or a parameterized
-- SELECT as protection from direct queries using stolen DB credentials.
-- No secrets, no table data, no DDL, no attempts to SET ROLE.
WITH expected_tables(table_name) AS (
 VALUES ('approvals'),('operator_links'),('receipts'),
        ('core_identity_receipts'),('post_consumption_fences')
), target AS (
 SELECT 'dev_gpt02_lineage_login'::text AS role_name,
        r.oid AS role_oid, r.rolcanlogin, r.rolinherit, r.rolbypassrls
 FROM pg_roles r WHERE r.rolname='dev_gpt02_lineage_login'
), inventory AS (
 SELECT e.table_name,t.role_name,t.rolcanlogin,t.rolinherit,t.rolbypassrls,
        c.oid AS table_oid,c.relrowsecurity,c.relforcerowsecurity,
        CASE WHEN c.oid IS NOT NULL
             THEN has_any_column_privilege(t.role_name,c.oid,'SELECT')
             ELSE false END AS effective_column_select,
        CASE WHEN c.oid IS NOT NULL
             THEN has_table_privilege(t.role_name,c.oid,'SELECT')
             ELSE false END AS table_select
 FROM expected_tables e
 CROSS JOIN target t
 LEFT JOIN pg_namespace n ON n.nspname='gpt02_private'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid
                     AND c.relname=e.table_name AND c.relkind='r'
), policies AS (
 SELECT i.table_name,
        count(*) FILTER (WHERE p.cmd IN ('SELECT','ALL')
                   AND ('dev_gpt02_lineage_reader'=ANY(p.roles)
                     OR 'dev_gpt02_lineage_login'=ANY(p.roles)
                     OR 'public'=ANY(p.roles))) AS applicable_select_policies,
        bool_or(coalesce(p.qual,'')='true') FILTER (WHERE p.cmd IN ('SELECT','ALL')
                   AND ('dev_gpt02_lineage_reader'=ANY(p.roles)
                     OR 'dev_gpt02_lineage_login'=ANY(p.roles)
                     OR 'public'=ANY(p.roles))) AS has_unconditional_policy,
        bool_or(p.qual LIKE '%task_id >%' OR p.qual LIKE '%hub_task_id >%')
          FILTER (WHERE p.cmd IN ('SELECT','ALL')
                   AND ('dev_gpt02_lineage_reader'=ANY(p.roles)
                     OR 'dev_gpt02_lineage_login'=ANY(p.roles)
                     OR 'public'=ANY(p.roles))) AS has_task_threshold_policy
 FROM inventory i
 LEFT JOIN pg_policies p ON p.schemaname='gpt02_private'
                       AND p.tablename=i.table_name
 GROUP BY i.table_name
)
SELECT i.role_name,i.table_name,
       i.rolcanlogin,i.rolinherit,
       coalesce(i.relrowsecurity,false) AS rls_enabled,
       coalesce(i.relforcerowsecurity,false) AS force_rls,
       i.effective_column_select,i.table_select,
       coalesce(p.applicable_select_policies,0) AS applicable_policies,
       coalesce(p.has_unconditional_policy,false) AS unconditional_policy,
       coalesce(p.has_task_threshold_policy,false) AS threshold_policy,
       CASE
        WHEN i.table_oid IS NULL THEN 'NO_GO_TABLE_MISSING'
        WHEN i.rolbypassrls THEN 'NO_GO_ROLE_BYPASSES_RLS'
        WHEN NOT i.relrowsecurity OR NOT i.relforcerowsecurity
          THEN 'NO_GO_RLS_NOT_FORCED'
        WHEN i.rolcanlogin AND i.effective_column_select
          THEN 'NO_GO_SHARED_LOGIN_CAN_READ_DIRECTLY'
        WHEN coalesce(p.has_unconditional_policy,false)
          THEN 'NO_GO_UNCONDITIONAL_POLICY'
        ELSE 'REVIEW_EXACT_TASK_ROLE_BINDING_NOT_PROVEN'
       END AS release_decision
FROM inventory i JOIN policies p USING(table_name)
ORDER BY i.table_name;

-- A later, separate PASS gate must cryptographically bind a persisted,
-- unexpired, one-use Super Admin decision to a single immutable task/company/
-- command/attempt before issuing any credential, and verify revocation plus
-- backend termination. This diagnostic is NOT an authorization token.


-- Independent READ-ONLY owner-custody preflight. The prior five-row query
-- checks the existing reader's broad effective rights; this query checks
-- whether a reviewed role-scoped migration could be executed WITHOUT
-- leaving postgres with permanent SET privileges on the ledger owner.
-- No password, secrets, data rows, DDL, SET ROLE or EXECUTE here.
WITH expected_tables(table_name) AS (
 VALUES ('approvals'),('operator_links'),('receipts'),
        ('core_identity_receipts'),('post_consumption_fences')
), owner_inventory AS (
 SELECT e.table_name,c.oid,
        c.relowner='gpt02_store_owner'::regrole AS expected_owner,
        c.relrowsecurity AND c.relforcerowsecurity AS force_rls
 FROM expected_tables e
 LEFT JOIN pg_namespace n ON n.nspname='gpt02_private'
 LEFT JOIN pg_class c ON c.relnamespace=n.oid
                      AND c.relname=e.table_name AND c.relkind='r'
), owner_checks AS (
 SELECT
  (SELECT rolcreaterole AND NOT rolsuper FROM pg_roles
    WHERE rolname='postgres') AS limited_migrator,
  EXISTS (SELECT 1 FROM pg_auth_members m
          WHERE m.roleid='gpt02_store_owner'::regrole
            AND m.member='postgres'::regrole AND m.admin_option) AS has_admin_option,
  pg_has_role('postgres','gpt02_store_owner','SET') AS owner_set_now,
  EXISTS (SELECT 1 FROM pg_namespace
          WHERE nspname='gpt02_private'
            AND nspowner='gpt02_store_owner'::regrole) AS expected_schema_owner,
  (SELECT count(*) FROM owner_inventory WHERE oid IS NOT NULL
    AND expected_owner AND force_rls) AS owned_forced_tables,
  NOT EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='gpt02_private'
      AND c.relname IN (SELECT table_name FROM expected_tables)
      AND 0=ANY(p.polroles)
  ) AS no_public_policies
)
SELECT current_user AS observed_as,limited_migrator,has_admin_option,
       owner_set_now,expected_schema_owner,owned_forced_tables,
       no_public_policies,
       CASE WHEN current_user='postgres' AND limited_migrator
                 AND has_admin_option AND NOT owner_set_now
                 AND expected_schema_owner AND owned_forced_tables=5
                 AND no_public_policies
            THEN 'PASS_OWNER_CUSTODY_PREFLIGHT_NO_LIVE_PERMISSION'
            ELSE 'NO_GO_OWNER_CUSTODY_OR_SCHEMA_DRIFT'
       END AS owner_custody_preflight,
       'NO_GO_NO_SIGNED_ONE_USE_LIVE_ISSUER'::text AS credential_release
FROM owner_checks;

-- A PASS owner-custody preflight is not authority to execute DDL. The
-- per-task role/owner GRANT sequence is a Draft proposal only and requires
-- separately reviewed issuance, rollback, scope RLS, and fresh approval.
