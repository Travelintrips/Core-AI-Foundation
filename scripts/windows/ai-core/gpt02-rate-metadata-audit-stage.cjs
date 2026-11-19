'use strict';
// DEV diagnostic only. Never changes monitor, worker, command or source log.
// Fail closed when responseStatus=429 lacks a usable timestamp.
const {parseUniqueJson}=require('./gpt02-json-unique-stage.js');
const LIMIT=4_000_000, DAY=86_400_000, HOUR=3_600_000;
const OFFSET_ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const fail=(reason,details={})=>Object.freeze({allowed:false,reason,...details});
function auditMetadata(raw,{nowMs=Date.now()}={}){
 if(!Number.isFinite(nowMs))return fail('AUDIT_CLOCK_INVALID');
 if(typeof raw!=='string')return fail('AUDIT_CAPTURE_LOG_MISSING');
 if(!raw.trim()||Buffer.byteLength(raw,'utf8')>LIMIT)
  return fail('AUDIT_CAPTURE_LOG_EMPTY_OR_OVERSIZE');
 const rows=raw.trimEnd().split(/\r?\n/);
 if(rows.some(line=>!line.trim())||rows.length>10000)
  return fail('AUDIT_CAPTURE_LOG_ROWS_INVALID',{total:rows.length});
 const captures=[];
 for(let i=0;i<rows.length;i++){
  let r;
  try {r=parseUniqueJson(rows[i]);}
  catch {return fail('AUDIT_CAPTURE_LOG_JSON_UNVERIFIED',{line:i+1});}
  if(!Number.isInteger(r.responseStatus)||r.responseStatus<100||r.responseStatus>599)
   return fail('AUDIT_CAPTURE_STATUS_UNVERIFIED',{line:i+1});
  if(r.responseStatus!==429)continue;
  if(typeof r.capturedAtUtc!=='string'||!OFFSET_ISO.test(r.capturedAtUtc))
   return fail('AUDIT_429_TIMESTAMP_UNVERIFIED',{line:i+1,total429Seen:captures.length+1});
  const t=Date.parse(r.capturedAtUtc);
  if(!Number.isFinite(t)||t>nowMs)
   return fail('AUDIT_429_TIMESTAMP_INVALID_OR_FUTURE',{line:i+1});
  const retry=r.retryAfterSeconds;
  const retryValid=typeof retry==='number'&&Number.isFinite(retry)&&retry>=0;
  captures.push({t,retryAfterSeconds:retryValid?retry:null});
 }
 // Identical timestamps do not establish distinct incidents.
 const recent=captures.filter(x=>nowMs-x.t<DAY);
 const uniqueRecent=new Set(recent.map(x=>x.t));
 if(recent.length!==uniqueRecent.size)
  return fail('AUDIT_429_IDENTITY_AMBIGUOUS',{recentEntries:recent.length,distinctTimestamps:uniqueRecent.size});
 if(recent.length>=2)
  return fail('AUDIT_REPEAT_429',{total429:captures.length,recent429:recent.length});
 if(recent.length===1){
  const latest=recent[0];
  const cooldownMs=latest.retryAfterSeconds===null?HOUR:Math.min(HOUR,Math.max(1000,(latest.retryAfterSeconds+5)*1000));
  if(nowMs-latest.t<cooldownMs)
   return fail('AUDIT_429_COOLDOWN',{total429:captures.length,recent429:1,cooldownMs});
 }
 return Object.freeze({allowed:true,reason:'AUDIT_CAPTURE_GATE_ELIGIBLE_ONLY',
  totalRows:rows.length,total429:captures.length,recent429:recent.length,
  note:'Not authorization to resume worker, replay C11 or send any request'});
}
module.exports={auditMetadata};
