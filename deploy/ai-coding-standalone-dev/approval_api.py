import hashlib,hmac,json,os,sqlite3,stat,time,uuid
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path
from admin_identity import admin_identity
from gpt02_issue159_approval_http import handle_issue159_approval_intent
from gpt02_issue159_approval_intent_contract import ApprovalIntentContractError, validate_approval_claims
from gpt02_issue159_approval_request_refresh import refresh_pending, RefreshDenied
DB='/opt/ai-coding-standalone-dev/tasks.db'
TOKEN=os.environ.get('AICODING_APPROVAL_TOKEN','')
ISSUE159_APPROVAL_INTENT_ENABLED=os.environ.get(
 'GPT02_ISSUE159_APPROVAL_INTENT_ENABLED','false'
).strip().lower()=='true'
ISSUE159_APPROVED_PACKET=os.environ.get(
 'GPT02_ISSUE159_APPROVED_PACKET',
 '/opt/ai-coding-standalone-dev/gpt02_issue159_approved_claims.json'
)
ISSUE159_PENDING_CLAIMS=os.environ.get(
 'GPT02_ISSUE159_PENDING_CLAIMS',
 '/opt/ai-coding-standalone-dev/gpt02_issue159_pending_claims.json'
)
def now(): return datetime.now(timezone.utc).isoformat()
def persist_issue159_approved_packet(claims,result):
 packet={
  'claims':claims,
  'intentId':result['intentId'],
  'claimsSha256':result['claimsSha256'],
  'actorId':result['actorId'],
  'authMethod':result['authMethod'],
  'roleAtDecision':result['roleAtDecision'],
  'decision':result['decision'],
  'recordedAt':result['recordedAt'],
  'expiresAt':result['expiresAt'],
  'signingPermitted':False,
  'authorizationGranted':False,
  'dispatchPermitted':False,
  'releaseDecision':'NO_GO',
 }
 target=Path(ISSUE159_APPROVED_PACKET)
 target.parent.mkdir(parents=True,exist_ok=True)
 tmp=target.with_name('.'+target.name+'.tmp')
 tmp.write_text(json.dumps(packet,sort_keys=True,separators=(',',':'))+'\n',encoding='utf-8')
 os.chmod(tmp,0o600)
 os.replace(tmp,target)
 return packet
def issue159_operator_identity(identity,connection):
 if (not identity or identity.get('role')!='super_admin'
     or identity.get('auth_level') not in ('aal1','aal2')
     or not identity.get('user_id') or not identity.get('email')):return None
 rows=connection.execute(
  """SELECT l.hub_operator_id
     FROM gpt02_issue159_admin_operator_links l
     JOIN admin_identities a ON a.user_id=l.auth_user_id
     WHERE l.auth_user_id=? AND lower(l.email)=lower(?)
       AND l.enabled=1 AND a.enabled=1 AND a.role='super_admin'""",
  (identity['user_id'],identity['email'])
 ).fetchall()
 if len(rows)!=1 or not rows[0][0]:return None
 return {'userId':rows[0][0],'role':'super_admin',
         'enabled':True,'authMethod':'supabase_admin_session'}
def issue159_identity_verifier(token,connection):
 return issue159_operator_identity(admin_identity(token,connection),connection)
def load_issue159_pending_claims(actor_id):
 try:
  st=os.lstat(ISSUE159_PENDING_CLAIMS)
 except FileNotFoundError:
  return {'environment':'DEV','pending':False,'reason':'NO_PENDING_REQUEST','releaseDecision':'NO_GO'}
 except OSError:
  return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_READ_FAILED','releaseDecision':'NO_GO'}
 if (stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode)
     or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600):
  return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_FILE_SECURITY_INVALID','releaseDecision':'NO_GO'}
 try:
  payload=json.loads(Path(ISSUE159_PENDING_CLAIMS).read_text(encoding='utf-8'))
  if not isinstance(payload,dict) or set(payload)!={'claims'} or not isinstance(payload['claims'],dict):
   raise ValueError('pending claims shape invalid')
  claims=payload['claims']
  validated=validate_approval_claims(claims)
  if claims['superAdminId']!=actor_id:
   return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_ACTOR_MISMATCH','releaseDecision':'NO_GO'}
  observed=int(time.time()*1000)
  if observed<claims['issuedAt'] or observed>=claims['expiresAt']:
   return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_EXPIRED','taskId':claims['taskId'],'releaseDecision':'NO_GO'}
  con=sqlite3.connect('file:'+DB+'?mode=ro',uri=True,timeout=2)
  try:
   con.execute('PRAGMA query_only=ON')
   row=con.execute(
    'SELECT count(*) FROM gpt02_issue159_approval_intents WHERE task_id=? AND command_id=? AND attempt_id=? AND claims_sha256=? AND actor_id=?',
    (claims['taskId'],claims['commandId'],claims['attemptId'],validated['claimsSha256'],actor_id)
   ).fetchone()
  finally:
   con.close()
  if not row or row[0]!=0:
   return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_ALREADY_APPROVED','taskId':claims['taskId'],'releaseDecision':'NO_GO'}
  return {
   'environment':'DEV','pending':True,'taskId':claims['taskId'],
   'commandId':claims['commandId'],'expiresAt':claims['expiresAt'],
   'claims':claims,'signingPermitted':False,'authorizationGranted':False,
   'dispatchPermitted':False,'releaseDecision':'NO_GO'
  }
 except (ApprovalIntentContractError,OSError,ValueError,TypeError,KeyError,sqlite3.Error):
  return {'environment':'DEV','pending':False,'reason':'PENDING_REQUEST_INVALID','releaseDecision':'NO_GO'}
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
  if p=='/api/gpt02/issue159/approval-intent/pending':
   auth=self.headers.get('Authorization','')
   if not auth.startswith('Bearer '):return self.send(401,{'error':'unauthorized'})
   with conn() as c:
    identity=issue159_operator_identity(admin_identity(auth[7:],c),c)
   if not identity:
    return self.send(403,{'error':'active_super_admin_operator_mapping_required'})
   return self.send(200,load_issue159_pending_claims(identity['userId']))
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
  p=urlparse(self.path).path
  if p=='/api/gpt02/issue159/approval-intent/refresh':
   # This is NOT a task/approval creation API. It only rotates an expired
   # nonce for the same independently verified, unconsumed DEV preparation.
   if not ISSUE159_APPROVAL_INTENT_ENABLED:
    return self.send(403,{'error':'issue159_approval_disabled','releaseDecision':'NO_GO'})
   auth=self.headers.get('Authorization','')
   if not auth.startswith('Bearer '):
    return self.send(401,{'error':'unauthorized','releaseDecision':'NO_GO'})
   with conn() as c:
    identity=issue159_operator_identity(admin_identity(auth[7:],c),c)
   if not identity:
    return self.send(403,{'error':'active_super_admin_operator_mapping_required','releaseDecision':'NO_GO'})
   try:
    length=int(self.headers.get('Content-Length','0'))
    if length!=2 or self.rfile.read(length)!=b'{}':
     return self.send(400,{'error':'empty_json_required','releaseDecision':'NO_GO'})
    response=refresh_pending(DB,ISSUE159_PENDING_CLAIMS,identity['userId'])
    return self.send(200,response)
   except RefreshDenied as exc:
    return self.send(exc.http_status,{'error':exc.code,
     'signingPermitted':False,'authorizationGranted':False,
     'dispatchPermitted':False,'releaseDecision':'NO_GO'})
   except (OSError,ValueError,TypeError,sqlite3.Error):
    return self.send(503,{'error':'issue159_refresh_unavailable',
     'signingPermitted':False,'authorizationGranted':False,
     'dispatchPermitted':False,'releaseDecision':'NO_GO'})
  if p=='/api/gpt02/issue159/approval-intent':
   try:
    n=int(self.headers.get('Content-Length','0'))
    if n<0 or n>8192:return self.send(400,{'error':'invalid_size'})
    raw=self.rfile.read(n)
    data=json.loads(raw.decode('utf-8'))
    with conn() as c:
     status,body=handle_issue159_approval_intent(
      self.headers.get('Authorization',''),raw,c,issue159_identity_verifier,
      enabled=ISSUE159_APPROVAL_INTENT_ENABLED)
    if status==201 and isinstance(data,dict) and set(data)=={'claims'}:
     persist_issue159_approved_packet(data['claims'],body)
    return self.send(status,body)
   except (ValueError,TypeError,KeyError,sqlite3.Error):
    return self.send(400,{'error':'invalid_request'})
  if not self.authorized(): return self.send(401,{'error':'unauthorized'})
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
