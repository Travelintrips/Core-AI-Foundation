import { createHash, createPublicKey, verify } from "node:crypto";

export const GPT02_ISSUE159_SIGNER_ROLES =
  ["approval", "hub", "core", "issuer"] as const;
export type Gpt02Issue159SignerRole =
  (typeof GPT02_ISSUE159_SIGNER_ROLES)[number];

export const GPT02_ISSUE159_SIGNER_DOMAINS = Object.freeze({
  approval: "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL",
  hub: "GPT02_OPERATOR_LINK_V1:hub",
  core: "GPT02_OPERATOR_LINK_V1:core",
  issuer: "GPT02_ISSUER_LEASE_EVIDENCE_V1",
} satisfies Record<Gpt02Issue159SignerRole, string>);

const APPROVAL_FIELDS = [
  "v", "environment", "audience", "taskId", "commandId", "attemptId",
  "nonce", "operatorNamespace", "superAdminId", "companyId",
  "issuedAt", "expiresAt",
] as const;

const OPERATOR_LINK_FIELDS = [
  "v", "environment", "audience", "linkId", "companyId", "hubTaskId",
  "hubExecutionId", "coreTaskId", "coreCommandId", "attemptId",
  "attemptNumber", "assigneeId", "accountableOwnerId",
  "hubOperatorNamespace", "hubOperatorId", "hubRole", "hubActive",
  "coreOperatorNamespace", "coreOperatorUserId", "coreRole", "coreActive",
  "corePasswordChanged", "workerId", "approvalDigest", "nonce",
  "issuedAt", "expiresAt",
] as const;

const ISSUER_FIELDS = [
  "v", "environment", "audience", "companyId", "hubTaskId",
  "hubExecutionId", "coreTaskId", "commandId", "attemptId", "workerId",
  "receiptId", "linkId", "fenceId", "approvalDigest", "nonceDigest",
  "issuerRole", "leaseEpoch", "issuedAt", "expiresAt",
] as const;

type Claim = Record<string, unknown>;

function exactObject(value: unknown, fields: readonly string[]): value is Claim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Claim);
  return keys.length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function canonical(value: unknown, fields: readonly string[], error: string): string {
  if (!exactObject(value, fields)) throw new Error(error);
  const record = value as Claim;
  return JSON.stringify(Object.fromEntries(fields.map((field) => [field, record[field]])));
}

export function canonicalGpt02Issue159Approval(claims: unknown): string {
  return canonical(claims, APPROVAL_FIELDS, "GPT02_ISSUE159_APPROVAL_FIELDS_INVALID");
}

export function canonicalGpt02Issue159OperatorLink(claims: unknown): string {
  return canonical(claims, OPERATOR_LINK_FIELDS, "GPT02_ISSUE159_OPERATOR_LINK_FIELDS_INVALID");
}

export function canonicalGpt02Issue159IssuerEvidence(claims: unknown): string {
  return canonical(claims, ISSUER_FIELDS, "GPT02_ISSUE159_ISSUER_FIELDS_INVALID");
}

export function gpt02Issue159SigningBytes(
  role: Gpt02Issue159SignerRole,
  claims: unknown,
): Buffer {
  if (role === "approval") {
    return Buffer.from(canonicalGpt02Issue159Approval(claims), "utf8");
  }
  if (role === "hub" || role === "core") {
    return Buffer.from(
      `GPT02_OPERATOR_LINK_V1:${role}\n${canonicalGpt02Issue159OperatorLink(claims)}`,
      "utf8",
    );
  }
  if (role === "issuer") {
    return Buffer.from(
      `GPT02_ISSUER_LEASE_EVIDENCE_V1\n${canonicalGpt02Issue159IssuerEvidence(claims)}`,
      "utf8",
    );
  }
  throw new Error("GPT02_ISSUE159_SIGNER_ROLE_INVALID");
}

function publicKeyFingerprint(pem: string): string {
  if (typeof pem !== "string" || pem.length < 100 || pem.length > 2048 ||
      !pem.includes("-----BEGIN PUBLIC KEY-----")) {
    throw new Error("GPT02_ISSUE159_PUBLIC_KEY_REQUIRED");
  }
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("GPT02_ISSUE159_ED25519_PUBLIC_KEY_REQUIRED");
  }
  return createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex");
}

/**
 * Verify one detached Ed25519 signature against the exact role domain and
 * canonical claims. This is verification only; it never loads a private key.
 */
export function verifyGpt02Issue159Signature(
  role: Gpt02Issue159SignerRole,
  claims: unknown,
  signatureBase64url: string,
  publicKeyPem: string,
): boolean {
  try {
    if (typeof signatureBase64url !== "string" ||
        !/^[A-Za-z0-9_-]{86}$/.test(signatureBase64url)) return false;
    const signature = Buffer.from(signatureBase64url, "base64url");
    if (signature.length !== 64) return false;
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return false;
    return verify(null, gpt02Issue159SigningBytes(role, claims), key, signature);
  } catch {
    return false;
  }
}

export function inspectGpt02Issue159PublicRoots(input: {
  approvalPublicKeyPem: string;
  hubPublicKeyPem: string;
  corePublicKeyPem: string;
  issuerPublicKeyPem: string;
}) {
  const keys = Object.keys(input).sort();
  if (keys.join(",") !==
      "approvalPublicKeyPem,corePublicKeyPem,hubPublicKeyPem,issuerPublicKeyPem") {
    throw new Error("GPT02_ISSUE159_FOUR_PUBLIC_KEYS_REQUIRED");
  }
  const fingerprints = Object.freeze({
    approval: publicKeyFingerprint(input.approvalPublicKeyPem),
    hub: publicKeyFingerprint(input.hubPublicKeyPem),
    core: publicKeyFingerprint(input.corePublicKeyPem),
    issuer: publicKeyFingerprint(input.issuerPublicKeyPem),
  });
  if (new Set(Object.values(fingerprints)).size !== 4) {
    throw new Error("GPT02_ISSUE159_INDEPENDENT_PUBLIC_KEYS_REQUIRED");
  }
  return Object.freeze({
    environment: "DEV" as const,
    algorithm: "Ed25519" as const,
    fingerprints,
    publicRootsVerified: true as const,
    privateKeyLoaded: false as const,
    signerMounted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
  });
}
