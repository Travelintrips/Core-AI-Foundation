#!/usr/bin/env python3
"""PostgreSQL16 disposable only: signed-lease JIT open -> session -> relock.

The manifest verification is synthetic/mock; genuine signed permit custody
is NOT supplied. No host network, no Supabase, no service deployment.
"""
import json, os, subprocess, sys, time
from pathlib import Path
from datetime import datetime,timedelta,timezone
from unittest.mock import patch
from contextlib import nullcontext
sys.path.insert(0,str(Path(__file__).resolve().parent))
import cst_onejob_stage_jit_open_controller as j

NAME="cst-onejob-jit-open-qa-"+str(os.getpid())
def run(args,*,input=None,allow=False,timeout=40):
    p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=timeout)
    if p.returncode and not allow:
        raise RuntimeError("DISPOSABLE_COMMAND_FAILED_"+str(p.returncode)+":"+p.stderr.strip()[:180])
    return p
def sql(s,*,user="postgres",allow=False):
    return run(["docker","exec","-i",NAME,"psql","-X","-qAt","-F","|",
                "-v","ON_ERROR_STOP=1","-U",user,"-d","postgres"],
               input=s,allow=allow)
def query(s):
    return [v.strip().split("|") for v in sql(s).stdout.splitlines() if v.strip()]
def assert_true(ok,code):
    if not ok:raise RuntimeError("DISPOSABLE_"+code)
def test():
    run(["docker","run","-d","--rm","--network","none","--name",NAME,
         "--memory","384m","--cpus","1",
         "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:16-alpine"],timeout=90)
    try:
        for _ in range(100):
            # The initial temporary bootstrap server can report readiness
            # before PostgreSQL switches to its final local socket.
            p=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                   "-X","-qAt","-U","postgres","-d","postgres",
                   "-c","SELECT 1"],allow=True)
            if p.returncode==0 and p.stdout.strip()=="1":
                time.sleep(.25)
                p2=run(["docker","exec",NAME,"psql","-h","127.0.0.1",
                        "-X","-qAt","-U","postgres","-d","postgres",
                        "-c","SELECT 1"],allow=True)
                if p2.returncode==0 and p2.stdout.strip()=="1":
                    break
            time.sleep(.15)
        else:raise RuntimeError("DISPOSABLE_DB_NOT_READY")
        sql("CREATE ROLE cst_team_model_pilot_stage_login NOLOGIN NOINHERIT NOBYPASSRLS CONNECTION LIMIT 1;")
        sql("CREATE ROLE cst_onejob_qa_unrelated NOLOGIN NOBYPASSRLS;")
        # Disposable PostgreSQL unique-index reservation: separate psql
        # connections contend for the same signed nonce; no host DB touched.
        sql("CREATE TABLE qa_once_nonce (project text NOT NULL, nonce text NOT NULL,"
            " source_sha text NOT NULL, expires_at timestamptz NOT NULL,"
            " PRIMARY KEY(project, nonce));")
        now=datetime.now(timezone.utc)
        permit={"sourceSha":"a"*40,"project":j.PROJECT,"nonce":"e"*32,
                "expiresAt":(now+timedelta(minutes=5)).isoformat(timespec="milliseconds").replace("+00:00","Z")}
        def one_session():
            assert_true(query(j.ROLE_QUERY)==[["1","0","0","0","1"]],"LOGIN_MISSING")
            sql("SELECT 1;",user=j.ROLE)
            run(["docker","exec","-d",NAME,"psql","-U",j.ROLE,
                 "-d","postgres","-c","SELECT pg_sleep(50)"])
            for _ in range(40):
                if query(j.ACTIVE_QUERY)==[["1"]]:break
                time.sleep(.1)
            else:raise RuntimeError("DISPOSABLE_STAGE_SESSION_MISSING")
        def mock_reserve(project,nonce,source,deadline):
            # Synthetic immutable literal fields, no untrusted interpolation
            # in operational SQL. This is an isolated no-network database.
            assert project==j.PROJECT and nonce=="e"*32 and source=="a"*40
            statement=("INSERT INTO qa_once_nonce(project,nonce,source_sha,expires_at)"
                       " VALUES ('"+project+"','"+nonce+"','"+source+"',"
                       " '"+deadline.strftime("%Y-%m-%d %H:%M:%S+00")+"')"
                       " ON CONFLICT(project,nonce) DO NOTHING RETURNING nonce;")
            return query(statement)==[[nonce]]
        with patch.object(j,"read_signed_manifest",return_value=permit):
            result=j.run_signed_one_stage(query,one_session,
                reserve_nonce=mock_reserve,acquire_single_flight=nullcontext,
                envelope_path="SYNTHETIC",public_key_path="SYNTHETIC",
                approved_public_pin="b"*64,approved_source_sha="a"*40,now=now)
        assert_true(result["status"]=="SOURCE_ONLY_RELOCKED","NOT_RELOCKED")
        # A replay from a separate SQL connection must fail before reopening.
        replay_calls=[]
        with patch.object(j,"read_signed_manifest",return_value=permit):
            try:
                j.run_signed_one_stage(query,lambda:replay_calls.append(True),
                    reserve_nonce=mock_reserve,acquire_single_flight=nullcontext,envelope_path="SYNTHETIC",
                    public_key_path="SYNTHETIC",approved_public_pin="b"*64,
                    approved_source_sha="a"*40,now=now)
            except j.JitStageDenied as exc:
                assert_true("NONCE_ALREADY_RESERVED" in str(exc),"REPLAY_WRONG_ERROR")
            else:raise RuntimeError("REPLAY_NOT_REJECTED")
        assert_true(not replay_calls,"REPLAY_STAGE_EXECUTED")
        assert_true(query("SELECT count(*) FROM qa_once_nonce")==[["1"]],
                    "NONCE_DUPLICATE_STORED")

        assert_true(query(j.ROLE_QUERY)==[["0","0","0","0","1"]],"ROLE_DRIFT")
        assert_true(query(j.ACTIVE_QUERY)==[["0"]],"RESIDUAL_STAGE_SESSION")
        assert_true(sql("SELECT 1;",user=j.ROLE,allow=True).returncode!=0,"LOGIN_NOT_DENIED")
        assert_true(query("SELECT rolcanlogin::int FROM pg_roles WHERE rolname='cst_onejob_qa_unrelated'")==[["0"]],"UNRELATED_CHANGED")
        print("CST_ONEJOB_STAGE_JIT_OPEN_DISPOSABLE_PASS "+json.dumps({
          "network":"none","project":"SYNTHETIC_POSTGRES16_ONLY",
          "openTemporarily":True,"oneStageSessionObserved":True,
          "newLoginAfterRelockDenied":True,"residualSessions":0,
          "unrelatedRoleUnchanged":True,"relockConfirmed":True,
          "databaseUniqueNonceReplayDenied":True,
          "signedPermit":"SYNTHETIC_QA_ONLY","realOperationalApproval":False,
          "connectedCstDevTouched":False,"prodTouched":False,
          "releaseDecision":"NO_GO"},sort_keys=True))
    finally:
        run(["docker","rm","-f",NAME],allow=True,timeout=20)
if __name__=="__main__":
    try:test()
    except Exception as err:
        print("CST_ONEJOB_STAGE_JIT_OPEN_DISPOSABLE_FAIL "+str(err)[:125])
        sys.exit(2)
