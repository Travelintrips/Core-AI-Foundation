import {describe,it,expect} from "vitest";
import {summarizeDevRecoveryEvidence} from "../jobLifecycleDevEvidenceSummary.js";
const id="169a7492-cfd8-4a56-bb57-18001b6b5968";
describe("DEV evidence summary never escalates observation to authority",()=>{
 it("terminal command and missing evidence deny all authorization",()=>{
  const s=summarizeDevRecoveryEvidence(id,{found:true,commandStatus:"FAILED",commandStatusReviewable:false});
  expect(s.releaseDecision).toBe("NO_GO");
  expect(s.snapshotAtomic).toBe(false);
  expect(s.checks.find(x=>x.id==="command_lineage")?.state).toBe("BLOCKED");
  expect([s.maySign,s.mayIssueGrant,s.mayDispatchWorker,s.mayCloseJob]).toEqual([false,false,false,false]);
 });
 it("even all observed command evidence cannot authorize grant or E2E completion",()=>{
  const s=summarizeDevRecoveryEvidence(id,{found:true,commandStatus:"PROCESSING",commandStatusReviewable:true,
   responseSnapshotComplete:true,checkpointResponseId:"cp",checkpointAttested:true,
   receiverAckVerified:true,blockingResponseId:"block",blockerEvidenceValid:true,workerPresenceHealthy:true});
  expect(s.checks.filter(x=>x.state==="OBSERVED")).toHaveLength(6);
  expect(s.checks.filter(x=>x.state==="NOT_VERIFIED")).toHaveLength(7);
  expect(s.checks.find(x=>x.id==="task_center_monitoring")?.state).toBe("NOT_VERIFIED");
  expect(s.releaseDecision).toBe("NO_GO");
  expect(s.mayDispatchWorker).toBe(false);
 });
 it("missing command is not treated as an empty valid response snapshot",()=>{
  const s=summarizeDevRecoveryEvidence(id,{found:false,responseSnapshotComplete:true,checkpointAttested:true,
    receiverAckVerified:true,blockerEvidenceValid:true,workerPresenceHealthy:true});
  expect(s.found).toBe(false);
  expect(s.checks.some(x=>x.state==="OBSERVED")).toBe(false);
 });
});
