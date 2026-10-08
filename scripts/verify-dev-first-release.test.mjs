import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requiredDevWorkflows, verifyDevEvidence } from "./verify-dev-first-release.mjs";

const sha = "a".repeat(40), expected = "b".repeat(40);
const greenRuns = requiredDevWorkflows.map((name) => ({
  name, head_sha: sha, head_branch: "develop",
  status: "completed", conclusion: "success", event: "push",
}));
function input(patch = {}) {
  return { expectedSha: expected, devSha: sha, developHead: sha,
    runs: greenRuns, differentFiles: [".github/workflows/hostinger-dev-deploy.yml"], ...patch };
}

describe("DEV-first release fail-closed evidence", () => {
  it("accepts only an exact live SHA with all three successful gates", () => {
    assert.equal(verifyDevEvidence(input()).devSha, sha);
  });
  it("rejects stale deployed DEV even when CI is green", () => {
    assert.throws(() => verifyDevEvidence(input({developHead: "c".repeat(40)})), /not on the current/);
  });
  it("rejects any missing or failed mandatory gate", () => {
    for (const name of requiredDevWorkflows) {
      assert.throws(() => verifyDevEvidence(input({
        runs: greenRuns.filter(r => r.name !== name),
      })), /Required DEV checks/);
      assert.throws(() => verifyDevEvidence(input({
        runs: greenRuns.map(r => r.name === name ? {...r, conclusion: "failure"} : r),
      })), /Required DEV checks/);
    }
  });
  it("rejects stale checks and untrusted event provenance", () => {
    assert.throws(() => verifyDevEvidence(input({
      runs: greenRuns.map(r => ({...r, head_sha: expected})),
    })), /Required DEV checks/);
    assert.throws(() => verifyDevEvidence(input({
      runs: greenRuns.map(r => ({...r, event: "pull_request"})),
    })), /Required DEV checks/);
  });
  it("rejects changes to any shared production path", () => {
    for (const path of ["artifacts/api-server/src/routes/ai-core-chat.ts",
      "deploy/ai-workers/docker-compose.yml", "package.json"]) {
      assert.throws(() => verifyDevEvidence(input({differentFiles: [path]})), /shared files/);
    }
  });
  it("rejects malformed commit evidence", () => {
    assert.throws(() => verifyDevEvidence(input({devSha: "unknown"})), /Invalid Git commit/);
  });
});
