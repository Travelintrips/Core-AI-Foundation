// DEV only: narrow admin UI. Authentication is enforced by nginx basic auth.
import http from 'node:http';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const host='dev-ai-task.cstlogistic.co.id';
const target='android-dev:zfold4-paired-dev-04';
const container='ai-task-dev-pr49-hostnet';
const session=crypto.randomBytes(24).toString('base64url');
function token(){
 const raw=execFileSync('/usr/bin/docker',['inspect',container,'--format','{{range .Config.Env}}{{println .}}{{end}}'],{encoding:'utf8',timeout:9000,maxBuffer:262144});
 if(!raw.includes('NODE_ENV=development')||!raw.includes('SUPABASE_DATABASE_URL_DEV=')||raw.includes('\nSUPABASE_PROD_DATABASE_URL=')||raw.includes('\nSUPABASE_DATABASE_URL='))
  throw Error('DEV environment check failed');
 const match=raw.split('\n').filter(s=>s.startsWith('AI_TASK_BRIDGE_TOKEN='));
 if(match.length!==1||match[0].length<54)throw Error('Missing bridge token');
 return match[0].slice('AI_TASK_BRIDGE_TOKEN='.length);
}
function reply(res,status,body,type='application/json'){
 res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
 res.end(typeof body==='string'?body:JSON.stringify(body));
}
const page=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Task DEV — Job Z Fold4</title>
<style>body{font:16px system-ui;margin:2rem auto;max-width:560px;padding:0 1rem;line-height:1.6}button{font:inherit;padding:12px 22px;cursor:pointer}code{overflow-wrap:anywhere}small{color:#666}.error{color:#b00020}</style>
<h2>AI Task DEV — Job Z Fold4</h2><p>Target terverifikasi: <code>android-dev:zfold4-paired-dev-04</code></p><p>Ini hanya membuat job uji DEV untuk perangkat tersebut. PROD tidak dipakai.</p>
<button id="create" type="button">Buat job Z Fold4</button><p id="status" role="status">Belum ada job baru.</p>
<small>Setelah job dibuat, buka aplikasi Z Fold4 dan tekan AMBIL JOB DEV OTOMATIS.</small>
<script>document.getElementById('create').onclick=async()=>{const b=document.getElementById('create'),s=document.getElementById('status');b.disabled=true;s.textContent='Mendaftarkan job DEV...';try{const r=await fetch('/android-admin/jobs',{method:'POST',headers:{'content-type':'application/json','x-dev-csrf':${JSON.stringify(session)}},body:'{}'});const j=await r.json();s.textContent=r.ok?'Job berhasil dibuat: '+j.jobId+' ('+j.status+')':'Gagal HTTP '+r.status+' '+(j.error||'');}catch(e){s.textContent='Koneksi gagal';}finally{b.disabled=false}}</script></html>`;
http.createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/android-admin/')return reply(res,200,page,'text/html; charset=utf-8');
 if(req.method!=='POST'||req.url!=='/android-admin/jobs')return reply(res,404,{error:'not_found'});
 if(req.headers.origin!=='https://'+host||req.headers['x-dev-csrf']!==session||req.headers['content-type']?.split(';')[0]!=='application/json')
   return reply(res,403,{error:'request_not_allowed'});
 let size=0;req.on('data',b=>{size+=b.length;if(size>512)req.destroy()});
 req.on('end',async()=>{
  try{
   const id=crypto.randomUUID(), key='zfold4-dev-admin:'+id;
   const response=await fetch('http://127.0.0.1:18183/api/bridge/jobs',{method:'POST',
    headers:{'authorization':'Bearer '+token(),'content-type':'application/json'},
    body:JSON.stringify({source:'OPENCLAW',externalId:key,idempotencyKey:key,title:'Z Fold4 DEV admin E2E check',sessionId:target}),
    signal:AbortSignal.timeout(12000)});
   const json=await response.json();
   if(!response.ok||!json.accepted||!json.task?.id)return reply(res,502,{error:'dev_job_creation_failed'});
   return reply(res,201,{jobId:json.task.id,status:json.task.status});
  }catch{return reply(res,503,{error:'dev_backend_unavailable'})}
 });
}).listen(18796,'127.0.0.1',()=>console.log('DEV Android admin web ready on localhost'));
