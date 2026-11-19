export type SubscriptionHealthState = "ACTIVE" | "EXPIRED" | "UNSUBSCRIBED" | "NOT_SUBSCRIBED";

/** Pure classification; a read must never renew a lease or acknowledge an event. */
export function classifySubscriptionLease(input: {
  leaseExpiresAt: Date | string | null | undefined;
  unsubscribedAt?: string | null;
}, now = Date.now()): { state: SubscriptionHealthState; renewalRequired: boolean; expiresAt: string | null } {
  if (input.leaseExpiresAt == null) {
    return { state: "NOT_SUBSCRIBED", renewalRequired: true, expiresAt: null };
  }
  const expires = input.leaseExpiresAt instanceof Date
    ? input.leaseExpiresAt : new Date(input.leaseExpiresAt);
  if (!Number.isFinite(expires.getTime())) {
    return { state: "EXPIRED", renewalRequired: true, expiresAt: null };
  }
  const expiresAt = expires.toISOString();
  if (input.unsubscribedAt) {
    return { state: "UNSUBSCRIBED", renewalRequired: true, expiresAt };
  }
  return expires.getTime() > now
    ? { state: "ACTIVE", renewalRequired: false, expiresAt }
    : { state: "EXPIRED", renewalRequired: true, expiresAt };
}
