import { describe, expect, it } from "vitest";
import { detectAiCoreGitHubOperation } from "../aiCoreGitHubControlService.js";

describe("AI Core no-worker GitHub control", () => {
  it.each([
    ["cek GitHub workflow run=37470000000", "GITHUB_WORKFLOW_STATUS"],
    ["rerun GitHub workflow run=37470000000", "GITHUB_WORKFLOW_RERUN"],
    ["rerun failed GitHub workflow run=37470000000", "GITHUB_WORKFLOW_RERUN_FAILED"],
    ["cancel GitHub workflow run=37470000000", "GITHUB_WORKFLOW_CANCEL"],
    ["cek PR #721", "GITHUB_PR_STATUS"],
    ["merge PR #721", "GITHUB_PR_MERGE"],
  ])("detects bounded operation %s", (message, operation) => {
    expect(detectAiCoreGitHubOperation(message)).toBe(operation);
  });

  it("does not convert ordinary coding requests into GitHub fast actions", () => {
    expect(detectAiCoreGitHubOperation("perbaiki kode scheduler lalu commit")).toBeNull();
  });
});
