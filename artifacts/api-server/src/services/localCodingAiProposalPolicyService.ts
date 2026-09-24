import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isSensitiveRepositoryPath } from "./localCodingEngineService.js";
import type {
  AiHandoffPackage,
  ApprovedAiHandoffLease,
} from "./localCodingAiHandoffService.js";

export const AI_PROPOSAL_POLICY_LIMITS = {
  maxPayloadBytes: 256_000,
  maxOperationBytes: 128_000,
  maxOperations: 32,
  maxFiles: 12,
} as const;

export const AI_PROPOSAL_OPERATION_KINDS = [
  "create_file",
  "replace_file",
  "update_file",
  "patch_file",
  "delete_file",
] as const;

export type AiProposalOperationKind =
  (typeof AI_PROPOSAL_OPERATION_KINDS)[number];

export type AiProposalPolicyCode =
  | "MALFORMED_PROPOSAL"
  | "MALFORMED_OPERATION"
  | "TASK_MISMATCH"
  | "UNKNOWN_OPERATION"
  | "PAYLOAD_OVERSIZED"
  | "TOO_MANY_FILES"
  | "TOO_MANY_OPERATIONS"
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "FILE_NOT_ALLOWED"
  | "SYMLINK_ESCAPE"
  | "SENSITIVE_FILE"
  | "REPOSITORY_MISMATCH"
  | "REPOSITORY_HASH_MISMATCH"
  | "PACKAGE_HASH_MISMATCH"
  | "BASE_SHA_MISMATCH"
  | "PATCH_SHA_MISMATCH"
  | "FORBIDDEN_SHELL"
  | "FORBIDDEN_NETWORK"
  | "FORBIDDEN_GIT_ACTION"
  | "STALE_HANDOFF"
  | "REVOKED_HANDOFF"
  | "EXPIRED_HANDOFF"
  | "HANDOFF_POLICY_INVALID";

export interface AiProposalPolicyViolation {
  code: AiProposalPolicyCode;
  message: string;
  operationIndex?: number;
  path?: string;
}

export interface AiProposalPolicyProposal {
  taskId: string;
  packageHash: string;
  repositoryHash: string;
  repository: {
    repository: string;
    branch: string;
    baseHeadSha: string;
  };
  patchSha256: string;
  operations: unknown[];
  [key: string]: unknown;
}

export interface AiProposalPolicyHandoffContext extends ApprovedAiHandoffLease {
  status?: "APPROVED" | "REVOKED";
  revokedAt?: string | null;
}

export interface ValidateAiProposalPolicyInput {
  proposal: unknown;
  handoff: AiProposalPolicyHandoffContext;
  repositoryRoot: string;
  currentRepositoryHeadSha: string;
  currentPatchSha256: string;
  now?: Date;
}

export interface ValidatedAiProposalOperation {
  kind: AiProposalOperationKind;
  path: string;
  payload: Readonly<Record<string, unknown>>;
}

export type AiProposalPolicyResult =
  | {
      ok: true;
      operations: ValidatedAiProposalOperation[];
      files: string[];
      packageHash: string;
      repositoryHash: string;
    }
  | {
      ok: false;
      errors: AiProposalPolicyViolation[];
    };

const KNOWN_OPERATION_KINDS = new Set<string>(AI_PROPOSAL_OPERATION_KINDS);
const SHA1_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function computeAiHandoffPackageHash(pkg: AiHandoffPackage): string {
  return sha256Json(pkg);
}

export function computeAiProposalRepositoryHash(repository: {
  repository: string;
  branch: string;
  baseHeadSha: string;
}): string {
  return sha256Json({
    repository: repository.repository,
    branch: repository.branch,
    baseHeadSha: repository.baseHeadSha.toLowerCase(),
  });
}

function jsonByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? Buffer.byteLength(serialized, "utf8")
      : null;
  } catch {
    return null;
  }
}

function normalizePathForPolicy(raw: string):
  | { ok: true; path: string }
  | { ok: false; code: "ABSOLUTE_PATH" | "PATH_TRAVERSAL" } {
  let decoded = raw.trim();
  if (!decoded || /[\u0000-\u001f]/.test(decoded)) {
    return { ok: false, code: "PATH_TRAVERSAL" };
  }

  for (let pass = 0; pass < 2 && /%[0-9a-f]{2}/i.test(decoded); pass += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { ok: false, code: "PATH_TRAVERSAL" };
    }
  }

  const portable = decoded.replace(/\\/g, "/");
  if (
    isAbsolute(decoded) ||
    portable.startsWith("/") ||
    portable.startsWith("//") ||
    /^[A-Za-z]:\//.test(portable)
  ) {
    return { ok: false, code: "ABSOLUTE_PATH" };
  }

  const segments = portable.split("/");
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, code: "PATH_TRAVERSAL" };
  }

  const normalized = segments
    .filter((segment) => Boolean(segment) && segment !== ".")
    .join("/");
  if (!normalized) return { ok: false, code: "PATH_TRAVERSAL" };
  return { ok: true, path: normalized };
}

function isExplicitSensitivePath(path: string): boolean {
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  const name = segments.at(-1) ?? "";

  if (
    segments.some((segment) =>
      [".env", ".secrets", "secret", "secrets", "credentials", ".credentials"].includes(
        segment,
      ),
    )
  ) {
    return true;
  }
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.|$)/.test(name)) return true;
  if (/\.(?:pem|key|p12|pfx|crt|cer|der|jks|keystore)$/i.test(name)) return true;
  if (/(?:^|[-_.])(secret|secrets|credential|credentials|private[-_.]?key)(?:[-_.]|$)/i.test(name)) {
    return true;
  }
  return isSensitiveRepositoryPath(path);
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(".." + sep));
}

async function pathEscapesThroughSymlink(
  repositoryRoot: string,
  path: string,
): Promise<boolean> {
  const root = await realpath(resolve(repositoryRoot)).catch(() => null);
  if (!root) return true;

  const lexicalCandidate = resolve(root, path);
  if (!insideRoot(root, lexicalCandidate)) return true;

  let prefix = root;
  for (const segment of path.split("/")) {
    prefix = resolve(prefix, segment);
    const info = await lstat(prefix).catch(() => null);
    if (!info) break;

    const actual = await realpath(prefix).catch(() => null);
    if (!actual || !insideRoot(root, actual)) return true;
  }
  return false;
}

function forbiddenControlViolation(
  value: unknown,
): "FORBIDDEN_SHELL" | "FORBIDDEN_NETWORK" | "FORBIDDEN_GIT_ACTION" | null {
  const visit = (current: unknown): ReturnType<typeof forbiddenControlViolation> => {
    if (typeof current === "string") {
      const lower = current.toLowerCase();
      if (/\bgit\s+(?:commit|push|merge|rebase|reset|checkout|switch|cherry-pick)\b/.test(lower)) {
        return "FORBIDDEN_GIT_ACTION";
      }
      if (/\b(?:commit|push|merge)\s+(?:the\s+)?(?:changes|branch|commit|repository|repo)\b/.test(lower)) {
        return "FORBIDDEN_GIT_ACTION";
      }
      if (/\b(?:curl|wget|ssh|scp|nc|netcat)\b/.test(lower)) return "FORBIDDEN_NETWORK";
      if (/\b(?:bash|sh|powershell|cmd\.exe)\b/.test(lower)) return "FORBIDDEN_SHELL";
      return null;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        const violation = visit(item);
        if (violation) return violation;
      }
      return null;
    }

    if (!isRecord(current)) return null;
    for (const [key, child] of Object.entries(current)) {
      const lowerKey = key.toLowerCase();
      if (/^(?:tool|tools|capability|capabilities|requires|permissions)$/.test(lowerKey)) {
        const controlText = JSON.stringify(child)?.toLowerCase() ?? "";
        if (/\bgit\b/.test(controlText)) return "FORBIDDEN_GIT_ACTION";
        if (/\b(?:network|http|https|curl|wget|socket)\b/.test(controlText)) return "FORBIDDEN_NETWORK";
        if (/\b(?:shell|bash|powershell|cmd\.exe)\b/.test(controlText)) return "FORBIDDEN_SHELL";
      }
      if (/^(?:commit|push|merge)$/.test(lowerKey) && child !== false && child !== null) {
        return "FORBIDDEN_GIT_ACTION";
      }
      if (/^(?:git|gitcommand|gitcommands)$/.test(lowerKey) && child !== false && child !== null) {
        return "FORBIDDEN_GIT_ACTION";
      }
      if (/^(?:network|networkaccess|http|https|url|urls|fetch|curl|wget|socket)$/.test(lowerKey) && child !== false && child !== null) {
        return "FORBIDDEN_NETWORK";
      }
      if (/^(?:shell|shellaccess|command|commands|exec|spawn|bash|powershell)$/.test(lowerKey) && child !== false && child !== null) {
        return "FORBIDDEN_SHELL";
      }
      const violation = visit(child);
      if (violation) return violation;
    }
    return null;
  };

  return visit(value);
}

function pushError(
  errors: AiProposalPolicyViolation[],
  code: AiProposalPolicyCode,
  message: string,
  operationIndex?: number,
  path?: string,
): void {
  if (
    errors.some(
      (item) =>
        item.code === code &&
        item.operationIndex === operationIndex &&
        item.path === path,
    )
  ) {
    return;
  }
  errors.push({
    code,
    message,
    ...(operationIndex === undefined ? {} : { operationIndex }),
    ...(path === undefined ? {} : { path }),
  });
}

function handoffPolicyIsFailClosed(pkg: AiHandoffPackage): boolean {
  return (
    pkg.policy.readOnlyContext === true &&
    pkg.policy.repositoryAccess === false &&
    pkg.policy.networkAccess === false &&
    pkg.policy.shellAccess === false &&
    pkg.policy.secretAccess === false &&
    pkg.policy.sourceWrite === false &&
    pkg.policy.commitPushMerge === false &&
    pkg.policy.modelInvoked === false &&
    pkg.policy.requiresExplicitApprovalBeforeModel === true &&
    pkg.policy.allowedFilesOnly === true
  );
}

export async function validateAiProposalPolicy(
  input: ValidateAiProposalPolicyInput,
): Promise<AiProposalPolicyResult> {
  const errors: AiProposalPolicyViolation[] = [];
  const now = input.now ?? new Date();
  const handoff = input.handoff;
  const pkg = handoff.package;

  if (handoff.status === "REVOKED" || Boolean(handoff.revokedAt)) {
    pushError(errors, "REVOKED_HANDOFF", "AI handoff approval has been revoked.");
  }

  const approvedAt = Date.parse(handoff.approvedAt);
  const expiresAt = Date.parse(handoff.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    pushError(errors, "EXPIRED_HANDOFF", "AI handoff approval lease is expired or invalid.");
  }
  if (
    !Number.isFinite(approvedAt) ||
    approvedAt > now.getTime() ||
    (Number.isFinite(expiresAt) && approvedAt >= expiresAt)
  ) {
    pushError(errors, "STALE_HANDOFF", "AI handoff approval timestamps are stale or invalid.");
  }

  if (!handoffPolicyIsFailClosed(pkg)) {
    pushError(errors, "HANDOFF_POLICY_INVALID", "Approved handoff policy is not fail-closed.");
  }

  const computedPackageHash = computeAiHandoffPackageHash(pkg);
  if (
    !SHA256_PATTERN.test(handoff.packageHash) ||
    handoff.packageHash.toLowerCase() !== computedPackageHash
  ) {
    pushError(errors, "PACKAGE_HASH_MISMATCH", "Approved handoff package hash does not match its package.");
  }

  if (
    !SHA1_PATTERN.test(input.currentRepositoryHeadSha) ||
    input.currentRepositoryHeadSha.toLowerCase() !== pkg.repository.baseHeadSha.toLowerCase()
  ) {
    pushError(errors, "STALE_HANDOFF", "Repository HEAD no longer matches the approved handoff.");
  }
  if (
    !SHA256_PATTERN.test(input.currentPatchSha256) ||
    input.currentPatchSha256.toLowerCase() !== pkg.currentPatch.sha256.toLowerCase()
  ) {
    pushError(errors, "STALE_HANDOFF", "Current patch no longer matches the approved handoff.");
  }

  if (!isRecord(input.proposal)) {
    pushError(errors, "MALFORMED_PROPOSAL", "Proposal must be a JSON object.");
    return { ok: false, errors };
  }

  const proposal = input.proposal;
  const proposalBytes = jsonByteLength(proposal);
  if (proposalBytes === null) {
    pushError(errors, "MALFORMED_PROPOSAL", "Proposal must be deterministically JSON serializable.");
    return { ok: false, errors };
  }
  if (proposalBytes > AI_PROPOSAL_POLICY_LIMITS.maxPayloadBytes) {
    pushError(errors, "PAYLOAD_OVERSIZED", "Proposal payload exceeds the policy byte limit.");
  }

  const forbidden = forbiddenControlViolation(proposal);
  if (forbidden) {
    pushError(
      errors,
      forbidden,
      forbidden === "FORBIDDEN_GIT_ACTION"
        ? "Proposal requests a forbidden git/commit/push/merge action."
        : forbidden === "FORBIDDEN_NETWORK"
          ? "Proposal requests forbidden network access."
          : "Proposal requests forbidden shell execution.",
    );
  }

  const proposalTaskId = typeof proposal.taskId === "string" ? proposal.taskId : "";
  if (!proposalTaskId || proposalTaskId !== pkg.task.id) {
    pushError(errors, "TASK_MISMATCH", "Proposal taskId does not match the approved handoff.");
  }

  const proposalPackageHash =
    typeof proposal.packageHash === "string" ? proposal.packageHash.toLowerCase() : "";
  if (
    !SHA256_PATTERN.test(proposalPackageHash) ||
    proposalPackageHash !== handoff.packageHash.toLowerCase()
  ) {
    pushError(errors, "PACKAGE_HASH_MISMATCH", "Proposal packageHash does not match the approved handoff.");
  }

  const expectedRepositoryHash = computeAiProposalRepositoryHash(pkg.repository);
  const proposalRepositoryHash =
    typeof proposal.repositoryHash === "string" ? proposal.repositoryHash.toLowerCase() : "";
  if (
    !SHA256_PATTERN.test(proposalRepositoryHash) ||
    proposalRepositoryHash !== expectedRepositoryHash
  ) {
    pushError(errors, "REPOSITORY_HASH_MISMATCH", "Proposal repositoryHash does not match the approved handoff.");
  }

  const proposalRepository = isRecord(proposal.repository) ? proposal.repository : null;
  if (
    !proposalRepository ||
    proposalRepository.repository !== pkg.repository.repository ||
    proposalRepository.branch !== pkg.repository.branch
  ) {
    pushError(errors, "REPOSITORY_MISMATCH", "Proposal repository/branch does not match the approved handoff.");
  }

  const proposalBaseSha =
    proposalRepository && typeof proposalRepository.baseHeadSha === "string"
      ? proposalRepository.baseHeadSha.toLowerCase()
      : "";
  if (
    !SHA1_PATTERN.test(proposalBaseSha) ||
    proposalBaseSha !== pkg.repository.baseHeadSha.toLowerCase()
  ) {
    pushError(errors, "BASE_SHA_MISMATCH", "Proposal base SHA does not match the approved handoff.");
  }

  const proposalPatchSha =
    typeof proposal.patchSha256 === "string" ? proposal.patchSha256.toLowerCase() : "";
  if (
    !SHA256_PATTERN.test(proposalPatchSha) ||
    proposalPatchSha !== pkg.currentPatch.sha256.toLowerCase()
  ) {
    pushError(errors, "PATCH_SHA_MISMATCH", "Proposal patch SHA does not match the approved handoff.");
  }

  const allowedFiles = new Set<string>();
  for (const rawAllowed of pkg.allowedFiles) {
    const normalized = normalizePathForPolicy(rawAllowed);
    if (!normalized.ok || isExplicitSensitivePath(normalized.path)) {
      pushError(errors, "HANDOFF_POLICY_INVALID", "Approved handoff contains an unsafe allowedFiles entry.");
      continue;
    }
    allowedFiles.add(normalized.path);
  }
  if (allowedFiles.size > AI_PROPOSAL_POLICY_LIMITS.maxFiles) {
    pushError(errors, "HANDOFF_POLICY_INVALID", "Approved handoff exceeds the allowed file bound.");
  }

  if (!Array.isArray(proposal.operations)) {
    pushError(errors, "MALFORMED_PROPOSAL", "Proposal operations must be an array.");
    return { ok: false, errors };
  }
  if (proposal.operations.length > AI_PROPOSAL_POLICY_LIMITS.maxOperations) {
    pushError(errors, "TOO_MANY_OPERATIONS", "Proposal contains too many operations.");
  }

  const validated: ValidatedAiProposalOperation[] = [];
  const files = new Set<string>();
  const operationsToInspect = proposal.operations.slice(
    0,
    AI_PROPOSAL_POLICY_LIMITS.maxOperations + 1,
  );

  for (let index = 0; index < operationsToInspect.length; index += 1) {
    const operation = operationsToInspect[index];
    if (!isRecord(operation)) {
      pushError(errors, "MALFORMED_OPERATION", "Operation must be a JSON object.", index);
      continue;
    }

    const operationBytes = jsonByteLength(operation);
    if (operationBytes === null) {
      pushError(errors, "MALFORMED_OPERATION", "Operation must be JSON serializable.", index);
      continue;
    }
    if (operationBytes > AI_PROPOSAL_POLICY_LIMITS.maxOperationBytes) {
      pushError(errors, "PAYLOAD_OVERSIZED", "Operation payload exceeds the policy byte limit.", index);
    }

    const rawKind =
      typeof operation.kind === "string"
        ? operation.kind
        : typeof operation.type === "string"
          ? operation.type
          : typeof operation.operation === "string"
            ? operation.operation
            : "";
    if (!KNOWN_OPERATION_KINDS.has(rawKind)) {
      pushError(errors, "UNKNOWN_OPERATION", "Operation kind is not allowlisted.", index);
      continue;
    }

    const rawPath = typeof operation.path === "string" ? operation.path : "";
    if (!rawPath) {
      pushError(errors, "MALFORMED_OPERATION", "Operation path is required.", index);
      continue;
    }

    const normalized = normalizePathForPolicy(rawPath);
    if (!normalized.ok) {
      pushError(
        errors,
        normalized.code,
        normalized.code === "ABSOLUTE_PATH"
          ? "Absolute file paths are forbidden."
          : "Path traversal is forbidden.",
        index,
        rawPath,
      );
      continue;
    }

    const path = normalized.path;
    files.add(path);
    if (isExplicitSensitivePath(path)) {
      pushError(errors, "SENSITIVE_FILE", "Sensitive files cannot be modified by an AI proposal.", index, path);
      continue;
    }
    if (!allowedFiles.has(path)) {
      pushError(errors, "FILE_NOT_ALLOWED", "File is outside the approved allowedFiles set.", index, path);
      continue;
    }
    if (await pathEscapesThroughSymlink(input.repositoryRoot, path)) {
      pushError(errors, "SYMLINK_ESCAPE", "File path resolves outside the repository through a symlink or unsafe root.", index, path);
      continue;
    }

    const operationForbidden = forbiddenControlViolation(operation);
    if (operationForbidden) {
      pushError(
        errors,
        operationForbidden,
        "Operation contains a forbidden execution capability request.",
        index,
        path,
      );
      continue;
    }

    validated.push({
      kind: rawKind as AiProposalOperationKind,
      path,
      payload: Object.freeze({ ...operation }),
    });
  }

  if (files.size > AI_PROPOSAL_POLICY_LIMITS.maxFiles) {
    pushError(errors, "TOO_MANY_FILES", "Proposal touches too many unique files.");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    operations: validated,
    files: [...files].sort(),
    packageHash: handoff.packageHash.toLowerCase(),
    repositoryHash: expectedRepositoryHash,
  };
}
