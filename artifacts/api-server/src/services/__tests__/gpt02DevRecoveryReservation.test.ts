import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({calls:0,plan:[] as Array<Array<Record<string,unknown>>>}));
vi.mock("@workspace/db",()=>({db:{
  transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({
    execute:async()=>({rows:mock.plan[mock.calls++]??[]}),
  }),
}}));
import {reserveGpt02DevRecoveryAttempt,validateReservationRequest} from "../gpt02DevRecoveryReservation.js";
const parent="83db99f5-cbda-4e60-be71-3090fb411bbb";
const key="2ba38abd-33bb-4459-9f3c-1fc280752a83";
const actor="admcst001@gmail.com";
const sha="f04519d8fadb09f0103c7e00646792a466bf0ddb512973c19ab82f4aaecf3658";
const input=()=>({parentCommandId:parent,humanReviewId:6,jobId:135,actor,idempotencyKey:key});
const recommendation=JSON.stringify({
  decision:"recommend_new_attempt",jobId:135,commandId:parent,notes:"Review approved for new DEV attempt",
  dispatchAuthorized:false,resumeAllowed:false,checkpointIssued:false,
});
const integrity=JSON.stringify({
  schemaVersion:1,evidenceKind:"server_hashed_artifact_bytes",
  jobId:135,humanReviewId:6,commandId:parent,artifactStage:"recovered_prototype_dev",
  sha256:sha,bytes:26477,operationalIntegrationVerified:false,attestationVerified:false,
  resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
});
const plan=()=>{
  mock.calls=0;
  mock.plan=[
    [{id:6,source_module:"ai_core_lifecycle",status:"accepted",assigned_user:actor,
      payload_json:{commandId:parent,taskId:"135",resumeAllowed:false}}],
    [{status:"FAILED",metadata_json:{devOnly:true,capability:"chatgpt:wake"}}],
    [{recommendation_notes:recommendation,recommendation_actor:actor,
      integrity_notes:integrity,integrity_actor:actor}],
    [],[{tagged_child_count:0}],
    [{id:"f29a546e-9ee9-4262-a25a-3bcf2b38d53f",
      candidate_command_id:"28a12988-1418-4b66-8be9-de3d66cac1ce"}],
  ];
};
const originalNodeEnv=process.env["NODE_ENV"];
beforeEach(()=>{
  process.env["NODE_ENV"]="development";
  process.env["APP_ENV"]="development";
  process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]="true";
  plan();
});
afterEach(()=>{
  delete process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"];
  delete process.env["APP_ENV"];
  if(originalNodeEnv===undefined)delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"]=originalNodeEnv;
});
describe("DEV reservation only, no GPT02 dispatch or command issuance",()=>{
  it("refuses feature disabled and production before touching DB",async()=>{
    process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]="false";
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"RESERVATION_FEATURE_DISABLED",mayDispatchWorker:false});
    process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]="true";
    process.env["APP_ENV"]="production";
    expect((await reserveGpt02DevRecoveryAttempt(input())).ok).toBe(false);
    expect(mock.calls).toBe(0);
  });
  it("requires exact DEV runtime and explicit reservation gate",async()=>{
    const scenarios=[
      ["APP_ENV","staging"],["APP_ENV",undefined],
      ["NODE_ENV","production"],["NODE_ENV",undefined],
      ["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED",undefined],
    ] as const;
    for(const [key,value] of scenarios){
      const previous=process.env[key];
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
      expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
        ok:false,error:"RESERVATION_FEATURE_DISABLED",mayCreateCommand:false,
        mayDispatchWorker:false,mayCloseJob:false,
      });
      if(previous===undefined)delete process.env[key];
      else process.env[key]=previous;
    }
    expect(mock.calls).toBe(0);
  });
  it("rejects invalid IDs, actors and subject",async()=>{
    expect(validateReservationRequest({...input(),idempotencyKey:"bad"}))
      .toBe("INVALID_RESERVATION_IDENTITY");
    expect(validateReservationRequest({...input(),jobId:-1}))
      .toBe("INVALID_RESERVATION_SUBJECT");
    expect((await reserveGpt02DevRecoveryAttempt({...input(),parentCommandId:key})).ok).toBe(false);
    expect(mock.calls).toBe(1); // wrong binding rejected at review
  });
  it("success only reserves; all authorization remains false",async()=>{
    const x=await reserveGpt02DevRecoveryAttempt(input());
    expect(x).toMatchObject({
      ok:true,alreadyReserved:false,artifactSha256:sha,
      mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
    });
    expect(mock.calls).toBe(6);
    expect(x.ok && x.candidateCommandId).not.toBe(parent);
  });
  it("denies unassigned reviewer and no review record",async()=>{
    mock.plan[0]=[];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"HUMAN_REVIEW_NOT_FOUND"});
    plan();
    expect(await reserveGpt02DevRecoveryAttempt({...input(),actor:"unassigned@example.com"}))
      .toMatchObject({ok:false,error:"ASSIGNED_HUMAN_REVIEWER_REQUIRED"});
  });
  it("rejects non-FAILED command and missing recommendation or manifest",async()=>{
    mock.plan[1]=[{status:"PENDING",metadata_json:{devOnly:true,capability:"chatgpt:wake"}}];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"ORIGINAL_FAILED_DEV_COMMAND_REQUIRED"});
    plan();mock.plan[2]=[{recommendation_notes:null,recommendation_actor:actor,
      integrity_notes:integrity,integrity_actor:actor}];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"BOUND_REVIEWER_RECOMMENDATION_REQUIRED"});
    plan();mock.plan[2]=[{recommendation_notes:recommendation,recommendation_actor:actor,
      integrity_notes:null,integrity_actor:actor}];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"SERVER_HASHED_PROTOTYPE_EVIDENCE_REQUIRED"});
  });
  it("retry same key and review is idempotent and does not execute",async()=>{
    mock.plan[3]=[{
      id:"f29a546e-9ee9-4262-a25a-3bcf2b38d53f",
      candidate_command_id:"28a12988-1418-4b66-8be9-de3d66cac1ce",
      idempotency_key:key,human_review_id:6,job_id:135,artifact_sha256:sha,
    }];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:true,alreadyReserved:true,mayCreateCommand:false,mayDispatchWorker:false});
    expect(mock.calls).toBe(4);
    plan();
    mock.plan[3]=[{id:"f29a546e-9ee9-4262-a25a-3bcf2b38d53f",
      idempotency_key:"a2c945b8-6236-47c6-bbbb-e421c95f21f7",
      human_review_id:6,job_id:135,artifact_sha256:sha}];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"PARENT_ALREADY_RESERVED"});
  });
  it("rejects tagged child and DB conflict",async()=>{
    mock.plan[4]=[{tagged_child_count:1}];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"EXISTING_OR_UNVERIFIED_CHILD_ATTEMPTS"});
    plan();mock.plan[5]=[];
    expect(await reserveGpt02DevRecoveryAttempt(input())).toMatchObject({
      ok:false,error:"RESERVATION_CONFLICT_RETRY_READBACK"});
  });
});
