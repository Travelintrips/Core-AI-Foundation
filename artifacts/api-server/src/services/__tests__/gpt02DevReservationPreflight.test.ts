import {beforeEach,describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],calls:0}));
vi.mock("@workspace/db",()=>({db:{execute:async()=>{mock.calls++;return {rows:mock.rows}}}}));
import {getGpt02DevReservationPreflight,assessDevReservationSnapshot} from "../gpt02DevReservationPreflight.js";
const parentCommandId="83db99f5-cbda-4e60-be71-3090fb411bbb",actor="admcst001@gmail.com";
const args=()=>({parentCommandId,humanReviewId:6,jobId:135,actor});
const recommendation=JSON.stringify({decision:"recommend_new_attempt",commandId:parentCommandId,jobId:135,notes:"Reviewer approved DEV trial",dispatchAuthorized:false,resumeAllowed:false,checkpointIssued:false});
const integrity=JSON.stringify({schemaVersion:1,evidenceKind:"server_hashed_artifact_bytes",jobId:135,humanReviewId:6,commandId:parentCommandId,artifactStage:"recovered_prototype_dev",sha256:"f04519d8fadb09f0103c7e00646792a466bf0ddb512973c19ab82f4aaecf3658",bytes:26477,operationalIntegrationVerified:false,attestationVerified:false,resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
const baseline=():Record<string,unknown>=>({review_id:6,source_module:"ai_core_lifecycle",review_status:"accepted",assigned_user:actor,payload_json:{commandId:parentCommandId,taskId:"135",resumeAllowed:false},command_status:"FAILED",command_dev_only:"true",command_capability:"chatgpt:wake",recommendation_notes:recommendation,recommendation_actor:actor,integrity_notes:integrity,integrity_actor:actor,reservation_id:null,tagged_child_count:0});
beforeEach(()=>{mock.calls=0;mock.rows=[baseline()];delete process.env["AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED"]});
describe("read-only GPT02 reservation preflight",()=>{
 it("prerequisite snapshot is not an execution grant",()=>{expect(assessDevReservationSnapshot(args(),baseline())).toMatchObject({reason:"SNAPSHOT_ONLY_NO_RESERVATION",prerequisiteSnapshotClear:true,featureEnabled:false,reservationCreated:false,commandCreated:false,executionLeaseVerified:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false})});
 for(const [label,change,reason] of [
  ["wrong reviewer",{assigned_user:"other"},"ASSIGNED_HUMAN_REVIEWER_REQUIRED"],
  ["not accepted",{review_status:"assigned"},"REVIEW_NOT_ACCEPTED"],
  ["wrong command state",{command_status:"PENDING"},"ORIGINAL_FAILED_DEV_COMMAND_REQUIRED"],
  ["wrong environment",{command_dev_only:"false"},"ORIGINAL_FAILED_DEV_COMMAND_REQUIRED"],
  ["no recommendation",{recommendation_notes:null},"BOUND_REVIEWER_RECOMMENDATION_REQUIRED"],
  ["no integrity",{integrity_notes:null},"SERVER_HASHED_PROTOTYPE_EVIDENCE_REQUIRED"],
  ["reserved",{reservation_id:"6d66d309-eaee-44ac-87f9-dd4b720a6d10"},"PARENT_ALREADY_RESERVED"],
  ["unknown children",{tagged_child_count:null},"CHILD_ATTEMPT_COUNT_UNVERIFIED"],
  ["child present",{tagged_child_count:1},"EXISTING_CHILD_ATTEMPT_TAGS"],
 ] as const){
  it("fails closed: "+label,()=>{expect(assessDevReservationSnapshot(args(),{...baseline(),...change})).toMatchObject({reason,prerequisiteSnapshotClear:false,mayDispatchWorker:false,mayCreateCommand:false})});
 }
 it("one read-only DB query",async()=>{expect(await getGpt02DevReservationPreflight(args())).toMatchObject({ok:true,reservationCreated:false,mayDispatchWorker:false});expect(mock.calls).toBe(1)});
 it("missing task and invalid identifier fail closed",async()=>{mock.rows=[];expect(await getGpt02DevReservationPreflight(args())).toMatchObject({reason:"HUMAN_REVIEW_NOT_FOUND",prerequisiteSnapshotClear:false});mock.calls=0;expect(await getGpt02DevReservationPreflight({...args(),parentCommandId:"bad"})).toMatchObject({ok:false});expect(mock.calls).toBe(0)});
});
