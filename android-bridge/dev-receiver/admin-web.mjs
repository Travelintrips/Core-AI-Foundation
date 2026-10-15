// DEV only: narrow admin UI. Authentication is enforced by nginx basic auth.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {saveDeviceAction} from './device-actions.mjs';
import {siteForKey} from './phone-site-catalog.mjs';
const host='dev-ai-task.cstlogistic.co.id';
const actionDirectory='/var/lib/openclaw-android-bridge-dev';
const ACTION_ROUTES=Object.freeze({
 '/android-admin/open-github':'github',
 '/android-admin/open-hostinger':'hostinger',
 '/android-admin/open-gcp':'gcp',
 '/android-admin/open-hostinger-vps':'hostinger-vps',
 '/android-admin/open-gcp-compute':'gcp-compute'
});
// Resolve the latest active, locally paired Z Fold4 each time, never a stale hardcoded ID.
function target(){
 const registry=JSON.parse(fs.readFileSync('/var/lib/openclaw-android-bridge-dev/device-registry.json','utf8'));
 const devices=Object.entries(registry).filter(([id,entry])=>
   /^zfold4-paired-dev-[0-9]{2}$/.test(id)&&entry?.active===true&&
   typeof entry.createdAt==='string'&&Number.isFinite(Date.parse(entry.createdAt)));
 if(!devices.length)throw Error('No active paired Z Fold4');
 devices.sort((a,b)=>Date.parse(b[1].createdAt)-Date.parse(a[1].createdAt));
 return 'android-dev:'+devices[0][0];
}
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
<h2>AI Task DEV — Job Z Fold4</h2><p>Target terverifikasi: <code>__LATEST_ZFOLD4_TARGET__</code></p><p>Ini hanya membuat job uji DEV untuk perangkat tersebut. PROD tidak dipakai.</p>
<button id="create" type="button">Buat job uji ChatGPT</button>
<button id="github" type="button">Buka GitHub di HP Z Fold4</button>
<button id="hostinger" type="button">Buka Hostinger di HP</button>
<button id="gcp" type="button">Buka GCP Console di HP</button>
<button id="hostinger-vps" type="button">Buka menu VPS Hostinger di HP</button>
<button id="gcp-compute" type="button">Buka Compute Engine GCP di HP</button>
<p id="status" role="status">Belum ada job baru.</p>
<small>Perintah GitHub, Hostinger, dan GCP ditujukan hanya ke Z Fold4 ter-pairing, tanpa fallback PC. Buka Android Bridge, tekan AMBIL JOB DEV OTOMATIS, setujui Jalankan di HP. Login dan klik menu dilakukan oleh pemilik HP. Jangan masukkan sandi ke ChatGPT. Tindakan perubahan atau penghapusan tidak otomatis.</small>
<script>
async function createDevJob(button,route) {
 const b=document.getElementById(button),s=document.getElementById('status');
 let blockRetry=false;
 b.disabled=true;
 s.textContent='Mengirim job DEV khusus Z Fold4...';
 try{
  const r=await fetch(route,{method:'POST',headers:{'content-type':'application/json','x-dev-csrf':${JSON.stringify(session)}},body:'{}'});
  const j=await r.json();
  if(r.ok) {
   s.textContent='Job '+j.jobId+' ('+j.status+'), target '+(j.target||'Z Fold4')+
    (j.action?' — OPEN_URL '+(j.site||'situs')+', konfirmasi di HP':'');
  }else if(j.jobId && j.error==='action_registration_failed') {
   blockRetry=true;
   s.textContent='Job '+j.jobId+' SUDAH dibuat, tetapi izin aksi gagal disimpan. Jangan buat job kedua. Hubungi admin DEV untuk melengkapi job ini.';
  }else{
   s.textContent='Gagal HTTP '+r.status+': '+(j.error||'tidak diketahui');
  }
 }catch(e){s.textContent='Koneksi DEV gagal; tidak ada fallback ke PC';}
 finally{if(!blockRetry)b.disabled=false}
}
document.getElementById('create').onclick=()=>createDevJob('create','/android-admin/jobs');
document.getElementById('github').onclick=()=>createDevJob('github','/android-admin/open-github');
document.getElementById('hostinger').onclick=()=>createDevJob('hostinger','/android-admin/open-hostinger');
document.getElementById('gcp').onclick=()=>createDevJob('gcp','/android-admin/open-gcp');
document.getElementById('hostinger-vps').onclick=()=>createDevJob('hostinger-vps','/android-admin/open-hostinger-vps');
document.getElementById('gcp-compute').onclick=()=>createDevJob('gcp-compute','/android-admin/open-gcp-compute');
</script></html>`;
http.createServer((req,res)=>{
 if(req.method==='GET'&&req.url==='/android-admin/'){
  try{return reply(res,200,page.replace('__LATEST_ZFOLD4_TARGET__',target()),'text/html; charset=utf-8')}
  catch{return reply(res,503,{error:'no_active_zfold4_pairing'})}
 }
 if(req.method!=='POST'||!(req.url==='/android-admin/jobs'||Object.hasOwn(ACTION_ROUTES,req.url)))return reply(res,404,{error:'not_found'});
 if(req.headers.origin!=='https://'+host||req.headers['x-dev-csrf']!==session||req.headers['content-type']?.split(';')[0]!=='application/json')
   return reply(res,403,{error:'request_not_allowed'});
 let size=0;req.on('data',b=>{size+=b.length;if(size>512)req.destroy()});
 req.on('end',async()=>{
  try{
   const androidTarget=target(); // Resolve once, never redirect to a PC worker.
   const siteKey=ACTION_ROUTES[req.url];
   const site=siteKey?siteForKey(siteKey):null;
   const id=crypto.randomUUID(), key='zfold4-dev-admin:'+id;
   const response=await fetch('http://127.0.0.1:18183/api/bridge/jobs',{method:'POST',
    headers:{'authorization':'Bearer '+token(),'content-type':'application/json'},
    body:JSON.stringify({source:'OPENCLAW',externalId:key,idempotencyKey:key,
      title:site?site.title:'Z Fold4 DEV admin E2E check',
      sessionId:androidTarget}),
    signal:AbortSignal.timeout(12000)});
   const json=await response.json();
   if(response.status!==201||!json.accepted||!json.task?.id)return reply(res,502,{error:'dev_job_creation_failed'});
   if(site){
    // The DEV dispatcher refuses any phone browser job without this matching action.
    // Never disguise a post-creation action-write failure as a failed job creation:
    // doing so encourages duplicate jobs when the operator retries.
    try {
     saveDeviceAction(actionDirectory,json.task.id,androidTarget.slice('android-dev:'.length),
       {kind:'OPEN_URL',target:site.url});
    } catch (e) {
     console.error('DEV_ADMIN_ACTION_REGISTRATION_FAILED',e?.code||'unknown');
     return reply(res,503,{error:'action_registration_failed',jobId:json.task.id,
       target:androidTarget});
    }
   }
   return reply(res,201,{jobId:json.task.id,status:json.task.status,
     target:androidTarget,...(site?{action:'OPEN_URL',site:site.label}:{})});
  }catch(e){
   console.error('DEV_ADMIN_BACKEND_FAILURE',e?.code||e?.name||'unknown');
   return reply(res,503,{error:'dev_backend_unavailable'});
  }
 });
}).listen(18796,'127.0.0.1',()=>console.log('DEV Android admin web ready on localhost'));
