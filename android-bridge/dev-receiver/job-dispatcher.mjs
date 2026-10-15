// DEV-only dispatcher: explicit AI Task source_session_id routes a QUEUED job to a paired device.
// Never assigns untagged jobs, changes job state, or contacts PROD.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadDeviceActions, verifiedDeviceAction} from './device-actions.mjs';
import {ACTION_TITLE_PREFIX,siteForTitle} from './phone-site-catalog.mjs';
const spool=process.env.BRIDGE_DEVICE_SPOOL_DIR||'/var/lib/openclaw-android-bridge-dev';
const devicesFile=path.join(spool,'device-registry.json');
const grantsFile=path.join(spool,'device-job-grants.json');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const container='ai-task-dev-pr49-hostnet';
const interval=10000;
const query=`
const {Pool}=require('/app/artifacts/api-server/node_modules/pg');
if(process.env.NODE_ENV!=='development'||!process.env.SUPABASE_DATABASE_URL_DEV||
process.env.SUPABASE_DATABASE_URL||process.env.SUPABASE_PROD_DATABASE_URL)process.exit(12);
(async()=>{const p=new Pool({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:7000});
try{const r=await p.query("SELECT id,title,source,source_session_id,status FROM ai_task_bridge.jobs WHERE source='OPENCLAW' AND status='QUEUED' AND source_session_id LIKE 'android-dev:%' ORDER BY created_at DESC LIMIT 100");
console.log(JSON.stringify(r.rows));}finally{await p.end()}})().catch(()=>process.exit(13));
`;
function load(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw e}}
function save(file,data){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});try{const owner=fs.statSync(devicesFile);fs.chownSync(tmp,owner.uid,owner.gid);fs.renameSync(tmp,file)}catch(e){try{fs.unlinkSync(tmp)}catch{}throw e}}
export function eligible(rows,registry,now=Date.now(),actions={}){
 return rows.filter(r=>r.status==='QUEUED'&&r.source==='OPENCLAW'&&uuid.test(r.id||'')&&
 /^android-dev:[a-zA-Z0-9_-]{3,48}$/.test(r.source_session_id||'')&&
 registry[r.source_session_id.slice(12)]?.active===true)
 .filter(r=>{
   // Navigation jobs cannot fall through to the ordinary ChatGPT test path.
   if(typeof r.title!=='string'||!r.title.startsWith(ACTION_TITLE_PREFIX))return true;
   // All phone browser jobs require a matching device-scoped immutable action,
   // including Hostinger/GCP. An unknown title is denied (never sent to PC).
   const site=siteForTitle(r.title);
   if(!site)return false;
   const action=verifiedDeviceAction(actions[r.id],r.id,r.source_session_id.slice(12),now);
   return action?.kind==='OPEN_URL'&&action.target===site.url;
 })
 .map(r=>({id:r.id,deviceId:r.source_session_id.slice(12)}));
}
export function planGrants(rows,registry,grants,now=Date.now(),actions={}){
 const updates={...grants};
 for(const r of eligible(rows,registry,now,actions)){
  const old=updates[r.id];
  if(old?.deviceId&&old.deviceId!==r.deviceId)continue; // immutable target once granted
  if(old?.active===true&&old.expiresAt>now+15*60*1000)continue;
  updates[r.id]={deviceId:r.deviceId,expiresAt:now+60*60*1000,active:true};
 }
 return updates;
}
async function tick(){
 const raw=execFileSync('/usr/bin/docker',['exec',container,'node','-e',query],
  {encoding:'utf8',timeout:16000,maxBuffer:128*1024});
 const rows=JSON.parse(raw);
 const registry=load(devicesFile),grants=load(grantsFile);
 const updated=planGrants(rows,registry,grants,Date.now(),loadDeviceActions(spool));
 if(JSON.stringify(updated)!==JSON.stringify(grants)){
  save(grantsFile,updated);
  console.log('DEV_ANDROID_AUTOGRANT',Object.keys(updated).length-Object.keys(grants).length);
 }
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1].replaceAll('\\','/'))){
 console.log('DEV Android assigned-job dispatcher started');
 while(true){try{await tick()}catch(e){console.error('DISPATCH_RETRY',e.message)}await new Promise(r=>setTimeout(r,interval))}
}
