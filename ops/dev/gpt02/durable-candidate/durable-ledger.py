#!/usr/bin/env python3
"""DEV-only candidate: crash-safe one-use state, no signing or issuance.
External independent issuer must atomically consume authorization.
CLAIMED never retries automatically after an ambiguous result.
"""
import json,os,sqlite3,sys,uuid,stat
from pathlib import Path
def out(v): print(json.dumps(v,separators=(',',':')))
def main():
 if len(sys.argv)!=3: raise ValueError('EXPECTED_DB_AND_ACTION')
 os.umask(0o077)
 path=Path(sys.argv[1]);action=sys.argv[2]
 if not path.is_absolute() or not path.parent.is_dir() or path.is_symlink(): raise ValueError('INVALID_DB_PATH')
 parent=os.lstat(path.parent)
 if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.geteuid() or stat.S_IMODE(parent.st_mode)!=0o700:
  raise ValueError('UNTRUSTED_LEDGER_PARENT')
 if path.exists():
  meta=os.lstat(path)
  if not stat.S_ISREG(meta.st_mode) or meta.st_uid!=os.geteuid() or stat.S_IMODE(meta.st_mode)!=0o600 or meta.st_nlink!=1:
   raise ValueError('INSECURE_LEDGER_MODE')
 inp=json.load(sys.stdin)
 key=inp.get('key')
 if not isinstance(key,str) or len(key)>256 or len(key)<10:raise ValueError('INVALID_KEY')
 conn=sqlite3.connect(str(path),timeout=4,isolation_level=None)
 try:
  conn.execute('PRAGMA busy_timeout=4000')
  conn.execute('PRAGMA synchronous=FULL')
  conn.execute('PRAGMA journal_mode=DELETE')
  conn.execute('CREATE TABLE IF NOT EXISTS gate_state (key TEXT PRIMARY KEY, authority TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ("READY","CLAIMED","COMPLETED")), receipt TEXT)')
  conn.execute('BEGIN IMMEDIATE')
  row=conn.execute('SELECT authority,challenge,expires_at,state,receipt FROM gate_state WHERE key=?',(key,)).fetchone()
  now=inp.get('now')
  if type(now) is not int or now<=0:raise ValueError('INVALID_CLOCK')
  if action=='ensure':
   ref=inp.get('authority');expiry=inp.get('expiresAt')
   if not isinstance(ref,str) or not ref or len(ref)>256 or type(expiry) is not int or not now<expiry<=now+120000:raise ValueError('INVALID_AUTHORITY')
   if row and row[3] in ('CLAIMED','COMPLETED'):result={'state':row[3], 'receipt':row[4]}
   else:
    if not row or row[2]<=now or row[0]!=ref:
     ident=str(uuid.uuid4())
     conn.execute('INSERT INTO gate_state VALUES(?,?,?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET authority=excluded.authority,challenge=excluded.challenge,expires_at=excluded.expires_at,state=excluded.state,receipt=NULL',(key,ref,ident,expiry,'READY'))
     result={'state':'READY','challenge':ident,'expiresAt':expiry}
    else:result={'state':'READY','challenge':row[1],'expiresAt':row[2]}
  elif action=='claim':
   challenge=inp.get('challenge');ref=inp.get('authority')
   if row and row[3]=='READY' and row[2]>now and row[0]==ref and row[1]==challenge:
    conn.execute('UPDATE gate_state SET state="CLAIMED" WHERE key=? AND state="READY"',(key,))
    result={'state':'CLAIMED'}
   else:result={'state':'ALREADY_CLAIMED_OR_EXPIRED'}
  elif action=='complete':
   receipt=inp.get('receipt')
   if not isinstance(receipt,str) or not receipt or len(receipt)>100:raise ValueError('INVALID_RECEIPT')
   if row and row[3]=='CLAIMED':
    conn.execute('UPDATE gate_state SET state="COMPLETED",receipt=? WHERE key=? AND state="CLAIMED"',(receipt,key))
    result={'state':'COMPLETED','receipt':receipt}
   else:result={'state':row[3] if row else 'ABSENT','receipt':row[4] if row else None}
  elif action=='read':
   result={'state':row[3] if row else 'ABSENT','receipt':row[4] if row else None}
  else:raise ValueError('INVALID_OPERATION')
  conn.execute('COMMIT')
  out(result)
 except:
  if conn.in_transaction:conn.execute('ROLLBACK')
  raise
 finally:conn.close()
if __name__=='__main__':
 try:main()
 except Exception as exc:
  print(json.dumps({'error':type(exc).__name__}),file=sys.stderr);sys.exit(3)
