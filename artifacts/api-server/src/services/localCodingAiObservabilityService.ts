import { desc, eq } from "drizzle-orm";
import { aiCodingRunsTable, db, type AiCodingRun } from "@workspace/db";
import { getPricingForModel } from "./observabilityService.js";

export interface CodingAiExecutionTelemetry {
  taskId: string;
  executionId: string | null;
  runId: string | null;
  status: string | null;
  nextAction: string | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  packageHash: string | null;
  proposalHash: string | null;
  candidatePatchSha256: string | null;
  resultSha256: string | null;
  changedFiles: string[];
  policyStatus: string | null;
  modelInvoked: boolean;
  privilegeEnded: boolean;
  attempts: number | null;
  retries: number | null;
  fallbackUsed: boolean;
  timeoutMs: number | null;
  maxOutputTokens: number | null;
  failureKind: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  estimatedCostUsd: number | null;
}

export interface CodingAiTaskObservability {
  taskId: string;
  latest: CodingAiExecutionTelemetry | null;
  executions: CodingAiExecutionTelemetry[];
  totals: {
    executions: number;
    successful: number;
    failed: number;
    modelInvocations: number;
    totalTokens: number;
    totalLatencyMs: number;
    estimatedCostUsd: number;
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseLogs(logs: string | null): Record<string, unknown> | null {
  if (!logs) return null;
  try {
    return record(JSON.parse(logs));
  } catch {
    return null;
  }
}

function costUsd(
  inputTokens: number,
  outputTokens: number,
  pricing: { inputPer1m: number; outputPer1m: number },
): number {
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1m +
    (outputTokens / 1_000_000) * pricing.outputPer1m
  );
}

export async function parseCodingAiExecutionTelemetry(
  taskId: string,
  run: Pick<AiCodingRun, "id" | "logs" | "errorMessage">,
): Promise<CodingAiExecutionTelemetry | null> {
  const payload = parseLogs(run.logs);
  if (!payload) return null;

  const execution = record(payload.aiExecution);
  const orchestration = record(payload.orchestration);
  const metadata = record(execution?.metadata);
  const usage = record(metadata?.usage);
  const aiHandoff = record(payload.aiHandoff);

  const provider =
    stringValue(metadata?.provider) ??
    stringValue(execution?.provider);
  const model =
    stringValue(metadata?.model) ??
    stringValue(execution?.model);

  const inputTokens =
    numberValue(usage?.inputTokens) ??
    numberValue(usage?.promptTokens) ??
    0;
  const outputTokens =
    numberValue(usage?.outputTokens) ??
    numberValue(usage?.completionTokens) ??
    0;
  const totalTokens =
    numberValue(usage?.totalTokens) ??
    inputTokens + outputTokens;

  let estimatedCostUsd: number | null = null;
  if (provider && model && (inputTokens > 0 || outputTokens > 0)) {
    const pricing = await getPricingForModel(provider, model);
    estimatedCostUsd = costUsd(inputTokens, outputTokens, pricing);
  }

  const status =
    stringValue(execution?.status) ??
    stringValue(payload.executionStatus);
  const failureKind =
    stringValue(execution?.errorKind) ??
    stringValue(payload.errorKind);
  const errorMessage =
    stringValue(execution?.errorMessage) ??
    stringValue(payload.error) ??
    run.errorMessage ??
    null;

  return {
    taskId,
    executionId: stringValue(execution?.executionId),
    runId: run.id ?? null,
    status,
    nextAction: stringValue(orchestration?.nextAction),
    provider,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs: numberValue(metadata?.latencyMs),
    packageHash:
      stringValue(execution?.packageHash) ??
      stringValue(aiHandoff?.packageHash),
    proposalHash: stringValue(execution?.proposalHash),
    candidatePatchSha256: stringValue(execution?.candidatePatchSha256),
    resultSha256: stringValue(execution?.resultSha256),
    changedFiles: stringList(execution?.changedFiles),
    policyStatus: stringValue(execution?.policyStatus),
    modelInvoked:
      execution?.modelInvoked === true ||
      aiHandoff?.modelInvoked === true,
    privilegeEnded:
      execution?.privilegeEnded === true ||
      aiHandoff?.gateStatus === "PRIVILEGE_ENDED",
    attempts: numberValue(metadata?.attempts),
    retries: numberValue(metadata?.retries),
    fallbackUsed: metadata?.fallbackUsed === true,
    timeoutMs: numberValue(metadata?.timeoutMs),
    maxOutputTokens: numberValue(metadata?.maxOutputTokens),
    failureKind,
    errorMessage,
    completedAt:
      stringValue(execution?.completedAt) ??
      stringValue(metadata?.completedAt),
    estimatedCostUsd,
  };
}

export function summarizeCodingAiTelemetry(
  taskId: string,
  executions: CodingAiExecutionTelemetry[],
): CodingAiTaskObservability {
  const successful = executions.filter(
    (item) =>
      item.status === "PROPOSAL_APPLIED" ||
      item.nextAction === "REVIEW_AI_PATCH",
  ).length;
  const failed = executions.filter(
    (item) =>
      item.status === "FAILED" ||
      Boolean(item.failureKind) ||
      Boolean(item.errorMessage),
  ).length;

  return {
    taskId,
    latest: executions[0] ?? null,
    executions,
    totals: {
      executions: executions.length,
      successful,
      failed,
      modelInvocations: executions.filter((item) => item.modelInvoked).length,
      totalTokens: executions.reduce((sum, item) => sum + item.totalTokens, 0),
      totalLatencyMs: executions.reduce(
        (sum, item) => sum + (item.latencyMs ?? 0),
        0,
      ),
      estimatedCostUsd: executions.reduce(
        (sum, item) => sum + (item.estimatedCostUsd ?? 0),
        0,
      ),
    },
  };
}

export async function getCodingAiTaskObservability(
  taskId: string,
): Promise<CodingAiTaskObservability> {
  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  const executions: CodingAiExecutionTelemetry[] = [];
  for (const run of runs) {
    const parsed = await parseCodingAiExecutionTelemetry(taskId, run);
    if (
      parsed &&
      (
        parsed.executionId ||
        parsed.modelInvoked ||
        parsed.status === "PROPOSAL_APPLIED" ||
        parsed.status === "FAILED"
      )
    ) {
      executions.push(parsed);
    }
  }

  return summarizeCodingAiTelemetry(taskId, executions);
}
