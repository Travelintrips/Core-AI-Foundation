import { createHash } from "node:crypto";
import {
  canonicalGpt02Issue159Approval,
} from "./gpt02Issue159FourSignerContract.js";

const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;

type Decision = {
  decisionId: string;
  claimsSha256: string;
  actorId: string;
  authMethod: "supabase_admin_session" | "supabase_aal2";
  roleAtDecision: "super_admin";
  decision: "APPROVE";
  recordedAt: number;
};

function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).sort().join(",") ===
    [...fields].sort().join(",");
}

/**
 * Validates the persisted evidence that a future approval signer must read
 * from a trusted local store. It NEVER signs and NEVER treats caller booleans
 * as authority.
 *
 * Existing approval_decisions rows do not yet contain this complete binding;
 * until that storage is upgraded, operational signing must remain disabled.
 */
export function inspectGpt02Issue159ApprovalAuthorizerEvidence(input: {
  claims: unknown;
  decision: unknown;
  observedAt: number;
}) {
  if (!exactObject(input, ["claims", "decision", "observedAt"])) {
    throw new Error("GPT02_ISSUE159_APPROVAL_AUTHORIZER_INPUT_INVALID");
  }
  const canonical = canonicalGpt02Issue159Approval(input.claims);
  const claims = input.claims as Record<string, unknown>;
  const decision = input.decision as Decision;

  if (!exactObject(decision, [
    "decisionId", "claimsSha256", "actorId", "authMethod",
    "roleAtDecision", "decision", "recordedAt",
  ])) {
    throw new Error("GPT02_ISSUE159_APPROVAL_DECISION_SHAPE_INVALID");
  }
  if (!UUID.test(decision.decisionId) ||
      !HEX.test(decision.claimsSha256) ||
      typeof decision.actorId !== "string" || !SUBJECT.test(decision.actorId) ||
      decision.actorId === "dev_approval_token" ||
      !["supabase_admin_session", "supabase_aal2"].includes(decision.authMethod) ||
      decision.roleAtDecision !== "super_admin" ||
      decision.decision !== "APPROVE" ||
      !Number.isSafeInteger(decision.recordedAt) ||
      !Number.isSafeInteger(input.observedAt)) {
    throw new Error("GPT02_ISSUE159_ADMIN_APPROVAL_REQUIRED");
  }

  const digest = createHash("sha256").update(canonical).digest("hex");
  if (decision.claimsSha256 !== digest ||
      decision.actorId !== claims["superAdminId"] ||
      claims["environment"] !== "DEV" ||
      claims["audience"] !== "GPT02_NEW_TASK_SINGLE_COMMAND_APPROVAL" ||
      decision.recordedAt < Number(claims["issuedAt"]) ||
      decision.recordedAt > Number(claims["expiresAt"]) ||
      input.observedAt < decision.recordedAt ||
      input.observedAt - decision.recordedAt > 300_000) {
    throw new Error("GPT02_ISSUE159_APPROVAL_BINDING_MISMATCH");
  }

  return Object.freeze({
    environment: "DEV" as const,
    approvalBindingMatched: true as const,
    aal2SuperAdminMatched: decision.authMethod === "supabase_aal2",
    adminApprovalMatched: true as const,
    claimsSha256: digest,
    persistedTrustedReadProven: false as const,
    privateKeyLoaded: false as const,
    signingPermitted: false as const,
    authorizationGranted: false as const,
    dispatchPermitted: false as const,
    releaseDecision: "NO_GO" as const,
  });
}
