import { describe, expect, it } from "vitest";
import { reviewBlockerEvidence } from "../jobLifecycleBlockerEvidence.js";
import type { LifecycleEvidenceRow } from "../jobLifecycleReadinessService.js";

const id = "test-command";
const at = (n:number) => new Date(Date.UTC(2026,10,8,0,0,n));
const cp = ():LifecycleEvidenceRow => ({ id:"cp",commandId:id,kind:"CHECKPOINT",createdAt:at(1),
  acknowledgedAt:at(2),checkpointAttested:true,receiverAckVerified:true });
const blocker = ():LifecycleEvidenceRow => ({ id:"block",commandId:id,kind:"BLOCKER",createdAt:at(3),acknowledgedAt:null });
const terminal = ():LifecycleEvidenceRow => ({ id:"terminal",commandId:id,kind:"FAILED",createdAt:at(2),acknowledgedAt:null });

describe("DEV recovery blocker evidence is fail-closed and read-only",()=>{
  it("accepts attested checkpoint followed by an explicit blocker but never dispatches",()=>{
    const result = reviewBlockerEvidence(id,[blocker(),cp()]);
    expect(result).toMatchObject({valid:true,reason:"BLOCKER_EVIDENCE_VALID",
      checkpointResponseId:"cp",blockerResponseId:"block",mayDispatchWorker:false,mayCloseJob:false});
  });
  it("rejects absent blocker",()=>expect(reviewBlockerEvidence(id,[cp()]).reason).toBe("NO_BLOCKER"));
  it("rejects missing checkpoint ACK or signature",()=>{
    for(const change of [{acknowledgedAt:null},{checkpointAttested:false},{receiverAckVerified:false}]){
      expect(reviewBlockerEvidence(id,[{...cp(),...change},blocker()]).reason).toBe("CHECKPOINT_NOT_VERIFIED");
    }
  });
  it("rejects evidence from another command",()=>{
    expect(reviewBlockerEvidence(id,[cp(),{...blocker(),commandId:"other"}]).reason).toBe("COMMAND_MISMATCH");
  });
  it("rejects duplicate IDs",()=>{
    expect(reviewBlockerEvidence(id,[cp(),cp(),blocker()]).reason).toBe("DUPLICATE_RESPONSE_ID");
  });
  it("rejects missing or invalid event timestamps",()=>{
    expect(reviewBlockerEvidence(id,[{...cp(),createdAt:null},blocker()]).reason).toBe("INVALID_EVENT_TIME");
    expect(reviewBlockerEvidence(id,[{...cp(),createdAt:new Date(NaN)},blocker()]).reason).toBe("INVALID_EVENT_TIME");
  });
  it("rejects blocker before checkpoint",()=>{
    expect(reviewBlockerEvidence(id,[{...blocker(),createdAt:at(0)},cp()]).valid).toBe(false);
  });
  it("rejects historical FAILED before a later verified checkpoint and blocker",()=>{
    const early={...terminal(),createdAt:at(0)};
    const x=reviewBlockerEvidence(id,[early,cp(),blocker()]);
    expect(x.reason).toBe("TERMINAL_BEFORE_CHECKPOINT");
    expect(x.valid).toBe(false);
    expect(x.mayDispatchWorker).toBe(false);
  });
  it("rejects historical COMPLETED before a later verified checkpoint and blocker",()=>{
    const early={...terminal(),kind:"COMPLETED",createdAt:at(0)};
    expect(reviewBlockerEvidence(id,[early,cp(),blocker()]).reason).toBe("TERMINAL_BEFORE_CHECKPOINT");
  });
  it("rejects terminal outcome after checkpoint, even if followed by blocker",()=>{
    expect(reviewBlockerEvidence(id,[cp(),terminal(),blocker()]).reason).toBe("TERMINAL_AFTER_CHECKPOINT");
  });
  it("does not turn terminal response into blocker",()=>{
    expect(reviewBlockerEvidence(id,[cp(),terminal()]).valid).toBe(false);
  });
});
