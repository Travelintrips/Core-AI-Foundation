'use strict';
// Isolated DEV proof-of-readiness probe. Never navigates a tab or sends a message.
// Prints READY only after CDP acknowledges Network.enable for an exact target.
const http = require('http');
const { WebSocket } = globalThis;
function fail(code){throw new Error(code)}
function inspectPort(s){const n=Number(s); if(!Number.isInteger(n)||n<1024||n>65535)fail('INVALID_PORT');return n}
function inspectId(s){if(!/^[0-9a-f]{32}$/i.test(s||''))fail('INVALID_TARGET_ID');return s.toUpperCase()}
function inventory(port){return new Promise((resolve,reject)=>{
 const req=http.get({hostname:'127.0.0.1',port,path:'/json/list',timeout:5000},r=>{
  if(r.statusCode!==200){r.resume();return reject(Error('CDP_INVENTORY_HTTP_'+r.statusCode))}
  let body='';r.setEncoding('utf8');
  r.on('data',c=>{body+=c;if(body.length>524288)r.destroy(Error('INVENTORY_OVERSIZE'))});
  r.on('end',()=>{try{resolve(JSON.parse(body))}catch(e){reject(Error('INVENTORY_INVALID_JSON'))}});
 });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('INVENTORY_TIMEOUT')));
})}
async function arm(port,id,expectedUrl,onEvent){
 const tabs=await inventory(port);
 if(!Array.isArray(tabs))fail('INVALID_TABS');
 const exact=tabs.filter(t=>t.type==='page'&&String(t.id).toUpperCase()===id&&t.url===expectedUrl);
 if(exact.length!==1)fail('TARGET_IDENTITY_NOT_PROVEN');
 const endpoint=exact[0].webSocketDebuggerUrl;
 if(typeof endpoint!=='string'||!endpoint.startsWith('ws://127.0.0.1:'+port+'/devtools/page/'))fail('CDP_ENDPOINT_MISMATCH');
 const ws=new WebSocket(endpoint);
 let seq=0,opened=false;
 const pending=new Map(),events=[];
 const watchdog=setTimeout(()=>{if(!opened)ws.close()},7000);
 try{
  await new Promise((resolve,reject)=>{
   ws.addEventListener('open',()=>{opened=true;resolve()},{once:true});
   ws.addEventListener('error',()=>reject(Error('CDP_WEBSOCKET_ERROR')),{once:true});
   ws.addEventListener('close',()=>reject(Error('CDP_WEBSOCKET_CLOSED')),{once:true});
  });
  ws.addEventListener('message',e=>{
   try{
    const v=JSON.parse(e.data);
    if(typeof v.id==='number'){
     const p=pending.get(v.id);if(p){pending.delete(v.id);v.error?p.reject(Error('CDP_'+p.method+'_FAILED')):p.resolve(v.result)}
    }else{
     if(v.method==='Network.responseReceived'){
      const r=v.params?.response;
      events.push({url:r?.url||'',status:r?.status||null,requestId:v.params?.requestId||''});
     }
     if(typeof onEvent==='function')onEvent(v);
    }
   }catch(e){}
  });
  const call=(method,params)=>new Promise((resolve,reject)=>{
   const reqId=++seq,p={resolve,reject,method};pending.set(reqId,p);
   ws.send(JSON.stringify({id:reqId,method,params:params||{}}));
  });
  let timer;
  try{await Promise.race([call('Network.enable',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('NETWORK_ENABLE_TIMEOUT')),5000)})])}
  finally{clearTimeout(timer)}
  console.log(JSON.stringify({phase:'READY',proof:'CDP_NETWORK_ENABLE_ACK',targetId:id,armedAtUtc:new Date().toISOString()}));
  return {ws,events,pending,call};
 }catch(err){ws.close();throw err}finally{clearTimeout(watchdog)}
}
async function main(){
 const [portArg,idArg,urlArg,modeArg]=process.argv.slice(2);
 const port=inspectPort(portArg),id=inspectId(idArg);
 if(!/^https:\/\/chatgpt\.com\/c\/[0-9a-f-]{36}$/i.test(urlArg||''))fail('INVALID_URL');
 if(modeArg!=='--arm-only')fail('STAGE_ONLY_NO_CAPTURE');
 const {ws,events}=await arm(port,id,urlArg);
 console.log(JSON.stringify({phase:'DONE',mode:'arm-only',networkResponsesSeen:events.length,mutatedBrowser:false}));
 ws.close();
}
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({phase:'ERROR',code:e.message}));process.exitCode=1});
module.exports={inspectPort,inspectId,arm};
