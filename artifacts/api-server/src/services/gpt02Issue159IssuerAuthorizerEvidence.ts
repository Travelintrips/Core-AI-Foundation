import { createHash } from "node:crypto";
import {
  canonicalGpt02Issue159Approval,
  canonicalGpt02Issue159OperatorLink,
} from "./gpt02Issue159FourSignerContract.js";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
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
  "receiptId", "commandId", "nonce", "digest", "consumedAt",
] as const;

const IDENTITY_FIELDS = [
  "receiptId", "commandId", "linkId", "operatorUserId", "hubOperatorId",
  "linkDigest", "bindingVerified", "mayDispatchWorker", "mayIssueGrant",
  "mayCloseJob", "coreLedgerWritten",
] as const;

const FENCE_FIELDS = [
  "fenceId", "receiptId", "commandId", "linkId", "hubExecutionId",
  "coreTaskId", "attemptId", "workerId", "leaseEpoch",
  "leaseStartedAt", "leaseExpiresAt", "dispatchAllowed", "coreLedgerWritten",
] as const;

/**
 * Validates the exact persisted lineage a future issuer signer must reconstruct
 * before producing detached issuer evidence.
 *
 * This never signs and never turns caller booleans into authority.
 */
export function inspectGpt02Issue159IssuerAuthorizerEvidence(input: {
  claims: unknown;
  approvalClaims: unknown;
  operatorLinkClaims: unknown;
  nonceReceipt: unknown;
  identityReceipt: unknown;
  fence: unknown;
  observedAt: number;
}) {
  if (!exactObject(input, [
        "claims", "approvalClaims", "operatorLinkClaims",
        "nonceReceipt", "identityReceipt", "fence", "observedAt",
      ]) ||
      !exactObject(input.claims, CLAIM_FIELDS) ||
      !exactObject(input.nonceReceipt, RECEIPT_FIELDS) ||
      !exactObject(input.identityReceipt, IDENTITY_FIELDS) ||
      !exactObject(input.fence, FENCE_FIELDS) ||
      !Number.isSafeInteger(input.observedAt) ||
      input.observedAt <= 0) {
    throw new Error("GPT02_ISSUE159_ISSUER_AUTHORIZER_INPUT_INVALID");
  }

  let approvalCanonical: string;
  let linkCanonical: string;
  try {
    approvalCanonical = canonicalGpt02Issue159Approval(input.approvalClaims);
    linkCanonical = canonicalGpt02Issue159OperatorLink(input.operatorLinkClaims);
  } catch {
    throw new Error("GPT02_ISSUE159_APPROVAL_LINK_CANONICAL_INVALID");
  }

  const c = input.claims;
  const a = input.approvalClaims as Record<string, unknown>;
  const l = input.operatorLinkClaims as Record<string, unknown>;
  const r = input.nonceReceipt;
  const i = input.identityReceipt;
  const f = input.fence;

  const approvalDigest = createHash("sha256")
    .update(approvalCanonical).digest("hex");
  const linkDigest = createHash("sha256")
    .update(linkCanonical).digest("hex");
  const nonceDigest = typeof a["nonce"] === "string"
    ? createHash("sha256").update(a["nonce"]).digest("hex")
    : "";

  if (a["v"] !== 2 ||
      a["environment"] !== "DEV" ||
      a["audience"] !== "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" ||
      a["companyId"] !== "default" ||
      !Number.isSafeInteger(a["taskId"]) ||
      Number(a["taskId"]) <= 136 ||
      !UUID.test(String(a["commandId"])) ||
      !UUID.test(String(a["attemptId"])) ||
      a["commandId"] === a["attemptId"] ||
      typeof a["nonce"] !== "string" ||
      !NONCE.test(a["nonce"] as string) ||
      !Number.isSafeInteger(a["issuedAt"]) ||
      !Number.isSafeInteger(a["expiresAt"]) ||
      Number(a["expiresAt"]) <= Number(a["issuedAt"]) ||
      Number(a["expiresAt"]) - Number(a["issuedAt"]) > 300_000) {
    throw new Error("GPT02_ISSUE159_APPROVAL_LINK_BINDING_MISMATCH");
  }

  if (l["v"] !== 1 ||
      l["environment"] !== "DEV" ||
      l["audience"] !== "GPT02_DUAL_ACCOUNT_COMMAND_LINK" ||
      l["companyId"] !== a["companyId"] ||
      l["hubTaskId"] !== a["taskId"] ||
      l["coreCommandId"] !== a["commandId"] ||
      l["attemptId"] !== a["attemptId"] ||
      l["hubOperatorId"] !== a["superAdminId"] ||
      l["nonce"] !== a["nonce"] ||
      l["approvalDigest"] !== approvalDigest ||
      l["workerId"] !== WORKER ||
      !UUID.test(String(l["linkId"])) ||
      !UUID.test(String(l["hubExecutionId"])) ||
      !UUID.test(String(l["coreTaskId"])) ||
      !Number.isSafeInteger(l["coreOperatorUserId"]) ||
      Number(l["coreOperatorUserId"]) <= 0 ||
      !Number.isSafeInteger(l["issuedAt"]) ||
      !Number.isSafeInteger(l["expiresAt"]) ||
      Number(l["issuedAt"]) < Number(a["issuedAt"]) ||
      Number(l["expiresAt"]) > Number(a["expiresAt"])) {
    throw new Error("GPT02_ISSUE159_APPROVAL_LINK_BINDING_MISMATCH");
  }

  if (c["v"] !== 1 ||
      c["environment"] !== "DEV" ||
      c["audience"] !== "GPT02_ISSUER_LEASE_EVIDENCE_V1" ||
      c["companyId"] !== "default" ||
      c["companyId"] !== a["companyId"] ||
      c["hubTaskId"] !== a["taskId"] ||
      c["hubTaskId"] !== l["hubTaskId"] ||
      c["hubExecutionId"] !== l["hubExecutionId"] ||
      c["coreTaskId"] !== l["coreTaskId"] ||
      c["commandId"] !== a["commandId"] ||
      c["commandId"] !== l["coreCommandId"] ||
      c["attemptId"] !== a["attemptId"] ||
      c["attemptId"] !== l["attemptId"] ||
      c["workerId"] !== WORKER ||
      c["receiptId"] !== r["receiptId"] ||
      c["linkId"] !== l["linkId"] ||
      c["fenceId"] !== f["fenceId"] ||
      c["approvalDigest"] !== approvalDigest ||
      c["nonceDigest"] !== nonceDigest ||
      c["issuerRole"] !== ROLE ||
      c["leaseEpoch"] !== 1 ||
      !HEX.test(String(c["approvalDigest"])) ||
      !HEX.test(String(c["nonceDigest"])) ||
      !Number.isSafeInteger(c["issuedAt"]) ||
      !Number.isSafeInteger(c["expiresAt"]) ||
      Number(c["expiresAt"]) <= Number(c["issuedAt"]) ||
      Number(c["expiresAt"]) - Number(c["issuedAt"]) > 15_000 ||
      ![
        "hubExecutionId", "coreTaskId", "commandId", "attemptId",
        "receiptId", "linkId", "fenceId",
      ].every((key) => UUID.test(String(c[key])))) {
    throw new Error("GPT02_ISSUE159_ISSUER_CLAIMS_INVALID");
  }

  if (r["receiptId"] !== c["receiptId"] ||
      r["commandId"] !== c["commandId"] ||
      r["nonce"] !== a["nonce"] ||
      r["digest"] !== approvalDigest ||
      !Number.isSafeInteger(r["consumedAt"]) ||
      Number(r["consumedAt"]) < Number(a["issuedAt"]) ||
      Number(r["consumedAt"]) > input.observedAt) {
    throw new Error("GPT02_ISSUE159_NONCE_RECEIPT_BINDING_MISMATCH");
  }

  if (i["receiptId"] !== r["receiptId"] ||
      i["commandId"] !== c["commandId"] ||
      i["linkId"] !== l["linkId"] ||
      i["operatorUserId"] !== l["coreOperatorUserId"] ||
      i["hubOperatorId"] !== l["hubOperatorId"] ||
      i["linkDigest"] !== linkDigest ||
      i["bindingVerified"] !== false ||
      i["mayDispatchWorker"] !== false ||
      i["mayIssueGrant"] !== false ||
      i["mayCloseJob"] !== false ||
      i["coreLedgerWritten"] !== false) {
    throw new Error("GPT02_ISSUE159_IDENTITY_RECEIPT_BINDING_MISMATCH");
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
      Number(f["leaseExpiresAt"]) <= input.observedAt ||
      Number(f["leaseExpiresAt"]) <= Number(f["leaseStartedAt"]) ||
      Number(f["leaseExpiresAt"]) - Number(f["leaseStartedAt"]) > 15_000 ||
      Number(f["leaseExpiresAt"]) > Number(a["expiresAt"]) ||
      Number(f["leaseExpiresAt"]) > Number(l["expiresAt"])) {
    throw new Error("GPT02_ISSUE159_FENCE_BINDING_MISMATCH");
  }

  if (Number(c["issuedAt"]) < Number(f["leaseStartedAt"]) ||
      Number(c["issuedAt"]) > input.observedAt + 1000 ||
      Number(c["expiresAt"]) <= input.observedAt ||
      Number(c["expiresAt"]) > Number(f["leaseExpiresAt"])) {
    throw new Error("GPT02_ISSUE159_ISSUER_EVIDENCE_EXPIRED_OR_UNBOUND");
  }

  return Object.freeze({
    environment: "DEV" as const,
    issuerEvidenceBindingMatched: true as const,
    approvalDigestMatched: true as const,
    operatorLinkDigestMatched: true as const,
    nonceReceiptMatched: true as const,
    identityReceiptMatched: true as const,
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
