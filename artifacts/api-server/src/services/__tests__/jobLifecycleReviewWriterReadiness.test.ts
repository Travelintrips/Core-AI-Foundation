import {afterEach,describe,expect,it} from "vitest";
import {isTrustedDevReviewWriterReady} from "../jobLifecycleReviewWriterReadiness.js";

const original={
 appEnv:process.env["APP_ENV"],nodeEnv:process.env["NODE_ENV"],
 signing:process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"],
};

afterEach(()=>{
 for(const [key,value] of Object.entries({
  APP_ENV:original.appEnv,NODE_ENV:original.nodeEnv,
  AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED:original.signing,
 })){
  if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});

describe("DEV review writer readiness cannot be enabled by environment flags",()=>{
 it.each(["development","test","production"])("never authorizes writer in %s environment",appEnv=>{
  process.env["APP_ENV"]=appEnv;
  process.env["NODE_ENV"]=appEnv==="production"?"production":"test";
  process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"]="true";
  expect(isTrustedDevReviewWriterReady()).toBe(false);
 });
 it("does not authorize writer when flag is unset",()=>{
  delete process.env["AI_CORE_DEV_OPERATOR_REVIEW_SIGNING_ENABLED"];
  expect(isTrustedDevReviewWriterReady()).toBe(false);
 });
});
