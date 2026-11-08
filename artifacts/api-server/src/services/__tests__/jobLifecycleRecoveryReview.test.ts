import {describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({rows:[] as unknown[],calls:0,humanRows:[] as unknown[],life:{found:true,commandStatus:"FAILED",checkpointResponseId:"cp1",checkpointAttested:true,nativeReceiverAckVerified:true}}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>{
  const call=m.calls++;
  return {rows:call%4===3?m.humanRows:m.rows};
}}}));
vi.mock("../codingCommandLifecycleEvidence.js",()=>({getCodingCommandLifecycleEvidence:async()=>m.life}));
import {assessReadonlyRecoveryFacts,getDevCommandRecoveryReview,parseRecoveryRecommendation,type RecoveryRuntimeFacts} from "../jobLifecycleRecoveryReview.js";
const now=new Date("2026-11-07T18:00:00Z");
function facts():RecoveryRuntimeFacts{return {
 commandId:"169a7492-cfd8-4a56-bb57-18001b6b5968",status:"FAILED",checkpointResponseId:"cp1",checkpointAttested:true,nativeReceiverAckVerified:true,
 responseRows:[{id:"ack1",kind:"ACK",createdAt:new Date(now.getTime()-900000),acknowledgedAt:null},
 {id:"failed",kind:"FAILED",createdAt:new Date(now.getTime()-600000),acknowledgedAt:null},
 {id:"cp1",kind:"CHECKPOINT",createdAt:new Date(now.getTime()-600000),acknowledgedAt:new Date(now.getTime()-550000)}],
 presence:{workerId:"openclaw-dell-chatgpt-wake-dev",lastSeenAt:new Date(now.getTime()-5000),leaseExpiresAt:new Date(now.getTime()+60000),reportedHealth:"healthy"},
 policy:{enabled:true,maxRetries:3,heartbeatGraceMinutes:10,requireAcknowledgement:true},serverFlag:false,now,responseSnapshotComplete:true,
};}
const cmd="83db99f5-cbda-4e60-be71-3090fb411bbb";
const reviewer="admcst001@gmail.com";
const recommendation=(decision:string)=>JSON.stringify({
  decision,commandId:cmd,jobId:135,
  dispatchAuthorized:false,resumeAllowed:false,checkpointIssued:false,
});
describe("advisory recovery recommendation binding",()=>{
 it("recognizes a valid bound reviewer recommendation",()=>{
  expect(parseRecoveryRecommendation(recommendation("recommend_new_attempt"),reviewer,reviewer,cmd,135))
   .toBe("recommend_new_attempt");
  expect(parseRecoveryRecommendation(recommendation("deny_new_attempt"),reviewer,reviewer,cmd,135))
   .toBe("deny_new_attempt");
 });
 it("rejects spoofed actor, wrong job or command and malformed input",()=>{
  expect(parseRecoveryRecommendation(recommendation("recommend_new_attempt"),"attacker",reviewer,cmd,135)).toBeNull();
  expect(parseRecoveryRecommendation(recommendation("recommend_new_attempt"),reviewer,reviewer,cmd,136)).toBeNull();
  expect(parseRecoveryRecommendation(recommendation("recommend_new_attempt"),reviewer,reviewer,"other",135)).toBeNull();
  expect(parseRecoveryRecommendation("invalid-json",reviewer,reviewer,cmd,135)).toBeNull();
 });
 it("rejects recommendation masquerading as dispatch authorization",()=>{
  const attempt=JSON.stringify({...JSON.parse(recommendation("recommend_new_attempt")),dispatchAuthorized:true});
  expect(parseRecoveryRecommendation(attempt,reviewer,reviewer,cmd,135)).toBeNull();
  expect(parseRecoveryRecommendation(JSON.stringify({...JSON.parse(recommendation("new")),decision:"arbitrary"}),reviewer,reviewer,cmd,135)).toBeNull();
 });
});
describe("DEV-only native GPT02 fail-closed recovery review",()=>{
 it("recognizes real ACK but never dispatches or closes",()=>{
  const x=assessReadonlyRecoveryFacts(facts());
  expect(x.checkpointAttested).toBe(true);
  expect(x.receiverAckVerified).toBe(true);
  expect(x.phase).toBe("IN_PROGRESS");
  expect(x.blockingResponseId).toBeNull();
  expect(x.workerPresenceHealthy).toBe(true);
  expect(x.workerPresenceLeaseActive).toBe(true);
  expect(x.reviewReason).toBe("TERMINAL_OR_UNKNOWN_COMMAND_STATUS");
  expect(x.commandResumeAuthorizationVerified).toBe(false);
  expect(x.commandExclusiveLeaseVerified).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
 it("an enabled review still requires an explicit BLOCKER",()=>{
  const x=assessReadonlyRecoveryFacts({...facts(),serverFlag:true});
  expect(x.reviewReason).toBe("TERMINAL_OR_UNKNOWN_COMMAND_STATUS");
  expect(x.blockerEvidenceValid).toBe(false);
  expect(x.blockerEvidenceReason).toBe("NO_BLOCKER");
  expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
 });
 it("terminal FAILED between checkpoint and blocker blocks recovery despite BLOCKER",()=>{
  const f=facts();const b={id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null};
  const x=assessReadonlyRecoveryFacts({...f,serverFlag:true,responseRows:[...f.responseRows,b]});
  expect(x.phase).toBe("BLOCKED");
  expect(x.blockingResponseId).toBe("b1");
  expect(x.blockerEvidenceValid).toBe(false);
  expect(x.blockerEvidenceReason).toBe("TERMINAL_AFTER_CHECKPOINT");
  expect(x.reviewReason).toBe("TERMINAL_OR_UNKNOWN_COMMAND_STATUS");
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("a valid blocker still cannot grant dispatch or command authorization",()=>{
  const f=facts();
  const responseRows=f.responseRows.filter(r=>r.kind!=="FAILED");
  responseRows.push({id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null});
  const x=assessReadonlyRecoveryFacts({...f,serverFlag:true,responseRows});
  expect(x.blockerEvidenceValid).toBe(true);
  expect(x.blockerEvidenceReason).toBe("BLOCKER_EVIDENCE_VALID");
  expect(x.commandResumeAuthorizationVerified).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
 it("a BLOCKER on terminal FAILED command is never recovery-review eligible",()=>{
  const f=facts();const responseRows=f.responseRows.filter(r=>r.kind!=="FAILED");
  responseRows.push({id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null});
  const x=assessReadonlyRecoveryFacts({...f,responseRows,serverFlag:true});
  expect(x.blockerEvidenceValid).toBe(true);
  expect(x.commandStatusReviewable).toBe(false);
  expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
  expect(x.reviewReason).toBe("TERMINAL_OR_UNKNOWN_COMMAND_STATUS");
 });
 it("a valid BLOCKER cannot pass review on a truncated response snapshot",()=>{
  const f=facts();const responseRows=f.responseRows.filter(r=>r.kind!=="FAILED");
  responseRows.push({id:"b1",kind:"BLOCKER",createdAt:new Date(now.getTime()-1000),acknowledgedAt:null});
  const x=assessReadonlyRecoveryFacts({...f,status:"PROCESSING",responseRows,serverFlag:true,responseSnapshotComplete:false});
  expect(x.blockerEvidenceValid).toBe(true);
  expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
  expect(x.reviewReason).toBe("INCOMPLETE_RESPONSE_SNAPSHOT");
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("does not label a stale or future heartbeat as healthy",()=>{
  const f=facts();
  for(const stamp of [new Date(now.getTime()-11*60000),new Date(now.getTime()+60000)]) {
   const x=assessReadonlyRecoveryFacts({...f,presence:{...f.presence!,lastSeenAt:stamp}});
   expect(x.workerPresenceHealthy).toBe(false);
   expect(x.mayDispatchWorker).toBe(false);
  }
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
  const x=assessReadonlyRecoveryFacts({...facts(),checkpointAttested:false,nativeReceiverAckVerified:false,serverFlag:true});
  expect(x.receiverAckVerified).toBe(false);
  expect(x.reviewReason).toBe("TERMINAL_OR_UNKNOWN_COMMAND_STATUS");
  expect(x.eligibleForAuthorizedRecoveryReview).toBe(false);
 });
 it("separates verified issuer receipt from missing native receiver ACK",()=>{
  const x=assessReadonlyRecoveryFacts({...facts(),status:"PROCESSING",serverFlag:true,
    checkpointAttested:true,nativeReceiverAckVerified:false});
  expect(x.checkpointAttested).toBe(true);
  expect(x.receiverAckVerified).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("cannot treat ACK-only claim as a signed checkpoint",()=>{
  const x=assessReadonlyRecoveryFacts({...facts(),status:"PROCESSING",serverFlag:true,
    checkpointAttested:false,nativeReceiverAckVerified:true});
  expect(x.checkpointAttested).toBe(false);
  expect(x.receiverAckVerified).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("links recovered artifact evidence without granting recovery permission",async()=>{
   m.humanRows=[{id:6,status:"accepted",completed_at:null,job_id:"135",recovered_artifact_evidence_recorded:true,
      assigned_user:reviewer,recommendation_notes:JSON.stringify({
        ...JSON.parse(recommendation("recommend_new_attempt")),commandId:facts().commandId,
      }),recommendation_actor:reviewer}];
   try {
     const x=await getDevCommandRecoveryReview(facts().commandId);
     expect(x.found).toBe(true);
     if(!x.found)return;
     expect(x.humanReviewId).toBe(6);
     expect(x.humanReviewStatus).toBe("accepted");
     expect(x.humanReviewCompleted).toBe(false);
     expect(x.recoveredArtifactEvidenceRecorded).toBe(true);
     expect(x.linkedJobId).toBe(135);
     expect(x.prototypeIntegrityEvidence).toBeNull();
     expect(x.humanRecoveryRecommendation).toBe("recommend_new_attempt");
     expect(x.newAttemptPreflight.reason).toBe("ARTIFACT_NOT_VERIFIED");
     expect(x.newAttemptPreflight.readyForSeparateAuthorization).toBe(false);
     expect(x.newAttemptPreflight.mayCreateCommand).toBe(false);
     expect(x.newAttemptPreflight.mayDispatchWorker).toBe(false);
     expect(x.newAttemptPreflightUnverifiedInputs).toContain("verified_artifact_manifest");
     expect(x.humanRecoveryAuthorizationVerified).toBe(false);
     expect(x.commandResumeAuthorizationVerified).toBe(false);
     expect(x.mayDispatchWorker).toBe(false);
     expect(x.mayCloseJob).toBe(false);
   } finally {m.humanRows=[];}
 });
 it("absence of Human Review must not fabricate evidence or authorization",async()=>{
   m.humanRows=[];
   const x=await getDevCommandRecoveryReview(facts().commandId);
   expect(x.found).toBe(true);
   if(!x.found)return;
   expect(x.newAttemptPreflight.reason).toBe("MISSING_REVIEW");
   expect(x.newAttemptPreflight.mayCreateCommand).toBe(false);
   expect(x.humanReviewId).toBeNull();
   expect(x.recoveredArtifactEvidenceRecorded).toBe(false);
   expect(x.humanRecoveryAuthorizationVerified).toBe(false);
 });
 it("accepted review without recommendation cannot prepare a command",async()=>{
   m.humanRows=[{id:6,status:"accepted",completed_at:null,job_id:"135",
      assigned_user:reviewer,recovered_artifact_evidence_recorded:true,
      recommendation_notes:null,recommendation_actor:null}];
   try{
     const x=await getDevCommandRecoveryReview(facts().commandId);
     expect(x.found).toBe(true);
     if(!x.found)return;
     expect(x.newAttemptPreflight.reason).toBe("NO_RECOMMENDATION");
     expect(x.newAttemptPreflight.mayCreateCommand).toBe(false);
     expect(x.newAttemptPreflight.mayDispatchWorker).toBe(false);
     expect(x.newAttemptPreflight.mayCloseJob).toBe(false);
   }finally{m.humanRows=[];}
 });
 it("unknown command returns not found without querying presence",async()=>{
  const prior=m.life;
  (m as unknown as {life:unknown}).life={found:false,commandId:"none"};
  try {expect((await getDevCommandRecoveryReview("none")).found).toBe(false)} finally {(m as unknown as {life:unknown}).life=prior}
 });
});
