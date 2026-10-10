import test from "node:test";
import assert from "node:assert/strict";
import { parseGithubRunIdentity, resolveAuthorizedSubscriptions } from "./github-event-correlation.mjs";

const base = {
  repository: "Travelintrips/Core-AI-Foundation",
  runId: "12345",
  headSha: "a".repeat(40),
  workflow: "CI Verify",
  conclusion: "success",
};

test("stable deduplication identity for a GitHub workflow result", () => {
  const event = parseGithubRunIdentity(base);
  assert.equal(event.eventKey, "github:workflow:Travelintrips/Core-AI-Foundation:12345:success");
  assert.equal(event.conversationId, undefined);
});
test("reject malformed event identities", () => {
  for (const patch of [{ runId: "1; rm -rf /" }, { headSha: "bad" }, { conclusion: "unknown" }, { repository: "../bad" }]) {
    assert.throws(() => parseGithubRunIdentity({ ...base, ...patch }));
  }
});
test("deliver only to authorized matching subscriptions and deduplicate", () => {
  const event = parseGithubRunIdentity(base);
  const allowed = {
    repository: base.repository, runId: base.runId, headSha: base.headSha,
    tenantId: "tenant-a", userId: "user-a", conversationId: "chat-a", taskId: "task-a", authorized: true,
  };
  const result = resolveAuthorizedSubscriptions(event, [
    allowed, allowed,
    { ...allowed, conversationId: "chat-b", userId: "user-b", authorized: false },
    { ...allowed, tenantId: "tenant-b", authorized: false },
    { ...allowed, runId: "999" },
    { ...allowed, headSha: "b".repeat(40) },
  ]);
  assert.deepEqual(result, [allowed]);
});
test("supports multiple authorized conversations for the same CI run", () => {
  const event = parseGithubRunIdentity(base);
  const one = { ...base, tenantId: "t", userId: "u", conversationId: "c1", taskId: "a", authorized: true };
  const two = { ...one, conversationId: "c2", taskId: "b" };
  assert.equal(resolveAuthorizedSubscriptions(event, [one, two]).length, 2);
});
