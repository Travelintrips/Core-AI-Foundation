import {describe,it,expect} from "vitest";
import {reviewGrantIssuancePreflight} from "../jobLifecycleGrantIssuancePreflight.js";
import type {ResumeGrantRecord} from "../jobLifecycleResumeAuthorization.js";
import type {LifecycleEvidenceRow} from "../jobLifecycleReadinessService.js";

const at=(n:number)=>new Date("2026-11-08T00:00:00.000Z".replace("00:00:00",`00:00:${String(n).padStart(2,"0")}`));
const commandId="command-1", workerId="openclaw-dell-chatgpt-wake-dev";
const rows=():LifecycleEvidenceRow[]=>[
 {id:"cp",commandId,kind:"CHECKPOINT",createdAt:at(1),acknowledgedAt:at(2),checkpointAttested:true,receiverAckVerified:true},
 {id:"block",commandId,kind:"BLOCKER",createdAt:at(3),acknowledgedAt:null},
];
const grant=():ResumeGrantRecord=>({
 commandId,workerId,checkpointResponseId:"cp",blockerResponseId:"block",
 status:"APPROVED",approvedBy:"authenticated-operator",approvedAt:at(4),expiresAt:at(50),consumedAt:null,
});
function valid(){return {
 commandId,commandStatus:"PROCESSING",workerId,now:at(5),persistedRows:rows(),
 databaseSnapshotVerified:true,responseHistoryComplete:true,signedCheckpointAndNativeAckVerified:true,
 grant:grant(),grantRecordVerified:true,
};}
describe("authorized resume preflight remains read-only and fail-closed",()=>{
 it("never issues a grant, dispatches or closes even with a clean server-owned snapshot",()=>{
  const x=reviewGrantIssuancePreflight(valid());
  expect(x).toMatchObject({eligibleForFurtherReview:true,reason:"REVIEW_ONLY_VERIFIED",
   blockerResponseId:"block",checkpointResponseId:"cp",
   mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});
 });
 const cases:[string,Record<string,unknown>,string][]=[
  ["unauthenticated snapshot",{databaseSnapshotVerified:false},"UNVERIFIED_DATABASE_SNAPSHOT"],
  ["terminal command",{commandStatus:"FAILED"},"TERMINAL_OR_UNKNOWN_COMMAND"],
  ["unknown command",{commandStatus:"PAUSED"},"TERMINAL_OR_UNKNOWN_COMMAND"],
  ["truncated history",{responseHistoryComplete:false},"INCOMPLETE_HISTORY"],
  ["unsigned receipt",{signedCheckpointAndNativeAckVerified:false},"MISSING_SIGNED_EVIDENCE"],
  ["invalid blocker",{persistedRows:[rows()[0]]},"INVALID_BLOCKER"],
  ["cross command response",{persistedRows:[rows()[0],{...rows()[1],commandId:"other"}]},"INVALID_BLOCKER"],
  ["terminal before checkpoint",{persistedRows:[{id:"failed",commandId,kind:"FAILED",createdAt:at(0),acknowledgedAt:null},...rows()]},"INVALID_BLOCKER"],
  ["grant absent",{grant:null},"GRANT_REVIEW_DENIED"],
  ["grant from worker",{grantRecordVerified:false},"GRANT_REVIEW_DENIED"],
  ["cross command grant",{grant:{...grant(),commandId:"another"}},"GRANT_REVIEW_DENIED"],
  ["wrong blocker grant",{grant:{...grant(),blockerResponseId:"other"}},"GRANT_REVIEW_DENIED"],
  ["wrong checkpoint grant",{grant:{...grant(),checkpointResponseId:"other"}},"GRANT_REVIEW_DENIED"],
  ["wrong worker grant",{grant:{...grant(),workerId:"other"}},"GRANT_REVIEW_DENIED"],
  ["expired grant",{grant:{...grant(),expiresAt:at(5)}},"GRANT_REVIEW_DENIED"],
  ["consumed grant",{grant:{...grant(),status:"CONSUMED",consumedAt:at(5)}},"GRANT_REVIEW_DENIED"],
 ];
 for(const [name,patch,reason] of cases)it("denies "+name,()=>{
  const x=reviewGrantIssuancePreflight({...valid(),...patch});
  expect(x.reason).toBe(reason);
  expect(x.eligibleForFurtherReview).toBe(false);
  expect(x.mayIssueGrant).toBe(false);
  expect(x.mayDispatchWorker).toBe(false);
  expect(x.mayCloseJob).toBe(false);
 });
});
