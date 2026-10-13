import json,sqlite3,time,traceback
from datetime import datetime,timezone
from repository_inspect import inspect
from coding_runner import run as run_coding
DB='/opt/ai-coding-standalone-dev/tasks.db'
def now(): return datetime.now(timezone.utc).isoformat()
def setup(c):
 c.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,checkpoint TEXT,updated_at TEXT NOT NULL)')
 c.execute('CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,status TEXT NOT NULL,detail TEXT,created_at TEXT NOT NULL)')
 c.execute("UPDATE jobs SET status='QUEUED',checkpoint='recovered_after_restart',updated_at=? WHERE status='RUNNING'",(now(),))
 c.commit()
def event(c,jid,status,detail):
 c.execute('INSERT INTO job_events(job_id,status,detail,created_at) VALUES (?,?,?,?)',(jid,status,detail,now()))
def step(c):
 c.execute('BEGIN IMMEDIATE')
 row=c.execute("SELECT id,kind,payload,attempts FROM jobs WHERE status='QUEUED' ORDER BY updated_at LIMIT 1").fetchone()
 if not row:
  c.commit();return False
 jid,kind,payload,attempts=row
 c.execute("UPDATE jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=?",(now(),jid))
 event(c,jid,'RUNNING','claimed');c.commit()
 try:
  data=json.loads(payload)
  if kind=='repository_inspection':
   result=inspect(data['repository'],data['ref'])
   status='SUCCESS';detail=json.dumps(result)
  elif kind=='coding_test':
   # Only authenticated DEV jobs that explicitly need Ollama may wake the shared GPU VM.
   gcp=None
   if data.get('requires_ollama') is True:
    from gcp_dev_controller import ensure_for_dev_job
    gcp=ensure_for_dev_job(jid,data)
   result=run_coding(data)
   if gcp is not None: result['gcp_controller']=gcp
   status='WAITING_APPROVAL' if result['passed'] else 'FAILED'
   detail=json.dumps(result)
  else: raise ValueError('unsupported job kind')
 except Exception as exc:
  status='FAILED';detail=str(exc)[:500]
 with c:
  c.execute('UPDATE jobs SET status=?,checkpoint=?,updated_at=? WHERE id=?',(status,detail,now(),jid))
  event(c,jid,status,detail)
 return True
def main():
 c=sqlite3.connect(DB,timeout=10)
 setup(c)
 while True:
  try:
   if not step(c): time.sleep(2)
  except Exception:
   traceback.print_exc();time.sleep(3)
if __name__=='__main__': main()
