import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync(new URL("../../app.ts", import.meta.url),"utf8");
describe("CST DEV multiproject and explicitly paired session route segregation",()=>{
  it("has one configured-project route and one distinct explicitly verified-session route",()=>{
    expect(source.match(/app\.use\("\/api\/ai\/agent-runtime\/dev\/projects\/continue-partial", createDefaultCstProjectContinuePartialRouter\(\)\)/g)).toHaveLength(1);
    expect(source.match(/app\.use\("\/api\/ai\/agent-runtime\/dev\/projects\/continue-partial\/verified-session", createDefaultCrossProjectContinuePartialRouter\(\)\)/g)).toHaveLength(1);
    expect(source.match(/app\.use\("\/api\/ai\/agent-runtime\/dev\/projects\/continue-partial", createDefaultCrossProjectContinuePartialRouter\(\)\)/g)).toBeNull();
  });
  it("both API mounts remain DEV-only",()=>{
    const marker = 'if (process.env["NODE_ENV"] !== "production" && process.env["APP_ENV"] !== "production")';
    expect(source.split(marker).length-1).toBeGreaterThanOrEqual(2);
  });
});
