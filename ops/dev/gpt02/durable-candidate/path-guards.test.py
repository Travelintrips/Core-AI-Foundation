import json,os,subprocess,tempfile,pathlib,stat
script='/opt/gpt02-task190-gate-candidate-20261125/durable-ledger.py'
def call(path):
 return subprocess.run(['python3',script,str(path),'read'],input=json.dumps({'key':'owner:google_candidate01|attempt','now':1795600000000}),text=True,capture_output=True)
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d)
 regular=root/'ok.sqlite3'
 assert call(regular).returncode==0
 assert stat.S_IMODE(regular.stat().st_mode)==0o600
 print('PASS:PRIVATE_REGULAR_DB')
 bad=root/'symlink.sqlite3';bad.symlink_to(regular)
 assert call(bad).returncode!=0
 print('PASS:SYMLINK_REJECTED')
 os.chmod(root,0o755)
 assert call(regular).returncode!=0
 print('PASS:OPEN_DIRECTORY_REJECTED')
 os.chmod(root,0o700)
 os.chmod(regular,0o644)
 assert call(regular).returncode!=0
 print('PASS:OPEN_FILE_REJECTED')
