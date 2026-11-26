import { createHash } from "node:crypto";

export const task189Target = Object.freeze({
  purpose: "CST-DEV/task189/second-preparation/signer-window/v1",
  project: "xssrfshdrtdfupgqwfdw",
  tenant: "default",
  task: 189,
  job: "816767f4-4264-4931-9a82-3d9496d3da3c",
  request: "66ae915fde2dc1aab68b55272a7107cb3e4b",
  principal: "openclaw-vps-dev-consumer",
  worker: "openclaw-vps-main",
  maxUses: 1,
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hexDigest = /^[0-9a-f]{64}$/;
const grantLifetimeMs = 24 * 60 * 60 * 1000;

export type Mandate = typeof task189Target & {
  grantId: string; credentialId: string; credentialBinding: string;
  redeemerUserId: number; notBefore: number; expiresAt: number;
};
export class ReleaseError extends Error {
  readonly status: number;
  constructor(status: number, code: string) { super(code); this.status = status; }
}

// Rotation invalidates grants even when the service credential retains its row ID.
export function releaseCredentialBinding(tokenHash: string): string {
  return createHash("sha256").update("CST-DEV/task189/credential/v1\0").update(tokenHash).digest("hex");
}

export function verifyOwnerMandate(value: unknown, now: number): Mandate {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReleaseError(400, "INVALID_MANDATE");
  const raw = value as Record<string, unknown>;
  const { grantId, credentialId, credentialBinding, redeemerUserId, notBefore, expiresAt } = raw;
  if (typeof grantId !== "string" || !uuid.test(grantId) ||
      typeof credentialId !== "string" || !uuid.test(credentialId) ||
      typeof credentialBinding !== "string" || !hexDigest.test(credentialBinding) ||
      typeof redeemerUserId !== "number" || !Number.isSafeInteger(redeemerUserId) || redeemerUserId < 1 || redeemerUserId > 2147483647 ||
      typeof notBefore !== "number" || !Number.isSafeInteger(notBefore) ||
      typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) ||
      Object.keys(raw).length !== Object.keys(task189Target).length + 6 ||
      Object.entries(task189Target).some(([k,v]) => raw[k] !== v))
    throw new ReleaseError(400, "INVALID_MANDATE_TARGET");
  if (!Number.isSafeInteger(now) || notBefore > now || expiresAt <= now || expiresAt <= notBefore || expiresAt - notBefore > grantLifetimeMs)
    throw new ReleaseError(409, "MANDATE_OUTSIDE_VALIDITY");
  return { ...task189Target, grantId, credentialId, credentialBinding, redeemerUserId, notBefore, expiresAt };
}
