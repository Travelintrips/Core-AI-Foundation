import os, subprocess
ALLOWED={'Travelintrips/Core-AI-Foundation':('/opt/core-ai-dev','develop')}
def inspect(repo,ref='develop'):
 if repo not in ALLOWED: raise ValueError('repository not allowlisted')
 path,allowed_ref=ALLOWED[repo]
 if ref!=allowed_ref: raise ValueError('ref not allowlisted')
 def git(*args):
  return subprocess.check_output(['git','-C',path,*args],text=True,timeout=15).strip()
 actual=git('branch','--show-current')
 if actual!=allowed_ref: raise RuntimeError('local branch mismatch')
 sha=git('rev-parse','HEAD')
 files=git('ls-tree','-r','--name-only','HEAD').splitlines()
 return {'repository':repo,'ref':ref,'commit':sha,'tracked_file_count':len(files),'sample_files':files[:20],'mode':'read_only_committed_snapshot','source':'local_git_object_database'}
if __name__=='__main__':
 import json
 print(json.dumps(inspect('Travelintrips/Core-AI-Foundation'),indent=2))
