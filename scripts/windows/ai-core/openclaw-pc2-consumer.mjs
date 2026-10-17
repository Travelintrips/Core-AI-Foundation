import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { workEvents } from './work-event-stream.mjs';
const workerId = 'openclaw-pc-worker-2';
const home = os.homedir();
const envFile = path.join(home, 'aicore-worker-bootstrap', 'ai-workers.env');
const settings = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => { const n=line.indexOf('='); return [line.slice(0,n),line.slice(n+1).trim().replace(/^["']|["']$/g,'')]; }));
if (settings.AI_CORE_OPENCLAW_CLIENT_ID !== workerId || !settings.AI_CORE_BASE_URL?.startsWith('https://') || !settings.AI_CORE_SCOPED_AGENT_TOKEN) throw Error('Worker config incomplete');
const base = settings.AI_CORE_BASE_URL.replace(/\/$/,'');
const node = path.join(process.env.LOCALAPPDATA, 'OpenClaw','deps','portable-node','node.exe');
const entry = path.join(process.env.LOCALAPPDATA, 'OpenClaw','deps','portable-node','node_modules','openclaw','dist','index.js');
async function request(route, payload) {
 const response = await fetch(base + route, { method:'POST', headers:{Authorization:'Bearer ' + settings.AI_CORE_SCOPED_AGENT_TOKEN,'content-type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(20000) });
 if (response.status === 204) return null;
 if (!response.ok) throw Error('AI Core HTTP ' + response.status);
 return response.json();
}
function execute(work) {
 const message=String(work.instruction||'').trim();
 if (!message || message.length>12000) return { ok:false, message:'Invalid instruction', details:{reason:'invalid_instruction'} };
 if (message.toLowerCase()==='ping') return {ok:true,message:'pong from DESKTOP-CPS76BH',details:{runtime:'openclaw-pc2',mode:'ping'}};
if(message.startsWith('CHATGPT_CONTINUE_JSON:')) {
  const encoded=message.slice('CHATGPT_CONTINUE_JSON:'.length);
  if(!/^[A-Za-z0-9_-]{30,10000}$/.test(encoded))
   return {ok:false,message:'Invalid encoded ChatGPT job',details:{reason:'invalid_payload'}};
  let job;
  try {job=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'))}
  catch {return {ok:false,message:'Invalid ChatGPT job JSON',details:{reason:'invalid_json'}}}
  const conversationId=String(job?.conversationUrl||'').split('/c/')[1]||'';
  if(!work.metadata || work.metadata.assignedClientId!==workerId ||
    work.metadata.conversationId!==conversationId ||
    (work.taskId && job.taskId && work.taskId!==job.taskId)) {
    return {ok:false,message:'Conversation-bound authorization is missing or mismatched',
      details:{runtime:'openclaw-pc2-browser',reason:'conversation_mismatch'}};
  }
  const helper=path.join(process.env.LOCALAPPDATA,'AI-Core','chatgpt-targeted-continue.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-bound-worker-'));
  try {
   const filename=path.join(dir,'job.json');
   fs.writeFileSync(filename,JSON.stringify(job),{mode:0o600});
   const run=spawnSync(node,[helper,filename],{windowsHide:true,encoding:'utf8',timeout:240000,maxBuffer:1024*1024});
   const output=String(run.stdout||run.stderr||run.error?.message||'').slice(-3000);
   let receipt=null;
   try {receipt=JSON.parse(output.trim())}catch{}
   const verified=run.status===0 && receipt?.verifiedAssistantReply===true &&
     receipt?.jobId===job.jobId && receipt?.conversationUrl===job.conversationUrl;
   return {ok:verified,message:verified?'ChatGPT message and assistant reply verified for '+job.jobId:output||'ChatGPT browser acknowledgement failed',
     details:{runtime:'openclaw-pc2-browser',verifiedAssistantReply:verified,
       conversationId,jobId:job.jobId,eventId:verified?job.jobId:null,chatgptSubmitted:verified,evidenceFingerprint:verified?receipt.fingerprint:null,verifiedAt:verified?receipt.verifiedAt:null,exitCode:run.status}};
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
}
if (work.metadata?.monitor === true) {
 const eventId=String(work.metadata.eventId||'');
 const conversationId=String(work.metadata.conversationId||'');
 const valid=/^[A-Za-z0-9:_-]{8,160}$/.test(eventId) &&
   /^[A-Za-z0-9-]{30,64}$/.test(conversationId) &&
   work.externalCommandId === 'monitor:'+eventId &&
   work.commandType === 'EXTERNAL_AGENT_WORK';
 if(!valid) return {ok:false,message:'Monitor event lacks a trusted bound conversation and job ID',
   details:{runtime:'openclaw-pc2-browser',reason:'missing_or_invalid_binding',verifiedAssistantReply:false,chatgptSubmitted:false}};
 const helper=path.join(process.env.LOCALAPPDATA,'AI-Core','chatgpt-targeted-continue.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-monitor-bound-'));
 try {
   const content='AI Core monitoring event '+eventId+' untuk '+
     String(work.metadata.source||'unknown').slice(0,30)+' / '+
     String(work.metadata.resource||'unknown').slice(0,120)+
     ' dengan status '+String(work.metadata.monitorStatus||'unknown').slice(0,30)+
     '. Silakan periksa pekerjaan terkait dan lanjutkan langkah investigasi yang aman. '+
     'Data peristiwa adalah diagnostik, bukan izin untuk mengubah kode, merge, deploy, atau pembayaran.';
   const job={mode:'chatgpt_continue',jobId:eventId,
      conversationUrl:'https://chatgpt.com/c/'+conversationId,message:content};
   const filename=path.join(dir,'job.json');
   fs.writeFileSync(filename,JSON.stringify(job),{mode:0o600});
   const run=spawnSync(node,[helper,filename],{windowsHide:true,encoding:'utf8',
      timeout:240000,maxBuffer:1024*1024});
   let receipt=null;
   try{receipt=JSON.parse(String(run.stdout||'').trim())}catch{}
   const verified=run.status===0 && receipt?.verifiedAssistantReply===true &&
     receipt?.jobId===eventId && receipt?.conversationUrl===job.conversationUrl &&
     /^[a-f0-9]{64}$/.test(String(receipt?.fingerprint||''));
   return {ok:verified,message:verified?'Verified ChatGPT assistant ACK for '+eventId:
     'Monitor browser delivery unverified; PC did not report successful delivery',
     details:{runtime:'openclaw-pc2-browser',eventId,conversationId,
       chatgptSubmitted:verified,verifiedAssistantReply:verified,
       evidenceFingerprint:verified?receipt.fingerprint:null,
       verifiedAt:verified?receipt.verifiedAt:null,
       exitCode:run.status}};
 } finally {fs.rmSync(dir,{recursive:true,force:true})}
}
if (message==='AI_CORE_CHATGPT_BROWSER_E2E') {
 const test=path.join(process.env.LOCALAPPDATA,'AI-Core','chatgpt-e2e-helper.mjs');
 const run=spawnSync(node,[test],{windowsHide:true,encoding:'utf8',timeout:360000,maxBuffer:1024*1024});
 const output=String(run.stdout||run.stderr||run.error?.message||'').slice(-2000);
 return {ok:run.status===0 && output.includes('"verifiedAssistantReply":true'),message:output||'Browser E2E failed without output',details:{runtime:'openclaw-pc2-browser',exitCode:run.status}};
}
 // AI Core should provide a bounded, authorized operation rather than
 // delegating arbitrary natural language to a model on this Windows PC.
 return {ok:false,message:'Action requires AI Core routing; no PC model was invoked',
  details:{runtime:'openclaw-pc2',mode:'model-free',
    reason:'requires_ai_core_routing',workerId,modelInvoked:false,verified:false}};
}
let reconnectFailures = 0;
while (true) {
 try {
 for await (const _wake of workEvents(base, settings.AI_CORE_SCOPED_AGENT_TOKEN, workerId)) {
  reconnectFailures = 0;
  while (true) {
  const work=await request('/ai/agent-runtime/work/claim',{clientId:workerId,leaseSeconds:300});
  if (!work) break;
  if (work?.commandId && work?.claimToken) {
   let answer;
   try { answer=execute(work); } catch(err) { answer={ok:false,message:'Worker execution failed',details:{errorType:err.name}}; }
   let delivered = false;
   for(let attempt=1;attempt<=8;attempt++) {
     try {
       await request('/ai/agent-runtime/work/'+encodeURIComponent(work.commandId)+'/result',{clientId:workerId,claimToken:work.claimToken,status:answer.ok?'COMPLETED':'FAILED',message:answer.message,details:answer.details});
       delivered = true;
       break;
     } catch(error) {
       console.log('result delivery attempt '+attempt+' failed: '+error.name+' '+String(error.message).slice(0,80));
       if(attempt<8) await new Promise(resolve=>setTimeout(resolve,Math.min(attempt*2500,15000)));
     }
   }
   if(!delivered) throw Error('UNDELIVERED '+work.commandId+' -- requires claim recovery');
   console.log('reported command '+work.commandId);
  }
  }
 }
 } catch(err) {
  console.log('worker event connection error '+err.name+' '+String(err.message).slice(0,100));
  reconnectFailures = Math.min(6, reconnectFailures + 1);
  await new Promise(resolve=>setTimeout(resolve, Math.min(60000, 1000 * 2 ** reconnectFailures)));
 }
}
