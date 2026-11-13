'use strict';
// DEV-only CDP response capture, no page navigation or user input.
// Caller owns navigation only AFTER READY from arm(). Fail-closed on ambiguity.
const {arm}=require('./gpt02-cdp-listener-stage.js');
function exactApi(url,conversationId){
 return typeof url==='string' && url.startsWith('https://chatgpt.com/backend-api/conversations/'+conversationId)
  && (url.length===('https://chatgpt.com/backend-api/conversations/'+conversationId).length || /[?#]/.test(url['https://chatgpt.com/backend-api/conversations/'.length+conversationId.length]));
}
async function capture(port,id,expectedTabUrl,conversationId,timeoutMs=90000){
 if(process.env.AI_CORE_GPT02_CDP_READY_CAPTURE_DEV!=='1')throw Error('CDP_CAPTURE_NOT_AUTHORIZED_DEV');
 if(!/^[0-9a-f-]{36}$/i.test(conversationId))throw Error('INVALID_CONVERSATION_ID');
 if(expectedTabUrl!=='about:blank'&&expectedTabUrl!=='https://chatgpt.com/c/'+conversationId)throw Error('INVALID_TAB_URL');
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>90000)throw Error('INVALID_CAPTURE_TIMEOUT');
 let selected=null,closed=false,settleOk,settleFail;
 const done=new Promise((resolve,reject)=>{settleOk=resolve;settleFail=reject});
 const events=(e)=>{
  const v=e.params||{};
  if(e.method==='Network.responseReceived'&&exactApi(v.response?.url,conversationId)){
   if(selected&&selected.requestId!==v.requestId){settleFail(Error('AMBIGUOUS_RESPONSE'));return}
   selected={requestId:v.requestId,url:v.response.url,status:v.response.status,headers:v.response.headers||{}};
  }
  if(e.method==='Network.loadingFailed'&&selected&&v.requestId===selected.requestId)settleFail(Error('CAPTURE_LOADING_FAILED'));
  if(e.method==='Network.loadingFinished'&&selected&&v.requestId===selected.requestId)settleOk(selected);
 };
 const {ws,call}=await arm(port,id,expectedTabUrl,events);
 try{
  let timer;
  let response;
  try{response=await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('CAPTURE_TIMED_OUT')),timeoutMs)})])}
  finally{clearTimeout(timer)}
  const raw=await Promise.race([call('Network.getResponseBody',{requestId:response.requestId}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BODY_TIMED_OUT')),8000)})]).finally(()=>clearTimeout(timer));
  if(typeof raw?.body!=='string')throw Error('BODY_MISSING');
  const body=raw.base64Encoded?Buffer.from(raw.body,'base64').toString('utf8'):raw.body;
  if(body.length>4000000)throw Error('CAPTURE_TRUNCATED_FAIL_CLOSED');
  return {ok:true,targetId:id,url:'https://chatgpt.com/c/'+conversationId,response:{url:response.url,status:response.status,headers:response.headers,body,truncated:false}};
 }finally{if(!closed){ws.close();closed=true}}
}
module.exports={exactApi,capture};
if(require.main===module){
 const [action,portArg,id,expectedTabUrl,conversationId,timeoutArg]=process.argv.slice(2);
 if(action!=='--capture'||!/^\d{4,5}$/.test(portArg||'')||!/^\d{3,5}$/.test(timeoutArg||'')){
  console.error('STAGING_CAPTURE_CLI_INVALID_ARGUMENTS');process.exitCode=1;
 }else{
  capture(Number(portArg),id,expectedTabUrl,conversationId,Number(timeoutArg))
   .then(result=>console.log(JSON.stringify(result)))
   .catch(error=>{console.error('STAGING_CAPTURE_FAILED:'+error.message);process.exitCode=1});
 }
}
