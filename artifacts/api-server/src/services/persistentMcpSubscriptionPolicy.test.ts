import { describe, expect, it } from "vitest";
import {
  decidePersistentMcpSubscription,
  devPersistentMcpRuntimeEnabled,
  persistentMcpDeliveryState,
} from "./persistentMcpSubscriptionPolicy.js";

const base = {
  optedIn: true,
  explicitlyRevoked: false,
  pendingResponses: 0,
  totalCommands: 1,
  verifiedCommands: 1,
  verificationComplete: true,
};

describe("DEV durable MCP subscription, not OAuth token", () => {
  it("retains expired leases while any callback or ACK is pending", () => {
    expect(decidePersistentMcpSubscription({ ...base, pendingResponses: 30,
      verifiedCommands: 0 })).toBe("RENEW");
  });
  it("does not close a failed, blocked, or merely COMPLETED job", () => {
    expect(decidePersistentMcpSubscription({ ...base, verifiedCommands: 0 })).toBe("RENEW");
    expect(decidePersistentMcpSubscription({ ...base, totalCommands: 2,
      verifiedCommands: 1 })).toBe("RENEW");
    expect(decidePersistentMcpSubscription({ ...base,
      verificationComplete: false })).toBe("RENEW");
  });
  it("does not expire a subscription when there are no jobs yet", () => {
    expect(decidePersistentMcpSubscription({ ...base,
      totalCommands: 0, verifiedCommands: 0 })).toBe("RENEW");
  });
  it("closes only when every command has signed final ACK and zero pending events", () => {
    expect(decidePersistentMcpSubscription({ ...base })).toBe("CLOSE_PASS");
    expect(decidePersistentMcpSubscription({ ...base,
      totalCommands: 3, verifiedCommands: 3 })).toBe("CLOSE_PASS");
  });
  it("explicit owner revocation dominates all expiry and job conditions", () => {
    expect(decidePersistentMcpSubscription({ ...base, explicitlyRevoked: true,
      pendingResponses: 99 })).toBe("SKIP");
    expect(decidePersistentMcpSubscription({ ...base,
      optedIn: false })).toBe("SKIP");
  });
  it("offline then online changes delivery state, never Final ACK", () => {
    const now = Date.parse("2026-10-26T06:00:00.000Z");
    expect(persistentMcpDeliveryState("2026-10-21T06:00:00.000Z", now)).toBe("WAITING_CLIENT");
    expect(persistentMcpDeliveryState("2026-10-26T05:59:00.000Z", now)).toBe("CLIENT_RECENTLY_SEEN");
    expect(decidePersistentMcpSubscription({ ...base, pendingResponses: 1 })).toBe("RENEW");
  });
  it("PROD cannot activate even with opt-in flag set", () => {
    expect(devPersistentMcpRuntimeEnabled({ APP_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(devPersistentMcpRuntimeEnabled({ APP_ENV: "production", NODE_ENV: "development" })).toBe(false);
    expect(devPersistentMcpRuntimeEnabled({ APP_ENV: "development", NODE_ENV: "development" })).toBe(true);
    expect(devPersistentMcpRuntimeEnabled({ APP_ENV: "development", NODE_ENV: "development",
      AI_CORE_DEV_PERSISTENT_MCP_SUBSCRIPTIONS: "false" })).toBe(false);
  });
  it("no unverified or invalid aggregate may close fail-open", () => {
    expect(decidePersistentMcpSubscription({ ...base, totalCommands: 2, verifiedCommands: 3 })).toBe("RENEW");
    expect(decidePersistentMcpSubscription({ ...base, pendingResponses: -1 })).toBe("RENEW");
  });
});
