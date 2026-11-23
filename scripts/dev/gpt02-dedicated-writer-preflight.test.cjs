"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {evaluateDedicatedWriter,safeDsnIdentity}=require("./gpt02-dedicated-writer-preflight.cjs");
const ready=()=>({devRuntime:true,dedicatedConnectionConfigured:true,dsnDistinct:true,
 connected:true,separateLogin:true,nonPrivileged:true,schemaReady:true,
 insertBoth:true,noReadModifyDelete:true,noCoreCommandWrite:true,noGrantLeaseWrite:true});
test("all-green dedicated PostgreSQL login never implies issuer authority",()=>{
 const r=evaluateDedicatedWriter(ready());
 assert.equal(r.credentialIsolationVerified,true);
 assert.equal(r.releaseDecision,"NO_GO");
 assert.deepEqual([r.mayPersistBinding,r.mayIssueGrant,r.mayDispatchWorker,r.mayResume,r.mayCloseJob],
  [false,false,false,false,false]);
 assert.deepEqual(r.blockingReasons,["NO_TRUSTED_BINDING_ISSUER_IMPLEMENTED"]);
});
test("missing writer or DSN reuse fails closed",()=>{
 for(const key of ["devRuntime","dedicatedConnectionConfigured","dsnDistinct","connected","separateLogin"]){
  const x=ready();x[key]=false;const y=evaluateDedicatedWriter(x);
  assert.equal(y.credentialIsolationVerified,false,key);
  assert.equal(y.mayPersistBinding,false);
  assert.ok(y.blockingReasons.length>=2,key);
 }
});
test("privileged roles and excess rights fail the preflight",()=>{
 for(const key of ["nonPrivileged","schemaReady","insertBoth","noReadModifyDelete",
 "noCoreCommandWrite","noGrantLeaseWrite"]){
  const x=ready();x[key]=false;
  const y=evaluateDedicatedWriter(x);
  assert.equal(y.credentialIsolationVerified,false,key);
  assert.equal(y.mayIssueGrant,false);
 }
});
test("database identity parser does not leak credentials or accept unsafe protocol",()=>{
 assert.equal(safeDsnIdentity("https://user:secret@host/db"),null);
 const id=safeDsnIdentity("postgresql://gpt02_writer:secret@db.internal:5432/core");
 assert.deepEqual(id,{username:"gpt02_writer",host:"db.internal",port:"5432",database:"core"});
 assert.equal(JSON.stringify(id).includes("secret"),false);
});
