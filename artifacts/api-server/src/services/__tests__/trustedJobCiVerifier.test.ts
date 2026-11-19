import { describe, expect, it } from "vitest";
import { verifyTrustedCiRun, type GitHubWorkflowRun } from "../trustedJobCiVerifier.js";
const repository = "Travelintrips/Core-AI-Foundation";
const sha = "a".repeat(40);
const runId = 123;
const input = { repository, commitSha: sha, workflowRunId: runId, expectedWorkflowName: "CI Tests", allowedEvents: ["push", "pull_request"] };
const success: GitHubWorkflowRun = {
  id: runId, name:"CI Tests", head_sha: sha, head_repository: { full_name: repository },
  status:"completed", conclusion:"success", event:"push",
  html_url:"https://github.com/Travelintrips/Core-AI-Foundation/actions/runs/123"
};
const check = (patch: Partial<GitHubWorkflowRun>) =>
  verifyTrustedCiRun(input, async () => ({...success,...patch}));
describe("trusted CI verifier", () => {
  it("accepts a matching successful GitHub workflow", async () => {
    expect((await check({})).verified).toBe(true);
  });
  it("rejects unrelated successful workflow", async () => {
    expect((await check({name:"PR Auto Complete"})).reason).toBe("WORKFLOW_NAME_MISMATCH");
  });
  it("rejects unexpected workflow trigger", async () => {
    expect((await check({event:"workflow_dispatch"})).reason).toBe("WORKFLOW_EVENT_MISMATCH");
  });
  it("rejects wrong SHA", async () => {
    expect((await check({head_sha:"b".repeat(40)})).reason).toBe("COMMIT_MISMATCH");
  });
  it("rejects wrong repo", async () => {
    expect((await check({head_repository:{full_name:"other/repo"}})).reason).toBe("REPOSITORY_MISMATCH");
  });
  it("rejects incomplete and failed runs", async () => {
    expect((await check({status:"in_progress"})).verified).toBe(false);
    expect((await check({conclusion:"failure"})).verified).toBe(false);
  });
  it("rejects arbitrary evidence links", async () => {
    expect((await check({html_url:"https://another.host/success"})).verified).toBe(false);
  });
  it("fails closed on lookup errors", async () => {
    const r=await verifyTrustedCiRun(input, async()=>{throw new Error("offline");});
    expect(r.reason).toBe("GITHUB_LOOKUP_FAILED");
  });
});
