from __future__ import annotations
import json,os,subprocess,time
from pathlib import Path
from gpt02_issue159_approval_request_refresh import _socket_fact_reader
from gpt02_issue159_hub_core_signer_guard import assemble_verified_operator_link

APP=Path('/opt/ai-coding-standalone-dev')
APPROVED=APP/'gpt02_issue159_approved_claims.json'
LINK=APP/'gpt02_issue159_hub_core_link_claims.json'

class AutoChainError(RuntimeError): pass

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
        r=subprocess.run(['systemctl','start',name],
                         capture_output=True,text=True,timeout=25)
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
    if state['ConditionResult']!='yes':
        raise AutoChainError('UNIT_CONDITION_NOT_MET_'+code)
    if (state['LoadState']!='loaded' or state['Result']!='success'
            or state['ExecMainStatus']!='0'
            or state['ActiveState']!='inactive'):
        raise AutoChainError('UNIT_RESULT_INVALID_'+code)

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
    _reset_failed(
      'gpt02-issue159-sign-once-approval.service',
      'gpt02-issue159-sign-once-operator@hub.service',
      'gpt02-issue159-sign-once-operator@core.service',
      'gpt02-issue159-attestor-record-once.service',
      'gpt02-issue159-sign-once-issuer.service',
      'gpt02-issue159-issuer-finalize-once.service')
    packet=json.loads(APPROVED.read_text('utf-8'))
    claims=packet.get('claims')
    if not isinstance(claims,dict) or claims.get('taskId')!=expected_task_id:
        raise AutoChainError('APPROVED_TASK_BINDING_MISMATCH')
    now=int(time.time()*1000)
    if claims.get('expiresAt',0)-now<30000:
        raise AutoChainError('APPROVAL_NOT_FRESH_ENOUGH_FOR_AUTO_CHAIN')

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
