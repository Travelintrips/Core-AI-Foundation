import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySubscriptionLease } from "./subscriptionLeaseHealth.js";

const now = Date.parse("2026-10-25T21:30:00.000Z");

test("expired MCP subscription must require explicit resubscribe", () => {
  assert.deepEqual(classifySubscriptionLease({
    leaseExpiresAt: "2026-10-22T21:00:38.446Z",
  }, now), {
    state: "EXPIRED", renewalRequired: true,
    expiresAt: "2026-10-22T21:00:38.446Z",
  });
});
test("healthy subscription requires no action", () => {
  assert.equal(classifySubscriptionLease({
    leaseExpiresAt: "2026-10-26T21:00:38.446Z",
  }, now).state, "ACTIVE");
});
test("explicit unsubscribe cannot be silently renewed by read", () => {
  const status = classifySubscriptionLease({
    leaseExpiresAt: "2026-10-26T21:00:38.446Z",
    unsubscribedAt: "2026-10-25T20:00:00.000Z",
  }, now);
  assert.equal(status.state, "UNSUBSCRIBED");
  assert.equal(status.renewalRequired, true);
});
test("missing or invalid lease fails closed", () => {
  assert.equal(classifySubscriptionLease({ leaseExpiresAt: null }, now).state, "NOT_SUBSCRIBED");
  assert.equal(classifySubscriptionLease({ leaseExpiresAt: "not-a-date" }, now).state, "EXPIRED");
});
