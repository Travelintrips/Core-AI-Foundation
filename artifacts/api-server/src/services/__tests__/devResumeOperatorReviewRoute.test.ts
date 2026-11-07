import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
const m=vi.hoisted(()=>({user:null as Record<string,unknown>|null}));
vi.mock("../internalAuthService.js",()=>({
 SESSION_COOKIE_NAME:"internal_session",
 verifySessionToken:(token:string)=>token==="valid-session"?{sub:7}:null,
 getInternalUserById:async()=>m.user,
}));
vi.mock("../aiAuditService.js",()=>({logAudit:async()=>{}}));
import route from "../routes/dev-resume-operator-review.js";
const app=express();
app.use(cookieParser());
app.use(route);
const url="/ai/core-chat/dev/resume/operator-readiness";
const valid=()=>({id:7,role:"admin",status:"active",accountType:"internal",
 email:"admin@example.test",mustChangePassword:false});
beforeEach(()=>{process.env["APP_ENV"]="development";process.env["NODE_ENV"]="test";m.user=valid();});
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
 it("does not expose any write endpoint",async()=>{
  const r=await request(app).post(url).set("Cookie","internal_session=valid-session");
  expect(r.status).toBe(404);
 });
});
