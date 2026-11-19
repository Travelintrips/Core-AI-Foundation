import { describe, it, expect } from "vitest";
import { buildJobCompletionReport } from "../jobCompletionReport.js";
const checks = ["CI", "deployment", "production health", "E2E"].map(name => ({
  name, status: "pass" as const, evidenceUrl: "https://github.com/Travelintrips/Core-AI-Foundation/actions/runs/123"
}));
describe("jobCompletionReport evidence gate", () => {
  it("does not elevate completed without evidence", () => {
    expect(buildJobCompletionReport({jobId:"102",title:"Test",status:"completed",checks:[]}).status).toBe("COMPLETED_UNVERIFIED");
  });
  it("never promotes URL-only claims to E2E PASS", () => {
    expect(buildJobCompletionReport({jobId:"102",title:"Test",status:"completed",checks}).status).toBe("COMPLETED_UNVERIFIED");
  });
  it("does not elevate a failed check", () => {
    expect(buildJobCompletionReport({jobId:"102",title:"Test",status:"completed",checks:[...checks,{name:"db",status:"fail"}]}).status).toBe("COMPLETED_UNVERIFIED");
  });
  it("rejects duplicate named gates", () => {
    expect(buildJobCompletionReport({jobId:"102",title:"Test",status:"completed",checks:[...checks,checks[0]!]}).status).toBe("COMPLETED_UNVERIFIED");
  });
  it("rejects placeholder evidence and never authorizes outbound WA", () => {
    const report = buildJobCompletionReport({jobId:"102",title:"Test",status:"completed",checks:checks.map(c => ({...c,evidenceUrl:"https://example.invalid/evidence"}))});
    expect(report.status).toBe("COMPLETED_UNVERIFIED");
    expect(report.notificationAuthorized).toBe(false);
  });
  it("does not elevate an in-progress job", () => {
    expect(buildJobCompletionReport({jobId:"102",title:"Test",status:"running",checks}).status).toBe("RUNNING");
  });
});
