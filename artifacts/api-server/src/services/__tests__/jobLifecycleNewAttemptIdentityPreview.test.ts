import {describe,it,expect,vi,beforeEach} from "vitest";
const state=vi.hoisted(()=>({calls:0,rows:[] as unknown[]}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>{state.calls++;return {rows:state.rows}}}}));
import {getNewAttemptIdentityPreview,evaluateIdentityPreview} from "../jobLifecycleNewAttemptIdentityPreview.js";

const original="83db99f5-cbda-4e60-be71-3090fb411bbb";
const candidate="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const baseline=()=>({parentCommandId:original,candidateCommandId:candidate,
 originalExists:true,originalStatus:"FAILED",candidateExists:false,taggedChildCount:0});
beforeEach(()=>{state.calls=0;state.rows=[{original_exists:true,original_status:"FAILED",
 candidate_exists:false,tagged_child_count:0}];});
describe("read-only candidate command preview",()=>{
 it("never turns a free UUID snapshot into a lease or command grant",()=>{
  expect(evaluateIdentityPreview(baseline())).toEqual({
   previewOnly:true,reason:"SNAPSHOT_CLEAR_NOT_RESERVED",candidateCommandId:candidate,
   observedTaggedChildCount:0,observedCandidateExists:false,
   identitySnapshotClear:true,reservationVerified:false,
   duplicateFreeAtCommitVerified:false,exclusiveLeaseVerified:false,
   dispatchAuthorizationVerified:false,mayCreateCommand:false,
   mayDispatchWorker:false,mayCloseJob:false,
  });
 });
 for(const [label,patch,reason] of [
  ["original missing",{originalExists:false},"ORIGINAL_NOT_FOUND"],
  ["original active",{originalStatus:"PROCESSING"},"ORIGINAL_NOT_FAILED"],
  ["replayed ID",{candidateCommandId:original},"COMMAND_REPLAY"],
  ["candidate collision",{candidateExists:true},"CANDIDATE_ALREADY_EXISTS"],
  ["observed child",{taggedChildCount:1},"POSSIBLE_PRIOR_ATTEMPT"],
  ["unverified count",{taggedChildCount:-1},"ATTEMPT_COUNT_UNVERIFIED"],
  ["malformed UUID",{candidateCommandId:"not-a-uuid"},"INVALID_IDENTITY"],
 ] as const){
  it("fails closed for "+label,()=>{
   const r=evaluateIdentityPreview({...baseline(),...patch});
   expect(r.reason).toBe(reason);
   expect(r.identitySnapshotClear).toBe(false);
   expect(r.mayCreateCommand).toBe(false);
   expect(r.mayDispatchWorker).toBe(false);
  });
 }
 it("real query reads only one identity snapshot and returns an unreserved UUID",async()=>{
  const result=await getNewAttemptIdentityPreview(original);
  expect(state.calls).toBe(1);
  expect(result.candidateCommandId).toMatch(/^[a-f0-9-]{36}$/);
  expect(result.candidateCommandId).not.toBe(original);
  expect(result.previewOnly).toBe(true);
  expect(result.mayCreateCommand).toBe(false);
  expect(result.reservationVerified).toBe(false);
 });
 it("unreadable duplicate count refuses to infer no collisions",async()=>{
  state.rows=[{original_exists:true,original_status:"FAILED",candidate_exists:false,
    tagged_child_count:null}];
  const r=await getNewAttemptIdentityPreview(original);
  expect(r.reason).toBe("ATTEMPT_COUNT_UNVERIFIED");
  expect(r.mayDispatchWorker).toBe(false);
 });
});
