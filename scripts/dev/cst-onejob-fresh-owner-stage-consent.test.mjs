import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import jwt from "jsonwebtoken";
import {
 verifyFreshOneJobStageConsent,ONE_JOB_OWNER_STAGE_INTENT
} from "../../artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts";

const now=Math.floor(Date.parse("2026-11-20T05:00:00.000Z")/1000);
const secret="synthetic-test-only-dev-owner-session-"+("x".repeat(48));
const token=(sub=19,issued=now-45,extra={})=>jwt.sign(
 {sub,iat:issued,...extra},secret,{algorithm:"HS256",expiresIn:"12h"});
const input=(change={})=>({
 sessionToken:token(),sessionSecret:secret,
 ownerUserId:19,role:"owner",status:"active",accountType:"internal",
 mustChangePassword:false,nowSeconds:now,
 body:{intent:ONE_JOB_OWNER_STAGE_INTENT},...change,
});

test("one explicit fresh Owner click accepts a signed numeric internal session",()=>{
 assert.equal(verifyFreshOneJobStageConsent(input()),true);
});
test("old 12h login, future JWT, expired JWT and forged subject denied",()=>{
 for(const sessionToken of [
  token(19,now-21*60),token(19,now+60),token(20),
  token(19,now-13*60*60),token(19,now-45,{purpose:"magic_login"}),
  token().slice(0,-3)+"bad",
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
 for(const body of [null,{},[],{intent:"APPROVE_ALL"},{intent:ONE_JOB_OWNER_STAGE_INTENT,other:true},
  {actor:19,intent:ONE_JOB_OWNER_STAGE_INTENT},true]){
  assert.equal(verifyFreshOneJobStageConsent(input({body})),false);
 }
});
test("pure helper grants no DB role, OTP bypass, worker dispatch or Final ACK",()=>{
 const source=readFileSync(new URL("../../artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts",import.meta.url),"utf8");
 assert.doesNotMatch(source,/INSERT INTO|UPDATE ai_platform|CREATE ROLE|SET ROLE|dispatchPermitted:\s*true/);
});
