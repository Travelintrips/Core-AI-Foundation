#!/usr/bin/env python3
"""Network-none PostgreSQL16 test of the independent one-job subscriber RLS.

NEVER CONNECTS TO REAL CST-DEV OR PROD. Never creates a real credential.
Only the approved model job/event is visible to an independent reader.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
APPLY = ROOT / "scripts/dev/cst-team-onejob-independent-subscriber-role-template.sql"
ROLLBACK = ROOT / "scripts/dev/cst-team-onejob-independent-subscriber-rollback-template.sql"
IMAGE = "postgres:16-alpine"
NAME = "cst-onejob-subscriber-rls-qa-20261120"
DATABASE = "cst_onejob_subscriber_qa_fixture"
ROLE = "cst_team_onejob_subscriber_20261120_abcdef12"
SUBSCRIBER = "cst-dev-onejob-subscriber-20261120-abcdef12"
REQUEST = "cst-ai-team-company1-dev:pilot-" + "a"*20
EVENT = "25745d53-9c8d-46ae-8afc-62bfbba92711"
OTHER_EVENT = "25745d53-9c8d-46ae-8afc-62bfbba92712"
CORRELATION = "24a5dc22-318b-42b4-aaed-a7c84e24cd21"
WORKER = "991"
JOB = "483"
PIN = "f"*64
SIGNATURE = "A"*86 + "=="

def run(args, stdin=None, timeout=35):
    p=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("COMMAND_FAILED:" + args[0] + ": " +
                           (p.stderr[-1400:] or p.stdout[-500:]))
    return p.stdout

def psql(sql):
    return run(["docker","exec","-i",NAME,"psql","-v","ON_ERROR_STOP=1",
                "-U","postgres","-d",DATABASE],sql)

def sqlquote(s):
    return "'" + s.replace("'","''") + "'"

def render(path, expiry):
    values={
        "EXPECTED_DATABASE":DATABASE,"SUBSCRIBER_ROLE":ROLE,
        "SUBSCRIBER_PASSWORD":secrets.token_hex(32),
        "SUBSCRIBER_ID":SUBSCRIBER,"REQUEST_ID":REQUEST,
        "JOB_ID":JOB,"WORKER_ID":WORKER,
        "EXPECTED_PUBLIC_KEY_SHA256":PIN,"EXPIRES":expiry,
    }
    s=path.read_text()
    for key,value in values.items():
        s=s.replace("{{"+key+"}}",value)
    assert "{{" not in s and "}}" not in s, "Unexpanded migration placeholder"
    assert "nzdweipzckfszczzqtuw" not in s
    return s

def receipt_details():
    payload={
      "version":1,"type":"CST_DEV_JOB_COMPLETED_SUBSCRIBER_RECEIPT",
      "project":"xssrfshdrtdfupgqwfdw","companyId":"1",
      "eventId":EVENT,"jobId":int(JOB),"jobCode":"APPROVED-ONE",
      "requestId":REQUEST,"workerId":int(WORKER),
      "correlationId":CORRELATION,"subscriberId":SUBSCRIBER,
      "deliveryState":"delivered",
      "receivedAt":datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00","Z"),
      "nonce":"c"*32,
    }
    return json.dumps({"payload":payload,"signatureBase64":SIGNATURE,
                       "publicKeySha256":PIN},separators=(",",":"))

def main():
    for path in [APPLY, ROLLBACK]:
        if not path.is_file(): raise RuntimeError("MISSING_TEMPLATE")
    already=subprocess.run(["docker","inspect",NAME],capture_output=True)
    if already.returncode==0: raise RuntimeError("DISPOSABLE_CONTAINER_NAME_OCCUPIED")
    launched=False
    try:
        run(["docker","run","-d","--rm","--name",NAME,"--network","none",
             "--memory","320m","--cpus","1","--pids-limit","100",
             "-e","POSTGRES_DB="+DATABASE,
             "-e","POSTGRES_HOST_AUTH_METHOD=trust",IMAGE])
        launched=True
        for _ in range(75):
            logs=run(["docker","logs",NAME],timeout=5)
            # Docker returns initialization logs on stderr in a number of versions.
            p=subprocess.run(["docker","exec",NAME,"psql","-At","-U","postgres",
                              "-d",DATABASE,"-c","SELECT 1"],capture_output=True,text=True,timeout=5)
            if p.returncode==0 and p.stdout.strip()=="1":
                if "PostgreSQL init process complete" in logs or _>5:
                    break
            time.sleep(0.25)
        else: raise RuntimeError("ISOLATED_POSTGRES_NOT_READY")

        fixture = """
CREATE ROLE dev_gpt02_relock_catalog_auditor NOLOGIN;
CREATE ROLE aicore_dev_runtime NOLOGIN;
CREATE SCHEMA ai_platform;
CREATE TABLE ai_platform.ai_jobs(
 id integer PRIMARY KEY, job_code text UNIQUE, status text,
 job_type text, required_capability text, payload_json jsonb);
CREATE TABLE ai_platform.ai_events(
 event_id text UNIQUE NOT NULL, event_type text,source_module text,
 source_id text,status text,correlation_id text,payload_json jsonb);
CREATE TABLE ai_platform.ai_audit_logs(
 id SERIAL PRIMARY KEY,module text,action text,resource_id text,
 resource_type text,status text,actor_id text,actor_type text,
 tenant_id text,details jsonb);
ALTER TABLE ai_platform.ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_platform.ai_audit_logs ENABLE ROW LEVEL SECURITY;
"""
        psql(fixture)
        psql(
          "INSERT INTO ai_platform.ai_jobs VALUES " +
          "(" + JOB + ",'APPROVED-ONE','queued','ollama_model_invocation'," +
          "'ollama_inference',"+sqlquote(json.dumps({"requestId":REQUEST,"modelId":"qwen2.5:3b"}))+"::jsonb),"+
          "(484,'OTHER-COMPANY','queued','ollama_model_invocation'," +
          "'ollama_inference','{\"requestId\":\"cst-ai-team-company3-dev:other\"}'::jsonb);"
        )
        expiry=(datetime.now(timezone.utc)+timedelta(minutes=30)).isoformat()
        psql(render(APPLY,expiry))
        # Simulate the previously authorized model-job completion, performed by
        # privileged fixture owner, BEFORE any dedicated subscriber is started.
        psql(
          "UPDATE ai_platform.ai_jobs SET status='completed' WHERE id="+JOB+";"+
          "INSERT INTO ai_platform.ai_events VALUES "+
          "("+sqlquote(EVENT)+",'job.completed','job-engine',"+sqlquote(JOB)+
          ",'published',"+sqlquote(CORRELATION)+","+
          sqlquote(json.dumps({"jobId":int(JOB),"workerId":int(WORKER),
                       "jobType":"ollama_model_invocation","jobCode":"APPROVED-ONE"}))+"::jsonb),"+
          "("+sqlquote(OTHER_EVENT)+",'job.completed','job-engine','484',"+
          "'published','other-correlation',"+
          "'{\"jobId\":484,\"workerId\":998,\"jobType\":\"ollama_model_invocation\"}'::jsonb);"
        )
        details=receipt_details()
        insert="INSERT INTO ai_platform.ai_audit_logs(module,action,resource_id,"+\
          "resource_type,status,actor_id,actor_type,tenant_id,details) VALUES ("+\
          " 'cst-team-model-subscriber','job_completed_received',"+sqlquote(EVENT)+\
          ",'ai_event','success',"+sqlquote(SUBSCRIBER)+\
          ",'independent-subscriber','1',"+sqlquote(details)+"::jsonb);"
        negative=insert.replace(sqlquote(EVENT)+",'ai_event'",sqlquote(OTHER_EVENT)+",'ai_event'")
        malformed=insert.replace("'independent-subscriber','1'", "'independent-subscriber','3'")
        psql("SET ROLE "+ROLE+";\n"+
        """DO $check$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM ai_platform.ai_events;
 IF n<>1 THEN RAISE EXCEPTION 'EVENT_RLS_LEAK'; END IF;
 IF has_table_privilege(current_user,'ai_platform.ai_events','UPDATE')
   OR has_table_privilege(current_user,'ai_platform.ai_events','INSERT')
   OR has_table_privilege(current_user,'ai_platform.ai_audit_logs','SELECT')
   OR has_table_privilege(current_user,'ai_platform.ai_jobs','SELECT')
 THEN RAISE EXCEPTION 'SUBSCRIBER_ROLE_OVERPRIVILEGED'; END IF;
END $check$;
"""+
        """DO $negative$
BEGIN
 BEGIN
""" + negative + """
  RAISE EXCEPTION 'WRONG_JOB_RECEIPT_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
""" + malformed + """
  RAISE EXCEPTION 'WRONG_COMPANY_RECEIPT_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $negative$;
""" + insert +
        """DO $duplicate$
BEGIN
 BEGIN
""" + insert + """
  RAISE EXCEPTION 'DUPLICATE_RECEIPT_ALLOWED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $duplicate$;
RESET ROLE;
""")
        summary=psql("""DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM ai_platform.ai_audit_logs
     WHERE module='cst-team-model-subscriber'
       AND action='job_completed_received')<>1
 THEN RAISE EXCEPTION 'RECEIPT_ONCE_COUNT_MISMATCH'; END IF;
 IF (SELECT count(*) FROM ai_platform.ai_events)<>2
 THEN RAISE EXCEPTION 'PUBLISHER_EVENTS_MODIFIED'; END IF;
END $postcheck$;""")
        psql(render(ROLLBACK,expiry))
        psql("""DO $cleanup$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cst_team_onejob_subscriber_20261120_abcdef12')
 THEN RAISE EXCEPTION 'SUBSCRIBER_ROLE_NOT_REVOKED'; END IF;
 IF (SELECT count(*) FROM ai_platform.ai_audit_logs WHERE
      module='cst-team-model-subscriber'
      AND action='job_completed_received')<>1
 THEN RAISE EXCEPTION 'APPEND_ONLY_RECEIPT_LOST'; END IF;
END $cleanup$;""")
        print(json.dumps({
          "result":"PASS",
          "test":"CST_ONEJOB_INDEPENDENT_SUBSCRIBER_ONE_EVENT_RLS_IMMUTABLE_RECEIPT",
          "environment":"postgres16_network_none_disposable",
          "authorizedEventVisible":True,"unrelatedEventHidden":True,
          "wrongJobAndCompanyDenied":True,"duplicateReceiptDenied":True,
          "subscriberRoleRevoked":True,"auditReceiptPreserved":True,
          "signatureOnlySyntacticallyChecked":True,
          "cryptographicSignatureAndRealDeliveryVerified":False,
          "devDatabaseTouched":False,"prodDatabaseTouched":False,
          "operationalAuthority":False,
        },sort_keys=True))
    finally:
        if launched:
            subprocess.run(["docker","rm","-f",NAME],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=25)

if __name__=="__main__":
    main()
