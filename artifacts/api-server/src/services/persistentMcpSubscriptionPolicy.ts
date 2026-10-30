/** Business lifecycle is independent of the short-lived authenticated MCP lease.
 * Never extend OAuth tokens or synthesize an event acknowledgement.
 */
export type PersistentMcpSubscriptionAction = "RENEW" | "CLOSE_PASS" | "SKIP";
export type PersistentMcpDeliveryState = "CLIENT_RECENTLY_SEEN" | "WAITING_CLIENT";

export function decidePersistentMcpSubscription(input: {
  optedIn: boolean;
  explicitlyRevoked: boolean;
  pendingResponses: number;
  totalCommands: number;
  verifiedCommands: number;
  verificationComplete: boolean;
}): PersistentMcpSubscriptionAction {
  if (!input.optedIn || input.explicitlyRevoked) return "SKIP";
  if (!input.verificationComplete || !Number.isSafeInteger(input.pendingResponses) ||
      input.pendingResponses < 0 || !Number.isSafeInteger(input.totalCommands) ||
      input.totalCommands < 0 || !Number.isSafeInteger(input.verifiedCommands) ||
      input.verifiedCommands < 0 || input.verifiedCommands > input.totalCommands) return "RENEW";
  // No job yet is not a successful job. Failed, blocked and unverified jobs
  // remain subscribed, even if their transport callbacks are already delivered.
  if (input.pendingResponses !== 0 || input.totalCommands === 0 ||
      input.verifiedCommands !== input.totalCommands) return "RENEW";
  return "CLOSE_PASS";
}

export function persistentMcpDeliveryState(lastClientSeenAt: Date | string | null, now: number,
  inactiveAfterMs = 15 * 60_000): PersistentMcpDeliveryState {
  const stamp = lastClientSeenAt instanceof Date ? lastClientSeenAt.getTime()
    : lastClientSeenAt ? Date.parse(lastClientSeenAt) : Number.NaN;
  return Number.isFinite(stamp) && now - stamp >= 0 && now - stamp <= inactiveAfterMs
    ? "CLIENT_RECENTLY_SEEN" : "WAITING_CLIENT";
}

/** This runtime is strictly isolated from PROD, even if its opt-in env is set there. */
export function devPersistentMcpRuntimeEnabled(env: {
  APP_ENV?: string; NODE_ENV?: string; AI_CORE_DEV_PERSISTENT_MCP_SUBSCRIPTIONS?: string;
}): boolean {
  return env.APP_ENV === "development" && env.NODE_ENV === "development" &&
    env.AI_CORE_DEV_PERSISTENT_MCP_SUBSCRIPTIONS !== "false";
}
