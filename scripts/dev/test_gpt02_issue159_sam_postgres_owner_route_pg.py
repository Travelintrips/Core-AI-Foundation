#!/usr/bin/env python3
"""CST GPT02: disposable PG16/17 proof for Sam's postgres owner-context route.
No live network, no real credentials, no changes to Supabase/PROD.
"""
import os, secrets, subprocess, time, uuid
IMAGE=os.getenv('GPT02_RELOCK_TEST_PG_IMAGE','postgres:16-alpine')
if IMAGE not in ('postgres:16-alpine','postgres:17-alpine'):
    raise SystemExit('DISPOSABLE_IMAGE_NOT_APPROVED')
name="issue159-sam-"+uuid.uuid4().hex[:9]
password=secrets.token_urlsafe(22)
pgpassword=secrets.token_urlsafe(22)
auditorpassword=secrets.token_urlsafe(22)
reader="dev_gpt02_task_999_"+uuid.uuid4().hex[:12]
tables=["approvals","core_identity_receipts","issuer_evidences",
        "issuer_lease_consumptions","operator_links","post_consumption_fences","receipts"]
def run(args,stdin=None,check=True,timeout=55):
    r=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=timeout)
    if check and r.returncode:
        raise RuntimeError("TEST_COMMAND_FAILED "+(r.stderr[-1250:] or r.stdout[-1250:]))
    return r
def psql(user,pw,sql,check=True):
    return run(["docker","exec","-i","-e","PGPASSWORD="+pw,name,"psql","-X","-w","-v","ON_ERROR_STOP=1",
          "-h","127.0.0.1","-U",user,"-d","postgres","-At"],sql,check)
def val(user,pw,sql):
    return psql(user,pw,sql).stdout.strip().splitlines()[-1]
def main():
    print("TEST_ONLY_IMAGE="+IMAGE+" NETWORK_NONE",flush=True)
    try:
        run(["docker","run","--rm","-d","--network","none","--name",name,
            "-e","POSTGRES_USER=fixture_root","-e","POSTGRES_PASSWORD="+password,
            IMAGE])
        for i in range(120):
            if psql("fixture_root",password,"select 1;",check=False).returncode==0:break
            time.sleep(.25)
        else:raise RuntimeError("FIXTURE_NOT_READY")
        setup=f"""
        CREATE ROLE postgres LOGIN CREATEROLE NOINHERIT PASSWORD '{pgpassword}';
        CREATE ROLE gpt02_store_owner NOLOGIN NOINHERIT;
        CREATE ROLE dev_gpt02_relock_catalog_auditor LOGIN NOINHERIT PASSWORD '{auditorpassword}';
        CREATE ROLE {reader} NOLOGIN NOINHERIT;
        CREATE ROLE outsider NOLOGIN;
        CREATE SCHEMA gpt02_private AUTHORIZATION gpt02_store_owner;
        CREATE SCHEMA gpt02_relock_audit AUTHORIZATION postgres;
        REVOKE ALL ON SCHEMA gpt02_private FROM PUBLIC;
        GRANT USAGE ON SCHEMA gpt02_relock_audit TO dev_gpt02_relock_catalog_auditor;
        GRANT gpt02_store_owner TO postgres WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
        SET ROLE gpt02_store_owner;
        """+("\n".join("CREATE TABLE gpt02_private.%s (id integer primary key, label text); ALTER TABLE gpt02_private.%s ENABLE ROW LEVEL SECURITY;"%(x,x) for x in tables))+f"""
        GRANT USAGE ON SCHEMA gpt02_private TO {reader};
        GRANT USAGE ON SCHEMA gpt02_private TO postgres;
        GRANT SELECT ON ALL TABLES IN SCHEMA gpt02_private TO {reader};
        GRANT SELECT (label) ON gpt02_private.approvals TO {reader};
        RESET ROLE;
        """
        psql("fixture_root",password,setup)
        assert val("fixture_root",password,"select not pg_has_role('postgres','gpt02_store_owner','SET');")=="t"
        assert val("fixture_root",password,"select (not rolcanlogin and rolpassword is null) from pg_authid where rolname='gpt02_store_owner';")=="t"
        print("PASS_BASELINE_OWNER_NOLOGIN_AND_POSTGRES_SET_FALSE",flush=True)
        # The existing source guard is for a distinct maintenance account;
        # this new isolated route keeps the runtime helper's caller checks unchanged.
        helper="""CREATE FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(p_role name)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE col record;
BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor'
     OR current_user <> 'gpt02_store_owner' THEN
    RAISE EXCEPTION 'RELOCK_OWNER_HELPER_CALLER_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_role::text !~ '^dev_gpt02_task_[1-9][0-9]*_[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'RELOCK_SCOPE_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=p_role) THEN
    RAISE EXCEPTION 'RELOCK_ROLE_MISSING' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members
     WHERE member=p_role::regrole OR roleid=p_role::regrole) THEN
    RAISE EXCEPTION 'RELOCK_MEMBERSHIP_PRESENT' USING ERRCODE='42501';
  END IF;
  EXECUTE pg_catalog.format('REVOKE SELECT ON TABLE
     gpt02_private.approvals,gpt02_private.core_identity_receipts,
     gpt02_private.issuer_evidences,gpt02_private.issuer_lease_consumptions,
     gpt02_private.operator_links,gpt02_private.post_consumption_fences,
     gpt02_private.receipts FROM %I',p_role);
  FOR col IN
    SELECT c.relname, a.attname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='gpt02_private'
      AND c.relname=ANY(ARRAY['approvals','core_identity_receipts',
        'issuer_evidences','issuer_lease_consumptions','operator_links',
        'post_consumption_fences','receipts'])
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(a.attacl) acl
        WHERE acl.grantee=p_role::regrole AND acl.privilege_type='SELECT')
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%I) ON TABLE gpt02_private.%I FROM %I',
      col.attname,col.relname,p_role);
  END LOOP;
  EXECUTE pg_catalog.format('REVOKE USAGE ON SCHEMA gpt02_private FROM %I',p_role);
END $fn$;
REVOKE ALL ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_private.revoke_expired_scoped_reader_grants(name) TO postgres;"""
        preflight="""DO $g$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
   THEN RAISE EXCEPTION 'POSTGRES_SESSION_REQUIRED'; END IF;
 IF pg_catalog.pg_has_role('postgres','gpt02_store_owner','SET')
   THEN RAISE EXCEPTION 'ALREADY_HAS_OWNER_SET'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
     WHERE m.roleid='gpt02_store_owner'::regrole AND m.member='postgres'::regrole
      AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
   THEN RAISE EXCEPTION 'OWNER_ADMIN_BASELINE_NOT_MATCHED'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
     WHERE r.rolname='gpt02_store_owner' AND NOT r.rolcanlogin)
   THEN RAISE EXCEPTION 'OWNER_MUST_BE_NOLOGIN'; END IF;
END $g$;"""
        guard="""DO $g$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'gpt02_store_owner'
    THEN RAISE EXCEPTION 'POSTGRES_OWNER_CONTEXT_GUARD_FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace
    WHERE nspname='gpt02_private' AND nspowner='gpt02_store_owner'::regrole)
    THEN RAISE EXCEPTION 'SCHEMA_OWNER_MISMATCH'; END IF;
END $g$;"""
        # Negative test: unapproved postgres cannot enter owner context
        denied=psql("postgres",pgpassword,"SET ROLE gpt02_store_owner;",check=False)
        assert denied.returncode!=0 and "permission denied" in denied.stderr
        print("PASS_NO_PREGRANT_POSTGRES_OWNER_SET_DENIED",flush=True)
        # One transaction ensures no durable temporary SET if any statement fails.
        install=("BEGIN;\n"+preflight+"\n"
           "GRANT gpt02_store_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;\n"
           "SET ROLE gpt02_store_owner;\n"+guard+"\n"+helper+"\n"
           "RESET ROLE;\nREVOKE gpt02_store_owner FROM postgres GRANTED BY postgres;\nCOMMIT;")
        result=psql("postgres",pgpassword,install,check=False)
        if result.returncode:
            print("INSTALL_RESULT_STDERR="+result.stderr[-1200:],flush=True)
            raise RuntimeError("ISOLATED_GRANT_OWNER_INSTALL_REVOKE_PATH_FAILED")
        print("PASS_SINGLE_TRANSACTION_SET_OWNER_INSTALL_RESET_REVOKE_COMMIT",flush=True)
        verify="""SELECT 
          pg_catalog.pg_has_role('postgres','gpt02_store_owner','SET') as can_set,
          pg_catalog.pg_has_role('postgres','gpt02_store_owner','USAGE') as can_inherit,
          (SELECT count(*) FROM pg_catalog.pg_auth_members m
            WHERE m.roleid='gpt02_store_owner'::regrole 
              AND m.member='postgres'::regrole
              AND m.grantor='fixture_root'::regrole
              AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) as root_admin_grant,
          (SELECT count(*) FROM pg_catalog.pg_auth_members m
            WHERE m.roleid='gpt02_store_owner'::regrole
              AND m.member='postgres'::regrole
              AND m.grantor='postgres'::regrole) as temporary_grant;
        """
        got=val("fixture_root",password,verify).split("|")
        assert got==['f','f','1','0'],f"POST_REVOKE_MEMBERSHIP_DRIFT:{got}"
        assert val("fixture_root",password,"SELECT NOT rolcanlogin AND rolconnlimit=-1 AND rolpassword IS NULL FROM pg_authid WHERE rolname='gpt02_store_owner';")=="t"
        own=val("fixture_root",password,
            "SELECT (proowner='gpt02_store_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=\"\"']::text[])"
            " FROM pg_proc WHERE oid='gpt02_private.revoke_expired_scoped_reader_grants(name)'::regprocedure;")
        if own!="t":
            meta=val("fixture_root",password,
                "SELECT pg_get_userbyid(proowner)::text || '|' || prosecdef::text || '|' || array_to_string(proconfig, ';') FROM pg_proc WHERE oid='gpt02_private.revoke_expired_scoped_reader_grants(name)'::regprocedure;")
            print("OWNER_PATH_METADATA="+meta,flush=True)
        assert own=="t",f"OWNER_OR_SEARCH_PATH_MISMATCH:{own}"
        assert val("fixture_root",password,
            "SELECT NOT has_function_privilege('outsider', 'gpt02_private.revoke_expired_scoped_reader_grants(name)', 'EXECUTE');")=="t"
        print("PASS_OWNER_SECDEF_PATH_EMPTY_PUBLIC_DENIED",flush=True)
        print("PASS_PROVIDER_ADMIN_MEMBERSHIP_PRESERVED_TEMP_SET_REMOVED",flush=True)
        # Direct postgres cannot invoke helper despite nested EXECUTE grant
        direct=psql("postgres",pgpassword,
          "SELECT gpt02_private.revoke_expired_scoped_reader_grants('"+reader+"'::name);",check=False)
        assert direct.returncode!=0 and "RELOCK_OWNER_HELPER_CALLER_DENIED" in direct.stderr
        print("PASS_POSTGRES_DIRECT_CALL_DENIED",flush=True)
        wrapper="""CREATE FUNCTION gpt02_relock_audit.fixture_relock_reader(p_role name)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $wrap$ BEGIN
  IF session_user <> 'dev_gpt02_relock_catalog_auditor' OR current_user <> 'postgres'
    THEN RAISE EXCEPTION 'WRAPPER_CALLER_DENIED'; END IF;
  PERFORM gpt02_private.revoke_expired_scoped_reader_grants(p_role);
END $wrap$;
REVOKE ALL ON FUNCTION gpt02_relock_audit.fixture_relock_reader(name) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION gpt02_relock_audit.fixture_relock_reader(name) TO dev_gpt02_relock_catalog_auditor;"""
        psql("postgres",pgpassword,wrapper)
        invalid=psql("dev_gpt02_relock_catalog_auditor",auditorpassword,
          "SELECT gpt02_relock_audit.fixture_relock_reader('dev_gpt02_task_1_wrong'::name);",check=False)
        assert invalid.returncode!=0 and "RELOCK_SCOPE_INVALID" in invalid.stderr
        print("PASS_SCOPED_ROLE_NAME_REJECTION",flush=True)
        psql("dev_gpt02_relock_catalog_auditor",auditorpassword,
          "SELECT gpt02_relock_audit.fixture_relock_reader('"+reader+"'::name);")
        privs=val("fixture_root",password,f"""
          SELECT
           has_schema_privilege('{reader}','gpt02_private','USAGE'),
           (SELECT count(*) FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON c.relnamespace=n.oid
             WHERE n.nspname='gpt02_private' AND c.relname=ANY(ARRAY[
               'approvals','core_identity_receipts','issuer_evidences',
               'issuer_lease_consumptions','operator_links','post_consumption_fences','receipts'])
               AND has_any_column_privilege('{reader}',c.oid,'SELECT')),
           (SELECT count(*) FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='gpt02_private' AND a.attnum>0 AND NOT a.attisdropped
              AND has_column_privilege('{reader}',c.oid,a.attnum,'SELECT'))
        """)
        assert privs=='f|0|0',f"READER_RESIDUAL_SELECT_OR_USAGE:{privs}"
        print("PASS_SEVEN_TABLE_READER_AND_COLUMN_ACL_REVOKED",flush=True)
        # Reentry must be idempotent on an already-cleaned scope.
        psql("dev_gpt02_relock_catalog_auditor",auditorpassword,
          "SELECT gpt02_relock_audit.fixture_relock_reader('"+reader+"'::name);")
        print("PASS_IDEMPOTENT_READER_REVOKE",flush=True)
        psql("fixture_root",password,
          "ALTER ROLE dev_gpt02_relock_catalog_auditor NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL;")
        assert val("fixture_root",password,
          "SELECT NOT rolcanlogin AND rolconnlimit=0 AND rolpassword IS NULL "
          "FROM pg_authid WHERE rolname='dev_gpt02_relock_catalog_auditor';")=="t"
        assert val("fixture_root",password,
          "SELECT count(*) FROM pg_stat_activity WHERE usename='dev_gpt02_relock_catalog_auditor';")=="0"
        print("PASS_SYNTHETIC_AUDITOR_RELOCK_ZERO_SESSION",flush=True)
        print("PASS_SAM_POSTGRES_OWNER_ROUTE_DISPOSABLE_ONLY "+IMAGE,flush=True)
    finally:
        run(["docker","rm","-f",name],check=False)
if __name__=="__main__":main()
