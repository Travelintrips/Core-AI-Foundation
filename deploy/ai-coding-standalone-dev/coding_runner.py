import json,subprocess,tempfile,os
from pathlib import Path
ROOT=Path('/opt/ai-coding-standalone-dev')
IMAGE='python:3.13-slim'
REPO='Travelintrips/Core-AI-Foundation'
def run(payload):
 if not isinstance(payload,dict): raise ValueError('invalid payload')
 if payload.get('repository')!=REPO or payload.get('ref')!='develop': raise ValueError('repository or branch not allowed')
 filename=payload.get('filename')
 source=payload.get('source')
 tests=payload.get('tests')
 if filename!='ai-coding-sandbox/solution.py': raise ValueError('file not allowlisted')
 if not isinstance(source,str) or len(source)>12000 or not isinstance(tests,str) or not 1<=len(tests)<=12000: raise ValueError('invalid source or tests')
 with tempfile.TemporaryDirectory(prefix='coding-',dir=str(ROOT)) as tmp:
  path=Path(tmp)
  path.chmod(0o755)
  (path/'solution.py').write_text(source)
  (path/'test_solution.py').write_text(tests)
  for name in ('solution.py','test_solution.py'): (path/name).chmod(0o644)
  cmd=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','128m','--cpus','0.5','--user','65534:65534','--tmpfs','/tmp:rw,noexec,nosuid,size=16m','--mount',f'type=bind,src={tmp},dst=/workspace,readonly','--workdir','/workspace',IMAGE,'python','-B','-I','-m','unittest','discover','-s','.','-p','test_*.py','-v']
  try: p=subprocess.run(cmd,capture_output=True,text=True,timeout=40)
  except subprocess.TimeoutExpired: return {'passed':False,'reason':'timeout','mode':'docker_isolated'}
  return {'passed':p.returncode==0,'exit_code':p.returncode,'test_output':(p.stdout+'\n'+p.stderr)[-3500:],'mode':'docker_isolated','network':'disabled','production_changes':False}
