'use strict';
// DEV-only validation of an *immutable historical prefix*, not provider clearance.
// A quarantine manifest cannot rewrite the native log or authorize a worker.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const originalHash='9DB41F161FC8261B187D23103AE63D8B3B8D15AC4E91DD2F6B086F71B32B4D74';
const rowsToQuarantine=[15,17,18];
const upperBound=Date.parse('2026-11-03T20:34:38.170868Z');
const latest429=Date.parse('2026-11-05T17:10:15.669643Z');
const releaseNotBefore=latest429+86400000;
const hash=x=>crypto.createHash('sha256').update(x).digest('hex').toUpperCase();
function validate(raw, manifest, now=Date.now(), extraExcludedRows=[]){
  const fail=reason=>Object.freeze({valid:false,reason,excludedRows:[]});
  if(!Number.isFinite(now))return fail('CLOCK_INVALID');
  if(typeof raw!=='string'||!manifest||typeof manifest!=='object')return fail('INPUT_INVALID');
  if(manifest.recordType!=='GPT02_DEV_HISTORICAL_429_QUARANTINE_MANIFEST'||
     manifest.sourceSha256!==originalHash||
     manifest.sourceLog!=='native-response-metadata.jsonl'||
     manifest.preservedInPlace!==true||
     manifest.historicalCount!==3||
     JSON.stringify(manifest.historicalRows)!==JSON.stringify(rowsToQuarantine)||
     manifest.historicalUpperBoundUtc!=='2026-11-03T20:34:38.170868Z'||
     manifest.boundType!=='CONDITIONAL_APPEND_ORDER_NOT_PROVIDER_ATTESTATION'||
     manifest.verdict!=='STAGED_NOT_RELEASED'||
     manifest.mayOverrideNativeGate!==false||
     manifest.mayRestartModel!==false||
     manifest.mayAck!==false)return fail('MANIFEST_INVALID');
  const lines=raw.trimEnd().split(/\r?\n/);
  if(lines.length<27||lines.length>10000)return fail('ROW_COUNT_INVALID');
  // Approved source prefix must be byte-for-byte identical to the captured history.
  const first=lines.slice(0,27);
  const prefixes=[first.join('\n'),first.join('\n')+'\n',first.join('\r\n'),first.join('\r\n')+'\r\n'];
  if(!prefixes.some(p=>hash(p)===originalHash))return fail('SOURCE_PREFIX_HASH_MISMATCH');
  let rows;
  try{
    const {parseUniqueJson}=require('./gpt02-json-unique-stage.js');
    rows=lines.map(parseUniqueJson);
  }catch{return fail('JSON_INVALID');}
  for(const i of rowsToQuarantine){
    const r=rows[i-1];
    if(r?.responseStatus!==429||r?.capturedAtUtc)return fail('QUARANTINE_ROW_MISMATCH');
  }
  if(rows[18]?.responseStatus!==429||Date.parse(rows[18].capturedAtUtc)!==upperBound)
    return fail('UPPER_BOUND_ROW_MISMATCH');
  if(now<upperBound+86400000)return fail('HISTORICAL_WINDOW_NOT_AGED');
  if(now<releaseNotBefore)return fail('LATEST_429_24H_WINDOW_ACTIVE');
  // Distinct current provider 429s remain protected, regardless of old history.
  const dated=[];
  const excludedNew=new Set([...rowsToQuarantine,...extraExcludedRows]);
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(r?.responseStatus!==429||excludedNew.has(i+1))continue;
    const at=Date.parse(r.capturedAtUtc);
    if(!Number.isFinite(at)||at>now)return fail('NEW_429_TIMESTAMP_INVALID');
    if(r.retryAfterInvalid===true)return fail('PROVIDER_RETRY_AFTER_UNVERIFIED');
    let cooldownUntil=at+3600000;
    if(r.retryAfterSeconds!==undefined){
      if(!Number.isInteger(r.retryAfterSeconds)||r.retryAfterSeconds<0||r.retryAfterSeconds>86400)
        return fail('RETRY_AFTER_INVALID');
      cooldownUntil=at+Math.min(3600000,Math.max(1000,(r.retryAfterSeconds+5)*1000));
    }
    if(r.retryAfterUtc!==undefined){
      const until=Date.parse(r.retryAfterUtc);
      if(!Number.isFinite(until)||until<at)return fail('RETRY_AFTER_INVALID');
      cooldownUntil=Math.max(cooldownUntil===at+3600000&&r.retryAfterSeconds===undefined?0:cooldownUntil,
                             Math.min(at+3600000,until+5000));
    }
    dated.push({at,cooldownUntil});
  }
  const recent=dated.filter(x=>now-x.at<86400000);
  if(recent.length>=2)return fail('RECENT_REPEAT_429');
  if(recent.some(x=>now<x.cooldownUntil))return fail('RECENT_429_COOLDOWN');
  return Object.freeze({valid:true,reason:'LEGACY_QUARANTINE_AGED_CONDITIONALLY',excludedRows:[...rowsToQuarantine],
    providerClearance:false,workerResumeAuthorized:false,releaseNotBeforeUtc:new Date(releaseNotBefore).toISOString()});
}
function evaluateFiles(root,now=Date.now()){
 try{
  const raw=fs.readFileSync(path.join(root,'native-response-metadata.jsonl'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'gpt02-dev-legacy429-quarantine-manifest-20261106.json'),'utf8').replace(/^\uFEFF/,''));
  // Task167 test-row files were intentionally removed; never exclude real 429 row 100.
  // Only verified, hash-pinned non-lifecycle probes may be excluded from incident counting.
  const probes=require('./gpt02-task167-nonoperational-probe-quarantine.cjs').evaluateFiles(root);
  if(probes.valid!==true)return {valid:false,reason:'NONOPERATIONAL_PROBES_'+String(probes.reason||'INVALID'),excludedRows:[]};
  return validate(raw,manifest,now,probes.excludedRows);
 }catch{return {valid:false,reason:'QUARANTINE_FILE_MISSING_OR_INVALID',excludedRows:[]};}
}
module.exports={validate,evaluateFiles};
