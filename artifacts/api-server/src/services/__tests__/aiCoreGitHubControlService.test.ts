import { describe, expect, it } from "vitest";
import {
  detectAiCoreGitHubOperation,
  requestedCommitSha,
} from "../aiCoreGitHubControlService.js";

describe("AI Core no-worker GitHub control", () => {
  it.each([
    ["cek GitHub workflow run=37470000000", "GITHUB_WORKFLOW_STATUS"],
    ["rerun GitHub workflow run=37470000000", "GITHUB_WORKFLOW_RERUN"],
    ["rerun failed GitHub workflow run=37470000000", "GITHUB_WORKFLOW_RERUN_FAILED"],
    ["cancel GitHub workflow run=37470000000", "GITHUB_WORKFLOW_CANCEL"],
    [
      "Deploy operasional Core AI Foundation ke Hostinger untuk exact commit 34e9b7ab317458894555c82205f5fe155189babe. Jangan scan repo dan jangan ubah kode.",
      "GITHUB_HOSTINGER_NODEJS_DEPLOY",
    ],
    ["cek PR #721", "GITHUB_PR_STATUS"],
    ["merge PR #721", "GITHUB_PR_MERGE"],
  ])("detects bounded operation %s", (message, operation) => {
    expect(detectAiCoreGitHubOperation(message)).toBe(operation);
  });

  it("extracts an optional exact deployment commit guard", () => {
    expect(
      requestedCommitSha(
        "deploy Hostinger exact commit 34e9b7ab317458894555c82205f5fe155189babe",
      ),
    ).toBe("34e9b7ab317458894555c82205f5fe155189babe");
    expect(requestedCommitSha("deploy Hostinger current main")).toBeNull();
  });

  it("does not convert ordinary coding requests into GitHub fast actions", () => {
    expect(detectAiCoreGitHubOperation("perbaiki kode scheduler lalu commit")).toBeNull();
  });
});
