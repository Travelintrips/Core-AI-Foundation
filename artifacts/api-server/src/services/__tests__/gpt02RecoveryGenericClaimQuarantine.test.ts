import {describe,it,expect} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
import {
  genericClaimNotGpt02RecoverySql,genericClaimNotReservedCandidateSql,
  isQuarantinedGpt02RecoveryMetadata,
} from "../gpt02RecoveryGenericClaimQuarantine.js";

describe("generic worker never claims DEV GPT02 recovery",()=>{
  it.each([
    {gpt02Recovery:false},
    {gpt02Recovery:null},
    {gpt02RecoveryParentCommandId:"parent"},
    {recoveryParentCommandId:"parent"},
    {recovery_parent_command_id:"parent"},
    {gpt02Issue159PositivePermit:false},
    {gpt02Issue159PositivePermit:null},
    {gpt02Issue159PositivePermit:{commandId:"fake"}},
    {capability:"chatgpt:wake",parentCommandId:"parent"},
  ])("quarantines recovery markers even when falsy: %j",(metadata)=>{
    expect(isQuarantinedGpt02RecoveryMetadata(metadata)).toBe(true);
  });
  it.each([
    {capability:"chatgpt:wake",assignedClientId:"dell"},
    {capability:"other",parentCommandId:"unrelated"},
    {devContinuity:{active:true},capability:"chatgpt:wake"},
    null,{},[],{metadata:"ordinary"},
  ])("preserves ordinary claims: %j",(metadata)=>{
    expect(isQuarantinedGpt02RecoveryMetadata(metadata)).toBe(false);
  });
  it("uses the same fail-closed SQL marker keys at claim time",()=>{
    const dialect=new PgDialect();
    const rendered=dialect.sqlToQuery(genericClaimNotGpt02RecoverySql()).sql;
    for(const key of ["gpt02Recovery","gpt02RecoveryParentCommandId",
      "recoveryParentCommandId","recovery_parent_command_id",
      "gpt02Issue159PositivePermit",
      "parentCommandId","chatgpt:wake"])
      expect(rendered).toContain("'"+key+"'");
    expect(rendered).toContain("NOT");
    expect(rendered).toContain("metadata_json");
    expect(rendered).not.toContain("gpt02_dev_recovery_reservations");
  });
  it("generic bridge claim and submit use quarantine before any notify",async()=>{
    const {readFileSync}=await import("node:fs");
    const source=readFileSync(
      new URL("../localCodingControlBridgeService.ts",import.meta.url),"utf8");
    const submission=source.slice(source.indexOf("export async function submitCodingBridgeCommand("),
      source.indexOf("async function deliverCodingBridgeWhatsappNotification"));
    expect(submission.indexOf("isQuarantinedGpt02RecoveryMetadata(input.metadata)"))
      .toBeLessThan(submission.indexOf("await ensureCodingControlBridgeTables()"));
    const claim=source.slice(source.indexOf("export async function claimCodingBridgeCommand("),
      source.indexOf("// Only a worker holding the active command claim"));
    expect(claim).toContain("AND ${genericClaimNotGpt02RecoverySql()}");
    expect(claim.indexOf("AND ${genericClaimNotGpt02RecoverySql()}")).toBeLessThan(
      claim.indexOf("FOR UPDATE SKIP LOCKED"));
  });
  it("duplicate protected bridge commands cannot re-notify when caller omits marker",async()=>{
    const {readFileSync}=await import("node:fs");
    const source=readFileSync(
      new URL("../localCodingControlBridgeService.ts",import.meta.url),"utf8");
    const submission=source.slice(source.indexOf("export async function submitCodingBridgeCommand("),
      source.indexOf("async function deliverCodingBridgeWhatsappNotification"));
    const start=submission.indexOf("if (existing) {");
    const guard=submission.indexOf("isQuarantinedGpt02RecoveryMetadata(existing.metadataJson)",start);
    const notification=submission.indexOf("notifyExternalAgentWork(input.assignedClientId, existing.id)",start);
    expect(start).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(start);
    expect(notification).toBeGreaterThan(guard);
    expect(submission.slice(guard,notification)).toContain("GPT02_PROTECTED_GENERIC_RENOTIFY_FORBIDDEN");
  });
  it("DEV uses owner-owned candidate identity function without broad table grants",()=>{
    const prev=process.env["APP_ENV"];
    try {
      process.env["APP_ENV"]="development";
      expect(new PgDialect().sqlToQuery(genericClaimNotReservedCandidateSql()).sql)
        .toContain("ai_platform.gpt02_dev_generic_claim_allowed(id)");
      process.env["APP_ENV"]="production";
      expect(new PgDialect().sqlToQuery(genericClaimNotReservedCandidateSql()).sql).toContain("TRUE");
      process.env["APP_ENV"]="staging";
      expect(new PgDialect().sqlToQuery(genericClaimNotReservedCandidateSql()).sql).toContain("TRUE");
    }finally{if(prev===undefined)delete process.env["APP_ENV"];else process.env["APP_ENV"]=prev}
  });
  it("generic claimant also includes the unmarked candidate identity filter",async()=>{
    const {readFileSync}=await import("node:fs");
    const source=readFileSync(new URL("../localCodingControlBridgeService.ts",import.meta.url),"utf8");
    const claim=source.slice(source.indexOf("export async function claimCodingBridgeCommand("),
      source.indexOf("// Only a worker holding the active command claim"));
    expect(claim).toContain("AND ${genericClaimNotReservedCandidateSql()}");
    expect(claim.indexOf("AND ${genericClaimNotReservedCandidateSql()}")).toBeLessThan(
      claim.indexOf("FOR UPDATE SKIP LOCKED"));
  });

});
