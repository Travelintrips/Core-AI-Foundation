import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
// jsonwebtoken belongs to the API workspace, not the monorepo root.
const jwt=createRequire(new URL("../../artifacts/api-server/package.json",import.meta.url))("jsonwebtoken");
import {
 verifyFreshOneJobStageConsent,ONE_JOB_OWNER_STAGE_INTENT
} from "../../artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts";

import {CST_ONEJOB_PUBLIC_OPERATIONS_CANDIDATE_SHA256 as rootFingerprint}
  from "../../artifacts/api-server/src/lib/cstOneJobOperationsRootCandidate.js";
const now=Math.floor(Date.parse("2026-11-20T05:00:00.000Z")/1000);
const secret="synthetic-test-only-dev-owner-session-"+("x".repeat(48));
const token=(sub=19,issued=now-45,extra={})=>jwt.sign(
 {sub,iat:issued,...extra},secret,{algorithm:"HS256",expiresIn:"12h"});
const input=(change={})=>({
 sessionToken:token(),sessionSecret:secret,
 ownerUserId:19,role:"owner",status:"active",accountType:"internal",
 mustChangePassword:false,nowSeconds:now,
 body:{intent:ONE_JOB_OWNER_STAGE_INTENT,
  operationsRootFingerprint:rootFingerprint},...change,
});

test("one explicit Owner click works with an existing valid app session beyond 20 minutes",()=>{
 for(const sessionToken of [token(),token(19,now-21*60),token(19,now-4*60*60),
   token(19,now-11*60*60)]){
  assert.equal(verifyFreshOneJobStageConsent(input({sessionToken})),true);
 }
});
test("future JWT, expired session, excessive lifetime, forgery and wrong subject denied",()=>{
 const excessiveLifetime=jwt.sign({sub:19,iat:now-45,exp:now+24*60*60},secret,{algorithm:"HS256"});
 for(const sessionToken of [
  token(19,now+60),token(20),token(19,now-13*60*60),excessiveLifetime,
  token(19,now-45,{purpose:"magic_login"}),token().slice(0,-3)+"bad",
 ]){
  assert.equal(verifyFreshOneJobStageConsent(input({sessionToken})),false);
 }
});
test("same-session actor role, status and password-change guard remain mandatory",()=>{
 for(const change of [
  {ownerUserId:20},{ownerUserId:"19"},
  {role:"admin"},{role:"super_admin"},
  {status:"suspended"},{accountType:"customer"},
  {mustChangePassword:true},{sessionSecret:"weak"},
  {sessionToken:null}
 ]){
  assert.equal(verifyFreshOneJobStageConsent(input(change)),false);
 }
});
test("only the exact one-job business intent is accepted, never an implicit empty POST",()=>{
 for(const body of [
  null,{},[],{intent:"APPROVE_ALL"},
  {intent:ONE_JOB_OWNER_STAGE_INTENT},
  {intent:ONE_JOB_OWNER_STAGE_INTENT,operationsRootFingerprint:"a".repeat(64)},
  {intent:ONE_JOB_OWNER_STAGE_INTENT,operationsRootFingerprint:rootFingerprint,other:true},
  {intent:ONE_JOB_OWNER_STAGE_INTENT,operationsRootFingerprint:rootFingerprint,actor:19},
  true
 ]){
  assert.equal(verifyFreshOneJobStageConsent(input({body})),false);
 }
});
test("pure helper grants no DB role, OTP bypass, worker dispatch or Final ACK",()=>{
 const source=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts",import.meta.url),"utf8");
 assert.doesNotMatch(source,/INSERT INTO|UPDATE ai_platform|CREATE ROLE|SET ROLE|dispatchPermitted:\s*true/);
});

test("one click binds exact dormant public Operations candidate without trusting it",()=>{
 assert.match(rootFingerprint,/^[a-f0-9]{64}$/);
 assert.equal(verifyFreshOneJobStageConsent(input()),true);
 const source=readFileSync(new URL(
  "../../artifacts/api-server/src/lib/cstOneJobOperationsRootCandidate.js",import.meta.url),"utf8");
 assert.match(source,/CST_ONEJOB_OPERATIONS_ROOT_TRUSTED=false/);
 assert.doesNotMatch(source,/PRIVATE KEY|BEGIN PRIVATE KEY|sign\(/);
});
