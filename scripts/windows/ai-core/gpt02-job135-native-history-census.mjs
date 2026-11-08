/**
 * Read-only bounded DELL Job135 forensic evidence census.
 * Does NOT execute a worker, issue/resume a command, read secrets or ACK.
 * Only exact UUID matches are included (never text containing "135").
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const PARENT="83db99f5-cbda-4e60-be71-3090fb411bbb";
const SOURCES=Object.freeze({
  delivery:"dell-wake-delivery-evidence.jsonl",
  failure:"dell-wake-failure-diagnostics.jsonl",
  gate:"gpt02-auto-ack-gate-audit.jsonl",
});
const MAX_BYTES=8_000_000;
const MAX_LINES=5000;
export const deny=(reason, data={})=>({
  valid:false,reason,...data,
  legacyUntaggedAttemptsExcluded:false,
  mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
  nativeAckVerified:false,
});
const isRecord=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
const yes=x=>x===true;
function readOne(dir,file){
  const filename=path.join(dir,file);
  const st=fs.lstatSync(filename);
  if(!st.isFile()||st.size>MAX_BYTES||st.size===0)
    throw Error("SOURCE_SIZE_OR_TYPE_INVALID");
  const buf=fs.readFileSync(filename);
  if(buf.length!==st.size)throw Error("SOURCE_CHANGED_DURING_READ");
  const txt=new TextDecoder("utf-8",{fatal:true}).decode(buf);
  const lines=txt.split(/\r?\n/);
  if(lines.length>MAX_LINES+1)throw Error("SOURCE_LINE_LIMIT");
  const matched=[];
  for(let i=0;i<lines.length;i++){
    if(!lines[i].trim())continue;
    const o=JSON.parse(lines[i]);
    if(!isRecord(o))throw Error("SOURCE_RECORD_INVALID");
    if(o.commandId===PARENT)matched.push({line:i+1,data:o});
  }
  return {matched,sha256:createHash("sha256").update(buf).digest("hex"),
    bytes:buf.length,lineCount:lines.filter(x=>x.trim()).length};
}
const validDate=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
export function interpretJob135NativeEvidence(rows){
  const d=rows?.delivery?.matched;
  const f=rows?.failure?.matched;
  const g=rows?.gate?.matched;
  if(!Array.isArray(d)||!Array.isArray(f)||!Array.isArray(g))
    return deny("NATIVE_LOG_SOURCES_INCOMPLETE");
  if(d.length!==1||f.length!==1||g.length!==1)
    return deny("NATIVE_PARENT_RECORDS_MISSING_OR_AMBIGUOUS",{
      deliveryMatches:d.length,failureMatches:f.length,gateMatches:g.length});
  const [delivery,failure,gate]=[d[0].data,f[0].data,g[0].data];
  if([delivery,failure,gate].some(x=>!validDate(x.at))||
     delivery.stage!=="RESULT_DELIVERED"||
     !Number.isSafeInteger(failure.exitCode) ||
     typeof failure.reasonCode!=="string"||
     typeof delivery.workerId!=="string"||!delivery.workerId||
     !("responseId" in delivery)||
     gate.status!=="FAILED"||gate.workerMatch!==true||
     !["verified","e2e","delivery","reply","pairing"].every(k=>gate[k]===false))
    return deny("NATIVE_PARENT_RECORDS_UNVERIFIED");
  // Require all related records to refer to the same near-time outcome.
  const stamps=[delivery.at,failure.at,gate.at].map(x=>Date.parse(x));
  if(Math.max(...stamps)-Math.min(...stamps)>60_000)
    return deny("NATIVE_OUTCOME_WINDOW_MISMATCH");
  return {
    valid:true,reason:"NATIVE_PARENT_FAILED_REPLY_NOT_READY",
    parentCommandId:PARENT,
    workerId:delivery.workerId,
    deliveryStage:delivery.stage,
    nativeExitCode:failure.exitCode,
    nativeFailureCode:failure.reasonCode,
    autoAckGateStatus:gate.status,
    outcomeWindowMs:Math.max(...stamps)-Math.min(...stamps),
    deliveryAt:delivery.at,failureAt:failure.at,gateAt:gate.at,
    nativeAckVerified:false,
    legacyUntaggedAttemptsExcluded:false,
    mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
  };
}
export function censusJob135NativeHistory(dir){
  const out={};
  for(const [key,file] of Object.entries(SOURCES)){
    try{out[key]=readOne(dir,file);}
    catch{return deny("NATIVE_LOG_SOURCE_READ_OR_PARSE_FAILED",{source:key});}
  }
  const result=interpretJob135NativeEvidence(out);
  return {...result,
    sourceIntegrity:Object.fromEntries(Object.entries(out).map(([k,v])=>
      [k,{sha256:v.sha256,bytes:v.bytes,lines:v.lineCount,
       exactParentMatches:v.matched.length}]))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
  const dir=process.argv[2];
  if(!dir){
    process.stderr.write("Usage: node gpt02-job135-native-history-census.mjs <log-directory>\n");
    process.exitCode=2;
  }else{
    const result=censusJob135NativeHistory(dir);
    process.stdout.write(JSON.stringify(result)+"\n");
    if(!result.valid)process.exitCode=2;
  }
}
