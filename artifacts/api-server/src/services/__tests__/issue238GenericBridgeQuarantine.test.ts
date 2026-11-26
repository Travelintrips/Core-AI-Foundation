import { describe, expect, it, vi } from "vitest";
import { genericClaimNotIssue238QaSql, isReservedIssue238GenericMetadata }
  from "../issue238GenericBridgeQuarantine.js";

describe("Issue238 dedicated QA origin remains quarantined from the generic bridge", () => {
  it.each([
    { issue238QaPurpose:"issue238-pg17-disposable-qa" },
    { issue238QaPurpose:null }, { issue238QaPurpose:false },
    { issue238QaPurpose:"" }, { issue238QaPurpose:undefined },
  ])("refuses even empty/spoofed reserved markers before any DB access", (metadata) => {
    expect(isReservedIssue238GenericMetadata(metadata)).toBe(true);
  });
  it.each([null,undefined,{},[],{other:"regular-work"}, "issue238QaPurpose"])(
    "does not quarantine unrelated metadata", metadata => {
      expect(isReservedIssue238GenericMetadata(metadata)).toBe(false);
    }
  );
  it("uses a SQL key-existence predicate, not a truthy value predicate", () => {
    const rendered=genericClaimNotIssue238QaSql();
    expect(rendered).toBeTruthy();
    const parts=JSON.stringify(rendered);
    expect(parts).toContain("NOT (metadata_json ?");
    expect(parts).toContain("issue238QaPurpose");
  });
  it("generic submit and claim explicitly enforce the guard", async () => {
    const {readFileSync}=await import("node:fs");
    const source=readFileSync(new URL("../localCodingControlBridgeService.ts",import.meta.url),"utf8");
    expect(source).toContain("isReservedIssue238GenericMetadata(input.metadata)");
    expect(source).toContain("genericClaimNotIssue238QaSql()");
    expect(source).toContain("DEDICATED_OWNER_QA_ISSUER_REQUIRED");
  });
});
