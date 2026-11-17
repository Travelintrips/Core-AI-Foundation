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
    subprocess.run(['systemctl','reset-failed',name],capture_output=True,text=True,timeout=5)
    r=subprocess.run(['systemctl','start',name],capture_output=True,text=True,timeout=25)
    if r.returncode!=0:
        raise AutoChainError('UNIT_FAILED_'+name.replace('.','_').replace('@','_AT_').upper())
    q=subprocess.run(['systemctl','show',name,'-p','Result','-p','ExecMainStatus','--value'],
                     capture_output=True,text=True,timeout=5)
    vals=[x.strip() for x in q.stdout.splitlines() if x.strip()]
    if 'success' not in vals or '0' not in vals:
        raise AutoChainError('UNIT_RESULT_INVALID_'+name.replace('.','_').replace('@','_AT_').upper())

def _write_link(link:dict):
    tmp=APP/'.gpt02_issue159_hub_core_link_claims.json.auto.tmp'
    if tmp.exists(): tmp.unlink()
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(link,f,sort_keys=True,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
        os.replace(tmp,LINK)
        os.chmod(LINK,0o600);os.chown(LINK,0,0)
    finally:
        if tmp.exists(): tmp.unlink()

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
