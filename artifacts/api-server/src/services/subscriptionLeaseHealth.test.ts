import { test, expect } from "vitest";
import { classifySubscriptionLease } from "./subscriptionLeaseHealth.js";

const now = Date.parse("2026-10-25T21:30:00.000Z");

test("expired MCP subscription requires authenticated resubscribe", () => {
  expect(classifySubscriptionLease({ leaseExpiresAt: "2026-10-22T21:00:38.446Z" }, now)).toEqual({
    state: "EXPIRED", renewalRequired: true,
    expiresAt: "2026-10-22T21:00:38.446Z",
  });
});
test("active lease remains active", () => {
  expect(classifySubscriptionLease({ leaseExpiresAt: "2026-10-26T21:00:38.446Z" }, now).state).toBe("ACTIVE");
});
test("unsubscribed lease cannot be silently renewed on reads", () => {
  expect(classifySubscriptionLease({
    leaseExpiresAt: "2026-10-26T21:00:38.446Z",
    unsubscribedAt: "2026-10-25T20:00:00.000Z",
  }, now)).toMatchObject({ state: "UNSUBSCRIBED", renewalRequired: true });
});
test("missing or invalid lease fails closed", () => {
  expect(classifySubscriptionLease({ leaseExpiresAt: null }, now).state).toBe("NOT_SUBSCRIBED");
  expect(classifySubscriptionLease({ leaseExpiresAt: "not-a-date" }, now).state).toBe("EXPIRED");
});
