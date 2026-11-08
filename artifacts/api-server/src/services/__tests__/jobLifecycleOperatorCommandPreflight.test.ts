import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({read:vi.fn()}));
vi.mock("../jobLifecycleRecoveryReview.js",()=>({getDevCommandRecoveryReview:mock.read}));
import {getDevResumeOperatorCommandPreflight} from "../jobLifecycleOperatorCommandPreflight.js";
const cmd="169a7492-cfd8-4a56-bb57-18001b6b5968";
beforeEach(()=>mock.read.mockReset());
describe("real database-backed operator preflight fails closed before approval",()=>{
 it("refuses historical FAILED command with no BLOCKER and reports all missing guards",async()=>{
  mock.read.mockResolvedValue({found:true,commandStatus:"FAILED",
   commandStatusReviewable:false,responseSnapshotComplete:true,
   checkpointAttested:true,receiverAckVerified:true,blockerEvidenceValid:false,
   workerPresenceHealthy:true,workerPresenceLeaseActive:true,
   recoveryPolicyEnabled:true,recoveryFeatureEnabled:true,
   commandResumeAuthorizationVerified:false,commandExclusiveLeaseVerified:false,
   rateLimitClearanceVerified:false,retryBudgetVerified:false,
   checkpointResponseId:"checkpoint",blockingResponseId:null,reviewReason:"TERMINAL_OR_UNKNOWN_COMMAND_STATUS"});
  const x=await getDevResumeOperatorCommandPreflight(cmd);
  expect(x.found).toBe(true);
  if(!x.found)return;
  expect(x.approvalBlockers).toContain("COMMAND_TERMINAL_OR_UNKNOWN");
  expect(x.approvalBlockers).toContain("BLOCKER_NOT_VERIFIED");
  expect(x.approvalBlockers).toContain("RESUME_GRANT_UNVERIFIED");
  expect(x.reviewEvidenceBlockers).toContain("COMMAND_TERMINAL_OR_UNKNOWN");
  expect(x.reviewEvidenceBlockers).toContain("BLOCKER_NOT_VERIFIED");
  expect(x.reviewEvidenceReady).toBe(false);
  expect(x.diagnosticStage).toBe("REVIEW_EVIDENCE_BLOCKED");
  expect(x.reviewEvidenceBlockers).not.toContain("RESUME_GRANT_UNVERIFIED");
  expect(x.executionAdditionalBlockers).toContain("RESUME_GRANT_UNVERIFIED");
  expect(x.grantIssuanceEnabled).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
 it("does not report clear authorization even if every diagnostic boolean is true",async()=>{
  mock.read.mockResolvedValue({found:true,commandStatus:"PROCESSING",
   commandStatusReviewable:true,responseSnapshotComplete:true,
   checkpointAttested:true,receiverAckVerified:true,blockerEvidenceValid:true,
   workerPresenceHealthy:true,workerPresenceLeaseActive:true,
   recoveryPolicyEnabled:true,recoveryFeatureEnabled:true,
   commandResumeAuthorizationVerified:true,commandExclusiveLeaseVerified:true,
   rateLimitClearanceVerified:true,retryBudgetVerified:true,
   checkpointResponseId:"cp",blockingResponseId:"block",reviewReason:"REVIEW_ELIGIBLE"});
  const x=await getDevResumeOperatorCommandPreflight(cmd);
  expect(x.found).toBe(true);
  if(!x.found)return;
  expect(x.approvalBlockers).toEqual([]);
  expect(x.reviewEvidenceReady).toBe(true);
  expect(x.diagnosticStage).toBe("ISSUER_NOT_IMPLEMENTED");
  expect(x.issuanceBlockedReason).toBe("TRUSTED_GRANT_ISSUER_NOT_IMPLEMENTED");
  expect(x.reviewEvidenceBlockers).toEqual([]);
  expect(x.executionAdditionalBlockers).toEqual([]);
  expect(x.grantIssuanceEnabled).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("reports verified review evidence separately from blocked execution",async()=>{
  mock.read.mockResolvedValue({found:true,commandStatus:"PROCESSING",
   commandStatusReviewable:true,responseSnapshotComplete:true,
   checkpointAttested:true,receiverAckVerified:true,blockerEvidenceValid:true,
   workerPresenceHealthy:true,workerPresenceLeaseActive:true,
   recoveryPolicyEnabled:true,recoveryFeatureEnabled:true,
   commandResumeAuthorizationVerified:false,commandExclusiveLeaseVerified:false,
   rateLimitClearanceVerified:false,retryBudgetVerified:false,
   checkpointResponseId:"cp",blockingResponseId:"block",reviewReason:"AUTHORIZATION_REQUIRED"});
  const x=await getDevResumeOperatorCommandPreflight(cmd);
  expect(x.found).toBe(true);
  if(!x.found)return;
  expect(x.reviewEvidenceBlockers).toEqual([]);
  expect(x.reviewEvidenceReady).toBe(true);
  expect(x.diagnosticStage).toBe("EXECUTION_GATES_BLOCKED");
  expect(x.issuanceBlockedReason).toBe("TRUSTED_GRANT_ISSUER_NOT_IMPLEMENTED");
  expect(x.executionAdditionalBlockers).toEqual([
   "RESUME_GRANT_UNVERIFIED","EXCLUSIVE_COMMAND_LEASE_UNVERIFIED",
   "RATE_LIMIT_CLEARANCE_UNVERIFIED","RETRY_BUDGET_UNVERIFIED"]);
  expect(x.approvalBlockers).toEqual(x.executionAdditionalBlockers);
  expect(x.grantIssuanceEnabled).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
 });
 it("rejects malformed command IDs without reading DB",async()=>{
  const x=await getDevResumeOperatorCommandPreflight("not-uuid");
  expect(x.found).toBe(false);
  expect(mock.read).not.toHaveBeenCalled();
 });
 it("denies command missing in DEV",async()=>{
  mock.read.mockResolvedValue({found:false});
  const x=await getDevResumeOperatorCommandPreflight(cmd);
  expect(x.found).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
 });
});
