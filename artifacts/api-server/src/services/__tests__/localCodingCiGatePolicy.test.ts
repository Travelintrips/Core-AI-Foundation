import { describe, expect, it } from "vitest";
import { decideSignedGithubCiGate } from "../localCodingCiGatePolicy.js";

const sha = "a".repeat(40);
const base = {
  sourceModule: "github-webhook" as const,
  eventType: "coding.github.check_run",
  eventId: "delivery-1",
  headSha: sha,
  bindingHeadSha: sha,
  checkName: "Unit tests",
  status: "completed",
  conclusion: "success",
  requiredChecks: ["Unit tests", "Security scan"],
  previousCheckpoint: {} as Record<string, unknown>,
  previousState: "WAITING",
};

describe("signed multi-check GitHub CI gate", () => {
  it("does not promote one green check when another required check is missing", () => {
    const verdict = decideSignedGithubCiGate(base);
    expect(verdict).toMatchObject({
      accepted: true, state: "WAITING", newlyGreen: false,
      checkResults: { "Unit tests": "success" },
    });
  });

  it("promotes only after all required checks of the exact SHA are successful", () => {
    const verdict = decideSignedGithubCiGate({
      ...base,
      eventId: "delivery-2",
      checkName: "Security scan",
      previousCheckpoint: {
        ciHeadSha: sha,
        ciChecks: { "Unit tests": "success" },
        ciLastEventId: "delivery-1",
      },
    });
    expect(verdict).toMatchObject({
      accepted: true, state: "GREEN", newlyGreen: true,
      checkResults: { "Unit tests": "success", "Security scan": "success" },
    });
    expect(decideSignedGithubCiGate({
      ...base,
      eventId: "delivery-3",
      checkName: "Security scan",
      previousState: "GREEN",
      previousCheckpoint: {
        ciHeadSha: sha,
        ciChecks: { "Unit tests": "success", "Security scan": "success" },
      },
    })).toMatchObject({ accepted: true, newlyGreen: false, state: "GREEN" });
  });

  it("fails closed for untrusted source, unrelated events, checks and SHA", () => {
    for (const change of [
      { sourceModule: "browser-relay" },
      { eventType: "coding.github.pull_request" },
      { headSha: "b".repeat(40) },
      { checkName: "Unrelated successful check" },
      { status: "in_progress" },
      { conclusion: null },
      { requiredChecks: [] },
      { requiredChecks: [""] },
      { requiredChecks: ["Unit tests", 42] },
      { previousCheckpoint: { ciLastEventId: "delivery-1" } },
    ]) {
      expect(decideSignedGithubCiGate({ ...base, ...change }).accepted).toBe(false);
    }
  });

  it("a failing required check blocks green and preserves failure for other checks", () => {
    const failed = decideSignedGithubCiGate({
      ...base, checkName: "Security scan", conclusion: "failure",
      previousCheckpoint: { ciHeadSha: sha, ciChecks: { "Unit tests": "success" } },
    });
    expect(failed).toMatchObject({
      accepted: true, state: "FAILED", currentCheckFailed: true,
      checkResults: { "Unit tests": "success", "Security scan": "failure" },
    });
    const stillFailed = decideSignedGithubCiGate({
      ...base, checkName: "Unit tests", eventId: "delivery-2",
      previousState: "FAILED",
      previousCheckpoint: { ciHeadSha: sha, ciChecks: { "Security scan": "failure" } },
    });
    expect(stillFailed).toMatchObject({ accepted: true, state: "FAILED", newlyGreen: false });
  });

  it("does not reuse check results from another SHA", () => {
    const verdict = decideSignedGithubCiGate({
      ...base,
      previousCheckpoint: { ciHeadSha: "b".repeat(40), ciChecks: { "Security scan": "success" } },
    });
    expect(verdict).toMatchObject({
      accepted: true, state: "WAITING", checkResults: { "Unit tests": "success" },
    });
  });

  it("a single explicitly required verified workflow run may promote, not unrelated workflows", () => {
    expect(decideSignedGithubCiGate({
      ...base, eventType: "coding.github.workflow_run",
      requiredChecks: ["CI Verify"], checkName: "CI Verify",
    })).toMatchObject({ accepted: true, state: "GREEN", newlyGreen: true });
    expect(decideSignedGithubCiGate({
      ...base, eventType: "coding.github.workflow_run",
      requiredChecks: ["CI Verify"], checkName: "Other Workflow",
    }).accepted).toBe(false);
  });
});
