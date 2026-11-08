import {describe,expect,it} from "vitest";
import {projectGpt02Job135Timeline,type TimelineResponse}
  from "../gpt02Job135TimelineProjection.js";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const candidate="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const event=(kind:TimelineResponse["kind"],i:number):TimelineResponse=>({
  id:"response-"+i,commandId:candidate,kind,
  createdAt:new Date("2026-11-08T12:00:00.000Z"),
  nativeAttestationVerified:false,receiverAckVerified:false,resultVerified:false,
});
const input=(responses:TimelineResponse[])=>({
  jobId:135,parentCommandId:parent,candidateCommandId:candidate,
  assignedWorkerId:"gpt02-dell",accountableOwner:"operator",
  reviewAccepted:true,responses,
});
describe("GPT02 read-only timeline never grants dispatch or completion",()=>{
  it("missing candidate is issuer-unverified, percent unknown",()=>{
    expect(projectGpt02Job135Timeline({...input([]),candidateCommandId:null}))
      .toMatchObject({status:"ISSUER_NOT_VERIFIED",progressPercent:null,
        mayDispatchWorker:false,mayCloseJob:false});
  });
  it("progress and checkpoint never invent percentage or final result",()=>{
    const x=projectGpt02Job135Timeline(input([event("PROGRESS",1),event("CHECKPOINT",2)]));
    expect(x).toMatchObject({observedEventCount:2,progressPercent:null,
      eligibleForCompletionReview:false,mayCloseJob:false});
  });
  it("blocker is displayed with exact response",()=>{
    expect(projectGpt02Job135Timeline(input([event("CHECKPOINT",1),event("BLOCKER",2)])))
      .toMatchObject({blockerResponseId:"response-2",status:"BLOCKED_OR_UNVERIFIED"});
  });
  it("COMPLETED reported without native and result proof never closes",()=>{
    expect(projectGpt02Job135Timeline(input([event("COMPLETED",3)])))
      .toMatchObject({eligibleForCompletionReview:false,mayCloseJob:false});
  });
  it("all terminal proofs yield review eligibility only, never auto-close",()=>{
    const complete={...event("COMPLETED",4),nativeAttestationVerified:true,
      receiverAckVerified:true,resultVerified:true};
    expect(projectGpt02Job135Timeline(input([complete]))).toMatchObject({
      status:"RESULT_EVIDENCE_RECORDED",eligibleForCompletionReview:true,
      mayCloseJob:false,mayDispatchWorker:false,progressPercent:null});
  });
  it("accepted review is separately required for completion review",()=>{
    const complete={...event("COMPLETED",4),nativeAttestationVerified:true,
      receiverAckVerified:true,resultVerified:true};
    expect(projectGpt02Job135Timeline({...input([complete]),reviewAccepted:false})
      .eligibleForCompletionReview).toBe(false);
  });
  it("invalid, duplicate and cross-command evidence is rejected or ignored",()=>{
    const x=event("PROGRESS",1);
    expect(projectGpt02Job135Timeline(input([x,x])).status).toBe("EVIDENCE_INVALID");
    expect(projectGpt02Job135Timeline(input([{...x,createdAt:null}])).status)
      .toBe("EVIDENCE_INVALID");
    expect(projectGpt02Job135Timeline(input([{...x,commandId:parent}]))
      .observedEventCount).toBe(1);
    expect(projectGpt02Job135Timeline(input([{...x,commandId:"1".repeat(36)}]))
      .observedEventCount).toBe(0);
  });
  it("does not mutate incoming events",()=>{
    const rows=[event("BLOCKER",1)];const before=JSON.stringify(rows);
    projectGpt02Job135Timeline(input(rows));
    expect(JSON.stringify(rows)).toBe(before);
  });
});
