import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {attestationCanonicalBytes,verifyOfflineBindingAttestation as verify} from './gpt02-binding-attestation-verifier.mjs';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const {publicKey:otherPublic}=generateKeyPairSync('ed25519');
const now=Date.parse('2026-11-09T01:00:00Z');
const payload={attestationVersion:1,commandId:randomUUID(),receiverJobId:randomUUID(),attemptId:randomUUID(),
 tenantId:'default',evidenceSha256:'a'.repeat(64),operatorUserId:301,
 issuedAt:'2026-11-09T00:59:30Z',expiresAt:'2026-11-09T01:00:30Z',nonce:randomUUID()};
const signatureBase64=sign(null,attestationCanonicalBytes(payload),privateKey).toString('base64');
const expected={commandId:payload.commandId,receiverJobId:payload.receiverJobId,
 attemptId:payload.attemptId,evidenceSha256:payload.evidenceSha256,operatorUserId:301,now,
 nonceUnused:true,trustedPublicKeyDerBase64:publicKey.export({type:'spki',format:'der'}).toString('base64')};
const run=(p=payload,e=expected,s=signatureBase64)=>verify({payload:p,signatureBase64:s},e);
test('signed evidence is observable but cannot authorize persistent binding',()=>{
 const r=run();assert.equal(r.signatureValid,true);
 assert.equal(r.independentAttestationVerified,false);
 assert.equal(r.mayPersistBinding,false);assert.equal(r.mayIssueGrant,false);
 assert.equal(r.releaseDecision,'NO_GO');
});
test('wrong key or edited payload fails signature validation',()=>{
 assert.equal(run(payload,{...expected,trustedPublicKeyDerBase64:otherPublic.export({type:'spki',format:'der'}).toString('base64')}).signatureValid,false);
 assert.equal(run({...payload,issuedAt:'2026-11-09T00:59:29Z'}).signatureValid,false);
});
test('context mismatch, role spoof, replay nonce and stale window fail closed',()=>{
 for(const e of [{...expected,commandId:randomUUID()},
  {...expected,operatorUserId:1},{...expected,nonceUnused:false},
  {...expected,now:now+240000}]){
  const r=run(payload,e);assert.equal(r.signatureValid,false);assert.equal(r.mayPersistBinding,false);
 }
});
test('additional forged fields and invalid signature encoding rejected',()=>{
 assert.equal(run({...payload,adminVerified:true}).reason,'NON_CANONICAL_PAYLOAD');
 assert.equal(run(payload,expected,'AA==').signatureValid,false);
});
