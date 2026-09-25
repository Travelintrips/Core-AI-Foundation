export interface CodingWorkstreamAiReviewModel {
  kind: "AI_CANDIDATE";
  status: string;
  reviewStatus: string | null;
  executionId: string | null;
  proposalSummary: string | null;
  proposalRationale: string | null;
  provider: string | null;
  model: string | null;
  policyStatus: string | null;
  changedFiles: string[];
  patch: string | null;
  patchSha256: string | null;
  resultSha256: string | null;
  warnings: string[];
  scriptsExecuted: boolean | null;
  networkUsed: boolean | null;
  commitCreated: boolean | null;
  pushed: boolean | null;
  modelInvoked: boolean | null;
  privilegeEnded: boolean | null;
  metadata: Record<string, unknown> | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  completeForReview: boolean;
}

export interface CodingWorkstreamLocalReviewModel {
  kind: "LOCAL_DETERMINISTIC";
  status: string | null;
  changedFiles: string[];
  patch: string | null;
  patchSha256: string | null;
  resultSha256: string | null;
  warnings: string[];
  completeForReview: boolean;
}

export type CodingWorkstreamReviewModel =
  | CodingWorkstreamAiReviewModel
  | CodingWorkstreamLocalReviewModel;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function boolValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildCodingWorkstreamReviewModel(
  resultJson: unknown,
): CodingWorkstreamReviewModel | null {
  const result = record(resultJson);
  if (!result) return null;

  const ai = record(result.workstreamAiExecution);
  if (ai?.status === "CANDIDATE_READY") {
    const patch = stringValue(ai.patch);
    const changedFiles = stringList(ai.changedFiles);
    const patchSha256 = stringValue(ai.patchSha256);
    const resultSha256 = stringValue(ai.resultSha256);
    const policyStatus = stringValue(ai.policyStatus);
    const scriptsExecuted = boolValue(ai.scriptsExecuted);
    const networkUsed = boolValue(ai.networkUsed);
    const commitCreated = boolValue(ai.commitCreated);
    const pushed = boolValue(ai.pushed);
    const modelInvoked = boolValue(ai.modelInvoked);
    const privilegeEnded = boolValue(ai.privilegeEnded);
    const metadata = record(ai.metadata);
    const usage = record(metadata?.usage);
    const latencyMs = numberValue(metadata?.latencyMs);
    const inputTokens =
      numberValue(usage?.inputTokens) ?? numberValue(usage?.promptTokens);
    const outputTokens =
      numberValue(usage?.outputTokens) ?? numberValue(usage?.completionTokens);
    const totalTokens =
      numberValue(usage?.totalTokens) ??
      (inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : null);

    const completeForReview =
      policyStatus === "PASSED" &&
      Boolean(patch) &&
      changedFiles.length > 0 &&
      Boolean(patchSha256) &&
      Boolean(resultSha256) &&
      scriptsExecuted === false &&
      networkUsed === false &&
      commitCreated === false &&
      pushed === false &&
      modelInvoked === true &&
      privilegeEnded === true;

    return {
      kind: "AI_CANDIDATE",
      status: "CANDIDATE_READY",
      reviewStatus: stringValue(ai.reviewStatus),
      executionId: stringValue(ai.executionId),
      proposalSummary: stringValue(ai.proposalSummary),
      proposalRationale: stringValue(ai.proposalRationale),
      provider: stringValue(ai.provider),
      model: stringValue(ai.model),
      policyStatus,
      changedFiles,
      patch,
      patchSha256,
      resultSha256,
      warnings: stringList(ai.warnings),
      scriptsExecuted,
      networkUsed,
      commitCreated,
      pushed,
      modelInvoked,
      privilegeEnded,
      metadata,
      latencyMs,
      inputTokens,
      outputTokens,
      totalTokens,
      completeForReview,
    };
  }

  const local = record(result.localExecution);
  if (local) {
    const patch = stringValue(local.patch);
    const changedFiles = stringList(local.changedFiles);
    const patchSha256 = stringValue(local.patchSha256);
    const resultSha256 = stringValue(local.resultSha256);

    return {
      kind: "LOCAL_DETERMINISTIC",
      status: stringValue(local.status),
      changedFiles,
      patch,
      patchSha256,
      resultSha256,
      warnings: stringList(local.warnings),
      completeForReview:
        Boolean(patch) &&
        changedFiles.length > 0 &&
        Boolean(patchSha256 || resultSha256),
    };
  }

  return null;
}

export function codingWorkstreamReviewCanApproveAiPatch(
  model: CodingWorkstreamReviewModel | null,
): boolean {
  return Boolean(
    model &&
      model.kind === "AI_CANDIDATE" &&
      model.reviewStatus !== "APPROVED" &&
      model.completeForReview,
  );
}
