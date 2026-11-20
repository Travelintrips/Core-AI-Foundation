-- GPT02 Issue159 owner-held helper: MAINTENANCE CANDIDATE, REVIEW ONLY.
-- NEVER APPLY WITHOUT INDEPENDENT OWNER / SECURITY APPROVAL.
-- No role, credential, role membership, deployment, or timer is created.
-- A separately authorized temporary maintenance login (NOT postgres) may
-- SET ROLE to the existing NOLOGIN owner; see accompanying negative tests.
BEGIN;
DO $guard$
BEGIN
 IF current_user <> 'gpt02_store_owner' OR session_user <> 'gpt02_owner_maintenance'
 THEN RAISE EXCEPTION 'GPT02_OWNER_MAINTENANCE_SESSION_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_store_owner'
   AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls)
 THEN RAISE EXCEPTION 'GPT02_OWNER_NOLOGIN_REQUIRED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gpt02_owner_maintenance'
    AND rolcanlogin AND NOT rolsuper AND NOT rolcreaterole
    AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)
 THEN RAISE EXCEPTION 'GPT02_MAINTENANCE_ROLE_PROFILE_INVALID'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_auth_members m
    WHERE m.roleid='gpt02_store_owner'::regrole
      AND m.member='gpt02_owner_maintenance'::regrole
      AND m.set_option AND NOT m.admin_option AND NOT m.inherit_option)
 OR EXISTS (SELECT 1 FROM pg_auth_members m
    WHERE (m.member='gpt02_owner_maintenance'::regrole AND
      (m.roleid<>'gpt02_store_owner'::regrole OR m.admin_option
       OR m.inherit_option OR NOT m.set_option))
      OR m.roleid='gpt02_owner_maintenance'::regrole)
 THEN RAISE EXCEPTION 'GPT02_MAINTENANCE_MEMBERSHIP_INVALID'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_namespace
   WHERE nspname='gpt02_private' AND nspowner='gpt02_store_owner'::regrole)
 THEN RAISE EXCEPTION 'GPT02_STORE_SCHEMA_OWNER_MISMATCH'; END IF;
END $guard$;

CREATE FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(p_role name)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $scope$
DECLARE col record;
BEGIN
 -- Match native relock Phase A/B custody: no caller may impersonate the
 -- store owner or inject a role outside this signed one-task namespace.
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 OR current_user <> 'gpt02_store_owner'
 THEN RAISE EXCEPTION 'RELOCK_OWNER_HELPER_CALLER_DENIED'
   USING ERRCODE='42501'; END IF;
 IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}
REVOKE ALL ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 FROM PUBLIC;
-- postgres can invoke ONLY this narrow owner helper as nested definer.
GRANT EXECUTE ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 TO postgres;
COMMIT;
-- No grant to auditor, anon, authenticated, issuer or signer.

 THEN RAISE EXCEPTION 'RELOCK_SCOPE_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=p_role)
 THEN RAISE EXCEPTION 'RELOCK_SCOPE_ROLE_MISSING' USING ERRCODE='22023'; END IF;
 -- CREATEROLE's expected postgres ADMIN membership permits Phase A's ALTER
 -- but may not be a SET/INHERIT path. Any other membership is a denial.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.roleid=p_role::regrole AND m.member='postgres'::regrole
      AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE m.member=p_role::regrole
      OR (m.roleid=p_role::regrole AND
          (m.member<>'postgres'::regrole
           OR NOT m.admin_option OR m.set_option OR m.inherit_option)))
 THEN RAISE EXCEPTION 'RELOCK_SCOPE_MEMBERSHIP_NOT_ISOLATED'
   USING ERRCODE='42501'; END IF;
 -- All seven existing owner-held private relations. Five are the canonical
 -- lineage readback, two are issuer-only evidence/fence ledgers.
 IF (SELECT count(*) FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='gpt02_private'
       AND c.relname IN ('approvals','operator_links','receipts',
         'core_identity_receipts','post_consumption_fences',
         'issuer_evidences','issuer_lease_consumptions')
       AND c.relkind='r' AND c.relowner='gpt02_store_owner'::regrole
       AND c.relrowsecurity AND c.relforcerowsecurity) <> 7
 THEN RAISE EXCEPTION 'RELOCK_PRIVATE_OWNER_OR_RLS_DRIFT'
   USING ERRCODE='42501'; END IF;
 EXECUTE pg_catalog.format('REVOKE SELECT ON TABLE
   gpt02_private.approvals,gpt02_private.operator_links,
   gpt02_private.receipts,gpt02_private.core_identity_receipts,
   gpt02_private.post_consumption_fences,gpt02_private.issuer_evidences,
   gpt02_private.issuer_lease_consumptions FROM %I',p_role);
 -- Table-level REVOKE alone leaves column ACLs in PostgreSQL. Revoke every
 -- explicit scoped SELECT column grant (never another role's grant).
 FOR col IN SELECT c.relname,a.attname FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='gpt02_private'
     AND c.relname IN ('approvals','operator_links','receipts',
       'core_identity_receipts','post_consumption_fences',
       'issuer_evidences','issuer_lease_consumptions')
     AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.aclexplode(a.attacl) acl
       WHERE acl.grantee=p_role::regrole AND acl.privilege_type='SELECT')
 LOOP
   EXECUTE pg_catalog.format(
     'REVOKE SELECT (%I) ON TABLE gpt02_private.%I FROM %I',
     col.attname,col.relname,p_role
   );
 END LOOP;
 EXECUTE pg_catalog.format('REVOKE USAGE ON SCHEMA gpt02_private FROM %I',p_role);
 IF pg_catalog.has_schema_privilege(p_role,'gpt02_private','USAGE')
 OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='gpt02_private'
     AND c.relname IN ('approvals','operator_links','receipts',
       'core_identity_receipts','post_consumption_fences',
       'issuer_evidences','issuer_lease_consumptions')
     AND (pg_catalog.has_table_privilege(p_role,c.oid,'SELECT')
        OR pg_catalog.has_any_column_privilege(p_role,c.oid,'SELECT')))
 THEN RAISE EXCEPTION 'RELOCK_SCOPE_EFFECTIVE_ACL_REMAINS'
   USING ERRCODE='42501'; END IF;
END $scope$;
REVOKE ALL ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 FROM PUBLIC;
-- postgres can invoke ONLY this narrow owner helper as nested definer.
GRANT EXECUTE ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 TO postgres;
COMMIT;
-- No grant to auditor, anon, authenticated, issuer or signer.
