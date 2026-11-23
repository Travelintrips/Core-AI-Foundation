import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectServerOperatorBoundary as assess} from './gpt02-binding-trusted-operator-boundary.mjs';
const request={commandId:'c43000bf-c952-4e91-9344-02d9256f9768',
 receiverJobId:'e343ceee-98cb-4f28-9314-e96be590ea82',
 attemptId:'93f178a4-444e-48df-8a49-242f0bdf1b51',attestation:{payload:{
 operatorUserId:301,commandId:'c43000bf-c952-4e91-9344-02d9256f9768',
 receiverJobId:'e343ceee-98cb-4f28-9314-e96be590ea82',attemptId:'93f178a4-444e-48df-8a49-242f0bdf1b51'}}};
const server={env:'development',nodeEnv:'test',sessionVerifiedByMiddleware:true,
 userReReadFromDatabase:true,originAcceptedByServer:true,
 principal:{id:301,accountType:'internal',status:'active',role:'owner',mustChangePassword:false}};
test('plausible server-observed owner does not independently authorize writer',()=>{
 const r=assess(request,server);assert.equal(r.principalObserved,true);
 assert.equal(r.operatorUserId,301);assert.equal(r.mayPersistBinding,false);
 assert.equal(r.mayIssueGrant,false);assert.equal(r.releaseDecision,'NO_GO');
});
test('request cannot provide a role, operator, auth flag or SQL as authority',()=>{
 for(const field of [{operatorUserId:301},{role:'owner'},{adminVerified:true},{sql:'INSERT INTO ...'},{actor:{id:301}}]){
  const r=assess({...request,...field},server);
  assert.equal(r.reason,'REQUEST_FIELDS_NOT_ALLOWLISTED');assert.equal(r.principalObserved,false);
 }
});
test('revoked, demoted, external, password-pending or unverified sessions denied',()=>{
 for(const context of [{...server,principal:{...server.principal,status:'disabled'}},
  {...server,principal:{...server.principal,role:'viewer'}},
  {...server,principal:{...server.principal,accountType:'external'}},
  {...server,principal:{...server.principal,mustChangePassword:true}},
  {...server,sessionVerifiedByMiddleware:false},
  {...server,userReReadFromDatabase:false},
  {...server,originAcceptedByServer:false},{...server,env:'production'}]){
  const r=assess(request,context);assert.equal(r.principalObserved,false);
  assert.equal(r.mayPersistBinding,false);
 }
});
test('signed operator and attempt must match independently reloaded user and request IDs',()=>{
 for(const changed of [{attestation:{payload:{...request.attestation.payload,operatorUserId:302}}},
  {attestation:{payload:{...request.attestation.payload,attemptId:'f0de5fb8-64e6-4117-b430-6333b3f851ae'}}},
  {receiverJobId:'f0de5fb8-64e6-4117-b430-6333b3f851ae'}]){
  const r=assess({...request,...changed},server);
  assert.equal(r.principalObserved,false);assert.equal(r.releaseDecision,'NO_GO');
 }
});
