import {describe,expect,it} from "vitest";
import {assessDevReviewWriterCredentialBoundary as check} from "../jobLifecycleReviewWriterCredentialBoundary.js";
const good={
 appEnv:"development",nodeEnv:"test",
 runtimeDatabaseUrl:"postgresql://aicore_dev_runtime:runtime-test-secret@db.dev.invalid:5432/postgres",
 writerDatabaseUrl:"postgresql://gpt02_dev_review_writer_login:writer-test-secret@db.dev.invalid:5432/postgres",
};
describe("candidate writer credential separation (validation only, never a ready signal)",()=>{
 it("accepts only distinct role credentials for independent review, not execution",()=>{
   expect(check(good)).toEqual({eligibleForIndependentSecurityReview:true,
    reason:"DISTINCT_CREDENTIAL_SHAPE_ONLY_NOT_READY"});
 });
 it.each([
  [{appEnv:"production"},"DEV_ONLY"],
  [{nodeEnv:"production"},"DEV_ONLY"],
  [{writerDatabaseUrl:undefined},"SEPARATE_CREDENTIAL_REQUIRED"],
  [{writerDatabaseUrl:good.runtimeDatabaseUrl},"RUNTIME_CREDENTIAL_REUSE_FORBIDDEN"],
  [{writerDatabaseUrl:good.writerDatabaseUrl?.replace("writer-test-secret","runtime-test-secret")},"RUNTIME_CREDENTIAL_REUSE_FORBIDDEN"],
  [{writerDatabaseUrl:good.writerDatabaseUrl?.replace("gpt02_dev_review_writer_login","aicore_dev_runtime")},"RUNTIME_CREDENTIAL_REUSE_FORBIDDEN"],
  [{writerDatabaseUrl:good.writerDatabaseUrl?.replace("db.dev.invalid","db.prod.invalid")},"DATABASE_TARGET_MISMATCH"],
  [{writerDatabaseUrl:good.writerDatabaseUrl?.replace("/postgres","/otherdb")},"DATABASE_TARGET_MISMATCH"],
  [{writerDatabaseUrl:good.writerDatabaseUrl?.replace("gpt02_dev_review_writer_login","postgres")},"DEDICATED_WRITER_ROLE_REQUIRED"],
  [{writerDatabaseUrl:good.writerDatabaseUrl+"?options=-crole%3Dpostgres"},"WRITER_STARTUP_ROLE_OVERRIDE_FORBIDDEN"],
  [{writerDatabaseUrl:"not a database url"},"DATABASE_URL_INVALID"],
 ] as const)("rejects disallowed credentials and environments %#", (overrides,reason)=>{
  expect(check({...good,...overrides})).toMatchObject({
   eligibleForIndependentSecurityReview:false,reason});
 });
});
