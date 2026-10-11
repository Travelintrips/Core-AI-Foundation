import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/hostinger-dev-deploy.yml", import.meta.url), "utf8");

test("Hostinger DEV transient restart errors require live exact SHA and health before acceptance", () => {
  const start = workflow.indexOf("- name: Restart DEV Node.js application");
  const end = workflow.indexOf("- name: Verify DEV runtime and exact commit", start);
  assert.ok(start >= 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /if \[\[ "\$code" =~ \^2\[0-9\]\[0-9\]\$ \]\]; then/);
  assert.match(step, /non-retryable/);
  assert.match(step, /health_code.*"200"/);
  assert.match(step, /live_sha.*EXPECTED_SHA/);
  assert.match(step, /jq -e '\.status == "ok"'/);
  assert.match(step, /already_live_verified/);
  assert.ok(step.indexOf("already_live_verified") < step.indexOf("DEV restart transient HTTP"));
});
