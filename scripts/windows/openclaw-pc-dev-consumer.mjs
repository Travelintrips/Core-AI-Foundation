import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const workerId = 'openclaw-pc-worker-dev';
const home = os.homedir();
const envFile = path.join(home, 'aicore-worker-bootstrap', 'ai-worker-dev.env');
const settings = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(Boolean).map(line => { const n=line.indexOf('='); return [line.slice(0,n),line.slice(n+1).trim().replace(/^["']|["']$/g,'')]; }));
if (settings.AI_CORE_OPENCLAW_CLIENT_ID !== workerId || !settings.AI_CORE_BASE_URL?.startsWith('https://') || !settings.AI_CORE_SCOPED_AGENT_TOKEN) throw Error('Worker config incomplete');
const base = settings.AI_CORE_BASE_URL.replace(/\/$/,'');
const node = path.join(process.env.LOCALAPPDATA, 'OpenClaw','deps','portable-node','node.exe');
const entry = path.join(process.env.LOCALAPPDATA, 'OpenClaw','deps','portable-node','node_modules','openclaw-known-good-20260909','dist','index.js');
async function request(route, payload) {
 const response = await fetch(base + route, { method:'POST', headers:{Authorization:'Bearer ' + settings.AI_CORE_SCOPED_AGENT_TOKEN,'content-type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(20000) });
 if (response.status === 204) return null;
 if (!response.ok) throw Error('AI Core HTTP ' + response.status);
 return response.json();
}
function execute(work) {
 let message=String(work.instruction||'').trim();
 const directBrowserE2e = message === 'AI_CORE_CHATGPT_BROWSER_E2E';
 if ((work?.metadata?.browserProfile === 'travelincars-dev' || work?.metadata?.accountAlias === 'GPT02') && !directBrowserE2e) {
   return {ok:false,message:'GPT02 travelincars-dev is reserved for openclaw-dell-chatgpt-wake-dev',details:{reason:'dedicated_worker_required',workerId:'openclaw-dell-chatgpt-wake-dev'}};
 }
 if (!message || message.length>12000) return { ok:false, message:'Invalid instruction', details:{reason:'invalid_instruction'} };
 if (work.commandType === 'EXTERNAL_AGENT_WORK' &&
    work.metadata?.assignedClientId === workerId &&
    message === 'Jalankan tugas OPERASIONAL melalui external-agent OpenClaw worker openclaw-pc-worker-dev pada PC DESKTOP-CPS76BH: buka Notepad dan verifikasi proses notepad.exe aktif; kembalikan hasil E2E yang terukur. Ini bukan tugas coding, jangan buat PR, jangan modifikasi kode.') {
  const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $before=@(Get-Process notepad -ErrorAction SilentlyContinue | ForEach-Object Id); Start-Process notepad.exe; Start-Sleep -Seconds 2; $p=@(Get-Process notepad -ErrorAction Stop | Where-Object {$before -notcontains $_.Id}); if($p.Count -gt 0){'NOTEPAD_VERIFIED PID='+($p.Id -join ',')}else{throw 'Notepad not running'}"],{windowsHide:true,encoding:'utf8',timeout:15000});
  const evidence=String(run.stdout||'').trim();
  const verified=run.status===0 && evidence.includes('NOTEPAD_VERIFIED PID=');
  return {ok:verified,message:verified?evidence:'Notepad verification failed',details:{runtime:'openclaw-pc2-local-action',e2eCode:verified?'VERIFIED':'FAILED',exitCode:run.status,evidence:verified?evidence:null}};
}
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
 const output=String(run.stdout||run.stderr||run.error?.message||'').slice(-3000);
 let receipt=null;
 try { receipt=JSON.parse(String(run.stdout||'').trim()); } catch {}
 const verified=run.status===0 &&
   receipt?.chatgptSubmitted===true &&
   receipt?.verifiedAssistantReply===true &&
   /^[A-Za-z0-9-]{30,64}$/.test(String(receipt?.conversationId||'')) &&
   /^[a-f0-9]{64}$/.test(String(receipt?.evidenceFingerprint||'')) &&
   typeof receipt?.verifiedAt==='string' && !Number.isNaN(Date.parse(receipt.verifiedAt));
 return {
   ok:verified,
   message:verified?'Verified direct OpenClaw ChatGPT E2E for '+work.commandId:(output||'Browser E2E failed without verified receipt'),
   details:{
     runtime:'openclaw-pc2-browser',
     eventId:String(work.commandId||''),
     conversationId:verified?receipt.conversationId:null,
     chatgptSubmitted:verified,
     verifiedAssistantReply:verified,
     evidenceFingerprint:verified?receipt.evidenceFingerprint:null,
     verifiedAt:verified?receipt.verifiedAt:null,
     exitCode:run.status
   }
 };
}
 const safeCloseRequested =
   work.commandType === 'EXTERNAL_AGENT_WORK' &&
   work.metadata?.assignedClientId === workerId &&
   work.metadata?.safePcAction === 'CLOSE_NOTEPAD' &&
   /^pc-safe:issue:Travelintrips\/Core-AI-Foundation:[1-9][0-9]*$/.test(String(work.externalCommandId||'')) &&
   message.startsWith('Owner-authorized safe request. Close only the test Notepad window with PID 12124');
 if (safeCloseRequested) {
   message='This safe action is approved. Call your local exec tool and run exactly: powershell.exe -NoProfile -File C:\\Users\\user\\AppData\\Local\\Temp\\oc-close-notepad-12124-safe-20261011.ps1 . Do not use a simulation. Do not force kill Notepad. Only report completion if the tool outputs NOTEPAD_WINDOW_CLOSED_VERIFIED_PID_12124 or NOTEPAD_ALREADY_CLOSED; otherwise report the actual error and stop.';
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ai-core-worker-'));
 const filename=path.join(dir,'instruction.txt');
 try {
  fs.writeFileSync(filename,message,{encoding:'utf8',mode:0o600});
  const safePcWork = work.commandType === 'EXTERNAL_AGENT_WORK' &&
     work.metadata?.assignedClientId === workerId &&
     /^pc-safe:issue:Travelintrips\/Core-AI-Foundation:[1-9][0-9]*$/.test(String(work.externalCommandId||'')) &&
     ['OPEN_NOTEPAD','MOVE_MOUSE_TOP','CLOSE_NOTEPAD'].includes(String(work.metadata?.safePcAction||''));
   const args = safePcWork
     ? [entry,'agent','--agent','main','--session-key','agent:main:pc-safe-'+work.commandId,'--message-file',filename,'--timeout','45','--json']
     : [entry,'agent','--agent','main','--session-key','agent:main:pc-work-'+work.commandId,'--message-file',filename,'--timeout','45','--json'];
   const run=spawnSync(node,args,{windowsHide:true,encoding:'utf8',timeout:safePcWork?60000:105000,maxBuffer:1024*1024});
  const output=String(run.stdout||run.stderr||run.error?.message||'').slice(-3000);
  return {ok:run.status===0,message:output||'OpenClaw returned no output',details:{runtime:'openclaw-pc2',exitCode:run.status}};
 } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
let idleDelayMs = 5000;
let lastHeartbeatAt = 0;
while (true) {
 let claimedWork = false;
 try {
  const now = Date.now();
  if (now - lastHeartbeatAt >= 60000) {
   await request('/ai/agent-runtime/presence/'+encodeURIComponent(workerId)+'/heartbeat',{health:'healthy',version:'2026.10.19-backoff'});
   lastHeartbeatAt = now;
  }
  const work=await request('/ai/agent-runtime/work/claim',{clientId:workerId,leaseSeconds:300});
  if (work?.commandId && work?.claimToken) {
   claimedWork = true;
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
   if(!delivered) console.log('UNDELIVERED '+work.commandId+' -- requires claim recovery; do not silently claim completed');
   console.log('reported command '+work.commandId);
  }
 } catch(err) { console.log('worker cycle error '+err.name+' '+String(err.message).slice(0,100)); }
 if (claimedWork) { idleDelayMs = 5000; } else { idleDelayMs = Math.min(Math.round(idleDelayMs * 1.6), 30000); }
 await new Promise(resolve=>setTimeout(resolve,idleDelayMs));
}
