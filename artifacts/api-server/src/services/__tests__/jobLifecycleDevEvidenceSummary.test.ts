import {describe,it,expect} from "vitest";
import {summarizeDevRecoveryEvidence,attachDevAiTaskReadback} from "../jobLifecycleDevEvidenceSummary.js";
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
 it("shows DB command task reference without claiming an AI Task job match",()=>{
  const s=summarizeDevRecoveryEvidence(id,{found:true,commandStatus:"PROCESSING",
   commandStatusReviewable:true,sourceTaskId:"source-task-42"});
  expect(s.sourceTaskId).toBe("source-task-42");
  expect(s.sourceTaskIdVerifiedAsAiTaskJob).toBe(false);
  expect(s.expectedAiTaskLedgerExternalId).toBe("bridge-command:"+id);
  expect(s.aiTaskLedgerReadbackVerified).toBe(false);
  expect(s.checks.find(x=>x.id==="job_intake")?.state).toBe("NOT_VERIFIED");
  expect(s.releaseDecision).toBe("NO_GO");
 });
 it("matching receiver record is observed without granting lifecycle authority",()=>{
  const base=summarizeDevRecoveryEvidence(id,{found:true,commandStatus:"PROCESSING",commandStatusReviewable:true});
  const merged=attachDevAiTaskReadback(base,{verified:true,reason:"DEV_RECEIVER_IDENTITY_OBSERVED_NOT_EXECUTION_AUTHORITY",
   receiverJobId:"238e0ad4-3c74-4469-908a-cd49ac6515f2",receiverStatus:"processing",receiverProgress:34});
  expect(merged.aiTaskLedgerReadbackVerified).toBe(true);
  expect(merged.checks.find(x=>x.id==="ai_task_ledger_identity")?.state).toBe("OBSERVED");
  expect(merged.checks.find(x=>x.id==="task_center_monitoring")?.state).toBe("NOT_VERIFIED");
  expect(merged.checks.find(x=>x.id==="job_intake")?.state).toBe("NOT_VERIFIED");
  expect(merged.releaseDecision).toBe("NO_GO");
  expect([merged.maySign,merged.mayIssueGrant,merged.mayDispatchWorker,merged.mayCloseJob]).toEqual([false,false,false,false]);
  expect(base.checks.some(x=>x.id==="ai_task_ledger_identity")).toBe(false);
 });
 it("receiver reporting 100 percent and completed cannot complete GPT02",()=>{
  const base=summarizeDevRecoveryEvidence(id,{found:true,commandStatus:"PROCESSING",commandStatusReviewable:true,
   responseSnapshotComplete:true,checkpointResponseId:"cp",checkpointAttested:true,
   receiverAckVerified:true,blockingResponseId:"block",blockerEvidenceValid:true,workerPresenceHealthy:true});
  const merged=attachDevAiTaskReadback(base,{verified:true,reason:"DEV_RECEIVER_IDENTITY_OBSERVED_NOT_EXECUTION_AUTHORITY",
   receiverJobId:"238e0ad4-3c74-4469-908a-cd49ac6515f2",receiverStatus:"completed",receiverProgress:100});
  expect(merged.aiTaskLedgerReceiverProgress).toBe(100);
  expect(merged.aiTaskLedgerStatusAndProgressAuthoritative).toBe(false);
  expect(merged.checks.find(x=>x.id==="worker_completion")?.state).toBe("NOT_VERIFIED");
  expect(merged.checks.find(x=>x.id==="task_center_monitoring")?.state).toBe("NOT_VERIFIED");
  expect(merged.releaseDecision).toBe("NO_GO");
  expect([merged.maySign,merged.mayIssueGrant,merged.mayDispatchWorker,merged.mayCloseJob]).toEqual([false,false,false,false]);
 });
 it("missing receiver job ID or failed readback never claims correlation",()=>{
  const base=summarizeDevRecoveryEvidence(id,{found:true});
  const missing=attachDevAiTaskReadback(base,{verified:true,reason:"MISCONFIGURED"});
  expect(missing.aiTaskLedgerReadbackVerified).toBe(false);
  expect(missing.checks.find(x=>x.id==="ai_task_ledger_identity")?.state).toBe("NOT_VERIFIED");
  const offline=attachDevAiTaskReadback(base,{verified:false,reason:"RECEIVER_TRANSPORT_UNAVAILABLE"});
  expect(offline.aiTaskLedgerReadbackVerified).toBe(false);
  expect(offline.aiTaskLedgerReceiverJobId).toBeUndefined();
  expect(offline.checks.find(x=>x.id==="ai_task_ledger_identity")?.reason).toBe("RECEIVER_TRANSPORT_UNAVAILABLE");
 });
 it("missing command is not treated as an empty valid response snapshot",()=>{
  const s=summarizeDevRecoveryEvidence(id,{found:false,responseSnapshotComplete:true,checkpointAttested:true,
    receiverAckVerified:true,blockerEvidenceValid:true,workerPresenceHealthy:true});
  expect(s.found).toBe(false);
  expect(s.expectedAiTaskLedgerExternalId).toBeNull();
  expect(s.checks.some(x=>x.state==="OBSERVED")).toBe(false);
 });
});
