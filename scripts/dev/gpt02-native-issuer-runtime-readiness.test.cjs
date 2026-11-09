"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {assessIssuerReadiness}=require("./gpt02-native-issuer-runtime-readiness.cjs");
const everything=()=>({
 devRuntime:true,databaseConnected:true,dbRoleLeastPrivilege:true,
 bindingClaimTablePresent:true,bindingNonceTablePresent:true,
 reviewIntentTablePresent:true,grantTablePresent:true,leaseTablePresent:true,
 operatorPrincipalAvailable:true,commandNonterminal:true,
 coreTaskLinked:true,trustedSignerReady:true,nativeAttestorReady:true,
 workerAckVerified:true
});
test("even forged all-green metadata cannot grant runtime authority",()=>{
 const r=assessIssuerReadiness(everything());
 assert.equal(r.releaseDecision,"NO_GO");
 assert.ok(r.blockingReasons.includes("NO_TRUSTED_BINDING_ISSUER_IMPLEMENTED"));
 for (const k of ["mayPersistBinding","mayIssueGrant","mayDispatchWorker","mayResume","mayCloseJob"])
  assert.equal(r[k],false,k);
 assert.equal(r.readOnly,true);
});
test("missing scoped writer and schema have reason-coded blockers",()=>{
 const x=everything();
 x.dbRoleLeastPrivilege=false;
 x.bindingClaimTablePresent=false;
 x.bindingNonceTablePresent=false;
 x.grantTablePresent=false;
 x.leaseTablePresent=false;
 const r=assessIssuerReadiness(x);
 for(const k of ["ISOLATED_WRITER_ROLE_NOT_VERIFIED","BINDING_CLAIM_SCHEMA_MISSING",
  "BINDING_NONCE_SCHEMA_MISSING","NATIVE_GRANT_SCHEMA_MISSING","NATIVE_LEASE_SCHEMA_MISSING"])
  assert.ok(r.blockingReasons.includes(k),k);
 assert.equal(r.mayIssueGrant,false);
});
test("terminal FAILED command, missing Core task ID and native evidence block",()=>{
 const x=everything();
 x.commandNonterminal=false;
 x.coreTaskLinked=false;
 x.trustedSignerReady=false;
 x.nativeAttestorReady=false;
 x.workerAckVerified=false;
 const r=assessIssuerReadiness(x);
 for(const k of ["COMMAND_TERMINAL_OR_MISSING","CORE_TASK_ID_MISSING",
  "TRUSTED_ISSUER_SIGNER_NOT_VERIFIED","INDEPENDENT_NATIVE_ATTESTOR_NOT_VERIFIED",
  "NATIVE_WORKER_ACK_NOT_VERIFIED"])
  assert.ok(r.blockingReasons.includes(k),k);
 assert.equal(r.releaseDecision,"NO_GO");
});
test("missing trustworthy runtime/database/operator fails closed",()=>{
 for(const k of ["devRuntime","databaseConnected","operatorPrincipalAvailable"]){
  const x=everything();x[k]=false;
  const r=assessIssuerReadiness(x);
  assert.ok(r.blockingReasons.length>=2,k);
  assert.equal(r.releaseDecision,"NO_GO");
 }
});
