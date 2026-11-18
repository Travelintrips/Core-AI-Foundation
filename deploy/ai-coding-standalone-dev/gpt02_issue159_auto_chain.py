from __future__ import annotations
import json,os,subprocess,time
from pathlib import Path
from gpt02_issue159_approval_request_refresh import _socket_fact_reader
from gpt02_issue159_hub_core_signer_guard import assemble_verified_operator_link

APP=Path('/opt/ai-coding-standalone-dev')
APPROVED=APP/'gpt02_issue159_approved_claims.json'
LINK=APP/'gpt02_issue159_hub_core_link_claims.json'

class AutoChainError(RuntimeError): pass

# systemd manager message IDs, not service-generated stdout. Journal trusted
# fields (_PID, UNIT, JOB_ID and the boot ID) bind proof to this start job.
_SYSTEMD_STARTING_ID = '7d4958e842da4a758f6c1cdc7b36dcc5'
_SYSTEMD_FINISHED_ID = '39f53479d3a045ac8e11786248231fbf'

def _fresh_oneshot_manager_proof(name:str, start_us:int, end_us:int,
                                 *, run=subprocess.run)->bool:
    """Fail closed unless PID 1 logged a new start AND finished job.

    An inactive Type=oneshot unit may be immediately garbage-collected by
    systemd: ConditionResult=no and zero ExecMain timestamps then appear
    even after a successful invocation. Conversely, ConditionResult=yes and
    Result=success may be stale from a previous invocation. The same-boot,
    same-job manager journal pair is authoritative for this bounded window.
    Nothing here opens a signer, connects to a DB, or grants dispatch.
    """
    if (type(start_us) is not int or type(end_us) is not int
            or start_us <= 0 or end_us < start_us):
        return False
    try:
        r=run(['journalctl','--boot','--unit',name,'--no-pager',
               '--output=json','--lines=64'],
              capture_output=True,text=True,timeout=5)
        if (r.returncode!=0 or type(r.stdout) is not str
                or len(r.stdout)>262144):
            return False
        starting,finished={},{}
        for line in r.stdout.splitlines():
            if not 0<len(line)<=16384:
                continue
            try:
                entry=json.loads(line)
                if (type(entry) is not dict
                        or str(entry.get('_PID'))!='1'
                        or entry.get('UNIT')!=name
                        or entry.get('JOB_TYPE')!='start'
                        or not isinstance(entry.get('JOB_ID'),str)
                        or not isinstance(entry.get('_BOOT_ID'),str)):
                    continue
                timestamp=int(entry['__MONOTONIC_TIMESTAMP'])
            except (ValueError,KeyError,TypeError):
                continue
            if not start_us<=timestamp<=end_us:
                continue
            job=(entry['_BOOT_ID'],entry['JOB_ID'])
            message=entry.get('MESSAGE')
            if entry.get('MESSAGE_ID')==_SYSTEMD_STARTING_ID:
                starting[job]=timestamp
            elif (entry.get('MESSAGE_ID')==_SYSTEMD_FINISHED_ID
                  and entry.get('JOB_RESULT')=='done'
                  and isinstance(message,str)
                  and (message.startswith('Finished '+name+' ')
                       or message=='Finished '+name+'.')):
                finished[job]=timestamp
        return any(job in finished and started<=finished[job]
                   for job,started in starting.items())
    except (OSError,subprocess.SubprocessError):
        return False

def _reset_failed(*names:str):
    subprocess.run(['systemctl','reset-failed',*names],capture_output=True,text=True,timeout=5)

def _unit(name:str):
    # For ConditionPathExists=, systemctl start may return 0 even when the
    # oneshot did NOT execute; old Result=success and ExecMainStatus=0 can
    # also remain from a previous invocation. Require the condition result.
    code=name.replace('.','_').replace('@','_AT_').upper()
    try:
        subprocess.run(['systemctl','reset-failed',name],
                       capture_output=True,text=True,timeout=5)
        started_us=time.monotonic_ns()//1000
        r=subprocess.run(['systemctl','start',name],
                         capture_output=True,text=True,timeout=25)
        ended_us=time.monotonic_ns()//1000
        if r.returncode!=0:
            raise AutoChainError('UNIT_FAILED_'+code)
        q=subprocess.run(
            ['systemctl','show',name,
             '-p','LoadState','-p','ConditionResult',
             '-p','Result','-p','ExecMainStatus','-p','ActiveState',
             '--no-pager'],
            capture_output=True,text=True,timeout=5)
    except (subprocess.SubprocessError, OSError) as exc:
        raise AutoChainError('UNIT_SYSTEMD_UNAVAILABLE_'+code) from exc
    if q.returncode!=0:
        raise AutoChainError('UNIT_RESULT_UNAVAILABLE_'+code)
    lines=[line.strip() for line in q.stdout.splitlines() if line.strip()]
    if any(line.count('=')!=1 for line in lines):
        raise AutoChainError('UNIT_RESULT_INVALID_'+code)
    state=dict(line.split('=',1) for line in lines)
    required={'LoadState','ConditionResult','Result','ExecMainStatus','ActiveState'}
    if set(state)!=required:
        raise AutoChainError('UNIT_RESULT_INVALID_'+code)
    if state['ConditionResult'] not in ('yes','no'):
        raise AutoChainError('UNIT_CONDITION_UNAVAILABLE_'+code)
    if (state['LoadState']!='loaded' or state['Result']!='success'
            or state['ExecMainStatus']!='0'
            or state['ActiveState']!='inactive'):
        raise AutoChainError('UNIT_RESULT_INVALID_'+code)
    # A skipped condition, including a cached Result=success/exit=0, never
    # produces a matching PID-1 Starting/Finished job pair. Legitimate
    # garbage-collected oneshots are accepted only with the fresh pair.
    if not _fresh_oneshot_manager_proof(name,started_us,ended_us,
                                        run=subprocess.run):
        raise AutoChainError('UNIT_FRESH_EXECUTION_UNPROVEN_'+code)

def _write_link(link:dict):
    # Operator link evidence is one-use, like the approved claims and
    # signer output. Never clear another task's temporary file or overwrite
    # an existing link: the original signer/attestor chain must fail closed.
    if not isinstance(link,dict):
        raise AutoChainError('VERIFIED_OPERATOR_LINK_INVALID')
    tmp=APP/'.gpt02_issue159_hub_core_link_claims.json.auto.tmp'
    try:
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
    except FileExistsError as exc:
        raise AutoChainError('VERIFIED_OPERATOR_LINK_TEMP_OCCUPIED') from exc
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(link,f,sort_keys=True,separators=(',',':'))
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp,0o600)
        if os.geteuid()==0:
            os.chown(tmp,0,0)
        # Exclusive creation, not os.replace: preserved evidence cannot
        # silently be reused, overwritten, or redirected through a symlink.
        try:
            os.link(tmp,LINK)
        except FileExistsError as exc:
            raise AutoChainError('VERIFIED_OPERATOR_LINK_OUTPUT_OCCUPIED') from exc
        dirfd=os.open(APP,os.O_DIRECTORY|os.O_RDONLY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    finally:
        # Delete only the temporary inode created by this invocation.
        tmp.unlink(missing_ok=True)

def run_after_approval(expected_task_id:int)->dict:
    # Do not mutate even the systemd failure state for an unbound, malformed
    # or stale one-use approval. Verify the packet before touching units.
    packet=json.loads(APPROVED.read_text('utf-8'))
    claims=packet.get('claims')
    if not isinstance(claims,dict) or claims.get('taskId')!=expected_task_id:
        raise AutoChainError('APPROVED_TASK_BINDING_MISMATCH')
    now=int(time.time()*1000)
    if claims.get('expiresAt',0)-now<30000:
        raise AutoChainError('APPROVAL_NOT_FRESH_ENOUGH_FOR_AUTO_CHAIN')

    _reset_failed(
      'gpt02-issue159-sign-once-approval.service',
      'gpt02-issue159-sign-once-operator@hub.service',
      'gpt02-issue159-sign-once-operator@core.service',
      'gpt02-issue159-attestor-record-once.service',
      'gpt02-issue159-sign-once-issuer.service',
      'gpt02-issue159-issuer-finalize-once.service')

    _unit('gpt02-issue159-sign-once-approval.service')
    if not Path('/run/gpt02-issue159-sign-once-approval/approval-signature.json').is_file():
        raise AutoChainError('APPROVAL_SIGNATURE_MISSING')

    facts=_socket_fact_reader({
        'companyId':claims['companyId'],'hubTaskId':claims['taskId'],
        'commandCandidateId':claims['commandId'],'attemptId':claims['attemptId']})
    link=assemble_verified_operator_link(claims,facts,now_ms=int(time.time()*1000))
    _write_link(link)

    _unit('gpt02-issue159-sign-once-operator@hub.service')
    _unit('gpt02-issue159-sign-once-operator@core.service')
    if not Path('/run/gpt02-issue159-sign-once-hub/hub-signature.json').is_file():
        raise AutoChainError('HUB_SIGNATURE_MISSING')
    if not Path('/run/gpt02-issue159-sign-once-core/core-signature.json').is_file():
        raise AutoChainError('CORE_SIGNATURE_MISSING')

    _unit('gpt02-issue159-attestor-record-once.service')
    subprocess.run(['systemctl','reset-failed','gpt02-issue159-sign-once-issuer.service'],
                   capture_output=True,text=True,timeout=5)
    subprocess.run(['systemctl','reset-failed','gpt02-issue159-issuer-finalize-once.service'],
                   capture_output=True,text=True,timeout=5)
    _unit('gpt02-issue159-issuer-finalize-once.service')

    return {
      'environment':'DEV','taskId':expected_task_id,'autoChainCompleted':True,
      'authorizationGranted':False,'dispatchPermitted':False,'releaseDecision':'NO_GO'
    }
