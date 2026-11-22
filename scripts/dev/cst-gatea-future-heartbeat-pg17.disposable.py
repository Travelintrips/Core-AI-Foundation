#!/usr/bin/env python3
"""Disposable PostgreSQL 17 RLS heartbeat migration QA. No real CST-DEV/PROD network."""
import json, os, subprocess, time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
name=f"cst-gatea-heartbeat-pg17-{os.getpid()}"
def run(args, data=None, ok=True):
    p=subprocess.run(args,input=data,capture_output=True,text=True,timeout=65)
    if ok and p.returncode: raise RuntimeError(f"{args[0]} failed: {p.stderr[-450:]}")
    return p
def sql(stmt, ok=True):
    return run(["docker","exec","-i",name,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","postgres","-d","postgres"],stmt,ok)
def check(cond,msg):
    if not cond: raise AssertionError(msg)
try:
    run(["docker","run","-d","--rm","--network","none","--memory","384m","--cpus","1","--name",name,
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","mirror.gcr.io/library/postgres:17-alpine"])
    for i in range(100):
        if sql("SELECT 1",False).returncode==0: break
        time.sleep(.25)
    else: raise AssertionError("PG17_NOT_READY")
    sql("""CREATE SCHEMA ai_platform;
CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_gatea_watchdog_relock NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_gatea_stage_lease_writer NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE cst_gatea_watchdog_lease_reader NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE TABLE ai_platform.cst_onejob_owner_approvals(status text);
CREATE TABLE ai_platform.cst_gatea_stage_leases(project text,nonce text,source_sha text,issued_at timestamptz,expires_at timestamptz,heartbeat_at timestamptz,state text);
ALTER TABLE ai_platform.cst_gatea_stage_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.cst_gatea_stage_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY cst_gatea_watchdog_exact_lease_read ON ai_platform.cst_gatea_stage_leases FOR SELECT TO cst_gatea_watchdog_relock USING (project='xssrfshdrtdfupgqwfdw');
CREATE POLICY gatea_watchdog_lease_read ON ai_platform.cst_gatea_stage_leases FOR SELECT TO cst_gatea_watchdog_lease_reader USING (project='xssrfshdrtdfupgqwfdw');
CREATE POLICY gatea_stage_lease_write_read ON ai_platform.cst_gatea_stage_leases FOR SELECT TO cst_gatea_stage_lease_writer USING (project='xssrfshdrtdfupgqwfdw');
CREATE POLICY gatea_stage_lease_write_insert ON ai_platform.cst_gatea_stage_leases FOR INSERT TO cst_gatea_stage_lease_writer WITH CHECK (project='xssrfshdrtdfupgqwfdw');
CREATE POLICY gatea_stage_lease_write_update ON ai_platform.cst_gatea_stage_leases FOR UPDATE TO cst_gatea_stage_lease_writer USING (project='xssrfshdrtdfupgqwfdw' AND state='ACTIVE' AND expires_at>clock_timestamp()) WITH CHECK (project='xssrfshdrtdfupgqwfdw' AND state='ACTIVE' AND expires_at>clock_timestamp());
GRANT USAGE ON SCHEMA ai_platform TO cst_gatea_stage_lease_writer;
GRANT SELECT,INSERT,UPDATE ON ai_platform.cst_gatea_stage_leases TO cst_gatea_stage_lease_writer;""")
    f=(root/"docs/dev/cst-gatea-heartbeat-no-future.CSTDEV-ONLY.sql").read_text()
    rollback=(root/"docs/dev/cst-gatea-heartbeat-no-future.ROLLBACK-CSTDEV-ONLY.sql").read_text()
    check(sql(f).returncode==0,"APPLY_FAIL")
    check(sql(f,False).returncode!=0,"SECOND_APPLY_NOT_DENIED")
    base="INSERT INTO ai_platform.cst_gatea_stage_leases VALUES ('xssrfshdrtdfupgqwfdw','n','s',now()-interval '1 minute',now()+interval '3 minutes',"
    check(sql("SET ROLE cst_gatea_stage_lease_writer; "+base+"now()+interval '1 minute','ACTIVE');",False).returncode!=0,"FUTURE_INSERT_ALLOWED")
    sql("SET ROLE cst_gatea_stage_lease_writer; "+base+"now()-interval '2 seconds','ACTIVE');")
    check(sql("SET ROLE cst_gatea_stage_lease_writer; UPDATE ai_platform.cst_gatea_stage_leases SET heartbeat_at=now()+interval '1 minute';",False).returncode!=0,"FUTURE_UPDATE_ALLOWED")
    sql("SET ROLE cst_gatea_stage_lease_writer; UPDATE ai_platform.cst_gatea_stage_leases SET heartbeat_at=now()-interval '1 second';")
    check(sql(rollback,False).returncode!=0,"ACTIVE_ROLLBACK_NOT_DENIED")
    sql("DELETE FROM ai_platform.cst_gatea_stage_leases;")
    sql(rollback)
    check("heartbeat_at" not in sql("SELECT with_check FROM pg_policies WHERE policyname='gatea_stage_lease_write_insert';").stdout,"ROLLBACK_POLICY_NOT_RESTORED")
    print("CST_GATEA_FUTURE_HEARTBEAT_PG17_MIGRATION_AND_ROLLBACK_PASS "+json.dumps({"postgres":17,"network":"none","futureInsertDenied":True,"futureUpdateDenied":True,"validHeartbeatAccepted":True,"secondApplyDenied":True,"rollbackDeniedWithActiveLease":True,"emptyRollbackRestored":True,"realCstDevTouched":False,"prodTouched":False,"releaseDecision":"NO_GO"}))
finally:
    run(["docker","rm","-f",name],ok=False)
