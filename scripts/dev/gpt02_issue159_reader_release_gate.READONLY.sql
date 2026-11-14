-- GPT02 Issue159 CST-DEV reader release inventory — READ ONLY / NO APPLY
-- Execute only on the identified CST-DEV project, never PROD.
-- Never query pg_authid.rolpassword or any credential value.
-- This is a conservative readiness inventory, not permission to alter roles.
WITH expected(role_name) AS (
 VALUES ('gpt02_issuer_evidence_reader'),
        ('dev_gpt02_lineage_reader'),
        ('dev_gpt02_lineage_login')
), roles AS (
 SELECT e.role_name, r.oid, r.rolcanlogin, r.rolconnlimit,
        r.rolinherit, r.rolbypassrls, r.rolsuper,
        r.rolcreaterole, r.rolcreatedb, r.rolreplication
 FROM expected e LEFT JOIN pg_roles r ON r.rolname=e.role_name
), inspected AS (
 SELECT x.role_name,x.oid,x.rolcanlogin,x.rolconnlimit,
        x.rolinherit,x.rolbypassrls,x.rolsuper,
        x.rolcreaterole,x.rolcreatedb,x.rolreplication,
        (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=x.role_name) AS active_sessions,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='gpt02_private' AND c.relkind='r'
           AND c.relname = ANY(ARRAY['approvals','operator_links','receipts',
             'core_identity_receipts','post_consumption_fences'])
           AND c.relrowsecurity AND c.relforcerowsecurity) AS force_rls_tables,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='gpt02_private' AND c.relkind='r'
           AND c.relname = ANY(ARRAY['approvals','operator_links','receipts',
             'core_identity_receipts','post_consumption_fences'])
           AND has_table_privilege(x.role_name,c.oid,'SELECT')) AS direct_select_tables,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='gpt02_private' AND
          (p.proname ILIKE '%lineage%' OR p.proname ILIKE '%read%')
          AND has_function_privilege(x.role_name,p.oid,'EXECUTE')) AS callable_read_functions
 FROM roles x
)
SELECT role_name,rolcanlogin,rolconnlimit,rolinherit,
       active_sessions,force_rls_tables,direct_select_tables,
       callable_read_functions,
       CASE
         WHEN oid IS NULL THEN 'NO_GO_ROLE_MISSING'
         WHEN coalesce(rolsuper,false) OR coalesce(rolbypassrls,false)
              OR coalesce(rolcreaterole,false) OR coalesce(rolcreatedb,false)
              OR coalesce(rolreplication,false) THEN 'NO_GO_ELEVATED_ROLE'
         WHEN role_name='gpt02_issuer_evidence_reader'
              AND rolcanlogin=false AND rolconnlimit=0
              AND active_sessions=0 AND direct_select_tables=0
              THEN 'EXPECTED_LOCKED_NOT_OPERATIONAL'
         ELSE 'REVIEW_REQUIRED_NOT_AUTHORIZATION'
       END AS custody_decision
FROM inspected ORDER BY role_name;

-- An explicit read interface must prove exact task/company/command/attempt
-- authorization, no unrelated row enumeration, strict actor identity,
-- no credential reuse, and compatibility with native no_privileged_routines.
-- The mere existence of a readable function does NOT prove any of these.
