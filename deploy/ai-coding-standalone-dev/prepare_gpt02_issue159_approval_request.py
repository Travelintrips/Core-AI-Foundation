#!/usr/bin/env python3
"""Prepare one short-lived DEV Issue159 approval request from a mapped admin.

Supabase Auth UUIDs are authentication subjects. Approval claims use the
AI Task Hub public.users operator subject. This producer requires exactly one
enabled local auth-to-Hub mapping and never creates tasks, signs, or dispatches.
"""
from __future__ import annotations
import argparse,json,os,re,secrets,sqlite3,stat,time
from pathlib import Path
from gpt02_issue159_approval_intent_contract import validate_approval_claims

LIVE_DB="/opt/ai-coding-standalone-dev/tasks.db"
LIVE_OUTPUT="/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json"
UUID=re.compile(r"^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$")

def prepare(db_path:str,output_path:str,task_id:int,command_id:str,attempt_id:str,
            *,now_ms:int|None=None,operational:bool=True)->dict:
    if operational:
        if db_path!=LIVE_DB or output_path!=LIVE_OUTPUT or os.geteuid()!=0:
            raise RuntimeError("ISSUE159_PREPARE_TARGET_NOT_PINNED")
        st=os.lstat(db_path)
        if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
                or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
            raise RuntimeError("ISSUE159_TASK_DB_SECURITY_INVALID")
    if not isinstance(task_id,int) or task_id<=139:
        raise RuntimeError("ISSUE159_FRESH_TASK_AFTER_139_REQUIRED")
    if (not isinstance(command_id,str) or not UUID.fullmatch(command_id)
            or not isinstance(attempt_id,str) or not UUID.fullmatch(attempt_id)
            or command_id==attempt_id):
        raise RuntimeError("ISSUE159_COMMAND_ATTEMPT_ID_INVALID")
    if os.path.lexists(output_path):
        raise RuntimeError("ISSUE159_PENDING_REQUEST_ALREADY_EXISTS")

    con=sqlite3.connect(f"file:{db_path}?mode=ro",uri=True,timeout=2)
    try:
        con.execute("PRAGMA query_only=ON")
        rows=con.execute("""
          SELECT l.hub_operator_id
          FROM gpt02_issue159_admin_operator_links l
          JOIN admin_identities a ON a.user_id=l.auth_user_id
          WHERE l.enabled=1 AND a.enabled=1 AND a.role='super_admin'
          ORDER BY l.hub_operator_id
        """).fetchall()
    except sqlite3.Error as exc:
        raise RuntimeError("ISSUE159_ADMIN_OPERATOR_MAPPING_LOOKUP_FAILED") from exc
    finally:
        con.close()
    if len(rows)!=1 or not rows[0][0]:
        raise RuntimeError("ISSUE159_ACTIVE_ADMIN_OPERATOR_MAPPING_NOT_UNIQUE")
    actor_id=rows[0][0]

    if now_ms is None: now_ms=int(time.time()*1000)
    if not isinstance(now_ms,int) or now_ms<=0:
        raise RuntimeError("ISSUE159_APPROVAL_TIME_INVALID")
    claims={
      "v":2,"environment":"DEV",
      "audience":"GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
      "taskId":task_id,"commandId":command_id,"attemptId":attempt_id,
      "nonce":secrets.token_urlsafe(33),
      "operatorNamespace":"ai-task-hub.public.users",
      "superAdminId":actor_id,"companyId":"default",
      "issuedAt":now_ms,"expiresAt":now_ms+240_000,
    }
    validate_approval_claims(claims)

    target=Path(output_path); parent=target.parent
    pst=os.stat(parent)
    if operational and (pst.st_uid!=0 or pst.st_gid!=0):
        raise RuntimeError("ISSUE159_PENDING_DIRECTORY_OWNER_INVALID")
    tmp=parent/("."+target.name+".tmp")
    fd=os.open(str(tmp),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        payload=(json.dumps({"claims":claims},sort_keys=True,separators=(",",":"))+"\n").encode()
        os.write(fd,payload); os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(tmp,0o600)
    if operational: os.chown(tmp,0,0)
    try:
        os.link(tmp,target)
    except FileExistsError as exc:
        os.unlink(tmp)
        raise RuntimeError("ISSUE159_PENDING_REQUEST_ALREADY_EXISTS") from exc
    os.unlink(tmp)
    return {
      "environment":"DEV","taskId":task_id,"expiresAt":claims["expiresAt"],
      "pendingRequestCreated":True,"signingPermitted":False,
      "authorizationGranted":False,"dispatchPermitted":False,
      "releaseDecision":"NO_GO",
    }

def main()->int:
    p=argparse.ArgumentParser()
    p.add_argument("--task-id",required=True,type=int)
    p.add_argument("--command-id",required=True)
    p.add_argument("--attempt-id",required=True)
    p.add_argument("--test-mode",action="store_true")
    p.add_argument("--db",default=LIVE_DB)
    p.add_argument("--output",default=LIVE_OUTPUT)
    a=p.parse_args()
    print(json.dumps(prepare(a.db,a.output,a.task_id,a.command_id,a.attempt_id,
                             operational=not a.test_mode),sort_keys=True))
    return 0

if __name__=="__main__":
    try: raise SystemExit(main())
    except Exception as exc:
        print(str(exc),file=__import__("sys").stderr); raise SystemExit(2)
