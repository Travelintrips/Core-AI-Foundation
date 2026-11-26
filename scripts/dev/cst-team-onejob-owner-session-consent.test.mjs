import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
 issueOneJobOwnerIntentChallenge,consumeOneJobOwnerIntentChallenge,
} from "../../artifacts/api-server/src/lib/cstOneJobOwnerSessionConsent.ts";

const now=Date.parse("2026-11-20T05:00:00.000Z");
const base={
 ownerId:19,jobId:483,jobCode:"OLLAMA-A1B2C3D4",
 requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
 sourceSha:"b".repeat(40),workerName:"cst-dev-dell-onejob-20261120-abcdef12",
 sessionToken:"synthetic-signed-session-cookie-not-a-real-secret-abcdef1234567890",
};
const approval=(challenge,input=base,nowAt=now)=>consumeOneJobOwnerIntentChallenge({
 ...input,challenge,
 intent:"APPROVE_ONLY_ONE_CST_DEV_JOB",
 sameOriginVerified:true,freshSignedSessionVerified:true,
},nowAt);
test("Owner signs exactly one explicit browser confirmation of one new Company-1 waiting job",()=>{
 const ch=issueOneJobOwnerIntentChallenge(base,now);
 const out=approval(ch.challenge);
 assert.equal(out.sessionIntentCaptured,true);
 assert.equal(out.sourceSha,base.sourceSha);
 assert.match(out.receiptSha256,/^[0-9a-f]{64}$/);
 assert.equal(out.independentOwnerApprovalAttested,false);
 assert.equal(out.dispatchPermitted,false);
 assert.equal(out.operationalAuthorityGranted,false);
 assert.throws(()=>approval(ch.challenge),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
});
test("wrong browser origin or stale auth session invalidates challenge irreversibly",()=>{
 for(const change of [
  {sameOriginVerified:false},
  {freshSignedSessionVerified:false},
  {intent:"APPROVE_ALL_JOBS"},
 ]){
  const ch=issueOneJobOwnerIntentChallenge(base,now);
  assert.throws(()=>consumeOneJobOwnerIntentChallenge({
   ...base,challenge:ch.challenge,
   intent:"APPROVE_ONLY_ONE_CST_DEV_JOB",
   sameOriginVerified:true,freshSignedSessionVerified:true,
   ...change,
  },now),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
  assert.throws(()=>approval(ch.challenge),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
 }
});
test("cross-owner cookie, worker or exact source SHA change cannot approve",()=>{
 for(const change of [
  {ownerId:20},
  {jobId:484},
  {requestId:"cst-ai-team-company1-dev:pilot-"+"c".repeat(20)},
  {sourceSha:"f".repeat(40)},
  {workerName:"cst-dev-dell-onejob-20261120-deadbeef"},
  {sessionToken:"synthetic-signed-other-session-not-a-real-secret-abcdef123456789"},
 ]){
  const ch=issueOneJobOwnerIntentChallenge(base,now);
  assert.throws(()=>approval(ch.challenge,{...base,...change}),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
 }
});
test("expired challenge, historic #482, invalid company requests never pass",()=>{
 const ch=issueOneJobOwnerIntentChallenge(base,now);
 assert.throws(()=>approval(ch.challenge,base,now+121000),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
 for(const invalid of [
  {jobId:482},{jobId:-1},{ownerId:0},{sourceSha:"BAD"},
  {requestId:"cst-ai-team-company3-dev:pilot-"+"a".repeat(20)},
  {workerName:"openclaw-vps-main"},
 ]){
  assert.throws(()=>issueOneJobOwnerIntentChallenge({...base,...invalid},now),
    /CST_ONEJOB_OWNER_CHALLENGE_SCOPE_INVALID/);
 }
});
test("a second pending challenge invalidates an earlier challenge for the same Owner/job",()=>{
 const first=issueOneJobOwnerIntentChallenge(base,now);
 const second=issueOneJobOwnerIntentChallenge(base,now+1000);
 assert.notEqual(first.challenge,second.challenge);
 assert.throws(()=>approval(first.challenge,base,now+1000),/CST_ONEJOB_OWNER_INTENT_NOT_VERIFIED/);
 assert.equal(approval(second.challenge,base,now+1000).sessionIntentCaptured,true);
});
test("session helper cannot grant release or write a DB approval",()=>{
 const source=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobOwnerSessionConsent.ts",import.meta.url),"utf8");
 assert.doesNotMatch(source,/createPrivateKey|sign\(|node:net|child_process|\bfetch\(/);
 assert.doesNotMatch(source,/from "pg"|from "@workspace\/db"|INSERT INTO|CREATE ROLE|UPDATE ai_platform/);
 assert.match(source,/independentOwnerApprovalAttested:false/);
 assert.match(source,/dispatchPermitted:false/);
});
