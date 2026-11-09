import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({calls:0,plan:[] as Array<Array<Record<string,unknown>>>}));
vi.mock("@workspace/db",()=>({db:{transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>
  fn({execute:async()=>({rows:mock.plan[mock.calls++]??[]})})}}));
import {readGpt02IssuerTransactionPreflight,validateGpt02IssuerPreflightInput}
  from "../gpt02DevIssuerTransactionPreflight.js";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const candidate="41aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const reservation="22aa961d-ac1e-4e12-a2c8-28ed07ff97cc";
const actor="admcst001@gmail.com";
const sha="f04519d8fadb09f0103c7e00646792a466bf0ddb512973c19ab82f4aaecf3658";
const input=()=>({jobId:135,humanReviewId:6,parentCommandId:parent,
  reservationId:reservation,actor});
const recommendation=JSON.stringify({decision:"recommend_new_attempt",jobId:135,
  commandId:parent,notes:"Review approved for new DEV attempt",dispatchAuthorized:false,
  resumeAllowed:false,checkpointIssued:false});
const integrity=JSON.stringify({schemaVersion:1,evidenceKind:"server_hashed_artifact_bytes",
  jobId:135,humanReviewId:6,commandId:parent,artifactStage:"recovered_prototype_dev",
  sha256:sha,bytes:26477,operationalIntegrationVerified:false,attestationVerified:false,
  resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
const baseline=()=>{
  mock.calls=0;mock.plan=[
    [{id:6,source_module:"ai_core_lifecycle",status:"accepted",
      assigned_user:actor,source_id:"execution:4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a",payload_json:{commandId:parent,taskId:"135",executionId:"4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a",resumeAllowed:false}}],
    [{id:parent,status:"FAILED",metadata_json:{devOnly:true,capability:"chatgpt:wake"}}],
    [{id:reservation,parent_command_id:parent,candidate_command_id:candidate,
      human_review_id:6,job_id:135,artifact_sha256:sha}],
    [{recommendation_notes:recommendation,recommendation_actor:actor,
      integrity_notes:integrity,integrity_actor:actor}],
    [{candidate_exists:false,prior_link_exists:false,tagged_child_count:0}],
  ];
};
beforeEach(()=>{process.env["APP_ENV"]="development";baseline();});
afterEach(()=>{delete process.env["APP_ENV"];});
describe("issuer transaction preflight locks identity but never issues",()=>{
  it("refuses production and invalid subject before database",async()=>{
    process.env["APP_ENV"]="production";
    expect(await readGpt02IssuerTransactionPreflight(input())).toMatchObject({
      reason:"NOT_DEV",mayCreateCommand:false,mayDispatchWorker:false});
    process.env["APP_ENV"]="development";
    expect(validateGpt02IssuerPreflightInput({...input(),reservationId:"bad"}))
      .toBe("INVALID_COMMAND_IDENTITY");
    expect(mock.calls).toBe(0);
  });
  it("review, parent and reservation identity are mandatory",async()=>{
    mock.plan[0]=[];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("HUMAN_REVIEW_NOT_FOUND");
    baseline();mock.plan[1]=[{status:"PROCESSING",metadata_json:{devOnly:true,capability:"chatgpt:wake"}}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("FAILED_DEV_PARENT_REQUIRED");
    baseline();mock.plan[2]=[{parent_command_id:parent,candidate_command_id:candidate,
      human_review_id:6,job_id:136,artifact_sha256:sha}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("RESERVATION_IDENTITY_MISMATCH");
  });
  it("rejects wrong or missing execution identity before parent lookup",async()=>{
    mock.plan[0]=[{id:6,source_module:"ai_core_lifecycle",status:"accepted",assigned_user:actor,source_id:"execution:00000000-0000-4000-8000-000000000000",payload_json:{commandId:parent,taskId:"135",executionId:"4eb75fa9-f9e4-4573-8e00-d3084b4c2c8a",resumeAllowed:false}}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("RECOVERY_EXECUTION_IDENTITY_MISMATCH");
    expect(mock.calls).toBe(1);
    baseline();delete mock.plan[0][0].source_id;
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("RECOVERY_EXECUTION_IDENTITY_MISMATCH");
    expect(mock.calls).toBe(1);
  });
  it("rejects missing trusted reviewer recommendation and hash mismatch",async()=>{
    mock.plan[3]=[{recommendation_notes:null,recommendation_actor:actor,
      integrity_notes:integrity,integrity_actor:actor}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason)
      .toBe("BOUND_REVIEWER_RECOMMENDATION_REQUIRED");
    baseline();mock.plan[2]=[{id:reservation,parent_command_id:parent,candidate_command_id:candidate,
      human_review_id:6,job_id:135,artifact_sha256:"f".repeat(64)}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason)
      .toBe("ARTIFACT_BINDING_MISMATCH");
  });
  it("rejects known child or unknown census",async()=>{
    mock.plan[4]=[{candidate_exists:true,prior_link_exists:false,tagged_child_count:0}];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("KNOWN_ATTEMPT_CONFLICT");
    baseline();mock.plan[4]=[];
    expect((await readGpt02IssuerTransactionPreflight(input())).reason).toBe("ATTEMPT_CENSUS_UNVERIFIED");
  });
  it("even complete positive snapshot cannot rule out untagged legacy",async()=>{
    expect(await readGpt02IssuerTransactionPreflight(input())).toMatchObject({
      ok:false,reason:"UNTAGGED_LEGACY_EXCLUSION_NOT_PROVEN",
      preflightSnapshotBound:true,candidateCommandId:candidate,taggedChildCount:0,
      issuerAuthorized:false,legacyUntaggedAttemptsExcluded:false,
      mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
    expect(mock.calls).toBe(5);
  });
});
