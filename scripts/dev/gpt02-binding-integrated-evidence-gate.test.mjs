import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {evaluateOfflineBindingEvidence as evaluate} from './gpt02-binding-integrated-evidence-gate.mjs';
import {preflightBindingClaim} from './gpt02-binding-writer-preflight.mjs';
import {attestationCanonicalBytes} from './gpt02-binding-attestation-verifier.mjs';
const commandId='c43000bf-c952-4e91-9344-02d9256f9768';
const coding='965604aa-9e6b-478b-8e33-cc52a8f0b8ca';
const receiverJobId='e343ceee-98cb-4f28-9314-e96be590ea82';
const attemptId='93f178a4-444e-48df-8a49-242f0bdf1b51';
const now=Date.parse('2026-11-09T01:00:00Z');
const source={commandId,taskId:coding,status:'PROCESSING',devOnly:true,
 capability:'chatgpt:wake',assignedWorker:'openclaw-dell-chatgpt-wake-dev',responses:[]};
const receiver={source:'AI_CORE',receiverJobId,externalId:'bridge-command:'+commandId,
 passiveLedger:true,tenant:'default',timelineCommandId:commandId,workerId:'openclaw-dell-chatgpt-wake-dev',
 status:'processing',progress:25,readOnly:true,taskId:42,
 eventEvidence:{observedEventCount:0,sourceEventCount:0,signedEventCount:0,
 historyTruncated:false,progressProvesCompletion:false,nativeWorkerCompletionVerified:false,
 mayIssueGrant:false,mayDispatchWorker:false}};
const independentReadbacks={source,receiver,coreTask:{codingTaskId:coding,codingTaskExists:true,codingRunCount:1},
 hubTask:{aiTaskId:42,aiTaskExists:true,tenant:'default',assigneePresent:true},
 attemptNumber:1,captureTimes:{sourceObservedAt:'2026-11-09T00:59:30Z',receiverObservedAt:'2026-11-09T00:59:30Z'}};
const serverContext={env:'development',nodeEnv:'test',sessionVerifiedByMiddleware:true,
 userReReadFromDatabase:true,originAcceptedByServer:true,
 principal:{id:301,accountType:'internal',status:'active',role:'owner',mustChangePassword:false}};
const proofHash=preflightBindingClaim({source,receiver,coreTask:independentReadbacks.coreTask,
 hubTask:independentReadbacks.hubTask,attemptId,attemptNumber:1,hubExecutionJobId:receiverJobId,
 actor:{sessionAuthenticated:true,adminVerified:true,userId:301,originVerified:true},
 proof:independentReadbacks.captureTimes},{now}).evidenceSha256;
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const payload={attestationVersion:1,commandId,receiverJobId,attemptId,tenantId:'default',
 evidenceSha256:proofHash,operatorUserId:301,issuedAt:'2026-11-09T00:59:40Z',
 expiresAt:'2026-11-09T01:00:40Z',nonce:randomUUID()};
const attestation={payload,signatureBase64:sign(null,attestationCanonicalBytes(payload),privateKey).toString('base64')};
const request={commandId,receiverJobId,attemptId,attestation};
const proofVerification={nonceUnused:true,
 trustedPublicKeyDerBase64:publicKey.export({format:'der',type:'spki'}).toString('base64')};
const base={request,serverContext,independentReadbacks,proofVerification};
test('full synthetic signed operator/source/receiver/attempt correlation still NO-GO',()=>{
 const r=evaluate(base,{now});
 assert.equal(r.reason,'OFFLINE_CORRELATION_ONLY_NO_TRUSTED_WRITER');
 assert.equal(r.evidenceSha256,proofHash);
 assert.equal(r.checks.signature,'VALID_SYNTHETIC_SIGNATURE');
 for(const k of ['bindingEvidenceReadyForReview','mayPersistBinding','mayIssueGrant','mayDispatchWorker','mayCloseJob'])
  assert.equal(r[k],false);
 assert.equal(r.releaseDecision,'NO_GO');
});
test('request-supplied operator, role, SQL, and forged server role fail closed',()=>{
 for(const x of [{...base,request:{...request,operatorUserId:301}},
  {...base,request:{...request,sql:'INSERT'}},
  {...base,serverContext:{...serverContext,principal:{...serverContext.principal,role:'viewer'}}},
  {...base,serverContext:{...serverContext,userReReadFromDatabase:false}}]){
  const r=evaluate(x,{now});assert.match(r.reason,/^OPERATOR_/);
  assert.equal(r.mayPersistBinding,false);
 }
});
test('changed DB evidence, stale readbacks and missing task lineage cannot pass',()=>{
 for(const x of [
  {...base,independentReadbacks:{...independentReadbacks,receiver:{...receiver,progress:90}}},
  {...base,independentReadbacks:{...independentReadbacks,captureTimes:{...independentReadbacks.captureTimes,sourceObservedAt:'2026-11-08T10:00:00Z'}}},
  {...base,independentReadbacks:{...independentReadbacks,coreTask:{...independentReadbacks.coreTask,codingTaskExists:false}}},
  {...base,independentReadbacks:{...independentReadbacks,receiver:{...receiver,tenant:'other'}}}
 ]){
  const r=evaluate(x,{now});assert.equal(r.mayPersistBinding,false);
  assert.equal(r.releaseDecision,'NO_GO');
  assert.notEqual(r.reason,'OFFLINE_CORRELATION_ONLY_NO_TRUSTED_WRITER');
 }
});
test('wrong key, wrong operator signature and missing nonce proof cannot pass',()=>{
 for(const x of [
  {...base,proofVerification:{...proofVerification,nonceUnused:false}},
  {...base,proofVerification:{...proofVerification,trustedPublicKeyDerBase64:'invalid'}},
  {...base,request:{...request,attestation:{...attestation,signatureBase64:'AA=='}}},
  {...base,request:{...request,attestation:{...attestation,payload:{...payload,operatorUserId:302}}}}
 ]){
  const r=evaluate(x,{now});assert.equal(r.mayPersistBinding,false);
  assert.equal(r.releaseDecision,'NO_GO');
  assert.notEqual(r.reason,'OFFLINE_CORRELATION_ONLY_NO_TRUSTED_WRITER');
 }
});
