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
