'use strict';
// DEV DELL only. Computes resume authorization from immutable historical evidence,
// fresh native audit and exact persisted ACK proof. Never modifies capture log.
const fs=require('node:fs'),path=require('node:path');
const {evaluate}=require('./gpt02-effective-rate-audit-readonly.cjs');
const {evaluateFiles}=require('./gpt02-legacy429-quarantine-validator.cjs');
const {evaluateFiles:evaluateProbeRows}=require('./gpt02-task167-nonoperational-probe-quarantine.cjs');
const {parseUniqueJson}=require('./gpt02-json-unique-stage.js');
const {evaluateFiles:evaluateNative200Proof}=require('./gpt02-task167-native200-recovery-validator.cjs');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DAY=86_400_000,HOUR=3_600_000;
const COMMAND='f9081674-7575-4cb3-a627-d51c264f7ef5';
const RESPONSE='d30bdaff-4c35-4d11-a0f9-e29b1b40235a';
function evaluateRecovery(root,now=Date.now()){
 const deny=(reason)=>({authorized:false,reason,scope:'GPT02_DELL_DEV_RECOVERY',immutableHistoricalRows:3});
 if(!Number.isFinite(now))return deny('RECOVERY_CLOCK_UNVERIFIED');
 try{
  const probes=evaluateProbeRows(root),legacy=evaluateFiles(root,now,probes.valid===true?probes.excludedRows:[]),effective=evaluate(root,now);
  if(probes.valid!==true)return deny('NONOPERATIONAL_PROBES_'+String(probes.reason||'INVALID'));
  if(legacy.valid!==true)return deny('LEGACY_QUARANTINE_'+String(legacy.reason||'INVALID'));
  if(legacy.reason!=='LEGACY_QUARANTINE_AGED_CONDITIONALLY')return deny('HISTORICAL_PREFIX_NOT_VALIDATED');
  if(effective.effectiveAllowed!==true||effective.historicalQuarantineValid!==true)return deny('NEW_RATE_AUDIT_FAILED');
  const src=fs.readFileSync(path.join(root,'native-response-metadata.jsonl'),'utf8');
  if(Buffer.byteLength(src)>4e6)return deny('RATE_LOG_OVERSIZED');
  const rows=src.trimEnd().split(/\r?\n/).map(parseUniqueJson);
  const excluded=new Set([...legacy.excludedRows,...probes.excludedRows]);
  const dated=[];
  for(let i=0;i<rows.length;i++){
   if(excluded.has(i+1))continue;
   const r=rows[i];
   if(r.responseStatus!==429)continue;
   const t=Date.parse(r.capturedAtUtc);
   if(!Number.isFinite(t)||t>now)return deny('NEW_429_TIMESTAMP_INVALID');
   if(r.retryAfterInvalid===true)return deny('PROVIDER_RETRY_AFTER_UNVERIFIED');
   // Retry-After seconds or HTTP date: persist future-until if provided.
   let retryUntil=0;
   const ra=r.retryAfterSeconds;
   if(ra!==undefined){
    if(!Number.isInteger(ra)||ra<0||ra>86400)return deny('RETRY_AFTER_INVALID');
    retryUntil=t+ra*1000;
   }
   if(r.retryAfterUtc!==undefined){
    const until=Date.parse(r.retryAfterUtc);
    if(!Number.isFinite(until)||until<t)return deny('RETRY_AFTER_INVALID');
    retryUntil=Math.max(retryUntil,until);
   }
   let cooldownUntil=t+HOUR;
   if(retryUntil>t)cooldownUntil=Math.min(t+HOUR,retryUntil+5000);
   dated.push({at:t,retryUntil,cooldownUntil});
  }
  const recent=dated.filter(x=>now-x.at<DAY);
  if(recent.length>=2)return deny('REPEATED_NEW_429_24H');
  if(dated.some(x=>now<x.retryUntil))return deny('PROVIDER_RETRY_AFTER_ACTIVE');
  if(recent.some(x=>now<x.cooldownUntil))return deny('NEW_429_COOLDOWN');
  const lastNew429=dated.length?Math.max(...dated.map(x=>x.at)):0;
  // No automatic resume after a fresh provider denial until a newer native 200
  // is independently verified; even when a simple cooldown has elapsed.
  const successful=rows.some(r=>r.responseStatus===200 && typeof r.capturedAtUtc==='string' &&
    Date.parse(r.capturedAtUtc)>lastNew429 &&
    Number.isFinite(Date.parse(r.capturedAtUtc)) &&
    Date.parse(r.capturedAtUtc)>=Date.parse('2026-11-07T08:00:34Z') &&
    Date.parse(r.capturedAtUtc)<=now &&
    r.responseTruncated===false && r.responsePresent===true);
  const native200=evaluateNative200Proof(root,now,lastNew429);
  if(!successful&&native200.valid!==true)return deny('NEW_NATIVE_HTTP200_PROOF_MISSING');
  // Verified non-lifecycle probes are excluded from operational incident counts,
  // but a newer probe 429 invalidates older native HTTP 200 recovery evidence.
  let latestProbe429=0;
  for(const n of probes.excludedRows){
    const p=rows[n-1];
    if(!p||p.responseStatus!==429)return deny('PROBE_RATE_EVIDENCE_INVALID');
    const at=Date.parse(p.capturedAtUtc);
    if(!Number.isFinite(at)||at>now)return deny('PROBE_429_TIMESTAMP_INVALID');
    latestProbe429=Math.max(latestProbe429,at);
  }
  if(latestProbe429>0){
    const logged200=rows.reduce((v,r)=>r.responseStatus===200&&r.responsePresent===true&&r.responseTruncated===false&&
      Number.isFinite(Date.parse(r.capturedAtUtc))&&Date.parse(r.capturedAtUtc)<=now?
      Math.max(v,Date.parse(r.capturedAtUtc)):v,0);
    const proven200=native200.valid===true?native200.capturedAt:0;
    if(Math.max(logged200,proven200)<=latestProbe429)return deny('PROBE_429_NEWER_THAN_NATIVE200_PROOF');
  }
  const journal=path.join(root,'gpt02-ack-attempt-'+COMMAND+'.json');
  if(!fs.existsSync(journal)||fs.statSync(journal).size>10000)return deny('ACK_JOURNAL_MISSING');
  const j=fs.readFileSync(journal,'utf8').trimEnd().split(/\r?\n/).map(parseUniqueJson);
  if(!j.some(r=>r.commandId===COMMAND&&r.responseId===RESPONSE&&r.stage==='ACK_INTENT_BEFORE_POST'))return deny('ACK_INTENT_MISMATCH');
  if(!j.some(r=>r.stage==='ACK_POST_RESPONSE'&&r.post?.http===200&&r.post?.id===RESPONSE&&r.post?.commandId===COMMAND))return deny('ACK_POST_UNVERIFIED');
  if(!j.some(r=>r.stage==='EXACT_GET_READBACK'&&r.verified===true&&Number.isFinite(Date.parse(r.at))&&Date.parse(r.at)>lastNew429&&Date.parse(r.at)<=now&&Number.isFinite(Date.parse(r.acknowledgedAt))&&Date.parse(r.acknowledgedAt)<=now))return deny('ACK_READBACK_UNVERIFIED');
  if(fs.existsSync(path.join(root,'dell-wake-reconciliation-required.json')))return deny('RECONCILIATION_REQUIRED');
  return {authorized:true,reason:'NEW_NATIVE_AND_ACK_VERIFIED_HISTORICAL_QUARANTINE_ACCEPTED',scope:'GPT02_DELL_DEV_RECOVERY',immutableHistoricalRows:3,new429Last24h:recent.length};
 }catch{return deny('RECOVERY_EVIDENCE_UNAVAILABLE');}
}
if(require.main===module)console.log(JSON.stringify(evaluateRecovery(__dirname)));
module.exports={evaluateRecovery};
