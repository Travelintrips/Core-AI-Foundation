import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { test } from "node:test";
import { task189Target, releaseCredentialBinding, verifyMandate } from "../artifacts/api-server/src/services/task189ReleaseMandate.ts";

const keys = generateKeyPairSync("ed25519");
const der = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const now = Date.now();
const grant = { ...task189Target, grantId: randomUUID(), credentialId: randomUUID(),
  credentialBinding: releaseCredentialBinding("synthetic-fixture"), redeemerUserId: 7, notBefore: now-500, expiresAt: now+60000 };
const signature = (g, privateKey = keys.privateKey) => sign(null, Buffer.from(JSON.stringify(g)), privateKey).toString("base64url");

test("registered independent key authenticates the exact DEV mandate, even after JSONB reorders keys", () => {
  const reordered = Object.fromEntries(Object.entries(grant).reverse());
  assert.deepEqual(verifyMandate(reordered, signature(grant), der, now), grant);
});
test("other issuers, unsigned claims and modified bytes are rejected", () => {
  assert.throws(() => verifyMandate(grant, signature(grant, generateKeyPairSync("ed25519").privateKey), der, now));
  assert.throws(() => verifyMandate(grant, "", der, now));
  assert.throws(() => verifyMandate({ ...grant, grantId: randomUUID() }, signature(grant), der, now));
  assert.throws(() => verifyMandate(grant, signature(grant), undefined, now));
});
test("even a correctly signed mandate cannot change the task, environment, principal or release purpose", () => {
  for (const field of Object.keys(task189Target)) {
    const wrong = { ...grant, [field]: "other" };
    assert.throws(() => verifyMandate(wrong, signature(wrong), der, now), /TARGET/);
  }
  const extra = { ...grant, dispatch: true };
  assert.throws(() => verifyMandate(extra, signature(extra), der, now));
});
test("expiry is exclusive, start inclusive, validity is bounded and time must be known", () => {
  assert.deepEqual(verifyMandate(grant, signature(grant), der, grant.notBefore), grant);
  for (const timestamp of [grant.notBefore-1, grant.expiresAt, NaN]) {
    assert.throws(() => verifyMandate(grant, signature(grant), der, timestamp), /VALIDITY/);
  }
  const long = { ...grant, expiresAt: grant.notBefore + 86400001 };
  assert.throws(() => verifyMandate(long, signature(long), der, now), /VALIDITY/);
});
