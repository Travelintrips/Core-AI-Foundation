import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHostingerDevWebsiteIsolation as verify } from "./verify-hostinger-dev-website-isolation.mjs";

const DEV = "dev-aicore.cstlogistic.co.id";
const PROD = "aicore.cstlogistic.co.id";
const ROOT = "/home/u1/domains/";
const site = (domain, root, options = {}) => ({
  domain,
  username: "u1",
  is_enabled: true,
  root_directory: root,
  vhost_type: "main",
  parent_domain: null,
  ...options,
});
const inventory = (dev = site(DEV, ROOT + DEV + "/public_html"),
  prod = site(PROD, ROOT + PROD + "/public_html")) => ({
  data: [dev, prod],
});

test("distinct vhosts safely share a Hostinger account username", () => {
  assert.deepEqual(verify(inventory(), DEV, PROD, "u1"), {
    safe: true, resource: "distinct-website-roots",
  });
});

test("reject same domain, regardless of whether it has two inventory records", () => {
  assert.throws(() => verify(inventory(), PROD, PROD, "u1"), /DOMAIN_COLLISION/);
});

test("reject missing, disabled, or ambiguous DEV/PROD inventory records", () => {
  assert.throws(() => verify({ data: [] }, DEV, PROD, "u1"), /MISSING_OR_AMBIGUOUS/);
  assert.throws(() => verify({ data: [site(DEV, "/a"), site(DEV, "/b"), site(PROD, "/p")] }, DEV, PROD, "u1"), /MISSING_OR_AMBIGUOUS/);
  assert.throws(() => verify(inventory(site(DEV, "/a", { is_enabled: false })), DEV, PROD, "u1"), /MISSING_OR_AMBIGUOUS/);
});

test("reject identical roots even when DEV and PROD domains differ", () => {
  assert.throws(() => verify(inventory(site(DEV, "/same"), site(PROD, "/same")), DEV, PROD, "u1"), /SHARED_WEBSITE_ROOT/);
});

test("fail closed if either site root cannot be inspected", () => {
  assert.throws(() => verify(inventory(site(DEV, null)), DEV, PROD, "u1"), /UNVERIFIABLE_WEBSITE_ROOT/);
  assert.throws(() => verify(inventory(undefined, site(PROD, "")), DEV, PROD, "u1"), /UNVERIFIABLE_WEBSITE_ROOT/);
});

test("reject alias or parked DEV vhosts and DEV parented on PROD", () => {
  assert.throws(() => verify(inventory(site(DEV, "/a", { vhost_type: "parked" })), DEV, PROD, "u1"), /DEV_ALIAS_NOT_ISOLATED/);
  assert.throws(() => verify(inventory(site(DEV, "/a", { vhost_type: "alias" })), DEV, PROD, "u1"), /DEV_ALIAS_NOT_ISOLATED/);
  assert.throws(() => verify(inventory(site(DEV, "/a", { parent_domain: PROD })), DEV, PROD, "u1"), /DEV_PARKED_ON_PROD/);
});

test("reject an unexpected hosting account identity", () => {
  assert.throws(() => verify(inventory(), DEV, PROD, "u2"), /HOSTING_ACCOUNT_IDENTITY_MISSING_OR_MISMATCH/);
  assert.throws(() => verify(inventory(site(DEV, "/a", { username: null })), DEV, PROD, "u1"), /HOSTING_ACCOUNT_IDENTITY_MISSING_OR_MISMATCH/);
});

test("reject malformed inventory and missing domains", () => {
  assert.throws(() => verify(null, DEV, PROD, "u1"), /INVALID_WEBSITE_INVENTORY/);
  assert.throws(() => verify(inventory(), "", PROD, "u1"), /DOMAIN_COLLISION/);
});
