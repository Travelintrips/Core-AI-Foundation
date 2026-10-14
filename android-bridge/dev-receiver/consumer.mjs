// DEV Android intake -> AI Task DEV automatic consumer.
// Run as a separate single-instance service on the VPS; never ship this code or bridge tokens to Android.
// Reads secret service tokens only from the DEV container, and uses a separate read-only verification query.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const container = 'ai-task-dev-pr49-hostnet';
const spool = process.env.BRIDGE_DEVICE_SPOOL_DIR || '/var/lib/openclaw-android-bridge-dev';
const origin = 'http://127.0.0.1:18183/api/bridge';
const owner = 'openclaw-android-auto-consumer-dev';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const verifiedFile = suffix => path.join(spool, '.processed-'+suffix+'.json');
function docker(args) { return execFileSync('/usr/bin/docker', ['exec',container,...args],{encoding:'utf8',timeout:15000,maxBuffer:1048576}).trim(); }
function env(name) {
  const raw=execFileSync('/usr/bin/docker',['inspect',container,'--format','{{range .Config.Env}}{{println .}}{{end}}'],{encoding:'utf8',timeout:15000});
  const entries = raw.split('\n').filter(x=>x.startsWith(name+'='));
  if(entries.length!==1 || entries[0].slice(name.length+1).length<32) throw Error('Missing DEV '+name);
  if(!raw.includes('NODE_ENV=development') || !raw.includes('SUPABASE_DATABASE_URL_DEV=') ||
      raw.includes('\nSUPABASE_PROD_DATABASE_URL=') || raw.includes('\nSUPABASE_DATABASE_URL='))
    throw Error('Refuse non-DEV bridge container');
  return entries[0].slice(name.length+1);
}
async function post(route,payload,secret) {
  const res=await fetch(origin+route,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},
    body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const data=await res.json().catch(()=>({}));
  return {code:res.status,data};
}
const verifyCode = `
const {Pool}=require('/app/artifacts/api-server/node_modules/pg');
const id=process.argv[1],callback=process.argv[2],summary=process.argv[3];
if(process.env.NODE_ENV!=='development'||!process.env.SUPABASE_DATABASE_URL_DEV||
 process.env.SUPABASE_DATABASE_URL || process.env.SUPABASE_PROD_DATABASE_URL)process.exit(12);
(async()=>{
 const pool=new Pool({connectionString:process.env.SUPABASE_DATABASE_URL_DEV,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:7000});
 try {
   const r=await pool.query('SELECT status,callback_id,result_summary FROM ai_task_bridge.jobs WHERE id=$1',[id]);
   const x=r.rows[0];console.log(JSON.stringify({verified:!!x&&x.status==='WAITING_FOR_ACK'&&x.callback_id===callback&&x.result_summary===summary,status:x?.status||null,callbackMatch:x?.callback_id===callback,summaryMatch:x?.result_summary===summary}));
 }finally{await pool.end()}
})().catch(e=>{console.error('verify database failed',e.name);process.exit(13)});
`;
function verify(id,callback,summary) {
  const result=docker(['node','-e',verifyCode,id,callback,summary]);
  return JSON.parse(result);
}
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
let working=false;
async function processReceipt(filename, bridgeToken, ackToken) {
 const source=path.join(spool,filename);
 let item;
 try {item=JSON.parse(fs.readFileSync(source,'utf8'));} catch {return;}
 if(!uuid.test(item.jobId||'') || !/^android-result:[0-9a-f-]{36}$/i.test(item.eventId||'') ||
     item.state!=='RECEIVED_UNVERIFIED' || typeof item.resultSummary!=='string' ||
     !item.resultSummary.trim() || item.resultSummary.length>2000) return;
 const receiptHash=crypto.createHash('sha256').update(item.jobId+'|'+item.eventId).digest('hex');
 if(item.receiptId!==receiptHash) return;
 const sha=crypto.createHash('sha256').update(item.resultSummary).digest('hex');
 if(item.resultDigest && item.resultDigest!==sha) return;
 const done=verifiedFile(receiptHash);
 if(fs.existsSync(done)) return;
 const callback='android-intake:'+receiptHash;
 const ackEvent='android-auto-ack:'+receiptHash;
 const prior = verify(item.jobId,callback,item.resultSummary);
 const receiptAge = Date.now() - Date.parse(item.receivedAt || '');
 if ((prior.status === null || (prior.status === 'COMPLETED' && (!prior.callbackMatch || !prior.summaryMatch)))
     && Number.isFinite(receiptAge) && receiptAge > 15*60*1000) {
   fs.writeFileSync(done,JSON.stringify({jobId:item.jobId,receiptId:receiptHash,
     status:'IGNORED_STALE_OR_UNMATCHED',markedAt:new Date().toISOString()})+'\\n',{flag:'wx',mode:0o600});
   console.log('ANDROID_DEV_IGNORED',item.jobId,receiptHash);
   return;
 }
 if(prior.status==='COMPLETED' && prior.callbackMatch && prior.summaryMatch) {
   fs.writeFileSync(done,JSON.stringify({jobId:item.jobId,receiptId:receiptHash,status:'COMPLETED',recovered:true})+'\\n',{flag:'wx',mode:0o600});
   return;
 }
 if(prior.status==='WAITING_FOR_ACK' && prior.verified) {
   await sendAck();
   return;
 }
 async function sendAck() {
   if(!verify(item.jobId,callback,item.resultSummary).verified) throw Error('Independent DEV DB verification failed');
   const ack=await post('/jobs/'+item.jobId+'/ack',{eventId:ackEvent,callbackId:callback,
     receiver:'android-dev-database-verifier',accepted:true},ackToken);
   if(![200,201].includes(ack.code) || !ack.data.accepted) throw Error('ACK not accepted '+ack.code);
   fs.writeFileSync(done,JSON.stringify({jobId:item.jobId,receiptId:receiptHash,ackReceiptId:ack.data.receiptId,
     completedAt:new Date().toISOString(),status:'COMPLETED'})+'\\n',{flag:'wx',mode:0o600});
   console.log('ANDROID_DEV_COMPLETED',item.jobId,receiptHash);
 }
 let result=await post('/jobs/'+item.jobId+'/claim',{owner,leaseSeconds:180},bridgeToken);
 if(result.code!==200 || !result.data.accepted || !uuid.test(result.data.task?.lease_token||'')) {
   // A previously processed job might already be COMPLETED. Never send ACK without
   // independently verifying a WAITING_FOR_ACK row.
   return;
 }
 const lease=result.data.task.lease_token;
 result=await post('/jobs/'+item.jobId+'/result',{owner,leaseToken:lease,eventId:item.eventId,
  callbackId:callback,resultSummary:item.resultSummary},bridgeToken);
 if(result.code!==202 && !(result.code===200 && result.data.duplicate)) throw Error('Result delivery failed '+result.code);
 await sendAck();
}
async function tick(bridgeToken,ackToken) {
 if(working) return;
 working=true;
 try {
  for(const entry of fs.readdirSync(spool).filter(x=>/^[a-f0-9]{64}\.json$/.test(x)).sort()) {
   try {await processReceipt(entry,bridgeToken,ackToken);} catch(e) {console.error('DEV_RECEIPT_RETRY',entry,e.message);}
  }
 }finally{working=false;}
}
const bridgeToken=env('AI_TASK_BRIDGE_TOKEN');
const ackToken=env('AI_TASK_BRIDGE_ACK_TOKEN');
if(bridgeToken===ackToken)throw Error('ACK token must differ from bridge token');
console.log('Android DEV consumer started; polling local receipts');
while(true){await tick(bridgeToken,ackToken);await sleep(5000);}
