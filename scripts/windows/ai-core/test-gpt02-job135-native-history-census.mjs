import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {censusJob135NativeHistory,interpretJob135NativeEvidence} from "./gpt02-job135-native-history-census.mjs";
const P="83db99f5-cbda-4e60-be71-3090fb411bbb";
function fixture(change={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"gpt02-job135-"));
 const entries={
  "dell-wake-delivery-evidence.jsonl":{stage:"RESULT_DELIVERED",commandId:P,
    workerId:"openclaw-dell-chatgpt-wake-dev",responseId:"synthetic-response",at:"2026-11-07T19:04:39.458Z"},
  "dell-wake-failure-diagnostics.jsonl":{commandId:P,exitCode:1,
    reasonCode:"Native_assistant_reply_is_not_visibly_ready",at:"2026-11-07T19:04:38.519Z"},
  "gpt02-auto-ack-gate-audit.jsonl":{commandId:P,status:"FAILED",workerMatch:true,
    verified:false,e2e:false,delivery:false,reply:false,pairing:false,
    at:"2026-11-07T19:04:39.460Z"}
 };
 for(const [name,object] of Object.entries(entries))
  fs.writeFileSync(path.join(dir,name),JSON.stringify({...object,...change[name]})+"\n");
 return dir;
}
test("three exact-parent sources describe failure but never native ACK",t=>{
 const dir=fixture();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const r=censusJob135NativeHistory(dir);
 assert.equal(r.valid,true);
 assert.equal(r.nativeExitCode,1);
 assert.equal(r.nativeFailureCode,"Native_assistant_reply_is_not_visibly_ready");
 assert.equal(r.deliveryStage,"RESULT_DELIVERED");
 assert.equal(r.nativeAckVerified,false);
 assert.equal(r.mayDispatchWorker,false);
 assert.equal(r.legacyUntaggedAttemptsExcluded,false);
 for(const source of Object.values(r.sourceIntegrity))assert.match(source.sha256,/^[0-9a-f]{64}$/);
});
for(const [label,change] of Object.entries({
 "forged successful ACK":{"gpt02-auto-ack-gate-audit.jsonl":{verified:true}},
 "wrong worker":{"gpt02-auto-ack-gate-audit.jsonl":{workerMatch:false}},
 "late retry":{"dell-wake-failure-diagnostics.jsonl":{at:"2026-11-09T00:00:00Z"}},
 "wrong delivery stage":{"dell-wake-delivery-evidence.jsonl":{stage:"COMPLETED"}},
 "missing failure":{"dell-wake-failure-diagnostics.jsonl":{commandId:"41aa961d-ac1e-4e12-a2c8-28ed07ff97cc"}},
})){
 test("denies "+label,t=>{
  const dir=fixture(change);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const r=censusJob135NativeHistory(dir);
  assert.equal(r.valid,false);assert.equal(r.mayCreateCommand,false);assert.equal(r.nativeAckVerified,false);
 });
}
test("missing and malformed sources are explicitly not zero evidence",t=>{
 const dir=fixture();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.unlinkSync(path.join(dir,"gpt02-auto-ack-gate-audit.jsonl"));
 assert.deepEqual(censusJob135NativeHistory(dir).reason,"NATIVE_LOG_SOURCE_READ_OR_PARSE_FAILED");
});
test("duplicate exact parent must fail closed",t=>{
 const dir=fixture();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const f=path.join(dir,"dell-wake-delivery-evidence.jsonl");
 fs.appendFileSync(f,fs.readFileSync(f));
 const r=censusJob135NativeHistory(dir);
 assert.equal(r.valid,false);assert.equal(r.reason,"NATIVE_PARENT_RECORDS_MISSING_OR_AMBIGUOUS");
});
test("input cannot grant recovery",()=>{
 const result=interpretJob135NativeEvidence({delivery:{matched:[]},failure:{matched:[]},gate:{matched:[]}});
 assert.equal(result.mayCreateCommand,false);assert.equal(result.mayDispatchWorker,false);
});
