import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = (name) => readFileSync(new URL("../.github/workflows/" + name, import.meta.url), "utf8");

test("all GitHub production Node release paths require DEV proof before scope and deploy", () => {
  const yaml = workflow("hostinger-nodejs-deploy.yml");
  const evidence = yaml.indexOf("node scripts/verify-dev-first-release.mjs");
  const scope = yaml.indexOf("- name: Detect whether runtime deployment is required");
  const nativeGrace = yaml.indexOf("- name: Give native Hostinger deploy a short grace period");
  assert.ok(evidence > 0 && evidence < scope && scope < nativeGrace);
  assert.match(yaml, /steps\.freshness\.outputs\.stale != 'true'/);
});

test("VPS release cannot auto-deploy from CI and requires exact DEV proof before SSH", () => {
  const yaml = workflow("ai-workers-deploy.yml");
  assert.doesNotMatch(yaml, /^  workflow_run:/m);
  assert.match(yaml, /REQUESTED_REF.*inputs\.ref/);
  assert.ok(yaml.indexOf("node scripts/verify-dev-first-release.mjs") < yaml.indexOf("- name: Configure SSH"));
});

test("GPU deployment is manual and checks DEV before cloud authentication", () => {
  const yaml = workflow("ai-image-worker-gcp.yml");
  assert.doesNotMatch(yaml, /^  push:/m);
  assert.ok(yaml.indexOf("node scripts/verify-dev-first-release.mjs") < yaml.indexOf("- id: auth"));
});

test("main-branch auto-merges cannot bypass DEV-first promotion", () => {
  const native = workflow("native-auto-merge.yml");
  const direct = workflow("pr-auto-complete.yml");
  const guardian = workflow("pr-queue-guardian.yml");
  assert.match(native, /if: \$\{\{ false \}\}/);
  assert.match(direct, /Main auto-merge disabled until verified DEV-first promotion/);
  assert.doesNotMatch(guardian, /await github\.graphql\(mutation,/);
  assert.match(guardian, /DEV-first promotion requires reviewed merge commit/);
});
