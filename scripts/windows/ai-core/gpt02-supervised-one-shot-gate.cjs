'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluateFiles}=require('./gpt02-legacy429-quarantine-validator.cjs');
const {evaluate}=require('./gpt02-effective-rate-audit-readonly.cjs');
const {evaluateFiles:evaluatePassive}=require('./gpt02-passive-submit-rate-gate.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_CACHE_HASHES=Object.freeze({
 "dev_chatgpt_native_transport.py":"17d0a6e00c966d6ad391779205826a91f989ec426fc073519ac60bf9bfb72b95",
 "gpt02-local-cache-readback.js":"d7258da2acc5c7650056da1049463667cabd91f86b5a2d907ec1d112de57aeec"
});
const PASSIVE_HASHES=Object.freeze({
 "dev_chatgpt_native_transport.py":"17d0a6e00c966d6ad391779205826a91f989ec426fc073519ac60bf9bfb72b95",
 "gpt02-cdp-submit-passive-stage.js":"8c559ece7f024d4bfab226ea34703d5eee89714c77cf24c3efd1bd36700f6797",
 "gpt02_submit_stream_reader.py":"aa5d36512eabb5f5d2e4469cd33ca8681e3b6577e65a78374c1938c4d0726da2",
 "gpt02-passive-submit-rate-gate.cjs":"aa252197049767e38a8e07462419c9f88de2f4cfdc367d25f979c2c91ca3cfad",
 "gpt02_passive_submit_rate_gate.py":"ead7bdd9a7ae882ae0d39a84c125303890141b63840c1bdd1033cb15df2fe127"
});
function sourceHash(root){
 return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'native-response-metadata.jsonl'))).digest('hex').toUpperCase();
}
function localCacheArchitectureHash(root){
 const rows=[];
 for(const [name,expected] of Object.entries(LOCAL_CACHE_HASHES)){
  const file=path.join(root,name);
  if(!fs.existsSync(file))return null;
  const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(actual!==expected)return null;
  rows.push(name+'='+actual);
 }
 return crypto.createHash('sha256').update('gpt02-local-cache-supervised/v1\n'+rows.join('\n')).digest('hex').toUpperCase();
}
function passiveArchitectureHash(root){
 const rows=[];
 for(const [name,expected] of Object.entries(PASSIVE_HASHES)){
  const file=path.join(root,name);
  if(!fs.existsSync(file))return null;
  const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(actual!==expected)return null;
  rows.push(name+'='+actual);
 }
 return crypto.createHash('sha256').update('gpt02-passive-supervised/v1\n'+rows.join('\n')).digest('hex').toUpperCase();
}
function consumeMarker(root,id,hash,now){
 const marker=path.join(root,'gpt02-supervised-one-shot-used-'+id+'.json');
 if(fs.existsSync(marker))return false;
 try{
  const fd=fs.openSync(marker,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({targetCommandId:id,consumedAtUtc:new Date(now).toISOString(),sourceSha256:hash})+'\n');fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  return true;
 }catch{return false;}
}
function check(root,id,now=Date.now(),consume=false){
 const fail=reason=>({allowed:false,reason,supervised:true});
 if(!UUID.test(id||''))return fail('TARGET_UUID_INVALID');
 try{
  const grant=JSON.parse(fs.readFileSync(path.join(root,'gpt02-supervised-one-shot-grant.json'),'utf8').replace(/^\uFEFF/,''));
  if(grant.targetCommandId!==id||grant.oneTime!==true)return fail('GRANT_SCOPE_MISMATCH');
  const created=Date.parse(grant.createdAtUtc),expires=Date.parse(grant.expiresAtUtc);
  if(!Number.isFinite(now)||!Number.isFinite(created)||!Number.isFinite(expires)||created>now||now>expires||expires-created>300000||expires-created<=0)return fail('GRANT_EXPIRED_OR_INVALID');
  const mon=JSON.parse(fs.readFileSync(path.join(root,'gpt02-dev-monitor-latest.json'),'utf8').replace(/^\uFEFF/,''));
  const checked=Date.parse(mon.checkedAt);
  if(mon.scope!=='DELL_DEV_LOCAL_ONLY'||mon.taskState!=='Disabled'||mon.workerCount!==0||!Number.isFinite(checked)||checked>now||now-checked>120000)return fail('MONITOR_NOT_SAFE_FOR_ONE_SHOT');
  const hash=sourceHash(root);
  if(grant.sourceSha256!==hash)return fail('SOURCE_LOG_HASH_CHANGED');
  const marker=path.join(root,'gpt02-supervised-one-shot-used-'+id+'.json');
  if(fs.existsSync(marker))return fail('GRANT_ALREADY_USED');
  if(grant.version===3&&grant.scope==='DELL_GPT02_DEV_LOCAL_CACHE_SINGLE_COMMAND'){
   const arch=localCacheArchitectureHash(root);
   if(!arch||grant.localCacheArchitectureSha256!==arch)return fail('LOCAL_CACHE_ARCHITECTURE_MISMATCH');
  }else if(grant.version===2&&grant.scope==='DELL_GPT02_DEV_PASSIVE_SINGLE_COMMAND'){
   const arch=passiveArchitectureHash(root);
   if(!arch||grant.passiveArchitectureSha256!==arch)return fail('PASSIVE_ARCHITECTURE_MISMATCH');
   const passive=evaluatePassive(root,now);
   if(passive.allowed!==true)return fail('PASSIVE_RATE_GATE_'+String(passive.reason||'BLOCKED'));
  }else if(grant.version===1&&grant.scope==='DELL_GPT02_DEV_SINGLE_NEW_COMMAND'){
   if(!(mon.preclaimGateClear===true||(mon.preclaimGateClear===false&&mon.preclaimGateReason==='PRECLAIM_NOT_CLEAR'&&mon.strictRateAuditReason==='AUDIT_429_TIMESTAMP_UNVERIFIED'&&mon.unverifiable429Count===3))||mon.effectiveRateAuditAllowed!==true||mon.native429Last24Hours!==0||mon.native429LastHour!==0)return fail('MONITOR_NOT_SAFE_FOR_ONE_SHOT');
   const q=evaluateFiles(root,now),eff=evaluate(root,now);
   if(q.valid!==true||eff.effectiveAllowed!==true||eff.historicalQuarantineValid!==true)return fail('RATE_EVIDENCE_NOT_CLEAR');
  }else return fail('GRANT_SCOPE_MISMATCH');
  const readyReason=grant.version===3?'LOCAL_CACHE_SUPERVISED_SINGLE_COMMAND_READY':grant.version===2?'PASSIVE_SUPERVISED_SINGLE_COMMAND_READY':'SUPERVISED_SINGLE_COMMAND_READY';
  const consumedReason=grant.version===3?'LOCAL_CACHE_SUPERVISED_SINGLE_COMMAND_CONSUMED':grant.version===2?'PASSIVE_SUPERVISED_SINGLE_COMMAND_CONSUMED':'SUPERVISED_SINGLE_COMMAND_CONSUMED';
  if(!consume)return {allowed:true,reason:readyReason,supervised:true};
  if(!consumeMarker(root,id,hash,now))return fail('GRANT_ALREADY_USED_OR_MARKER_UNWRITABLE');
  return {allowed:true,reason:consumedReason,supervised:true};
 }catch{return fail('GRANT_OR_EVIDENCE_UNAVAILABLE');}
}
module.exports={check,localCacheArchitectureHash,passiveArchitectureHash,sourceHash};
