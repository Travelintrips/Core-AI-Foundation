import {describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({rows:[] as unknown[],calls:0,life:{found:true,commandStatus:"FAILED",checkpointResponseId:"cp1",checkpointAttested:true,nativeReceiverAckVerified:true}}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>({rows:m.rows})}}));
vi.mock("../codingCommandLifecycleEvidence.js",()=>({getCodingCommandLifecycleEvidence:async()=>m.life}));
import {assessReadonlyRecoveryFacts,getDevCommandRecoveryReview,type RecoveryRuntimeFacts} from "../jobLifecycleRecoveryReview.js";
const now=new Date("2026-11-07T18:00:00Z");
function facts():RecoveryRuntimeFacts{return {
 commandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",status:"FAILED",checkpointResponseId:"cp1",checkpointVerified:true,
 responseRows:[{id:"ack1",kind:"ACK",createdAt:new Date(now.getTime()-900000),acknowledgedAt:null},
 {id:"failed",kind:"FAILED",createdAt:new Date(now.getTime()-600000),acknowledgedAt:null},
 {id:"cp1",kind:"CHECKPOINT",createdAt:new Date(now.getTime()-600000),acknowledgedAt:new Date(now.getTime()-550000)}],
 presence:{workerId:"openclaw-dell-chatgpt-wake-dev",lastSeenAt:new Date(now.getTime()-5000),leaseExpiresAt:new Date(now.getTime()+60000),reportedHealth:"healthy"},
 policy:{enabled:true,maxRetries:3,heartbeatGraceMinutes:10,requireAcknowledgement:true},serverFlag:false,now,
};}
describe("DEV-only native GPT02 fail-closed recovery review",()=>{
 it("recognizes real ACK but never dispatches or closes",()=>{
  const x=assessReadonlyRecoveryFacts(facts());
  expect(x.checkpointAttested).toBe(true);
  expect(x.receiverAckVerified).toBe(true);
  expect(x.phase).toBe("IN_PROGRESS");
  expect(x.blockingResponseId).toBeNull();
  expect(x.workerPresenceHealthy).toBe(true);
  expect(x.workerPresenceLeaseActive).toBe(true);
  expect(x.reviewReason).toBe("FLAG_OFF");
  expect(x.commandResumeAuthorizationVerified).toBe(false);
  expect(x.commandExclusiveLeaseVerified).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
 it("an enabled review still requires an explicit BLOCKER",()=>{
  const x=assessReadonlyRecoveryFacts({...facts(),serverFlag:true});
  expect(x.reviewReason).toBe("NO_BLOCKER");
  expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
 });
 it("even with a legitimate latest blocker, exact authorization remains absent",()=>{
  const f=facts();const b={id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null};
  const x=assessReadonlyRecoveryFacts({...f,serverFlag:true,responseRows:[...f.responseRows,b]});
  expect(x.phase).toBe("BLOCKED");
  expect(x.blockingResponseId).toBe("b1");
  expect(x.reviewReason).toBe("AUTHORIZATION_REQUIRED");
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("a presence lease does not imply a command lease",()=>{
  const f=facts();const x=assessReadonlyRecoveryFacts({...f,serverFlag:true,
   responseRows:[...f.responseRows,{id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null}]});
  expect(x.workerPresenceLeaseActive).toBe(true);
  expect(x.commandExclusiveLeaseVerified).toBe(false);
 });
 it("unknown policy, unhealthy worker and expired presence never grant authority",()=>{
  for(const patch of [{policy:null},{presence:null},{presence:{...facts().presence!,leaseExpiresAt:new Date(now.getTime()-30000),reportedHealth:"degraded"}}]){
   const x=assessReadonlyRecoveryFacts({...facts(),serverFlag:true,...patch});
   expect(x.mayDispatchWorker).toBe(false);
   expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
  }
 });
 it("native ACK label alone cannot set verified readiness",()=>{
  const x=assessReadonlyRecoveryFacts({...facts(),checkpointVerified:false,serverFlag:true});
  expect(x.receiverAckVerified).toBe(false);
  expect(x.reviewReason).toBe("NO_BLOCKER");
 });
 it("unknown command returns not found without querying presence",async()=>{
  const prior=m.life;
  (m as unknown as {life:unknown}).life={found:false,commandId:"none"};
  try {expect((await getDevCommandRecoveryReview("none")).found).toBe(false)} finally {(m as unknown as {life:unknown}).life=prior}
 });
});
