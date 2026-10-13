import hashlib,hmac,json,os,sqlite3,uuid
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path
from admin_identity import admin_identity
DB='/opt/ai-coding-standalone-dev/tasks.db'
TOKEN=os.environ.get('AICODING_APPROVAL_TOKEN','')
def now(): return datetime.now(timezone.utc).isoformat()
def conn():
 c=sqlite3.connect(DB,timeout=10)
 c.execute('PRAGMA busy_timeout=10000')
 c.execute('CREATE TABLE IF NOT EXISTS approval_decisions (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,decision TEXT NOT NULL,actor TEXT NOT NULL,artifact_hash TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL)')
 c.execute('CREATE TABLE IF NOT EXISTS approval_permissions (principal TEXT NOT NULL,repository TEXT NOT NULL,environment TEXT NOT NULL,action TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(principal,repository,environment,action))')
 c.execute('CREATE TABLE IF NOT EXISTS admin_identities (user_id TEXT PRIMARY KEY,role TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0)')
 c.commit()
 return c
class Handler(BaseHTTPRequestHandler):
 def send(self,status,obj):
  b=json.dumps(obj).encode()
  self.send_response(status)
  self.send_header('Content-Type','application/json')
  self.send_header('Content-Length',str(len(b)))
  self.send_header('Cache-Control','no-store')
  self.send_header('X-Content-Type-Options','nosniff')
  self.end_headers()
  self.wfile.write(b)
 def principal(self):
  h=self.headers.get('Authorization','')
  if not h.startswith('Bearer '):return None
  token=h[7:]
  with conn() as c:
   identity=admin_identity(token,c)
  if identity:return identity['user_id']
  if len(TOKEN)>=32 and hmac.compare_digest(h,'Bearer '+TOKEN):return 'dev_approval_token'
  return None
 def authorized(self): return self.principal() is not None
 def do_GET(self):
  if urlparse(self.path).path in ('/','/login'):
   body=Path('/opt/ai-coding-standalone-dev/admin_login.html').read_bytes()
   self.send_response(200)
   self.send_header('Content-Type','text/html; charset=utf-8')
   self.send_header('Content-Length',str(len(body)))
   self.send_header('Cache-Control','no-store')
   self.send_header('X-Content-Type-Options','nosniff')
   self.send_header('X-Frame-Options','DENY')
   self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self' https://xssrfshdrtdfupgqwfdw.supabase.co; base-uri 'none'; form-action 'none'")
   self.end_headers()
   self.wfile.write(body)
   return
  if not self.authorized(): return self.send(401,{'error':'unauthorized'})
  p=urlparse(self.path).path
  if p=='/api/dashboard':
   with conn() as c:
    jobs=c.execute('SELECT status,COUNT(*) FROM jobs GROUP BY status').fetchall()
    tasks=c.execute('SELECT status,COUNT(*) FROM tasks GROUP BY status').fetchall()
   return self.send(200,{'environment':'DEV','jobs_by_status':dict(jobs),'tasks_by_status':dict(tasks),'coding_execution_enabled':False})
  if p=='/api/jobs':
   with conn() as c:
    rows=c.execute('SELECT id,kind,status,attempts,updated_at FROM jobs ORDER BY updated_at DESC LIMIT 100').fetchall()
   return self.send(200,{'jobs':[dict(zip(('id','kind','status','attempts','updated_at'),r)) for r in rows]})
  if p=='/api/tasks':
   with conn() as c:
    rows=c.execute('SELECT id,title,status,created_at FROM tasks ORDER BY created_at DESC LIMIT 100').fetchall()
   return self.send(200,{'tasks':[dict(zip(('id','title','status','created_at'),r)) for r in rows]})
  if p!='/api/approvals': return self.send(404,{'error':'not_found'})
  with conn() as c:
   rows=c.execute("SELECT id,kind,status,checkpoint,updated_at,payload FROM jobs WHERE status='WAITING_APPROVAL' ORDER BY updated_at DESC LIMIT 100").fetchall()
  return self.send(200,{'approvals':[{'job_id':r[0],'kind':r[1],'status':r[2],'test_result':r[3],'updated_at':r[4],'artifact_hash':hashlib.sha256(r[5].encode()).hexdigest()} for r in rows]})
 def do_POST(self):
  if not self.authorized(): return self.send(401,{'error':'unauthorized'})
  p=urlparse(self.path).path
  if p=='/api/jobs':
   try:
    n=int(self.headers.get('Content-Length','0'))
    if n<2 or n>30000:return self.send(413,{'error':'invalid_size'})
    d=json.loads(self.rfile.read(n))
    if not isinstance(d,dict):return self.send(400,{'error':'invalid_request'})
    kind=d.get('kind');repository=d.get('repository');ref=d.get('ref')
    if repository!='Travelintrips/Core-AI-Foundation' or ref!='develop' or kind not in ('repository_inspection','coding_test'):return self.send(403,{'error':'job_not_allowed'})
    actor=self.principal()
    with conn() as c:
     permitted=c.execute("SELECT 1 FROM approval_permissions WHERE principal=? AND repository=? AND environment='DEV' AND action='approve_coding' AND enabled=1",(actor,repository)).fetchone()
     if not permitted:return self.send(403,{'error':'repository_permission_denied'})
     if kind=='coding_test':
      if d.get('filename')!='ai-coding-sandbox/solution.py' or not isinstance(d.get('source'),str) or not isinstance(d.get('tests'),str) or not 1<=len(d['source'])<=12000 or not 1<=len(d['tests'])<=12000:return self.send(400,{'error':'invalid_coding_payload'})
      payload={k:d[k] for k in ('repository','ref','filename','source','tests')}
      payload['environment']='DEV'
      if not isinstance(d.get('requires_ollama', False), bool):return self.send(400,{'error':'invalid_requires_ollama'})
      payload['requires_ollama']=d.get('requires_ollama', False)
     else:payload={'repository':repository,'ref':ref,'environment':'DEV'}
     jid=str(uuid.uuid4())
     with c:
      c.execute('INSERT INTO jobs(id,kind,payload,status,updated_at) VALUES (?,?,?,?,?)',(jid,kind,json.dumps(payload),'QUEUED',now()))
      c.execute('INSERT INTO job_events(job_id,status,detail,created_at) VALUES (?,?,?,?)',(jid,'QUEUED','created via authenticated DEV dashboard',now()))
    return self.send(201,{'job_id':jid,'status':'QUEUED','environment':'DEV'})
   except (ValueError,TypeError,KeyError,sqlite3.Error):return self.send(400,{'error':'invalid_request'})
  if p!='/api/approvals/decision': return self.send(404,{'error':'not_found'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if n<2 or n>4096: return self.send(400,{'error':'invalid_size'})
   d=json.loads(self.rfile.read(n))
   jid=d.get('job_id');decision=d.get('decision');reason=d.get('reason','');expected=d.get('artifact_hash')
   if not isinstance(jid,str) or not isinstance(expected,str) or decision not in ('APPROVE','REJECT') or not isinstance(reason,str) or len(reason)>1000: return self.send(400,{'error':'invalid_request'})
   with conn() as c:
    c.execute('BEGIN IMMEDIATE')
    row=c.execute('SELECT status,payload,checkpoint,kind FROM jobs WHERE id=?',(jid,)).fetchone()
    if not row: return self.send(404,{'error':'job_not_found'})
    status,payload,checkpoint,kind=row
    if status!='WAITING_APPROVAL': return self.send(409,{'error':'not_waiting_approval'})
    actual=hashlib.sha256(payload.encode()).hexdigest()
    if not hmac.compare_digest(actual,expected): return self.send(409,{'error':'artifact_changed'})
    evidence=json.loads(checkpoint)
    if kind!='coding_test' or evidence.get('passed') is not True: return self.send(409,{'error':'verification_missing'})
    job=json.loads(payload)
    repository=job.get('repository')
    environment=job.get('environment','DEV')
    if environment!='DEV': return self.send(403,{'error':'production_requires_separate_approval'})
    if decision=='REJECT' and not reason.strip(): return self.send(400,{'error':'rejection_reason_required'})
    action='approve_coding' if decision=='APPROVE' else 'reject_coding'
    actor=self.principal()
    allowed=c.execute('SELECT enabled FROM approval_permissions WHERE principal=? AND repository=? AND environment=? AND action=?',(actor,repository,environment,action)).fetchone()
    if not allowed or allowed[0]!=1: return self.send(403,{'error':'repository_permission_denied'})
    target='APPROVED' if decision=='APPROVE' else 'REJECTED'
    c.execute('INSERT INTO approval_decisions VALUES (?,?,?,?,?,?,?)',(str(uuid.uuid4()),jid,decision,actor,actual,reason,now()))
    c.execute('UPDATE jobs SET status=?,updated_at=? WHERE id=?',(target,now(),jid))
    c.execute('INSERT INTO job_events(job_id,status,detail,created_at) VALUES (?,?,?,?)',(jid,target,'approval decision; no deployment authorized',now()))
   return self.send(200,{'job_id':jid,'status':target,'deployment_executed':False})
  except (ValueError,TypeError,KeyError,sqlite3.Error): return self.send(400,{'error':'invalid_request'})
if __name__=='__main__':
 if len(TOKEN)<32: raise SystemExit('approval token required')
 conn().close()
 ThreadingHTTPServer(('127.0.0.1',18188),Handler).serve_forever()
