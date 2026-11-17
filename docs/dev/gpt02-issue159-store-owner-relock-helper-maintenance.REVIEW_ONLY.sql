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
BEGIN
 IF session_user <> 'dev_gpt02_relock_catalog_auditor'
 OR current_user <> 'gpt02_store_owner'
 THEN RAISE EXCEPTION 'RELOCK_OWNER_HELPER_CALLER_DENIED'
   USING ERRCODE='42501'; END IF;
 IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'RELOCK_SCOPE_INVALID' USING ERRCODE='22023'; END IF;
 -- The function owner is the existing owner of ALL five private tables.
 EXECUTE format('REVOKE SELECT ON TABLE
   gpt02_private.approvals,gpt02_private.operator_links,
   gpt02_private.receipts,gpt02_private.core_identity_receipts,
   gpt02_private.post_consumption_fences FROM %I',p_role);
 EXECUTE format('REVOKE USAGE ON SCHEMA gpt02_private FROM %I',p_role);
END $scope$;
REVOKE ALL ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 FROM PUBLIC;
-- postgres can invoke ONLY this narrow owner helper as nested definer.
GRANT EXECUTE ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name)
 TO postgres;
COMMIT;
-- No grant to auditor, anon, authenticated, issuer or signer.
