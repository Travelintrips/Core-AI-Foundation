'use strict';
const fs=require('node:fs'),path=require('node:path');
const {parseUniqueJson}=require('./gpt02-json-unique-stage.js');
const DAY=86_400_000,HOUR=3_600_000,HEX16=/^[a-f0-9]{16}$/;
function evaluateRows(rows,now=Date.now()){
 const deny=reason=>({allowed:false,reason,scope:'GPT02_PASSIVE_SUBMIT_RATE_GATE'});
 if(!Number.isFinite(now)||!Array.isArray(rows))return deny('PASSIVE_RATE_INPUT_INVALID');
 const incidents=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)||!Number.isInteger(row.responseStatus)||row.responseStatus<100||row.responseStatus>599)
   return deny('PASSIVE_RATE_LOG_MALFORMED');
  if(row.captureMode!=='PASSIVE_SUBMIT_STREAM')continue;
  if(typeof row.capturedAtUtc!=='string'||typeof row.eventPrefix!=='string'||!HEX16.test(row.eventPrefix))
   return deny('PASSIVE_RATE_EVIDENCE_INVALID');
  const at=Date.parse(row.capturedAtUtc);
  if(!Number.isFinite(at)||at>now)return deny('PASSIVE_RATE_TIMESTAMP_INVALID');
  if(row.responseStatus!==429)continue;
  if(row.retryAfterInvalid===true)return deny('PASSIVE_RETRY_AFTER_INVALID');
  let retryUntil=0;
  if(row.retryAfterSeconds!==undefined){
   if(!Number.isInteger(row.retryAfterSeconds)||row.retryAfterSeconds<0||row.retryAfterSeconds>86400)return deny('PASSIVE_RETRY_AFTER_INVALID');
   retryUntil=at+row.retryAfterSeconds*1000;
  }
  if(row.retryAfterUtc!==undefined){
   const u=Date.parse(row.retryAfterUtc);
   if(!Number.isFinite(u)||u<at)return deny('PASSIVE_RETRY_AFTER_INVALID');
   retryUntil=Math.max(retryUntil,u);
  }
  incidents.push({at,retryUntil,cooldownUntil:retryUntil>at?Math.min(at+HOUR,retryUntil+5000):at+HOUR});
 }
 const recent=incidents.filter(x=>now-x.at<DAY);
 const unique=new Set(recent.map(x=>x.at));
 if(unique.size!==recent.length)return deny('PASSIVE_429_IDENTITY_AMBIGUOUS');
 if(recent.length>=2)return deny('PASSIVE_429_REPEAT_REMEDIATION_REQUIRED');
 if(recent.some(x=>now<x.retryUntil))return deny('PASSIVE_PROVIDER_RETRY_AFTER_ACTIVE');
 if(recent.some(x=>now<x.cooldownUntil))return deny('PASSIVE_429_COOLDOWN');
 return {allowed:true,reason:'PASSIVE_SUBMIT_RATE_GATE_CLEAR',scope:'GPT02_PASSIVE_SUBMIT_RATE_GATE',
   passive429Last24h:recent.length};
}
function evaluateFiles(root,now=Date.now()){
 try{
  const p=path.join(root,'native-response-metadata.jsonl');
  if(!fs.existsSync(p)||fs.statSync(p).size>4_000_000)return {allowed:false,reason:'PASSIVE_RATE_LOG_UNAVAILABLE',scope:'GPT02_PASSIVE_SUBMIT_RATE_GATE'};
  const lines=fs.readFileSync(p,'utf8').trimEnd().split(/\r?\n/);
  if(!lines.length||lines.length>10000)return {allowed:false,reason:'PASSIVE_RATE_LOG_UNAVAILABLE',scope:'GPT02_PASSIVE_SUBMIT_RATE_GATE'};
  return evaluateRows(lines.map(parseUniqueJson),now);
 }catch{return {allowed:false,reason:'PASSIVE_RATE_LOG_UNVERIFIED',scope:'GPT02_PASSIVE_SUBMIT_RATE_GATE'}}
}
module.exports={evaluateRows,evaluateFiles};
if(require.main===module)console.log(JSON.stringify(evaluateFiles(__dirname)));
