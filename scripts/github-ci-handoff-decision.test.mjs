import test from "node:test";
import assert from "node:assert/strict";
import { classifyCiRun } from "./github-ci-handoff-decision.mjs";

const repo = "Travelintrips/Core-AI-Foundation";
const base = {
  id: 39021000877, run_attempt: 1, repository: { full_name: repo },
  name: "CI Verify", status: "completed", conclusion: "success",
  event: "push", head_branch: "develop", head_sha: "a".repeat(40),
};

test("approved develop push CI emits a stable read-only diagnostic event", () => {
  const x = classifyCiRun(base, repo);
  assert.deepEqual(
    [x.eligible, x.scope, x.status, x.requiresBranchHeadCheck, x.actionAuthorized],
    [true, "branch_push", "COMPLETED", true, false],
  );
  assert.equal(x.eventId, "githubci-39021000877-1-success");
  assert.equal(x.conversationId, undefined);
  assert.deepEqual(x, classifyCiRun(base, repo));
});
test("main push CI is tracked", () => {
  assert.equal(classifyCiRun({ ...base, head_branch: "main" }, repo).eligible, true);
});
test("pull request CI is tracked but is NEVER deployment authorization", () => {
  const x = classifyCiRun({ ...base, event: "pull_request", head_branch: "fix/a" }, repo);
  assert.equal(x.eligible, true);
  assert.equal(x.scope, "pr_ci");
  assert.equal(x.requiresBranchHeadCheck, false);
  assert.equal(x.actionAuthorized, false);
});
test("failed and cancelled CI remain diagnostic and never claim success", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "startup_failure"]) {
    const x = classifyCiRun({ ...base, conclusion }, repo);
    assert.equal(x.eligible, true);
    assert.equal(x.status, "FAILED");
  }
});
test("reject irrelevant and untrusted CI run identities", () => {
  const rejects = [
    { name: "Security Verify" }, { status: "in_progress" }, { conclusion: "skipped" },
    { id: "123; echo hacked" }, { head_sha: "malformed" },
    { repository: { full_name: "attacker/repo" } },
    { event: "workflow_dispatch" }, { event: "push", head_branch: "feature/hack" },
    { event: "pull_request", head_branch: "" }, { run_attempt: 0 },
  ];
  for (const x of rejects) assert.equal(classifyCiRun({ ...base, ...x }, repo).eligible, false);
});
