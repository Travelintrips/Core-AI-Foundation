#!/usr/bin/env python3
"""Bounded concurrent GPT02 DEV readiness, read-only; no approval, signing or dispatch.
Three existing protected credentials; one connection per role; always relock.
"""
import os,sys,re,json,stat,time,subprocess
from datetime import datetime,timezone,timedelta
from pathlib import Path
from urllib.parse import urlsplit,unquote,parse_qs
import psycopg
from psycopg import sql
REF="xssrfshdrtdfupgqwfdw"
POOLER="aws-1-ap-southeast-2.pooler.supabase.com"
CA="/etc/gpt02-dev/supabase-root-ca-2021.crt"
SERVICE="gpt02-issue159-issuer-reader.service"
SOCKET="/run/gpt02-issuer-reader/reader.sock"
LOCK="gpt02-three-identity-readiness-20261117"
CONFIG=[
 ("attestor","dev_gpt02_attestor_evidence",1,"db."+REF+".supabase.co",48),
 ("issuer","dev_gpt02_issuer_evidence",4,"db."+REF+".supabase.co",48),
 ("issuer-reader","gpt02_issuer_evidence_reader",0,POOLER,64)
]
admin=None;clients=[];armed=False;mutex=False;failure=None;baselines={};ledger_before=None;reader_start_attempted=False
def emit(event,**data):print("GPT02_3ROLE_"+event,json.dumps(data,sort_keys=True),flush=True)
def check(ok,code):
 if not ok:raise RuntimeError(code)
def public_error(e):
 return e.args[0] if isinstance(e,RuntimeError) else (getattr(e,"sqlstate",None) or type(e).__name__)
def run(cmd,timeout=12,check_exit=True):
 v=subprocess.run(cmd,capture_output=True,timeout=timeout)
 if check_exit and v.returncode:raise RuntimeError("LOCAL_SYSTEMD_COMMAND_FAILED")
 return v
def require_writer_slot_drained(admin, role, label, *, timeout_seconds=10,
                                monotonic=time.monotonic, sleep=time.sleep):
    """Wait only a bounded time for a closed TLS backend to leave pg_stat_activity.

    Must reach zero *before* a downstream one-shot can safely take this
    role's single allowed connection. Never expand grants or connection limits.
    """
    if role not in ("dev_gpt02_attestor_evidence", "dev_gpt02_issuer_evidence"):
        raise RuntimeError("WRITER_HANDOFF_UNEXPECTED_ROLE")
    if type(timeout_seconds) not in (int, float) or timeout_seconds <= 0 or timeout_seconds > 10:
        raise RuntimeError("WRITER_HANDOFF_TIMEOUT_INVALID")
    deadline = monotonic() + timeout_seconds
    while True:
        sessions = admin.execute(
            "SELECT count(*) FROM pg_stat_activity WHERE usename=%s",
            (role,),
        ).fetchone()[0]
        if sessions == 0:
            return
        if monotonic() >= deadline:
            raise RuntimeError("WRITER_SESSION_NOT_RELEASED_AFTER_HANDOFF_" + label)
        sleep(.25)


def require_no_untracked_catalog_window(admin):
    """Refuse the obsolete writer handoff if the independent relock catalog exists.

    This legacy probe opens short-lived writer identities but does NOT register
    task-bound issuance watchdog rows. With an installed independent relock
    supervisor, using the old path could leave a LOGIN role untracked if the
    main process is killed. Refuse before any ALTER ROLE, unit start, or client
    session; do not treat an absent/ambiguous catalog response as permission.
    A future supervised probe must register its exact rows atomically before
    opening roles, rather than bypassing this check.
    """
    row = admin.execute(
        "SELECT to_regclass('gpt02_relock_audit.writer_issuance_watchdog') IS NOT NULL"
    ).fetchone()
    if row != (False,):
        raise RuntimeError("WRITER_HANDOFF_RELOCK_WATCHDOG_REGISTRATION_REQUIRED")


def credential(name,role,host,pw_len):
 f="/etc/credstore.encrypted/gpt02-issue159-"+name+"-dsn"
 statf=os.lstat(f)
 check(stat.S_ISREG(statf.st_mode) and statf.st_uid==0 and stat.S_IMODE(statf.st_mode)==0o600,"CREDENTIAL_CUSTODY_INVALID_"+name)
 data=run(["systemd-creds","decrypt","--name="+name+"-dsn",f],timeout=9).stdout.decode().strip()
 u=urlsplit(data);q=parse_qs(u.query)
 pw=unquote(u.password or "")
 check(u.hostname==host and u.port==5432 and u.path=="/postgres" and not u.fragment,"CREDENTIAL_TARGET_INVALID_"+name)
 check(unquote(u.username or "") in (role,role+"."+REF),"CREDENTIAL_USER_INVALID_"+name)
 if name=="issuer-reader":
  check(bool(re.fullmatch("[0-9a-f]{64}",pw)) and not u.query,"CREDENTIAL_FORMAT_INVALID_"+name)
 else:
  check(bool(re.fullmatch("[A-Za-z0-9_-]{48}",pw)) and set(q)=={"sslmode","sslrootcert"}
        and q["sslmode"]==["verify-full"] and q["sslrootcert"]==[CA],"CREDENTIAL_FORMAT_INVALID_"+name)
 return data,pw
def history():
 return admin.execute("""SELECT
  (SELECT count(*) FROM gpt02_private.approvals),
  (SELECT count(*) FROM gpt02_private.receipts),
  (SELECT count(*) FROM gpt02_private.issuer_evidences),
  (SELECT count(*) FROM gpt02_private.issuer_lease_consumptions),
  (SELECT count(*) FROM gpt02_stage.core_preparations WHERE hub_task_id IN(170,171))
 """).fetchone()
try:
 check(os.geteuid()==0,"ROOT_DEV_READONLY_TEST_OPERATOR_REQUIRED")
 check(os.environ.get("GPT02_ISSUE159_WRITER_HANDOFF_READONLY")=="explicit-readonly",
       "HANDOFF_READONLY_EXPLICIT_OPT_IN_REQUIRED")
 check(os.environ.get("NODE_ENV")=="development" and os.environ.get("APP_ENV")=="development","EXPLICIT_DEV_MODE_REQUIRED")
 check(os.environ.get("PUBLIC_APP_BASE_URL","").rstrip("/")=="https://dev-ai-task.cstlogistic.co.id","BASE_URL_CHANGED")
 raw=os.environ.get("SUPABASE_DATABASE_URL_DEV","")
 a=urlsplit(raw)
 check(a.hostname==POOLER and a.port==5432 and a.path=="/postgres" and
    unquote(a.username or "")=="postgres."+REF and not a.query and not a.fragment,"WRONG_DEV_ADMIN_TARGET")
 check(Path(CA).is_file(),"PINNED_CA_UNAVAILABLE")
 check(run(["systemctl","is-active",SERVICE],check_exit=False).stdout.decode().strip() in ("inactive","failed"),"ISSUER_READER_ALREADY_RUNNING")
 check(not os.path.lexists(SOCKET),"ISSUER_READER_SOCKET_ALREADY_EXISTS")
 data={}
 for name,role,functions,host,pw_len in CONFIG:
  d,p=credential(name,role,host,pw_len)
  data[role]=(d,p)
 emit("CREDENTIAL_TARGETS_PINNED",roles=3,serverOnly=True)
 admin=psycopg.connect(raw,autocommit=True,sslmode="verify-full",sslrootcert=CA,connect_timeout=8,application_name="gpt02-readiness-three-roles")
 check(admin.execute("SELECT current_database(),current_user,session_user").fetchone()==("postgres","postgres","postgres"),"WRONG_ADMIN_SESSION")
 mutex=admin.execute("SELECT pg_try_advisory_lock(hashtextextended(%s,0))",(LOCK,)).fetchone()[0]
 check(mutex is True,"OTHER_SUPERVISED_READINESS_ACTIVE")
 ledger_before=history()
 for name,role,functions,host,pw_len in CONFIG:
  r=admin.execute("""SELECT rolcanlogin,rolconnlimit,rolpassword IS NULL,
  rolinherit,rolsuper,rolbypassrls,rolvaliduntil
  FROM pg_authid WHERE rolname=%s""",(role,)).fetchone()
  check(r is not None and r[:6]==(False,0,True,False,False,False),"DORMANT_ROLE_BASELINE_CHANGED_"+name)
  baselines[role]=r[6]
  count=admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename=%s",(role,)).fetchone()[0]
  check(count==0,"PREEXISTING_SESSION_"+name)
  writes=admin.execute("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT LIKE 'pg_%%' AND n.nspname<>'information_schema'
    AND c.relkind IN('r','p','f','m','v')
    AND (has_table_privilege(%s,c.oid,'INSERT') OR
    has_table_privilege(%s,c.oid,'UPDATE') OR
    has_table_privilege(%s,c.oid,'DELETE') OR has_table_privilege(%s,c.oid,'TRUNCATE'))""",(role,role,role,role)).fetchone()[0]
  check(writes==0,"DIRECT_WRITE_SURFACE_PRESENT_"+name)
  num=admin.execute("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE p.prosecdef AND n.nspname='gpt02_private'
   AND has_schema_privilege(%s,n.oid,'USAGE')
   AND has_function_privilege(%s,p.oid,'EXECUTE')""",(role,role)).fetchone()[0]
  check(num==functions,"PRIVILEGED_RPC_SCOPE_DRIFT_"+name)
 emit("BASELINE_PASS",roleCount=3,directWritePrivileges=0,ledgerConsistent=True)
 # This legacy probe has no independent watchdog enrollment. A live catalog
 # must fail closed BEFORE the first role-login transaction.
 require_no_untracked_catalog_window(admin)
 # Cleanup armed before the transaction that unlocks any role.
 armed=True
 until=(datetime.now(timezone.utc)+timedelta(seconds=115)).isoformat()
 with admin.transaction():
  for name,role,functions,host,pw_len in CONFIG:
   admin.execute(sql.SQL("ALTER ROLE {} LOGIN CONNECTION LIMIT 1 PASSWORD {} VALID UNTIL {}").format(
        sql.Identifier(role),sql.Literal(data[role][1]),sql.Literal(until)))
 emit("BOUNDED_LOGIN_ACTIVE",roles=3,connectionLimitPerRole=1,expirySeconds=115,grantsAdded=0)
 for name,role,functions,host,pw_len in CONFIG[:2]:
  client=psycopg.connect(data[role][0],autocommit=True,connect_timeout=8,
                application_name="gpt02-"+name+"-concurrent-readonly")
  clients.append(client)
  client.execute("BEGIN READ ONLY")
  r=client.execute("""SELECT current_user,session_user,current_setting('transaction_read_only'),
           (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())""").fetchone()
  check(r==(role,role,"on",True),"WRITER_NATIVE_IDENTITY_TLS_FAILED_"+name)
  emit(name.upper()+"_CONCURRENT_SESSION_PASS",readOnly=True,tls=True,roleVerified=True)
 # systemctl reset-failed exits 1 when an inactive, healthy unit is not loaded.
 run(["systemctl","reset-failed",SERVICE],timeout=5,check_exit=False)
 reader_start_attempted=True
 run(["systemctl","start",SERVICE],timeout=8)
 for _ in range(35):
  if os.path.exists(SOCKET) and stat.S_ISSOCK(os.stat(SOCKET).st_mode):break
  time.sleep(.5)
 else:raise RuntimeError("ISSUER_READER_SOCKET_NOT_READY")
 h=run(["curl","--silent","--show-error","--fail","--max-time","14",
       "--unix-socket",SOCKET,"http://localhost/health"],timeout=18)
 payload=json.loads(h.stdout)
 check(payload.get("ok") is True and payload.get("readerReady") is True and
       payload.get("issuerRole")=="gpt02_issuer_evidence_reader" and
       payload.get("readOnly") is True and payload.get("tlsVerified") is True and
       payload.get("signingPermitted") is False and
       payload.get("authorizationGranted") is False and
       payload.get("dispatchPermitted") is False and
       payload.get("releaseDecision")=="NO_GO","ISSUER_NATIVE_HEALTH_UNTRUSTED")
 # Both writer read-only transactions are STILL OPEN during issuer health probe.
 checks=[]
 for name,role,functions,host,pw_len in CONFIG[:2]:
  a=admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename=%s",(role,)).fetchone()[0]
  checks.append(a==1)
 check(all(checks),"WRITER_SESSIONS_NOT_SIMULTANEOUS")
 check(history()==ledger_before,"LIFECYCLE_EVIDENCE_CHANGED_DURING_READONLY_TEST")
 emit("THREE_COMPONENTS_CONCURRENT_PASS",attestor=True,issuer=True,issuerReader=True,
      tlsVerified=True,readOnly=True,signingPermitted=False,dispatchPermitted=False)
 # This is the crucial writer handoff: preflight read-only sessions MUST NOT
 # occupy either writer role's one allowed connection when real attestor/
 # issuer systemd one-shots later request their own native connections.
 for client in clients:
  client.execute("ROLLBACK")
  client.close()
 clients.clear()
 for name,role,functions,host,pw_len in CONFIG[:2]:
  require_writer_slot_drained(admin,role,name)
 emit("WRITER_PREFLIGHT_SESSIONS_RELEASED",attestorActiveSessions=0,
      issuerActiveSessions=0,roleConnectionLimit=1)
 # Reacquire each existing writer identity in read-only mode, just as a
 # downstream one-shot would have to. No SECDEF RPCs or writes are invoked.
 for name,role,functions,host,pw_len in CONFIG[:2]:
  client=psycopg.connect(data[role][0],autocommit=True,connect_timeout=8,
                application_name="gpt02-"+name+"-handoff-readonly")
  try:
   client.execute("BEGIN READ ONLY")
   row=client.execute("SELECT current_user,session_user,current_setting('transaction_read_only'),"
                      "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid())").fetchone()
   check(row==(role,role,"on",True),"DOWNSTREAM_WRITER_IDENTITY_RECONNECT_FAILED_"+name)
   client.execute("ROLLBACK")
  finally:
   client.close()
  require_writer_slot_drained(admin,role,name)
  emit(name.upper()+"_DOWNSTREAM_RECONNECT_PASS",roleIdentity=role,readOnly=True,
       tlsVerified=True,activeSessionsAfter=0,connectionLimit=1)
 check(history()==ledger_before,"LEDGER_CHANGED_DURING_WRITER_CONNECTION_HANDOFF")
 emit("HANDOFF_WINDOW_READY_NO_APPROVAL",attestorWriterSlotFree=True,
      issuerWriterSlotFree=True,issuerReaderStillHealthy=True,
      signingPermitted=False,dispatchPermitted=False,ledgerUnchanged=True)
except Exception as e:
 failure=public_error(e)
 emit("INCOMPLETE",reason=str(failure)[:100])
finally:
 # A preflight denial must NEVER stop an already-running reader belonging
 # to another supervised test. Stop only if THIS invocation attempted start.
 if reader_start_attempted:
  try:
   run(["systemctl","stop",SERVICE],timeout=8)
  except Exception as e:
   emit("STOP_FAILED",reason=public_error(e));failure="SERVICE_STOP_FAILED"
 for c in clients:
  try:c.execute("ROLLBACK")
  except Exception:pass
  try:c.close()
  except Exception:pass
 if armed and admin is not None:
  try:
   with admin.transaction():
    for name,role,functions,host,pw_len in CONFIG:
     exp=baselines.get(role)
     clause=sql.SQL("") if exp is None else sql.SQL(" VALID UNTIL {}").format(sql.Literal(exp.isoformat()))
     admin.execute(sql.SQL("ALTER ROLE {} NOLOGIN CONNECTION LIMIT 0 PASSWORD NULL").format(sql.Identifier(role))+clause)
   for name,role,functions,host,pw_len in CONFIG:
    admin.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=%s AND pid<>pg_backend_pid()",(role,))
   for name,role,functions,host,pw_len in CONFIG:
    r=admin.execute("SELECT NOT rolcanlogin,rolconnlimit,rolpassword IS NULL FROM pg_authid WHERE rolname=%s",(role,)).fetchone()
    n=admin.execute("SELECT count(*) FROM pg_stat_activity WHERE usename=%s",(role,)).fetchone()[0]
    check(r==(True,0,True) and n==0,"ROLE_RELOCK_POSTCONDITION_FAILED_"+name)
   check(history()==ledger_before,"LIFECYCLE_EVIDENCE_CHANGED_AFTER_TEST")
   emit("ALL_ROLES_RELOCKED_PASS",roleCount=3,nologin=True,passwordsRemoved=True,activeSessions=0,ledgerUnchanged=True)
  except Exception as e:
   emit("CRITICAL_RELOCK_FAILURE",reason=public_error(e));failure="RELOCK_FAILURE"
 if mutex and admin is not None:
  try:admin.execute("SELECT pg_advisory_unlock(hashtextextended(%s,0))",(LOCK,))
  except Exception:pass
 if admin is not None:admin.close()
if failure:sys.exit(2)
