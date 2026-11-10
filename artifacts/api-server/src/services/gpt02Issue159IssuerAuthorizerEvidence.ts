const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const WORKER = "openclaw-dell-chatgpt-wake-dev";
const ROLE = "dev_gpt02_issuer_evidence";

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).sort().join(",") ===
    [...fields].sort().join(",");
}

const CLAIM_FIELDS = [
  "v", "environment", "audience", "companyId", "hubTaskId",
  "hubExecutionId", "coreTaskId", "commandId", "attemptId", "workerId",
  "receiptId", "linkId", "fenceId", "approvalDigest", "nonceDigest",
  "issuerRole", "leaseEpoch", "issuedAt", "expiresAt",
] as const;

const RECEIPT_FIELDS = [
  "receiptId", "commandId", "approvalDigest", "nonceDigest", "consumedAt",
] as const;

const FENCE_FIELDS = [
  "fenceId", "receiptId", "commandId", "linkId", "hubExecutionId",
  "coreTaskId", "attemptId", "workerId", "leaseEpoch",
  "leaseStartedAt", "leaseExpiresAt", "dispatchAllowed", "coreLedgerWritten",
] as const;

/**
 * Validates the persisted nonce/fence/lease snapshot a future issuer signer
 * must reconstruct from an independently authenticated store.
 *
 * This never signs and never turns evidence booleans into authority.
 */
export function inspectGpt02Issue159IssuerAuthorizerEvidence(input: {
  claims: unknown;
  nonceReceipt: unknown;
  fence: unknown;
  observedAt: number;
}) {
  if (!exactObject(input, ["claims", "nonceReceipt", "fence", "observedAt"]) ||
      !exactObject(input.claims, CLAIM_FIELDS) ||
      !exactObject(input.nonceReceipt, RECEIPT_FIELDS) ||
      !exactObject(input.fence, FENCE_FIELDS) ||
      !Number.isSafeInteger(input.observedAt)) {
    throw new Error("GPT02_ISSUE159_ISSUER_AUTHORIZER_INPUT_INVALID");
  }

  const c = input.claims;
  const r = input.nonceReceipt;
  const f = input.fence;

  if (c["v"] !== 1 ||
      c["environment"] !== "DEV" ||
      c["audience"] !== "GPT02_ISSUER_LEASE_EVIDENCE_V1" ||
      c["companyId"] !== "default" ||
      c["workerId"] !== WORKER ||
      c["issuerRole"] !== ROLE ||
      c["leaseEpoch"] !== 1 ||
      !Number.isSafeInteger(c["hubTaskId"]) ||
      Number(c["hubTaskId"]) <= 136 ||
      !Number.isSafeInteger(c["issuedAt"]) ||
      !Number.isSafeInteger(c["expiresAt"]) ||
      Number(c["expiresAt"]) <= Number(c["issuedAt"]) ||
      Number(c["expiresAt"]) - Number(c["issuedAt"]) > 15_000 ||
      !HEX.test(String(c["approvalDigest"])) ||
      !HEX.test(String(c["nonceDigest"])) ||
      ![
        "hubExecutionId", "coreTaskId", "commandId", "attemptId",
        "receiptId", "linkId", "fenceId",
      ].every((key) => UUID.test(String(c[key])))) {
    throw new Error("GPT02_ISSUE159_ISSUER_CLAIMS_INVALID");
  }

  if (r["receiptId"] !== c["receiptId"] ||
      r["commandId"] !== c["commandId"] ||
      r["approvalDigest"] !== c["approvalDigest"] ||
      r["nonceDigest"] !== c["nonceDigest"] ||
      !Number.isSafeInteger(r["consumedAt"])) {
    throw new Error("GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH");
  }

  if (f["fenceId"] !== c["fenceId"] ||
      f["receiptId"] !== c["receiptId"] ||
      f["commandId"] !== c["commandId"] ||
      f["linkId"] !== c["linkId"] ||
      f["hubExecutionId"] !== c["hubExecutionId"] ||
      f["coreTaskId"] !== c["coreTaskId"] ||
      f["attemptId"] !== c["attemptId"] ||
      f["workerId"] !== WORKER ||
      f["leaseEpoch"] !== 1 ||
      f["dispatchAllowed"] !== false ||
      f["coreLedgerWritten"] !== false ||
      !Number.isSafeInteger(f["leaseStartedAt"]) ||
      !Number.isSafeInteger(f["leaseExpiresAt"]) ||
      Number(f["leaseStartedAt"]) < Number(r["consumedAt"]) ||
      Number(f["leaseExpiresAt"]) <= Number(f["leaseStartedAt"]) ||
      Number(f["leaseExpiresAt"]) - Number(f["leaseStartedAt"]) > 15_000) {
    throw new Error("GPT02_ISSUE159_FENCE_BINDING_MISMATCH");
  }

  if (Number(c["issuedAt"]) < Number(f["leaseStartedAt"]) ||
      Number(c["expiresAt"]) > Number(f["leaseExpiresAt"]) ||
      input.observedAt < Number(c["issuedAt"]) ||
      input.observedAt > Number(c["expiresAt"])) {
    throw new Error("GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND");
  }

  return Object.freeze({
    environment: "DEV" as const,
    issuerEvidenceBindingMatched: true as const,
    nonceReceiptMatched: true as const,
    nonDispatchFenceMatched: true as const,
    persistedTrustedReadProven: false as const,
    privateKeyLoaded: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    commandCreated: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
