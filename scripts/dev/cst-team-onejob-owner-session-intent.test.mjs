import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {
 issueOneJobOwnerIntentChallenge,consumeOneJobOwnerIntentChallenge,
} from "../../artifacts/api-server/src/lib/cstOneJobOwnerSessionConsent.ts";
const now=Date.parse("2026-11-20T05:00:00.000Z");
const baseline={
 ownerId:19,jobId:483,jobCode:"OLLAMA-A1B2C3D4",
 requestId:"cst-ai-team-company1-dev:pilot-"+"a".repeat(20),
 sourceSha:"b".repeat(40),workerName:"cst-dev-dell-onejob-20261120-abcdef12",
 sessionToken:"synthetic-signed-session-cookie-not-a-real-secret-abcdef1234567890",
};
const accept=(nonce,fields=baseline,at=now)=>consumeOneJobOwnerIntentChallenge({
 ...fields,challenge:nonce,intent:"APPROVE_ONLY_ONE_CST_DEV_JOB",
 sameOriginVerified:true,freshSignedSessionVerified:true,
},at);
test("one authenticated owner action consumes a challenge for one new Company-1 waiting job",()=>{
 const ch=issueOneJobOwnerIntentChallenge(baseline,now);
 const result=accept(ch.challenge);
 assert.equal(result.jobId,483);
 assert.match(result.receiptSha256,/^[a-f0-9]{64}$/);
 assert.equal(result.sessionIntentCaptured,true);
 assert.equal(result.independentOwnerApprovalAttested,false);
 assert.equal(result.dispatchPermitted,false);
 assert.throws(()=>accept(ch.challenge),/OWNER_INTENT_NOT_VERIFIED/);
});
test("wrong signed browser session, origin or explicit choice consumes challenge without approval",()=>{
 for(const change of [
  {sameOriginVerified:false},{freshSignedSessionVerified:false},
  {intent:"APPROVE_ALL_JOBS"},
 ]){
  const ch=issueOneJobOwnerIntentChallenge(baseline,now);
  assert.throws(()=>consumeOneJobOwnerIntentChallenge({
   ...baseline,challenge:ch.challenge,intent:"APPROVE_ONLY_ONE_CST_DEV_JOB",
   sameOriginVerified:true,freshSignedSessionVerified:true,...change,
  },now),/OWNER_INTENT_NOT_VERIFIED/);
  assert.throws(()=>accept(ch.challenge),/OWNER_INTENT_NOT_VERIFIED/);
 }
});
test("cookie, actor ID, job ID, commit, request, worker are all bound",()=>{
 for(const changed of [
  {ownerId:20},{jobId:484},{sourceSha:"f".repeat(40)},
  {workerName:"cst-dev-dell-onejob-20261120-deadbeef"},
  {requestId:"cst-ai-team-company1-dev:pilot-"+"d".repeat(20)},
  {sessionToken:"synthetic-other-owner-session-cookie-abcdef1234567890"},
 ]){
  const ch=issueOneJobOwnerIntentChallenge(baseline,now);
  assert.throws(()=>accept(ch.challenge,{...baseline,...changed}),
    /OWNER_INTENT_NOT_VERIFIED/);
 }
});
test("session TTL and job #482 denial cannot turn into approval",()=>{
 const ch=issueOneJobOwnerIntentChallenge(baseline,now);
 assert.throws(()=>accept(ch.challenge,baseline,now+121000),/OWNER_INTENT_NOT_VERIFIED/);
 for(const invalid of [
  {ownerId:0},{jobId:482},{jobId:-1},{sourceSha:"xyz"},
  {workerName:"openclaw-vps-main"},
  {requestId:"cst-ai-team-company3-dev:pilot-"+"a".repeat(20)},
 ]){
  assert.throws(()=>issueOneJobOwnerIntentChallenge({...baseline,...invalid},now),
    /OWNER_CHALLENGE_SCOPE_INVALID/);
 }
});
test("new challenge invalidates old challenge for exactly the same owner and job",()=>{
 const a=issueOneJobOwnerIntentChallenge(baseline,now);
 const b=issueOneJobOwnerIntentChallenge(baseline,now+1000);
 assert.notEqual(a.challenge,b.challenge);
 assert.throws(()=>accept(a.challenge,baseline,now+1000),/OWNER_INTENT_NOT_VERIFIED/);
 assert.equal(accept(b.challenge,baseline,now+1000).sessionIntentCaptured,true);
});
test("Owner browser route is existing-session + origin protected and default OFF, never DB approval insertion",()=>{
 const source=readFileSync(new URL("../../artifacts/api-server/src/routes/cst-team-onejob-owner-consent.ts",import.meta.url),"utf8");
 assert.match(source,/requireAuth,requireInternalRole\("owner"\),requirePasswordChanged/);
 assert.match(source,/CST_TEAM_ONEJOB_OWNER_CONSENT_ENABLED!=="true"/);
 assert.match(source,/process\.env\.NODE_ENV!=="development"/);
 assert.match(source,/process\.env\.APP_ENV!=="development"/);
 assert.match(source,/algorithms:\["HS256"\],maxAge:"20m"/);
 assert.match(source,/sameTrustedBrowserOrigin\(req\)/);
 assert.match(source,/scope\(body\.jobId\)/);
 assert.match(source,/consumeOneJobOwnerIntentChallenge/);
 assert.match(source,/authenticated_owner_session_confirmation/);
 assert.match(source,/aiAuditLogsTable/);
 assert.doesNotMatch(source,/INSERT INTO.*cst_onejob_owner_approvals|CREATE ROLE|ALTER ROLE/);
 assert.doesNotMatch(source,/res\.json\(\{[^}]*independentOwnerApprovalAttested:true/);
});
