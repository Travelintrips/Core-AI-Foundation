#!/usr/bin/env python3
"""Isolated functional PG16+Node one-job subscriber round-trip.
All server/client containers run --network none, with only a test Unix socket
shared. No Supabase, real key, OTP, real role, job #482, PROD or signers.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[2]
MODULE=ROOT/"scripts/dev/cst-team-onejob-independent-subscriber-role-rehearsal.py"
PGCON="cst-onejob-subscriber-functional-pg-20261120"
NODECON="cst-onejob-subscriber-functional-node-20261120"
DB="cst_onejob_subscriber_functional_fixture"
IMAGE="core-ai-dev:vps-858efc5a3a3a"
PGIMAGE="postgres:16-alpine"
PID_ROLE="cst_team_onejob_subscriber_20261120_abcdef12"
SID="cst-dev-onejob-subscriber-20261120-abcdef12"
REQUEST="cst-ai-team-company1-dev:pilot-"+"a"*20
EVENT="25745d53-9c8d-46ae-8afc-62bfbba92711"
OTHER_EVENT="25745d53-9c8d-46ae-8afc-62bfbba92712"
CORRELATION="24a5dc22-318b-42b4-aaed-a7c84e24cd21"
WORKER_NAME="cst-dev-dell-onejob-20261120-fedcba98"

def run(args,stdin=None,timeout=35):
    p=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        # No DSN, password or private key values may be printed.
        raise RuntimeError(f"QA_STEP_FAILED {args[0]}: "+
                           (p.stderr[-1300:] or p.stdout[-900:]))
    return p.stdout

def psql(sql):
    return run(["docker","exec","-i",PGCON,"psql","-v","ON_ERROR_STOP=1",
                "-U","postgres","-d",DB],sql)
def psql_json(sql):
    rows=run(["docker","exec",PGCON,"psql","-At","-v","ON_ERROR_STOP=1",
              "-U","postgres","-d",DB,"-c",sql]).strip().splitlines()
    if len(rows)!=1:raise RuntimeError("EXACT_ONE_DB_JSON_ROW_REQUIRED")
    return json.loads(rows[0])

def q(s):
    return "'"+str(s).replace("'","''")+"'"

def assert_no_containers():
    for name in [PGCON,NODECON]:
        r=subprocess.run(["docker","inspect",name],capture_output=True)
        if r.returncode==0:raise RuntimeError("QA_NAME_IN_USE_"+name)

def create_keys(shared):
    keydir=shared/"secrets"
    keydir.mkdir(mode=0o750)
    os.chown(keydir,0,28501)
    private=keydir/"receipt-private.pem"
    public=keydir/"receipt-public.pem"
    run(["openssl","genpkey","-algorithm","ED25519","-out",str(private)])
    run(["openssl","pkey","-in",str(private),"-pubout","-out",str(public)])
    os.chown(private,28502,28501)
    os.chmod(private,0o400)
    os.chmod(public,0o444)
    pubpin=run(["/usr/bin/node","-e",
        "const c=require('node:crypto'),fs=require('node:fs');"+
        "const p=c.createPublicKey(fs.readFileSync(process.argv[1]));"+
        "process.stdout.write(c.createHash('sha256').update("+
        "p.export({type:'spki',format:'der'})).digest('hex'));",
        str(public)]).strip()
    if len(pubpin)!=64 or not all(x in "0123456789abcdef" for x in pubpin):
        raise RuntimeError("QA_PUBLIC_KEY_PIN_INVALID")
    return keydir,pubpin

def main():
    assert_no_containers()
    spec=importlib.util.spec_from_file_location("cst_subscriber_existing_qa",MODULE)
    sharedmod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sharedmod)
    sharedmod.NAME=PGCON
    sharedmod.DATABASE=DB
    sharedmod.ROLE=PID_ROLE
    sharedmod.SUBSCRIBER=SID
    sharedmod.REQUEST=REQUEST
    sharedmod.EVENT=EVENT
    sharedmod.WORKER="991"
    sharedmod.JOB="483"
    sharedmod.CORRELATION=CORRELATION
    temp=Path(tempfile.mkdtemp(prefix="cst-subscriber-pg16-functional-"))
    made=False
    try:
        sockdir=temp/"pgsock"
        sockdir.mkdir(mode=0o755)
        keydir,pin=create_keys(temp)
        sharedmod.PIN=pin
        # PostgreSQL and Node have NO IP routes and share only this fixture
        # database's Unix socket. This is not the real pooler TLS topology.
        run(["docker","run","-d","--rm","--name",PGCON,"--network","none",
             "--memory","340m","--pids-limit","110",
             "--mount",f"type=bind,source={sockdir},target=/var/run/postgresql",
             "-e","POSTGRES_DB="+DB,
             "-e","POSTGRES_HOST_AUTH_METHOD=trust",PGIMAGE])
        made=True
        for count in range(65):
            ready=subprocess.run(
                ["docker","exec",PGCON,"psql","-At","-U","postgres",
                 "-d",DB,"-c","SELECT 1"],
                text=True,capture_output=True,timeout=4)
            if ready.returncode==0 and ready.stdout.strip()=="1":
                break
            time.sleep(.2)
        else:raise RuntimeError("PG16_FINAL_DATABASE_NOT_READY")
        fixture="""
CREATE ROLE dev_gpt02_relock_catalog_auditor NOLOGIN;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs(
 id integer PRIMARY KEY,job_code text UNIQUE,status text,
 job_type text,required_capability text,payload_json jsonb);
CREATE TABLE ai_platform.ai_workers(
 id integer PRIMARY KEY,worker_name text,
 provider_slug text,runtime_kind text,model_id text,lease_owner text);
CREATE TABLE ai_platform.ai_events(
 event_id text UNIQUE NOT NULL,event_type text,source_module text,
 source_id text,status text,correlation_id text,
 payload_json jsonb,published_at timestamptz);
CREATE TABLE ai_platform.ai_audit_logs(
 id SERIAL PRIMARY KEY,module text,action text,resource_id text,
 resource_type text,status text,actor_id text,actor_type text,
 tenant_id text,details jsonb);
ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
"""
        psql(fixture)
        psql("INSERT INTO ai_platform.ai_jobs VALUES"+
             "(483,'APPROVED-ONE','queued','ollama_model_invocation',"+
             "'ollama_inference',"+
             q(json.dumps({"requestId":REQUEST,"modelId":"qwen2.5:3b"}))+"::jsonb),"+
             "(484,'UNRELATED-COMPANY3','queued','ollama_model_invocation',"+
             "'ollama_inference','{\"requestId\":\"cst-ai-team-company3-dev:other\"}'::jsonb);"+
             "INSERT INTO ai_platform.ai_workers VALUES (991,"+q(WORKER_NAME)+","+
             "'ollama','ollama_remote_pull','qwen2.5:3b',"+
             q("ollama-remote:"+WORKER_NAME)+");")
        expiry=(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()
        psql(sharedmod.render(sharedmod.APPLY,expiry))
        publication=(datetime.now(timezone.utc)-timedelta(seconds=15)).isoformat()
        public_detail={
            "eventType":"job.completed","sourceModule":"job-engine",
            "correlationId":CORRELATION,
        }
        event_payload={"jobId":483,"jobCode":"APPROVED-ONE",
                       "workerId":991,"jobType":"ollama_model_invocation"}
        psql("UPDATE ai_platform.ai_jobs SET status='completed' WHERE id=483;"+
             "INSERT INTO ai_platform.ai_events VALUES ("+
             q(EVENT)+",'job.completed','job-engine','483','published',"+
             q(CORRELATION)+","+q(json.dumps(event_payload))+"::jsonb,"+
             q(publication)+"::timestamptz),("+
             q(OTHER_EVENT)+",'job.completed','job-engine','484','published',"+
             "'other-correlation',"+
             "'{\"jobId\":484,\"workerId\":998,\"jobType\":\"ollama_model_invocation\"}'::jsonb,"+
             q(publication)+"::timestamptz);"+
             "INSERT INTO ai_platform.ai_audit_logs("+
             "module,action,resource_id,resource_type,status,details) VALUES("+
             "'event-bus','event_published',"+q(EVENT)+","+
             "'ai_event','success',"+q(json.dumps(public_detail))+"::jsonb);")
        # Explicit test-only Node executable, cannot connect outside --network none.
        def run_client(mode):
            args=["docker","run","--rm","--name",NODECON,
              "--network","none","--read-only","--user","28502:28501",
              "--cap-drop","ALL","--security-opt","no-new-privileges",
              "--memory","256m","--pids-limit","64",
              "--mount",f"type=bind,source={sockdir},target=/var/run/postgresql,readonly",
              "--mount",f"type=bind,source={keydir},target=/qa-secrets,readonly",
              "--mount",f"type=bind,source={ROOT/'scripts/dev'},target=/qa,readonly",
              "--env","CST_ONEJOB_PG16_DISPOSABLE_QA=true",
              "--entrypoint","node",IMAGE,
              "/qa/cst-team-onejob-subscriber-functional-client-qa.mjs",
              mode]
            return run(args,timeout=15)
        first=run_client("first")
        if "PG16_AUTHENTICATED_ROLE_ONE_EVENT_SIGNED_RECEIPT_INSERTED" not in first:
            raise RuntimeError("FUNCTIONAL_FIRST_RECEIPT_NOT_VERIFIED")
        second=run_client("duplicate")
        if "PG16_DUPLICATE_SIGNED_RECEIPT_REJECTED" not in second:
            raise RuntimeError("DUPLICATE_NOT_DENIED")
        # Separate process performs privileged fixture DB readback. The
        # subscriber itself has no SELECT privileges on ai_audit_logs.
        query="""SELECT json_build_object(
'database',current_database(),
'job',(SELECT row_to_json(j) FROM ai_platform.ai_jobs j WHERE id=483),
'worker',(SELECT row_to_json(w) FROM ai_platform.ai_workers w WHERE id=991),
'event',(SELECT row_to_json(e) FROM ai_platform.ai_events e WHERE event_id=%s),
'eventPublishedAudit',(SELECT row_to_json(a) FROM ai_platform.ai_audit_logs a
 WHERE module='event-bus' AND action='event_published' AND resource_id=%s),
'receipt',(SELECT details FROM ai_platform.ai_audit_logs
 WHERE module='cst-team-model-subscriber'
 AND action='job_completed_received' AND resource_id=%s),
'receiptCount',(SELECT count(*) FROM ai_platform.ai_audit_logs
 WHERE module='cst-team-model-subscriber'
 AND action='job_completed_received' AND resource_id=%s),
'duplicateCount',(SELECT count(*) FROM ai_platform.ai_audit_logs
 WHERE module='cst-team-model-subscriber'
 AND action='job_completed_received')
)::text;""" % ((q(EVENT),)*4)
        facts=psql_json(query)
        if facts["receiptCount"]!=1 or facts["duplicateCount"]!=1:
            raise RuntimeError("RECEIPT_NOT_DURABLE_AND_UNIQUE")
        factsfile=temp/"facts.json"
        factsfile.write_text(json.dumps(facts),encoding="utf8")
        review=run(["/usr/bin/node",
          str(ROOT/"scripts/dev/cst-team-onejob-subscriber-functional-review-qa.mjs"),
          str(factsfile),str(keydir/"receipt-public.pem")],timeout=6)
        if "DISPOSABLE_PG16_SIGNED_RECEIPT_INDEPENDENT_READBACK_PASS" not in review:
            raise RuntimeError("SIGNATURE_AND_DB_READBACK_FAILED")
        psql(sharedmod.render(sharedmod.ROLLBACK,expiry))
        psql("""DO $postcheck$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE
   rolname='cst_team_onejob_subscriber_20261120_abcdef12')
 THEN RAISE EXCEPTION 'SUBSCRIBER_NOT_REVOKED'; END IF;
 IF (SELECT count(*) FROM ai_platform.ai_audit_logs
  WHERE module='cst-team-model-subscriber'
  AND action='job_completed_received')<>1
 THEN RAISE EXCEPTION 'SIGNED_RECEIPT_REMOVED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes
  WHERE schemaname='ai_platform'
  AND indexname='cst_onejob_subscriber_receipt_once')
 THEN RAISE EXCEPTION 'RECEIPT_INDEX_REMOVED'; END IF;
END $postcheck$;""")
        print(json.dumps({
          "result":"PASS",
          "mode":"DISPOSABLE_PG16_AND_NODE_BOTH_NETWORK_NONE",
          "consumerAuthenticatedAsSeparatePgRole":True,
          "oneScopedEventSelected":True,
          "signedReceiptInsertedOnce":True,
          "duplicateReceiptRejected":True,
          "cryptographicSignatureVerifiedFromIndependentFixtureReadback":True,
          "subscriberRoleRevoked":True,"auditReceiptPreserved":True,
          "realCstDevSubscriberDeliveryVerified":False,
          "fourAgentIndependentFinalAckVerified":False,
          "devDbTouched":False,"prodDbTouched":False,
        },sort_keys=True))
    finally:
        if made:
            subprocess.run(["docker","rm","-f","-v",PGCON],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
        subprocess.run(["docker","rm","-f",NODECON],
                       stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
        shutil.rmtree(temp,ignore_errors=True)

if __name__=="__main__":
    main()
