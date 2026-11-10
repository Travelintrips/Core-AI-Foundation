import {
  GPT02_ISSUE159_SIGNER_DOMAINS,
  GPT02_ISSUE159_SIGNER_ROLES,
  type Gpt02Issue159SignerRole,
  inspectGpt02Issue159PublicRoots,
} from "./gpt02Issue159FourSignerContract.js";

export const GPT02_ISSUE159_CUSTODY_POLICY = Object.freeze({
  approval: Object.freeze({
    custodySlot: "gpt02-issue159-approval-dev",
    authorizerSource: "aal2-super-admin-approval-audit",
  }),
  hub: Object.freeze({
    custodySlot: "gpt02-issue159-hub-operator-dev",
    authorizerSource: "ai-task-hub-persisted-super-admin-identity",
  }),
  core: Object.freeze({
    custodySlot: "gpt02-issue159-core-operator-dev",
    authorizerSource: "ai-core-persisted-internal-operator-identity",
  }),
  issuer: Object.freeze({
    custodySlot: "gpt02-issue159-issuer-evidence-dev",
    authorizerSource: "persisted-nonce-fence-lease-evidence",
  }),
} satisfies Record<Gpt02Issue159SignerRole, {
  custodySlot: string;
  authorizerSource: string;
}>);

export const GPT02_ISSUE159_FORBIDDEN_REUSE_DOMAINS = Object.freeze([
  "ai-core-dev-checkpoint/v1",
  "dev-chatgpt-assistant-attestation/v1",
  "dev-chatgpt-assistant-attestation/v2",
  "dev-chatgpt-session-registration/v1",
  "ai-core-gpt02-recovery-fence/v1",
]);

type Provenance = {
  role: Gpt02Issue159SignerRole;
  custodySlot: string;
  authorizerSource: string;
  signingDomain: string;
  publicKeyPem: string;
};

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).sort().join(",") ===
    [...fields].sort().join(",");
}

export function assessGpt02Issue159SignerProvenance(input: unknown) {
  if (!exactObject(input, [...GPT02_ISSUE159_SIGNER_ROLES])) {
    throw new Error("GPT02_ISSUE159_FOUR_PROVENANCE_RECORDS_REQUIRED");
  }
  const records = input as Record<Gpt02Issue159SignerRole, Provenance>;
  const slots = new Set<string>();

  for (const role of GPT02_ISSUE159_SIGNER_ROLES) {
    const record = records[role];
    if (!exactObject(record, [
      "role", "custodySlot", "authorizerSource", "signingDomain", "publicKeyPem",
    ]) || record.role !== role) {
      throw new Error("GPT02_ISSUE159_PROVENANCE_SHAPE_INVALID");
    }
    const expected = GPT02_ISSUE159_CUSTODY_POLICY[role];
    if (record.custodySlot !== expected.custodySlot) {
      throw new Error("GPT02_ISSUE159_CUSTODY_SLOT_MISMATCH");
    }
    if (record.authorizerSource !== expected.authorizerSource) {
      throw new Error("GPT02_ISSUE159_AUTHORIZER_SOURCE_MISMATCH");
    }
    if (record.signingDomain !== GPT02_ISSUE159_SIGNER_DOMAINS[role] ||
        GPT02_ISSUE159_FORBIDDEN_REUSE_DOMAINS.includes(record.signingDomain)) {
      throw new Error("GPT02_ISSUE159_SIGNING_DOMAIN_MISMATCH");
    }
    if (slots.has(record.custodySlot)) {
      throw new Error("GPT02_ISSUE159_SHARED_CUSTODY_FORBIDDEN");
    }
    slots.add(record.custodySlot);
  }

  const roots = inspectGpt02Issue159PublicRoots({
    approvalPublicKeyPem: records.approval.publicKeyPem,
    hubPublicKeyPem: records.hub.publicKeyPem,
    corePublicKeyPem: records.core.publicKeyPem,
    issuerPublicKeyPem: records.issuer.publicKeyPem,
  });

  return Object.freeze({
    environment: "DEV" as const,
    provenancePolicyVerified: true as const,
    distinctCustodySlots: slots.size === 4,
    publicFingerprints: roots.fingerprints,
    privateKeyCustodyAttested: false as const,
    roleAuthorizersOperationallyVerified: false as const,
    signerMounted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
