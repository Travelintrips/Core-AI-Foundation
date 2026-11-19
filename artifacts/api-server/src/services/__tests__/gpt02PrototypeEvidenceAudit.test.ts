import {describe,it,expect,vi,beforeEach} from "vitest";
import {createHash} from "node:crypto";
const mocks=vi.hoisted(()=>({calls:0,rows:[] as unknown[],proof:[] as unknown[],saved:[] as unknown[]}));
vi.mock("@workspace/db",()=>({db:{transaction:async(fn:(tx:unknown)=>unknown)=>fn({
 execute:async()=>{
  const call=mocks.calls++;
  return {rows:call===0?mocks.rows:call===1?mocks.proof:mocks.saved};
 },
})}}));
import {recordGpt02PrototypeIntegrity,decodePrototypeBase64,parsePrototypeAudit} from "../gpt02PrototypeEvidenceAudit.js";
const commandId="83db99f5-cbda-4e60-be71-3090fb411bbb";
const actor="admcst001@gmail.com";
const data=Buffer.from("<html>Real recovered bytes</html>");
const sha256=createHash("sha256").update(data).digest("hex");
const manifest=()=>({
 jobId:135,humanReviewId:6,commandId,filename:"index.html",
 artifactStage:"recovered_prototype_dev",bytes:data.length,sha256,
 browserE2E:"SMOKE_PASS_ONLY",attestation:"NOT_VERIFIED",resumeAuthorized:false,
 browserEvidence:{realCameraStream:"NOT_TESTED",whatsapp:"NOT_TESTED",
 finalAttestation:"NOT_VERIFIED"},
});
const input=()=>({humanReviewId:6,jobId:135,commandId,actor,
 manifest:manifest(),artifactBase64:data.toString("base64")});
const history=()=>JSON.stringify({
 schemaVersion:1,evidenceKind:"server_hashed_artifact_bytes",jobId:135,humanReviewId:6,
 commandId,artifactStage:"recovered_prototype_dev",sha256,bytes:data.length,
 operationalIntegrationVerified:false,attestationVerified:false,
 resumeAuthorized:false,mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false,
});
beforeEach(()=>{
 mocks.calls=0;mocks.rows=[{id:6,source_module:"ai_core_lifecycle",status:"accepted",
   assigned_user:actor,payload_json:{commandId,taskId:"135",resumeAllowed:false}}];
 mocks.proof=[{recommended:true,original_failed:true,previous_notes:null,previous_actor:null}];
 mocks.saved=[{id:15}];
});
describe("server-hashed GPT02 prototype integrity audit",()=>{
 it("rejects malformed and noncanonical base64 before touching database",async()=>{
  expect(decodePrototypeBase64("????")).toBeNull();
  expect(decodePrototypeBase64("A")).toBeNull();
  expect(decodePrototypeBase64("AAAA=".repeat(10))).toBeNull();
  expect(decodePrototypeBase64(Buffer.alloc(1024*1024+1).toString("base64"))).toBeNull();
  const result=await recordGpt02PrototypeIntegrity({...input(),artifactBase64:"AA=?"});
  expect(result).toMatchObject({ok:false,error:"INVALID_OR_OVERSIZED_PROTOTYPE_BYTES"});
  expect(mocks.calls).toBe(0);
 });
 it("rejects modified bytes, forged operational claim, wrong job or command",async()=>{
  for(const patch of [
   {manifest:{...manifest(),sha256:"f".repeat(64)}},
   {manifest:{...manifest(),resumeAuthorized:true}},
   {manifest:{...manifest(),jobId:136}},
   {manifest:{...manifest(),commandId:"not-original"}},
  ]){
   mocks.calls=0;
   expect((await recordGpt02PrototypeIntegrity({...input(),...patch})).ok).toBe(false);
   expect(mocks.calls).toBe(0);
  }
 });
 it("stores an audit digest only, always denies authorization",async()=>{
  const r=await recordGpt02PrototypeIntegrity(input());
  expect(r).toMatchObject({ok:true,alreadyRecorded:false,auditId:15,
   sha256,bytes:data.length,operationalIntegrationVerified:false,
   mayCreateCommand:false,mayDispatchWorker:false,mayCloseJob:false});
  expect(mocks.calls).toBe(3);
 });
 it("only assigned reviewer of accepted review can record it",async()=>{
  const r=await recordGpt02PrototypeIntegrity({...input(),actor:"attacker@example.com"});
  expect(r).toMatchObject({ok:false,error:"ASSIGNED_HUMAN_REVIEWER_REQUIRED"});
  expect(mocks.calls).toBe(1);
 });
 it("requires a bound reviewer recommendation and FAILED DEV original command",async()=>{
  mocks.proof=[{recommended:false,original_failed:true,previous_notes:null}];
  expect(await recordGpt02PrototypeIntegrity(input())).toMatchObject({
   ok:false,error:"REVIEW_RECOMMENDATION_REQUIRED"});
  mocks.calls=0;mocks.proof=[{recommended:true,original_failed:false,previous_notes:null}];
  expect(await recordGpt02PrototypeIntegrity(input())).toMatchObject({
   ok:false,error:"ORIGINAL_COMMAND_NOT_VERIFIED"});
 });
 it("is idempotent for same digest and blocks overwrite by other digest",async()=>{
  mocks.proof=[{recommended:true,original_failed:true,
   previous_notes:history(),previous_actor:actor}];
  expect(await recordGpt02PrototypeIntegrity(input())).toMatchObject({
   ok:true,alreadyRecorded:true,mayDispatchWorker:false});
  expect(mocks.calls).toBe(2);
  mocks.calls=0;
  mocks.proof=[{recommended:true,original_failed:true,
    previous_notes:JSON.stringify({...JSON.parse(history()),sha256:"0".repeat(64)}),
    previous_actor:actor}];
  expect(await recordGpt02PrototypeIntegrity(input())).toMatchObject({
   ok:false,error:"PROTOTYPE_EVIDENCE_ALREADY_RECORDED"});
 });
 it("readback accepts only bound, fail-closed server-hashed audit",()=>{
  expect(parsePrototypeAudit(history(),actor,actor,commandId,135,6))
   .toEqual({verified:true,sha256,bytes:data.length});
  expect(parsePrototypeAudit(history(),"spoofed",actor,commandId,135,6)).toBeNull();
  expect(parsePrototypeAudit(history(),actor,actor,commandId,136,6)).toBeNull();
  expect(parsePrototypeAudit(history(),actor,actor,commandId,135,7)).toBeNull();
  expect(parsePrototypeAudit(JSON.stringify({...JSON.parse(history()),mayDispatchWorker:true}),
   actor,actor,commandId,135,6)).toBeNull();
  expect(parsePrototypeAudit("bad",actor,actor,commandId,135,6)).toBeNull();
 });
});
