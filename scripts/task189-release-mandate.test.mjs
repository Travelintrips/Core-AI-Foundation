import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { task189Target, releaseCredentialBinding, verifyOwnerMandate } from "../artifacts/api-server/src/services/task189ReleaseMandate.ts";

const now = Date.now();
const grant = { ...task189Target, grantId: randomUUID(), credentialId: randomUUID(),
  credentialBinding: releaseCredentialBinding("synthetic-fixture"), redeemerUserId: 7, notBefore: now-500, expiresAt: now+60000 };
test("owner mandate validation tolerates DB field reordering", () => {
  const reordered = Object.fromEntries(Object.entries(grant).reverse());
  assert.deepEqual(verifyOwnerMandate(reordered, now), grant);
});
test("a mandate cannot change the task, environment, principal or release purpose", () => {
  for (const field of Object.keys(task189Target)) {
    const wrong = { ...grant, [field]: "other" };
    assert.throws(() => verifyOwnerMandate(wrong, now), /TARGET/);
  }
  const extra = { ...grant, dispatch: true };
  assert.throws(() => verifyOwnerMandate(extra, now));
});
test("expiry is exclusive, start inclusive, validity is bounded and time must be known", () => {
  assert.deepEqual(verifyOwnerMandate(grant, grant.notBefore), grant);
  for (const timestamp of [grant.notBefore-1, grant.expiresAt, NaN]) {
    assert.throws(() => verifyOwnerMandate(grant, timestamp), /VALIDITY/);
  }
  const long = { ...grant, expiresAt: grant.notBefore + 86400001 };
  assert.throws(() => verifyOwnerMandate(long, now), /VALIDITY/);
});
