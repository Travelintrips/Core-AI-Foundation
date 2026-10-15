import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/hostinger-dev-deploy.yml", import.meta.url), "utf8");
const release = readFileSync(new URL("./vps/deploy_dev_release.py", import.meta.url), "utf8");

test("VPS DEV health retry requires exact immutable SHA before GitHub release acceptance", () => {
  const start = workflow.indexOf("- name: Wait for CI-gated VPS DEV build and exact release");
  const check = workflow.indexOf("- name: Check isolated DEV frontend, protected jobs and unchanged production");
  const dns = workflow.indexOf("- name: Verify canonical combined DEV DNS (read-only)");
  assert.ok(start >= 0 && check > start && dns > check);
  const retry = workflow.slice(start, check);
  assert.match(retry, /seq 1 105/);
  assert.match(retry, /code.*200/);
  assert.match(retry, /sha.*EXPECTED_SHA/);
  assert.match(retry, /jq -e '\.status == "ok"'/);
  assert.match(retry, /VPS DEV did not converge/);
});

test("VPS DEV runtime rolls back when health, frontend, nginx or PROD validation fail", () => {
  assert.match(release, /wait\(18084, sha\)/);
  assert.match(release, /smoke\(18084\)/);
  assert.match(release, /wait\(18082, sha\)/);
  assert.match(release, /smoke\(18082\)/);
  assert.match(release, /verify_https_local\(sha\)/);
  assert.match(release, /if inspect\(PROD\)\["Id"\] != before_prod\["Id"\]/);
  assert.match(release, /if not complete and rollback:/);
  assert.match(release, /VPS_DEV_RELEASE=ROLLED_BACK/);
  assert.match(release, /Path\(tempfile\.mkdtemp/);
  assert.match(release, /tempstatic\.chmod\(0o755\)/);
});
