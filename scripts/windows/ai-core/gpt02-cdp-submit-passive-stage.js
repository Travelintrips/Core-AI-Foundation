'use strict';
// DEV-only passive capture of the exact ChatGPT submit request already generated
// by the bound browser tab. This script NEVER navigates or issues HTTP requests.
const {arm}=require('./gpt02-cdp-listener-stage.js');
const crypto=require('crypto');
const DIGEST=/^[a-f0-9]{64}$/;
const RAW=/^[A-Fa-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function backendPost(url){
 try{
  const u=new URL(url);
  return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&u.pathname.startsWith('/backend-api/');
 }catch{return false}
}
async function captureSubmit(port,id,expectedTabUrl,conversationId,eventId,challenge,timeoutMs=180000){
 if(process.env.AI_CORE_GPT02_CDP_READY_CAPTURE_DEV!=='1')throw Error('PASSIVE_CAPTURE_NOT_AUTHORIZED_DEV');
 if(!Number.isInteger(port)||port<1024||port>65535||!RAW.test(id)||!UUID.test(conversationId)||
    expectedTabUrl!=='https://chatgpt.com/c/'+conversationId||!DIGEST.test(eventId)||!DIGEST.test(challenge)||
    !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>240000)throw Error('PASSIVE_CAPTURE_INVALID_ARGUMENTS');
 const wake='[AI_CORE_WAKE:'+eventId+']',att='[AI_CORE_ATTEST:'+challenge+']';
 let callRef=null,selected=null,response=null,doneOk,doneFail,closed=false;
 const done=new Promise((ok,no)=>{doneOk=ok;doneFail=no});
 const inspectPost=async(requestId,request)=>{
  if(request.method!=='POST'||!backendPost(request.url))return;
  let post=typeof request.postData==='string'?request.postData:null;
  if(!post&&request.hasPostData===true&&callRef){
   try{post=(await callRef('Network.getRequestPostData',{requestId})).postData}catch{return}
  }
  if(typeof post!=='string'||post.length>262144||!post.includes(wake)||!post.includes(att))return;
  if(selected&&selected.requestId!==requestId){doneFail(Error('PASSIVE_SUBMIT_AMBIGUOUS'));return}
  selected={requestId,url:request.url,method:'POST',postData:post,postSha256:crypto.createHash('sha256').update(post).digest('hex')};
 };
 const events=e=>{
  const v=e.params||{};
  if(e.method==='Network.requestWillBeSent'&&v.requestId&&v.request){
   Promise.resolve(inspectPost(v.requestId,v.request)).catch(()=>doneFail(Error('PASSIVE_POSTDATA_INVALID')));
  }else if(e.method==='Network.responseReceived'&&selected&&v.requestId===selected.requestId){
   response={requestId:v.requestId,url:v.response?.url,status:v.response?.status,headers:v.response?.headers||{},mimeType:v.response?.mimeType};
  }else if(e.method==='Network.loadingFailed'&&selected&&v.requestId===selected.requestId){
   doneFail(Error('PASSIVE_SUBMIT_LOADING_FAILED'));
  }else if(e.method==='Network.loadingFinished'&&selected&&v.requestId===selected.requestId){
   if(!response){doneFail(Error('PASSIVE_RESPONSE_MISSING'));return}
   doneOk({selected,response});
  }
 };
 const armed=await arm(port,id,expectedTabUrl,events); callRef=armed.call;
 try{
  let timer;
  const observed=await Promise.race([done,new Promise((_,no)=>{timer=setTimeout(()=>no(Error('PASSIVE_SUBMIT_TIMED_OUT')),timeoutMs)})]).finally(()=>clearTimeout(timer));
  if(!observed?.selected||!observed?.response)throw Error('PASSIVE_SUBMIT_INCOMPLETE');
  let timer2;
  const raw=await Promise.race([callRef('Network.getResponseBody',{requestId:observed.response.requestId}),
    new Promise((_,no)=>{timer2=setTimeout(()=>no(Error('PASSIVE_BODY_TIMED_OUT')),10000)})]).finally(()=>clearTimeout(timer2));
  if(typeof raw?.body!=='string')throw Error('PASSIVE_BODY_MISSING');
  const body=raw.base64Encoded?Buffer.from(raw.body,'base64').toString('utf8'):raw.body;
  if(body.length>4000000)throw Error('PASSIVE_BODY_OVERSIZE');
  return {ok:true,targetId:id,url:expectedTabUrl,request:{url:observed.selected.url,method:'POST',
    postData:observed.selected.postData,postSha256:observed.selected.postSha256},
    response:{url:observed.response.url,status:observed.response.status,headers:observed.response.headers,
      mimeType:observed.response.mimeType,body,truncated:false},captureMode:'PASSIVE_SUBMIT_STREAM'};
 }finally{if(!closed){armed.ws.close();closed=true}}
}
module.exports={captureSubmit,backendPost};
if(require.main===module){
 const [action,portS,id,url,conversationId,eventId,challenge,timeoutS]=process.argv.slice(2);
 if(action!=='--capture-submit'){console.error('PASSIVE_CAPTURE_CLI_INVALID');process.exitCode=1}
 else captureSubmit(Number(portS),id,url,conversationId,eventId,challenge,Number(timeoutS))
  .then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error('PASSIVE_CAPTURE_FAILED:'+e.message);process.exitCode=1});
}
