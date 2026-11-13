'use strict';
const fs=require('fs'),http=require('http'),path=require('path'),cp=require('child_process');
const [pidS,portS,originalId,readerId,conversationUrl,profileDir,fingerprint]=process.argv.slice(2);
const pid=Number(pidS),port=Number(portS);
function stop(s){throw Error(s)}
if(!Number.isInteger(pid)||pid<1||!Number.isInteger(port)||port<1024||port>65535||
 !/^[0-9a-f]{32}$/i.test(originalId)||!/^[0-9a-f]{32}$/i.test(readerId)||originalId===readerId||
 !/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{36}$/i.test(conversationUrl)||!/^[0-9a-f]{64}$/.test(fingerprint))stop('INVALID_READER_BINDING');
const config=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'AI-Core','dell-chatgpt-wake-allowlist.json')));
const binding=(config.bindings||[]).filter(b=>b.accountAlias==='GPT02'&&b.enabled===true&&
 b.workerId==='openclaw-dell-chatgpt-wake-dev'&&b.browserProfile==='gpt02-dell-dev'&&
 b.bindingFingerprint===fingerprint&&conversationUrl.endsWith('/'+b.targetConversationId));
if(binding.length!==1)stop('REGISTRY_MISMATCH');
const args=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
 '(Get-CimInstance Win32_Process -Filter "ProcessId='+pid+'").CommandLine'],{encoding:'utf8',timeout:10000}).trim();
const userDataUnquoted='--user-data-dir='+profileDir;
const userDataQuoted='--user-data-dir="'+profileDir+'"';
const userDataMatches=(args.includes(userDataUnquoted)?1:0)+(args.includes(userDataQuoted)?1:0);
if(!args.includes('--remote-debugging-port='+port)||userDataMatches!==1||args.includes('--type='))stop('PROCESS_MISMATCH');
const inventory=()=>new Promise((ok,no)=>http.get({hostname:'127.0.0.1',port,path:'/json',timeout:5000},r=>{
 let chunks='';r.on('data',b=>{chunks+=b;if(chunks.length>524288)r.destroy()});r.on('end',()=>{try{ok(JSON.parse(chunks))}catch(e){no(e)}})}).on('error',no));
(async()=>{
 const tabs=await inventory();
 const a=tabs.filter(t=>t.id===originalId&&t.url===conversationUrl&&t.type==='page');
 const b=tabs.filter(t=>t.id===readerId&&t.url==='about:blank'&&t.type==='page');
 if(a.length!==1||b.length!==1)stop('READER_TAB_IDENTITY_MISMATCH');
 const ws=new WebSocket(b[0].webSocketDebuggerUrl);
 await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
 let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);const pair=pending.get(m.id);if(!pair)return;pending.delete(m.id);m.error?pair[1](Error(m.error.message)):pair[0](m.result)};
 const call=(method,params={},timeoutMs=10000)=>new Promise((ok,no)=>{
  const id=++seq;
  const timer=setTimeout(()=>{pending.delete(id);no(Error(method+'_TIMEOUT'))},timeoutMs);
  pending.set(id,[(v)=>{clearTimeout(timer);ok(v)},(e)=>{clearTimeout(timer);no(e)}]);
  ws.send(JSON.stringify({id,method,params}));
 });
 try {
  const before=await call('Runtime.evaluate',{expression:'location.href',returnByValue:true},5000);
  if(before.result?.value!=='about:blank')stop('READER_NOT_BLANK');
  let nav;
  try {
   nav=await call('Page.navigate',{url:conversationUrl},10000);
   if(nav.errorText)stop('NAVIGATION_ERROR');
  } catch(e) {
   const after=await inventory();
   const proven=after.filter(t=>t.id===readerId&&t.url===conversationUrl&&t.type==='page');
   const original=after.filter(t=>t.id===originalId&&t.url===conversationUrl&&t.type==='page');
   if(proven.length!==1||original.length!==1)throw e;
   console.log(JSON.stringify({ok:true,rawTargetId:readerId,pageUrl:conversationUrl,navigationInvoked:true,navigationReconciled:true}));
   return;
  }
  console.log(JSON.stringify({ok:true,rawTargetId:readerId,pageUrl:conversationUrl,navigationInvoked:true,navigationReconciled:false}));
 }finally{ws.close()}
})().catch(e=>{console.error('READER_STOP:'+e.message);process.exitCode=1});
