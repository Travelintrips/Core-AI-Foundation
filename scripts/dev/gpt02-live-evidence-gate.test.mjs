import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateLiveEvidence,REQUIRED_LIVE_EVIDENCE} from './gpt02-live-evidence-gate.mjs';
const script=fileURLToPath(new URL('./gpt02-live-evidence-gate.mjs',import.meta.url));
const base={schemaVersion:1,environment:'DEV',jobId:'job-135',attemptId:'attempt-2',commandId:'new-command'};
test('missing live evidence blocks all execution and does not grant anything',()=>{
 const out=evaluateLiveEvidence(null);
 assert.equal(out.releaseDecision,'NO_GO');
 assert.equal(out.checks.length,11);
 assert.ok(out.checks.every(x=>!x.verified));
 for(const k of ['maySign','mayIssueGrant','mayDispatchWorker','mayCloseJob'])assert.equal(out[k],false);
});
test('self-attested success and completed status do not authorize',()=>{
 const out=evaluateLiveEvidence({...base,allPass:true,authenticated:true,workerAck:true,grant:true});
 assert.equal(out.metadataAcceptable,false);
 assert.equal(out.releaseDecision,'NO_GO');
});
test('sensible DEV identifiers remain unverified without independent readback',()=>{
 const out=evaluateLiveEvidence(base);
 assert.equal(out.metadataAcceptable,true);
 assert.equal(out.releaseDecision,'NO_GO');
 assert.ok(out.checks.every(x=>x.reason==='INDEPENDENT_LIVE_VERIFIER_NOT_IMPLEMENTED'));
});
test('PROD and fake attestation objects are rejected',()=>{
 for(const bad of [{...base,environment:'PROD'},{...base,verification:{signature:'fake'}},[],true]){
  assert.equal(evaluateLiveEvidence(bad).metadataAcceptable,false);
 }
});
test('real release command returns non-zero without relying on caller flags',()=>{
 const r=spawnSync(process.execPath,[script],{encoding:'utf8'});
 assert.equal(r.status,3,r.stderr);
 assert.equal(JSON.parse(r.stdout).releaseDecision,'NO_GO');
 assert.deepEqual(REQUIRED_LIVE_EVIDENCE.map(x=>x.id).filter((x,i,a)=>a.indexOf(x)!==i),[]);
});
