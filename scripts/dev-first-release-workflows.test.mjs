import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const workflow = (name) =>
  readFileSync(new URL("../.github/workflows/" + name, import.meta.url), "utf8");

test("all GitHub production Node release paths require DEV proof before scope and deploy", () => {
  const yaml = workflow("hostinger-nodejs-deploy.yml");
  const evidence = yaml.indexOf("node scripts/verify-dev-first-release.mjs");
  const scope = yaml.indexOf("- name: Detect whether runtime deployment is required");
  const nativeGrace = yaml.indexOf("- name: Give native Hostinger deploy a short grace period");
  assert.ok(evidence > 0 && evidence < scope && scope < nativeGrace);
  assert.match(yaml, /steps\.freshness\.outputs\.stale != 'true'/);
});

test("VPS PROD release is manual and proves exact DEV before SSH", () => {
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

test("main branch auto-merges cannot bypass DEV-first promotion", () => {
  const native = workflow("native-auto-merge.yml");
  const direct = workflow("pr-auto-complete.yml");
  const guardian = workflow("pr-queue-guardian.yml");
  assert.match(native, /if: \${{ false }}/);
  assert.match(direct, /Main auto-merge disabled until verified DEV-first promotion/);
  assert.doesNotMatch(guardian, /await github\.graphql\(mutation,/);
  assert.match(guardian, /DEV-first promotion requires reviewed merge commit/);
});

test("DEV has isolated VPS release gate and read-only canonical DNS", () => {
  const yaml = workflow("hostinger-dev-deploy.yml");
  const wait = yaml.indexOf("- name: Wait for CI-gated VPS DEV build and exact release");
  const smoke = yaml.indexOf("- name: Check isolated DEV frontend, protected jobs and unchanged production");
  const dns = yaml.indexOf("- name: Verify canonical combined DEV DNS (read-only)");
  const publicVerify = yaml.indexOf("- name: Verify authoritative DNS and public DEV exact SHA");
  assert.ok(wait > 0 && wait < smoke && smoke < dns && dns < publicVerify);
  assert.match(yaml, /VPS_DEV_SHA=PASS/);
  assert.match(yaml, /--resolve/);
  assert.match(yaml, /x-cst-commit-sha/);
  assert.match(yaml, /DEV_VPS_IP/);
  assert.doesNotMatch(yaml, /HOSTINGER_API_TOKEN/);
  assert.match(yaml, /COMBINED_DEV_DNS=PASS/);
  assert.match(yaml, /DEV_DOMAIN: dev\.cstlogistic\.co\.id/);
  assert.doesNotMatch(yaml, /dns\/v1\/zones/);
  assert.match(yaml, /prod_sha/);
  assert.doesNotMatch(yaml, /hosting\/v1\/accounts/);
  assert.doesNotMatch(yaml, /source_type:"archive"/);
});

test("DEV SPA static serving is explicit and independently configured", () => {
  const app = readFileSync(new URL("../artifacts/api-server/src/app.ts", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../deploy/dev-hostinger/docker-compose.yml", import.meta.url), "utf8");
  assert.match(app, /const serveStaticFrontend\s*=\s*shouldServeFrontend\s*\|\|\s*process\.env\["SERVE_STATIC_FRONTEND"\]\s*===\s*"true"/);
  assert.match(compose, /SERVE_FRONTEND:\s*"true"[\s\S]*?SERVE_STATIC_FRONTEND:\s*"true"/);
  assert.match(compose, /APP_ENV:\s*development/);
});

test("DEV deployment requires bounded frontend, JS asset, and anonymous auth smoke", () => {
  const yaml = workflow("hostinger-dev-deploy.yml");
  const runtime = yaml.indexOf("- name: Wait for CI-gated VPS DEV build and exact release");
  const smoke = yaml.indexOf("- name: Check isolated DEV frontend, protected jobs and unchanged production");
  assert.ok(runtime > 0 && smoke > runtime);
  assert.match(yaml, /dev-index\.html/);
  assert.match(yaml, /dev-center\/jobs/);
  assert.match(yaml, /anonymous dashboard authorization failed/);
  assert.match(yaml, /DEV_ISOLATION_SMOKE=PASS/);
});

test("VPS source release and watcher retain project-ref checks and CI gating", () => {
  const base = new URL("./vps/", import.meta.url);
  const release = readFileSync(new URL("deploy_dev_release.py", base), "utf8");
  const watcher = readFileSync(new URL("dev_ci_watcher.py", base), "utf8");
  assert.match(release, /EXPECTED_DEV_PROJECT/);
  assert.match(release, /tempstatic\.chmod\(0o755\)/);
  assert.match(release, /prod_unchanged=PASS/);
  assert.match(release, /VPS_DEV_RELEASE=PASS/);
  assert.match(release, /core-ai-dev-prev-/);
  assert.match(release, /AI_PRODUCTION_WORKERS_ALLOWED=false/);
  assert.match(watcher, /CI Verify/);
  assert.match(watcher, /DEV Fast Verify/);
  assert.match(watcher, /run.get\("head_sha"\) == sha/);
  assert.match(watcher, /VPS_DEV_POLL=PASS/);
});
