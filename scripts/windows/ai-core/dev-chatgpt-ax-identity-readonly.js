const http=require('http'),cp=require('child_process'),fs=require('fs'),path=require('path');
const [pidS,portS,targetId,expectedUrl,expectedDir,alias,fingerprint]=process.argv.slice(2);
const pid=Number(pidS),port=Number(portS);
function fail(s){throw Error(s)}
if(!Number.isInteger(pid)||pid<=0||!Number.isInteger(port)||port<1024||port>65535||!/^[a-f0-9]{32}$/i.test(targetId)||!/^https:\/\/chatgpt\.com\/c\/[a-f0-9-]{36}$/i.test(expectedUrl))fail('INVALID_BOUND_CONTEXT');
if(alias!=='GPT02'||!/^[a-f0-9]{64}$/.test(fingerprint||''))fail('BINDING_ARGUMENT_INVALID');
const registry=JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA,'AI-Core','dell-chatgpt-wake-allowlist.json'),'utf8'));
const bindings=(registry.bindings||[]).filter(b=>b.enabled===true&&b.accountAlias===alias&&b.bindingFingerprint===fingerprint&&b.browserProfile==='gpt02-dell-dev'&&b.targetConversationId===expectedUrl.split('/').at(-1)&&b.workerId==='openclaw-dell-chatgpt-wake-dev');
if(bindings.length!==1)fail('LOCAL_BOUND_REGISTRY_MISMATCH');
const ps='(Get-CimInstance Win32_Process -Filter "ProcessId='+pid+'").CommandLine';
const line=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',timeout:10000,maxBuffer:8192}).trim();
if(!line||line.includes('--type=')||!line.includes('--remote-debugging-port='+port)||!line.includes('--user-data-dir='+expectedDir))fail('CHROME_PROCESS_IDENTITY_MISMATCH');
const get=(path)=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path,timeout:4000},res=>{let s='';res.on('data',b=>{s+=b;if(s.length>524288)res.destroy()});res.on('end',()=>{try{resolve(JSON.parse(s))}catch(e){reject(e)}})}).on('error',reject)});
(async()=>{
const inventory=await get('/json');
const tabs=inventory.filter(t=>t&&t.type==='page'&&t.id===targetId&&t.url===expectedUrl&&/^ws:\/\/127\.0\.0\.1:/.test(t.webSocketDebuggerUrl||''));
if(tabs.length!==1)fail('EXACT_TAB_IDENTITY_MISMATCH');
const ws=new WebSocket(tabs[0].webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
let seq=0;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(!pending.has(m.id))return;const [ok,no]=pending.get(m.id);pending.delete(m.id);m.error?no(Error(m.error.message)):ok(m.result)};
const call=(method,params={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,[res,rej]);ws.send(JSON.stringify({id,method,params}))});
try{
await call('Accessibility.enable');
const ax=await call('Accessibility.getFullAXTree');
const hits=ax.nodes.filter(n=>!n.ignored&&n.role?.value==='textbox'&&n.name?.value==='Ask ChatGPT');
if(hits.length!==1||!Number.isInteger(hits[0].backendDOMNodeId))fail('COMPOSER_AX_AMBIGUOUS');
const dom=await call('DOM.describeNode',{backendNodeId:hits[0].backendDOMNodeId,depth:0});
const attrs=dom.node?.attributes||[];
const map=Object.fromEntries(Array.from({length:attrs.length/2},(_,i)=>[attrs[2*i],attrs[2*i+1]]));
if(map.role!=='textbox'||map.contenteditable!=='true'||(map['aria-label']!=='Ask ChatGPT'&&map['data-placeholder']!=='Ask ChatGPT'))fail('COMPOSER_DOM_AX_MISMATCH');
const loc=await call('Runtime.evaluate',{expression:'location.href',returnByValue:true});
if(loc.result?.value!==expectedUrl)fail('PAGE_NAVIGATED');
const action=process.argv[9]||'probe';
if(!['probe','focus','draft-test','submit'].includes(action))fail('ACTION_NOT_ALLOWED');
if(action==='focus'||action==='draft-test'||action==='submit'){
 const same=await call('Accessibility.getFullAXTree');
 const pre=same.nodes.filter(n=>!n.ignored&&n.role?.value==='textbox'&&n.name?.value==='Ask ChatGPT'&&n.backendDOMNodeId===hits[0].backendDOMNodeId);
 if(pre.length!==1)fail('PREFLIGHT_AX_IDENTITY_CHANGED');
 await call('DOM.focus',{backendNodeId:hits[0].backendDOMNodeId});
 const post=await call('Accessibility.getFullAXTree');
 const after=post.nodes.filter(n=>!n.ignored&&n.role?.value==='textbox'&&n.name?.value==='Ask ChatGPT'&&n.backendDOMNodeId===hits[0].backendDOMNodeId);
 const loc2=await call('Runtime.evaluate',{expression:'({url:location.href,focused:document.activeElement?.getAttribute("role")==="textbox" && document.activeElement?.getAttribute("contenteditable")==="true" && (document.activeElement?.getAttribute("aria-label")==="Ask ChatGPT" || document.activeElement?.getAttribute("data-placeholder")==="Ask ChatGPT")})',returnByValue:true});
 if(after.length!==1||loc2.result?.value?.url!==expectedUrl||loc2.result?.value?.focused!==true)fail('POSTFOCUS_IDENTITY_UNVERIFIED');
}
if(action==='submit'){
 const crypto=require('crypto');
 const req=JSON.parse(fs.readFileSync(0,'utf8'));
 const valid=/^[a-f0-9]{64}$/;
 const message=req.message;
 if(typeof message!=='string'||message.length>4096||!message.length||/[^\x20-\x7e]/.test(message))fail('INVALID_SUBMIT_MESSAGE');
 if(!valid.test(req.eventId||'')||!valid.test(req.challenge||'')||
   !message.includes('[AI_CORE_WAKE:'+req.eventId+']')||
   !message.includes('[AI_CORE_ATTEST:'+req.challenge+']')||
   !message.includes('[AI_CORE_ATTEST_ACK:'+req.challenge+']'))fail('INVALID_BOUND_MARKERS');
 if(!Number.isSafeInteger(req.leaseDeadlineEpochMs)||Date.now()+3000>=req.leaseDeadlineEpochMs)fail('LEASE_EXPIRED');
 const directory=path.join(process.env.LOCALAPPDATA,'AI-Core','chatgpt-wake-dev-receipts');
 const marker=path.join(directory,fingerprint+'-'+req.eventId+'.native-input.json');
 if(!fs.statSync(directory).isDirectory())fail('RECEIPT_DIRECTORY_MISSING');
 const hash=crypto.createHash('sha256').update(message,'utf8').digest('hex');
 const start=Date.now()/1000;
 const record={version:1,status:'INPUT_ATTEMPTING',eventId:req.eventId,challenge:req.challenge,
   bindingFingerprint:fingerprint,browserProfile:'gpt02-dell-dev',conversationId:expectedUrl.split('/').at(-1),
   pageUrl:expectedUrl,rawTargetId:targetId,accountAlias:alias,ownerChannel:bindings[0].ownerChannel,
   workerId:'openclaw-dell-chatgpt-wake-dev',messageHash:hash,allowProviderLf:!!req.allowProviderLf,
   inputStartedAt:start,sendAttemptedAt:null,diagnosticStage:'INPUT_MARKED'};
 const getDraft=async()=>{const v=await call('Runtime.evaluate',{expression:'document.activeElement?.innerText||""',returnByValue:true});return v.result?.value};
 const original=await getDraft();
 if(typeof original!=='string'||!['','Ask ChatGPT'].includes(original.trim()))fail('PREEXISTING_DRAFT');
 const file=fs.openSync(marker,'wx',0o600);
 const save=()=>{const buf=Buffer.from(JSON.stringify(record));fs.ftruncateSync(file,0);fs.writeSync(file,buf,0,buf.length,0);fs.fsyncSync(file)};
 try{
  save();
  if(Date.now()+3000>=req.leaseDeadlineEpochMs)fail('LEASE_EXPIRED_AFTER_MARKER');
  await call('Input.insertText',{text:message});
  record.diagnosticStage='INPUT_INSERTED';save();
  if(await getDraft()!==message)fail('EXACT_DRAFT_READBACK_FAILED');
  record.diagnosticStage='FIRST_READBACK_VERIFIED';save();
  const tree=await call('Accessibility.getFullAXTree');
  const send=tree.nodes.filter(n=>!n.ignored&&n.role?.value==='button'&&n.name?.value==='Send');
  if(send.length!==1||!Number.isInteger(send[0].backendDOMNodeId))fail('SEND_CONTROL_AMBIGUOUS');
  const node=await call('DOM.describeNode',{backendNodeId:send[0].backendDOMNodeId,depth:0});
  if(node.node?.nodeName!=='BUTTON')fail('SEND_CONTROL_WRONG_TYPE');
  if(await getDraft()!==message)fail('SECOND_DRAFT_READBACK_FAILED');
  const url=await call('Runtime.evaluate',{expression:'location.href',returnByValue:true});
  if(url.result?.value!==expectedUrl||Date.now()+3000>=req.leaseDeadlineEpochMs)fail('PRESEND_GUARD_FAILED');
  record.sendAttemptedAt=Date.now()/1000;record.status='SEND_ATTEMPTING';record.diagnosticStage='SEND_INVOKING';save();
  const obj=await call('DOM.resolveNode',{backendNodeId:send[0].backendDOMNodeId});
  if(!obj.object?.objectId)fail('SEND_NODE_RESOLUTION_FAILED');
  const invoked=await call('Runtime.callFunctionOn',{objectId:obj.object.objectId,
    functionDeclaration:'function(){if(this.tagName!=="BUTTON"||this.disabled||this.getAttribute("aria-disabled")==="true")return false;this.click();return true}',
    returnByValue:true});
  if(invoked.result?.value!==true)fail('SEND_OUTCOME_UNKNOWN');
  record.status='SEND_INVOKED';record.diagnosticStage='SEND_INVOKED';save();
  console.log(JSON.stringify({ok:true,result:{sendInvoked:true,deliveryVerified:false,verifiedAssistantReply:false,
    bindingFingerprint:fingerprint,eventId:req.eventId,inputStartedAt:start,sendAttemptedAt:record.sendAttemptedAt}}));
 }finally{fs.closeSync(file)}
}
if(action==='draft-test'){
 const sample='HS-GPT02-DRAFT-VERIFY-20261024';
 const getDraft=async()=>{const v=await call('Runtime.evaluate',{expression:'document.activeElement?.innerText||""',returnByValue:true});return v.result?.value};
 const before=await getDraft();
 if(typeof before!=='string'||!['','Ask ChatGPT'].includes(before.trim()))fail('EXISTING_DRAFT_NOT_EMPTY');
 let inserted=false; let exact=false;
 try{
  await call('Input.insertText',{text:sample});inserted=true;
  const draft=await getDraft();
  exact=draft===sample;
  const tree=await call('Accessibility.getFullAXTree');
  if(tree.nodes.filter(n=>!n.ignored&&n.role?.value==='textbox'&&n.name?.value==='Ask ChatGPT').length!==1)fail('POSTDRAFT_AX_AMBIGUOUS');
  if(!exact)fail('DRAFT_EXACT_READBACK_FAILED');
  const sends=tree.nodes.filter(n=>!n.ignored&&n.role?.value==='button'&&n.name?.value==='Send');
  if(sends.length!==1||!Number.isInteger(sends[0].backendDOMNodeId))fail('SEND_CONTROL_NOT_UNIQUE');
  const sendDom=await call('DOM.describeNode',{backendNodeId:sends[0].backendDOMNodeId,depth:0});
  if(sendDom.node?.nodeName!=='BUTTON')fail('SEND_CONTROL_NOT_BUTTON');
 }finally{
  if(inserted){
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
   await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
   const after=await getDraft();
   if((typeof after!=='string'||!['','Ask ChatGPT'].includes(after.trim())))fail('DRAFT_CLEANUP_UNVERIFIED');
  }
 }
 console.log('DRAFT_EXACT_MATCH=true; DRAFT_CLEANUP_VERIFIED=true; SEND_NOT_INVOKED=true');
}
if(action!=='submit') console.log(JSON.stringify({ok:true,mode:action==='focus'?'focus-verified':'read-only',pid,port,targetId,composerRole:'textbox',composerName:'Ask ChatGPT',backendNodeId:hits[0].backendDOMNodeId,axHits:hits.length,urlVerified:true,domAttributesVerified:true}));
}finally{ws.close()}
})().catch(e=>{console.error('ADAPTER_STOP:'+e.message);process.exitCode=1});