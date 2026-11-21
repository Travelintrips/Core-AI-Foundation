import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const jobs=source("artifacts/api-server/src/routes/jobs.ts");
const consent=source("artifacts/api-server/src/lib/cstOneJobFreshStageConsent.ts");
const stage=source("artifacts/api-server/src/services/cstOneJobOwnerApprovalStageService.ts");
const auth=source("artifacts/api-server/src/middleware/internalAuth.ts");
const ui=source("artifacts/ai-platform/src/pages/cst-dev-onejob.tsx");
const nav=source("artifacts/ai-platform/src/components/layout.tsx");
const policy=source("docs/dev/cst-onejob-single-super-admin-authority-20261121.md");
const reviewer=source("scripts/dev/cst-onejob-operations-broker-release.mjs");

test("one Super Admin human: existing Core owner role, NOT generic admin or manager",()=>{
  const s=jobs.slice(jobs.indexOf('router.get("/ai/dev/onejob/owner-stage-readiness"'),
    jobs.indexOf('router.post("/ai/jobs"'));
  assert.equal((s.match(/requireInternalRole\("owner"\)/g)||[]).length,2);
  assert.doesNotMatch(s,/requireInternalRole\("admin"\)/);
  assert.doesNotMatch(s,/requireInternalRole\("manager"\)/);
  assert.match(consent,/i\.role!=="owner"/);
  assert.match(auth,/getInternalUserById\(payload.sub\)/);
  assert.match(auth,/user\.status === "active"/);
  assert.match(auth,/roles\.includes\(user\.role/);
  assert.match(policy,/single Super Admin decision|Super Admin is the only human approver|Exactly one human/i);
  assert.match(policy,/role owner/);
});
test("only one fresh Super Admin stage click, single scoped WAITING job, no second approval",()=>{
  assert.equal((jobs.match(/router.post\("\/ai\/dev\/onejob\/owner-approve-and-stage"/g)||[]).length,1);
  assert.match(jobs,/verifyFreshOneJobStageConsent/);
  assert.match(consent,/Object\.keys\(body\)\.length!==1/);
  assert.match(consent,/ONE_JOB_OWNER_STAGE_INTENT/);
  assert.match(stage,/status:"waiting" as const/);
  assert.match(stage,/cst_onejob_one_active_approval/);
  assert.match(stage,/ONEJOB_SINGLE_ACTIVE_INDEX_NOT_READY/);
  assert.doesNotMatch(stage,/status:"queued" as const|GRANT ALL|CREATE ROLE/);
  assert.match(policy,/No additional human Security\/Operations sign-off/);
});
test("UI says Super Admin but only privileged owner can see one action in DEV",()=>{
  assert.match(ui,/Persetujuan Super Admin — CST-DEV/);
  assert.match(ui,/role internal owner/);
  assert.match(ui,/user\.role==="owner"/);
  assert.match(nav,/user\?\.role==="owner"/);
  assert.match(nav,/Persetujuan Super Admin/);
  assert.match(ui,/APPROVE_ONE_NEW_CST_DEV_MODEL_JOB/);
  assert.match(ui,/disabled=\{!ready\|\|submitted\|\|loading\}/);
  assert.doesNotMatch(ui,/setInterval|autoRetry|type="password"/);
});
test("single human decision does not forge Operations keys or bypass technical evidence",()=>{
  assert.match(reviewer,/APPROVED_OPS_ROOT_FINGERPRINT=null/);
  assert.match(stage,/readIndependentlySignedPreapproval/);
  assert.match(stage,/dispatchPermitted:false/);
  assert.match(policy,/signature/);
  assert.match(policy,/NO-GO/);
  assert.match(policy,/No KMS/);
  assert.doesNotMatch(policy,/approvedRootFingerprint="[a-f0-9]{64}"/);
});
