import { createHash } from "node:crypto";
import {
  canonicalGpt02Issue159OperatorLink,
} from "./gpt02Issue159FourSignerContract.js";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const HEX = /^[0-9a-f]{64}$/;

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).sort().join(",") ===
    [...fields].sort().join(",");
}

export function inspectGpt02Issue159OperatorAuthorizerEvidence(input: {
  role: "hub" | "core";
  claims: unknown;
  evidence: unknown;
  observedAt: number;
}) {
  if (!exactObject(input, ["role", "claims", "evidence", "observedAt"]) ||
      !["hub", "core"].includes(input.role) ||
      !Number.isSafeInteger(input.observedAt)) {
    throw new Error("GPT02_ISSUE159_OPERATOR_AUTHORIZER_INPUT_INVALID");
  }

  const canonical = canonicalGpt02Issue159OperatorLink(input.claims);
  const claims = input.claims as Record<string, unknown>;
  const digest = createHash("sha256").update(canonical).digest("hex");

  if (!Number.isSafeInteger(claims["issuedAt"]) ||
      !Number.isSafeInteger(claims["expiresAt"]) ||
      input.observedAt < Number(claims["issuedAt"]) ||
      input.observedAt > Number(claims["expiresAt"])) {
    throw new Error("GPT02_ISSUE159_OPERATOR_EVIDENCE_EXPIRED");
  }

  if (input.role === "hub") {
    if (!exactObject(input.evidence, [
      "namespace", "operatorId", "operatorRole", "active",
      "hubTaskId", "hubExecutionId", "commandCandidateId", "attemptId", "linkId",
      "assignmentAuditAction", "assignmentAuditEntityId",
      "assignmentActorId", "assignmentActorRole", "assignmentActorActive",
      "approvalDigest", "claimsSha256", "observedAt",
    ])) {
      throw new Error("GPT02_ISSUE159_HUB_EVIDENCE_SHAPE_INVALID");
    }
    const e = input.evidence;
    if (e["namespace"] !== "ai-task-hub.public.users" ||
        e["operatorId"] !== claims["hubOperatorId"] ||
        e["operatorRole"] !== "super_admin" ||
        e["active"] !== true ||
        e["hubTaskId"] !== claims["hubTaskId"] ||
        e["hubExecutionId"] !== claims["hubExecutionId"] ||
        e["commandCandidateId"] !== claims["coreCommandId"] ||
        e["attemptId"] !== claims["attemptId"] ||
        e["linkId"] !== claims["linkId"] ||
        e["assignmentAuditAction"] !== "gpt02_pic_assigned" ||
        e["assignmentAuditEntityId"] !== String(claims["hubTaskId"]) ||
        e["assignmentActorId"] !== claims["hubOperatorId"] ||
        e["assignmentActorRole"] !== "super_admin" ||
        e["assignmentActorActive"] !== true ||
        e["approvalDigest"] !== claims["approvalDigest"] ||
        e["claimsSha256"] !== digest ||
        e["observedAt"] !== input.observedAt ||
        !UUID.test(String(e["hubExecutionId"])) ||
        !UUID.test(String(e["commandCandidateId"])) ||
        !UUID.test(String(e["attemptId"])) ||
        !UUID.test(String(e["linkId"])) ||
        !HEX.test(String(e["approvalDigest"]))) {
      throw new Error("GPT02_ISSUE159_HUB_IDENTITY_BINDING_MISMATCH");
    }
  } else {
    if (!exactObject(input.evidence, [
      "namespace", "operatorUserId", "operatorRole", "active",
      "passwordChanged", "coreTaskId", "coreCommandId", "attemptId",
      "taskStatus", "runCount", "commandCount", "workerId",
      "linkId", "claimsSha256", "observedAt",
    ])) {
      throw new Error("GPT02_ISSUE159_CORE_EVIDENCE_SHAPE_INVALID");
    }
    const e = input.evidence;
    if (e["namespace"] !== "ai-core.ai_platform.internal_users" ||
        e["operatorUserId"] !== claims["coreOperatorUserId"] ||
        !["owner", "admin"].includes(String(e["operatorRole"])) ||
        e["operatorRole"] !== claims["coreRole"] ||
        e["active"] !== true ||
        e["passwordChanged"] !== true ||
        e["coreTaskId"] !== claims["coreTaskId"] ||
        e["coreCommandId"] !== claims["coreCommandId"] ||
        e["attemptId"] !== claims["attemptId"] ||
        e["taskStatus"] !== "PENDING" ||
        e["runCount"] !== 0 ||
        e["commandCount"] !== 0 ||
        e["workerId"] !== "openclaw-dell-chatgpt-wake-dev" ||
        e["workerId"] !== claims["workerId"] ||
        e["linkId"] !== claims["linkId"] ||
        e["claimsSha256"] !== digest ||
        e["observedAt"] !== input.observedAt ||
        !UUID.test(String(e["coreTaskId"])) ||
        !UUID.test(String(e["coreCommandId"])) ||
        !UUID.test(String(e["attemptId"])) ||
        !UUID.test(String(e["linkId"]))) {
      throw new Error("GPT02_ISSUE159_CORE_IDENTITY_BINDING_MISMATCH");
    }
  }

  return Object.freeze({
    environment: "DEV" as const,
    role: input.role,
    operatorBindingMatched: true as const,
    claimsSha256: digest,
    persistedTrustedReadProven: false as const,
    privateKeyLoaded: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
