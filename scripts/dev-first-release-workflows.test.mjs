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


test("DEV hosting verifies distinct website roots before all environment writes", () => {
  const yaml = workflow("hostinger-dev-deploy.yml");
  const guard = yaml.indexOf("node scripts/verify-hostinger-dev-website-isolation.mjs");
  const configure = yaml.indexOf("- name: Configure isolated DEV environment");
  assert.ok(guard > 0 && configure > guard, "DEV/PROD virtual-host guard must precede any environment write");
  assert.match(yaml, /\/tmp\/websites\.json "\$DEV_DOMAIN" "\$PROD_TEMPLATE_DOMAIN" "\$username"/);
  assert.match(yaml, /SUPABASE_URL_DEV/);
  assert.match(yaml, /APP_ENV",value:"development"/);
});

test("DEV SPA static serving is explicit and preserved independently of NODE_ENV", () => {
  const app = readFileSync(new URL("../artifacts/api-server/src/app.ts", import.meta.url), "utf8");
  const compose = readFileSync(new URL("../deploy/dev-hostinger/docker-compose.yml", import.meta.url), "utf8");
  assert.match(app, /const serveStaticFrontend\s*=\s*shouldServeFrontend\s*\|\|\s*process\.env\["SERVE_STATIC_FRONTEND"\]\s*===\s*"true"/);
  assert.match(compose, /SERVE_FRONTEND:\s*"true"[\s\S]*?SERVE_STATIC_FRONTEND:\s*"true"/);
  assert.match(compose, /APP_ENV:\s*development/);
});


test("DEV deployment requires a bounded live frontend and authenticated dashboard smoke", () => {
  const yaml = workflow("hostinger-dev-deploy.yml");
  const runtime = yaml.indexOf("- name: Verify DEV runtime and exact commit");
  const smoke = yaml.indexOf("- name: Verify DEV frontend and authenticated dashboard (bounded smoke)");
  assert.ok(runtime > 0 && smoke > runtime, "smoke must run after exact DEV runtime verification");
  assert.match(yaml, /dev-smoke-root\.html/);
  assert.match(yaml, /dev-center\/dashboard/);
  assert.match(yaml, /dev-center\/jobs/);
  assert.match(yaml, /x-admin-api-key: \$admin_key/);
  assert.match(yaml, /anonymous auth boundary failed/);
});
