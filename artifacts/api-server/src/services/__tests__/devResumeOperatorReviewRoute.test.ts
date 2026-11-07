import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
const m=vi.hoisted(()=>({user:null as Record<string,unknown>|null,preflight:vi.fn(),recovery:vi.fn()}));
vi.mock("../internalAuthService.js",()=>({
 SESSION_COOKIE_NAME:"internal_session",
 verifySessionToken:(token:string)=>token==="valid-session"?{sub:7}:null,
 getInternalUserById:async()=>m.user,
}));
vi.mock("../aiAuditService.js",()=>({logAudit:async()=>{}}));
vi.mock("../jobLifecycleOperatorCommandPreflight.js",()=>({getDevResumeOperatorCommandPreflight:m.preflight}));
vi.mock("../jobLifecycleRecoveryReview.js",()=>({getDevCommandRecoveryReview:m.recovery}));
import route from "../../routes/dev-resume-operator-review.js";
const app=express();
app.use(express.json());
app.use(cookieParser());
app.use(route);
const url="/ai/core-chat/dev/resume/operator-readiness";
const valid=()=>({id:7,role:"admin",status:"active",accountType:"internal",
 email:"admin@example.test",mustChangePassword:false});
beforeEach(()=>{process.env["APP_ENV"]="development";process.env["NODE_ENV"]="test";m.user=valid();m.preflight.mockReset();m.preflight.mockResolvedValue({found:true,reason:"BLOCKED",grantIssuanceEnabled:false,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false});m.recovery.mockReset();m.recovery.mockResolvedValue({found:true,commandStatus:"FAILED",checkpointResponseId:"822efca2-7428-428a-ac66-548c0462438e",blockingResponseId:null,checkpointAttested:true,receiverAckVerified:true,blockerEvidenceValid:false,responseSnapshotComplete:true});});
afterEach(()=>{delete process.env["APP_ENV"];delete process.env["NODE_ENV"];});
describe("GPT02 DEV resume operator readiness uses real internal session and DB role guards",()=>{
 it("denies no session even with admin API key header",async()=>{
  const r=await request(app).get(url).set("x-admin-key","test-admin-key");
  expect(r.status).toBe(401);
 });
 it("denies invalid session",async()=>{
  const r=await request(app).get(url).set("Cookie","internal_session=invalid");
  expect(r.status).toBe(401);
 });
 it("requires active admin or owner from DB, not cookie claims",async()=>{
  for(const patch of [
    {role:"internal_staff"},{role:"manager"},
    {status:"suspended"},{accountType:"external"},
  ]){
    m.user={...valid(),...patch};
    const r=await request(app).get(url).set("Cookie","internal_session=valid-session");
    expect(r.status).toBe(403);
  }
 });
 it("denies operator with mandatory password change outstanding",async()=>{
  m.user={...valid(),mustChangePassword:true};
  const r=await request(app).get(url).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(403);
 });
 it.each(["admin","owner"])("allows authenticated %s only for read-only operator identity",async(role)=>{
  m.user={...valid(),role};
  const r=await request(app).get(url).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({verifiedInternalOperator:true,operatorId:"7",
   operatorRole:role,mayIssueGrant:false,mayDispatchWorker:false,mayCloseJob:false,
   approvalSigningConfigured:false,operatorGrantIssuanceEnabled:false});
  expect(JSON.stringify(r.body)).not.toContain("passwordHash");
 });
 it("is unavailable outside DEV even for authenticated admin",async()=>{
  process.env["APP_ENV"]="production";
  const r=await request(app).get(url).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(404);
 });
 const command="169a7492-cfd8-4a56-bb57-18001b6b5968";
 const preflightUrl="/ai/core-chat/dev/resume/commands/"+command+"/approval-preflight";
 it("reads command evidence only for an authenticated admin",async()=>{
  const r=await request(app).get(preflightUrl).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(200);
  expect(m.preflight).toHaveBeenCalledWith(command);
  expect(r.body).toMatchObject({grantIssuanceEnabled:false,mayIssueGrant:false,mayDispatchWorker:false});
 });
 it("denies missing session and admin key without a session before fetching DB",async()=>{
  const r=await request(app).get(preflightUrl).set("x-admin-key","any-key");
  expect(r.status).toBe(401);
  expect(m.preflight).not.toHaveBeenCalled();
 });
 it("denies non-admin role before DB readback",async()=>{
  m.user={...valid(),role:"manager"};
  const r=await request(app).get(preflightUrl).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(403);
  expect(m.preflight).not.toHaveBeenCalled();
 });
 it("rejects malformed command IDs before touching DB",async()=>{
  const r=await request(app).get("/ai/core-chat/dev/resume/commands/not-a-uuid/approval-preflight")
    .set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(400);
  expect(m.preflight).not.toHaveBeenCalled();
 });
 it("fails closed on database preflight errors",async()=>{
  m.preflight.mockRejectedValue(new Error("connection failed"));
  const r=await request(app).get(preflightUrl).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(503);
  expect(r.body).toMatchObject({mayIssueGrant:false,mayDispatchWorker:false});
 });
 it("hides command preflight on production settings",async()=>{
  process.env["APP_ENV"]="production";
  const r=await request(app).get(preflightUrl).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(404);
  expect(m.preflight).not.toHaveBeenCalled();
 });
 const signUrl="/ai/core-chat/dev/resume/commands/"+command+"/sign-review-intent";
 it("rejects any signing request while feature is disabled",async()=>{
  const r=await request(app).post(signUrl).set("Cookie","internal_session=valid-session")
   .set("Origin","https://dev-operator.example.test")
   .set("x-ai-core-review-intent","explicit")
   .send({acknowledgement:"SIGN_REVIEW_INTENT_ONLY"});
  expect(r.status).toBe(404);expect(m.recovery).not.toHaveBeenCalled();
 });
 it("requires cookie-authenticated owner/admin for signing, even with ADMIN_API_KEY",async()=>{
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]="true";
  const r=await request(app).post(signUrl).set("x-admin-key","any-key")
   .set("Origin","https://dev-operator.example.test")
   .set("x-ai-core-review-intent","explicit")
   .send({acknowledgement:"SIGN_REVIEW_INTENT_ONLY"});
  expect(r.status).toBe(401);expect(m.recovery).not.toHaveBeenCalled();
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];
 });
 it("rejects missing origin, wrong origin, or missing explicit action without DB read",async()=>{
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]="true";
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_ORIGIN"]="https://dev-operator.example.test";
  const cookie="internal_session=valid-session";
  const r1=await request(app).post(signUrl).set("Cookie",cookie).send({acknowledgement:"SIGN_REVIEW_INTENT_ONLY"});
  const r2=await request(app).post(signUrl).set("Cookie",cookie).set("Origin","https://evil.example.test")
   .set("x-ai-core-review-intent","explicit").send({acknowledgement:"SIGN_REVIEW_INTENT_ONLY"});
  const r3=await request(app).post(signUrl).set("Cookie",cookie).set("Origin","https://dev-operator.example.test")
   .set("x-ai-core-review-intent","explicit").send({acknowledgement:"APPROVE_GRANT"});
  expect([r1.status,r2.status,r3.status]).toEqual([403,403,400]);
  expect(m.recovery).not.toHaveBeenCalled();
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_ORIGIN"];
 });
 it("denies historical FAILED command on properly authenticated review-sign request",async()=>{
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]="true";
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_ORIGIN"]="https://dev-operator.example.test";
  const r=await request(app).post(signUrl).set("Cookie","internal_session=valid-session")
   .set("Origin","https://dev-operator.example.test").set("x-ai-core-review-intent","explicit")
   .send({acknowledgement:"SIGN_REVIEW_INTENT_ONLY"});
  expect(r.status).toBe(409);
  expect(r.body).toMatchObject({signed:false,mayIssueGrant:false,mayDispatchWorker:false,
   reason:"PERSISTED_COMMAND_EVIDENCE_DENIED"});
  expect(m.recovery).toHaveBeenCalledWith(command);
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_ORIGIN"];
 });
 it("does not expose any write endpoint",async()=>{
  const r=await request(app).post(url).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(404);
 });
});
