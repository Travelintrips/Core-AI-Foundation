import {describe,it,expect} from "vitest";
import {evaluateNewAttemptPreflight, type NewAttemptPreflight} from "../jobLifecycleNewAttemptPreflight.js";
const original="83db99f5-cbda-4e60-be71-3090fb411bbb";
const baseline=():NewAttemptPreflight=>({
 environment:"development",jobId:135,reviewJobId:135,
 originalCommandId:original,reviewCommandId:original,
 proposedNewCommandId:"a6e11e44-3297-4c4e-874e-110e3c886966",
 originalCommandStatus:"FAILED",humanReviewStatus:"accepted",
 recommendation:"recommend_new_attempt",evidenceVerified:true,
 artifactSha256:"f04519d8fadb09f0103c7e00646792a466bf0ddb512973c19ab82f4aaecf3658",
 existingAttemptCount:0,workerHealthy:true,
 retryAfterAt:null,now:new Date("2026-11-08T02:00:00Z"),
});
describe("New attempt planning never authorizes dispatch",()=>{
 it("passing all preflight checks is still only separate authorization eligibility",()=>{
  expect(evaluateNewAttemptPreflight(baseline())).toEqual({
   readyForSeparateAuthorization:true,reason:"READY_FOR_SEPARATE_AUTHORIZATION",
   mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
  });
 });
 for(const [name,change,reason] of [
  ["prod",{environment:"production"},"NOT_DEV"],
  ["original active",{originalCommandStatus:"PROCESSING"},"ORIGINAL_NOT_FAILED"],
  ["missing review",{humanReviewStatus:null},"MISSING_REVIEW"],
  ["review pending",{humanReviewStatus:"assigned"},"HUMAN_REVIEW_NOT_ACCEPTED"],
  ["no decision",{recommendation:null},"NO_RECOMMENDATION"],
  ["review denied",{recommendation:"deny_new_attempt"},"REVIEWER_DENIED"],
  ["unverified evidence",{evidenceVerified:false},"ARTIFACT_NOT_VERIFIED"],
  ["wrong digest",{artifactSha256:"unverified"},"INVALID_ARTIFACT_HASH"],
  ["wrong job",{reviewJobId:136},"JOB_BINDING_MISMATCH"],
  ["wrong command",{reviewCommandId:"other"},"COMMAND_BINDING_MISMATCH"],
  ["replay command",{proposedNewCommandId:original},"COMMAND_REPLAY"],
  ["duplicate attempt",{existingAttemptCount:1},"DUPLICATE_ATTEMPT"],
  ["malformed attempts",{existingAttemptCount:-1},"DUPLICATE_ATTEMPT"],
  ["dead worker",{workerHealthy:false},"WORKER_UNHEALTHY"],
  ["retry-after",{retryAfterAt:new Date("2026-11-08T02:01:00Z")},"RETRY_AFTER_ACTIVE"],
 ] as const){
  it("fails closed: "+name,()=>{
   const outcome=evaluateNewAttemptPreflight({...baseline(),...change} as NewAttemptPreflight);
   expect(outcome.reason).toBe(reason);
   expect(outcome.readyForSeparateAuthorization).toBe(false);
   expect(outcome.mayCreateCommand).toBe(false);
   expect(outcome.mayDispatchWorker).toBe(false);
  });
 }
});
