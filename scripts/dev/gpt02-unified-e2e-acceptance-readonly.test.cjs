"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {assess}=require("./gpt02-unified-e2e-acceptance-readonly.cjs");
const ID="83db99f5-cbda-4e60-be71-3090fb411bbb";
test("actual failed Task 135 metadata yields reason-coded NO_GO without dispatch",()=>{
 const r=assess({binding_ready:true,nonce_ready:true,grant_ready:false,lease_ready:false,core_task_id:null,command_status:"FAILED"},
 {role:"postgres",privileged:true,global_reader:true,can_set_writer:false,can_mutate_claim:false,can_mutate_nonce:false,pic_present:false,command_id:ID,execution_id:"synthetic",execution_status:"failed",attestation_verified:false,final_ack_verified:false},
 {core:true,hub:true,prod:true});
 assert.equal(r.passed,7);
 assert.equal(r.total,18);
 assert.equal(r.releaseDecision,"NO_GO");
 assert.equal(r.readOnly,true);
 for(const b of ["restrictedHubDbLogin","grantSchema","commandLeaseSchema","picPresent","coreTaskLinked","nativeAckRecorded","INDEPENDENT_NATIVE_PROVENANCE_NOT_ATTESTED"])
  assert.ok(r.blockers.includes(b),b);
 assert.deepEqual([r.issuerPermitted,r.dispatchPermitted,r.resumePermitted,r.completionPermitted],[false,false,false,false]);
});
test("fabricated all-green database metadata cannot replace independently signed native proof",()=>{
 const r=assess({binding_ready:true,nonce_ready:true,grant_ready:true,lease_ready:true,core_task_id:"synthetic",command_status:"RUNNING"},
 {role:"scoped",privileged:false,global_reader:false,can_set_writer:false,can_mutate_claim:false,can_mutate_nonce:false,pic_present:true,command_id:ID,execution_id:"synthetic",execution_status:"running",attestation_verified:true,final_ack_verified:true},
 {core:true,hub:true,prod:true});
 assert.equal(r.passed,15);
 assert.equal(r.total,18);
 assert.equal(r.releaseDecision,"NO_GO");
 assert.ok(r.blockers.includes("ISSUER_OPERATOR_GRANT_NOT_ATTESTED"));
 assert.equal(r.dispatchPermitted,false);
});
test("service health and direct app write exposure are never silently ignored",()=>{
 const r=assess({binding_ready:true,nonce_ready:true,grant_ready:false,lease_ready:false,command_status:null},
 {role:"postgres",privileged:true,global_reader:true,can_set_writer:true,can_mutate_claim:true,can_mutate_nonce:true}, {core:false,hub:true,prod:false});
 for(const b of ["coreDevHealthy","prodHealthy","directDmlFenced","commandReferenceMatch"])
  assert.ok(r.blockers.includes(b),b);
 assert.equal(r.resumePermitted,false);
});
