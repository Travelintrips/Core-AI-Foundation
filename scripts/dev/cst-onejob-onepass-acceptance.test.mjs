import test from "node:test";
import assert from "node:assert/strict";
import {OFFLINE_TESTS,LIVE_GATES,verifyManifest,acceptanceSummary,PROJECT} from "./cst-onejob-onepass-acceptance.mjs";

test("one-pass acceptance inventory contains all existing critical fixtures",()=>{
  const result=verifyManifest();
  assert.equal(result.valid,true,result.problems.join(","));
  assert.ok(OFFLINE_TESTS.length>=12);
  assert.equal(new Set(OFFLINE_TESTS.map(x=>x.id)).size,OFFLINE_TESTS.length);
  assert.ok(LIVE_GATES.includes("REAL_SUBSCRIBER_DELIVERY_AND_SIGNED_RECEIPT"));
});
test("passing all offline fixtures never grants live authority",()=>{
  const report=acceptanceSummary({
    manifest:{valid:true,problems:[],count:OFFLINE_TESTS.length},
    tests:OFFLINE_TESTS.map(x=>({id:x.id,status:"PASS",code:"0"})),
    live:{status:"READ_ONLY_PROBE",configPreflight:"CONDITIONS_REPORTED_COMPLETE",blockers:[]}
  });
  assert.equal(report.project,PROJECT);
  assert.equal(report.offlineResult,"PASS");
  assert.equal(report.releaseDecision,"NO_GO");
  assert.equal(report.queueTransitionAuthorized,false);
  assert.equal(report.dispatchPermitted,false);
  assert.equal(report.signerActivationPermitted,false);
  assert.equal(report.finalAckIssued,false);
});
test("missing or failed gate prevents offline PASS",()=>{
  assert.equal(acceptanceSummary({manifest:{valid:true},tests:[],live:null}).offlineResult,"NOT_EXECUTED");
  const report=acceptanceSummary({manifest:{valid:true},
    tests:OFFLINE_TESTS.map((x,i)=>({id:x.id,status:i===0?"FAIL":"PASS"}))});
  assert.equal(report.offlineResult,"FAIL");
  assert.equal(report.releaseDecision,"NO_GO");
});
