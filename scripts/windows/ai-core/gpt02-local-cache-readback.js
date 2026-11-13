'use strict';
// DEV GPT02 read-only cache adapter. No fetch/XHR/navigation/input.
// Reads only the exact ChatGPT tab's codex-browser-host IndexedDB cache.
const [portS,targetId,conversationId,eventId,challenge]=process.argv.slice(2);
const port=Number(portS);
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const RAW=/^[a-f0-9]{32}$/i,DIG=/^[a-f0-9]{64}$/;
function fail(code){throw Error(code)}
if(!Number.isInteger(port)||port<1024||port>65535||!RAW.test(targetId||'')||!UUID.test(conversationId||'')||!DIG.test(eventId||'')||!DIG.test(challenge||''))fail('CACHE_READBACK_ARGS_INVALID');
const http=require('node:http');
function getJson(path){return new Promise((ok,no)=>http.get({host:'127.0.0.1',port,path,timeout:4000},r=>{let s='';r.on('data',b=>{s+=b;if(s.length>524288)r.destroy()});r.on('end',()=>{try{ok(JSON.parse(s))}catch(e){no(e)}})}).on('error',no))}
(async()=>{
 const tabs=await getJson('/json/list');
 const url='https://chatgpt.com/c/'+conversationId;
 const rows=tabs.filter(x=>x&&x.type==='page'&&x.id===targetId&&x.url===url&&typeof x.webSocketDebuggerUrl==='string');
 if(rows.length!==1)fail('CACHE_READBACK_TARGET_INVALID');
 const ws=new WebSocket(rows[0].webSocketDebuggerUrl);
 await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
 let seq=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);const pair=pending.get(m.id);if(!pair)return;pending.delete(m.id);m.error?pair[1](Error('CDP_ERROR')):pair[0](m.result)};
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,[ok,no]);ws.send(JSON.stringify({id,method,params}))});
 try{
  const expr='(async()=>{'+
   'const db=await new Promise((res,rej)=>{const r=indexedDB.open("codex-browser-host");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});'+
   'const tx=db.transaction("records","readonly");const st=tx.objectStore("records");'+
   'const rows=await new Promise((res,rej)=>{const q=st.getAll();q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});db.close();'+
   'const event='+JSON.stringify(eventId)+',challenge='+JSON.stringify(challenge)+';'+
   'const seen=new WeakSet();let answer=null;function walk(v,path,depth,currentCachedAt){if(answer||!v||typeof v!=="object"||depth>10||seen.has(v))return;seen.add(v);if(typeof v.cachedAt==="number"&&Number.isFinite(v.cachedAt))currentCachedAt=v.cachedAt;'+
   'if(Array.isArray(v)&&v.length&&v.every(x=>x&&typeof x==="object"&&typeof x.id==="string"&&typeof x.text==="string")){'+
   'for(let i=0;i<v.length-1;i++){const a=v[i],b=v[i+1],at=String(a.text||""),bt=String(b.text||"");'+
   'if(at.includes("[AI_CORE_WAKE:"+event+"]")&&at.includes("[AI_CORE_ATTEST:"+challenge+"]")&&bt.includes("[AI_CORE_ATTEST_ACK:"+challenge+"]")){answer={wakeId:a.id,wakeText:at,assistantId:b.id,assistantText:bt,path,cachedAt:currentCachedAt};return}}}'+
   'if(Array.isArray(v)){for(let i=0;i<v.length;i++)walk(v[i],path+"["+i+"]",depth+1,currentCachedAt)}else{for(const [k,x] of Object.entries(v))walk(x,path+"."+k,depth+1,currentCachedAt)}}'+
   'walk(rows,"rows",0,null);return answer;})()';
  const out=await call('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  const value=out?.result?.value;
  if(!value||typeof value!=='object')fail('CACHE_READBACK_PAIR_NOT_FOUND');
  if(!UUID.test(value.wakeId||'')||!UUID.test(value.assistantId||'')||value.wakeId===value.assistantId)fail('CACHE_READBACK_MESSAGE_IDS_INVALID');
  if(typeof value.wakeText!=='string'||!value.wakeText||value.wakeText.length>12000)fail('CACHE_READBACK_WAKE_TEXT_INVALID');
  if(typeof value.assistantText!=='string'||value.assistantText.length<1||value.assistantText.length>4000)fail('CACHE_READBACK_ASSISTANT_TEXT_INVALID');
  if(typeof value.cachedAt!=='number'||!Number.isFinite(value.cachedAt))fail('CACHE_READBACK_TIMESTAMP_INVALID');
  console.log(JSON.stringify({ok:true,conversationId,eventId,challenge,wakeMessageId:value.wakeId.toLowerCase(),wakeText:value.wakeText,assistantMessageId:value.assistantId.toLowerCase(),assistantText:value.assistantText,cachedAt:value.cachedAt,source:'GPT02_LOCAL_INDEXEDDB_CACHE'}));
 }finally{ws.close()}
})().catch(e=>{console.error('CACHE_READBACK_STOP:'+e.message);process.exitCode=1});
