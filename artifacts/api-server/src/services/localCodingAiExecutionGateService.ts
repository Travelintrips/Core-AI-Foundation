import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
  type AiCodingRun,
  type AiCodingTask,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { executeAINoFallback, type ObservabilityContext } from "./aiExecutionService.js";
import { resolvePreferredCodingModel } from "./localCodingAiPreferredModelService.js";
import { createScheduledOllamaProviderAdapter } from "./localCodingOllamaWorkerProviderService.js";
import {
  CONSTRAINED_MODEL_CAPABILITIES,
  ProviderInvocationError,
  createConstrainedModelInvocationAdapter,
  type ConstrainedModelInvocationAdapter,
  type ConstrainedModelProvider,
  type ModelInvocationMetadata,
  type ModelTarget,
} from "./localCodingAiModelAdapterService.js";
import {
  LocalAiHandoffError,
  assertApprovedAiHandoffFresh,
  type ApprovedAiHandoffLease,
} from "./localCodingAiHandoffService.js";
import {
  parseLocalCodingAiProposalV1,
  type LocalCodingAiProposalBinding,
  type LocalCodingAiProposalV1,
} from "./localCodingAiProposalContractService.js";
import {
  computeAiProposalRepositoryHash,
  validateAiProposalPolicy,
} from "./localCodingAiProposalPolicyService.js";
import {
  applyAiProposalPatch,
  type AiPatchApplyResult,
} from "./localCodingAiPatchApplierService.js";
import {
  buildLocalCodingAiPrompt,
  type LocalCodingAiPrompt,
} from "./localCodingAiPromptBuilderService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

export type LocalCodingAiExecutionGateErrorKind =
  | "NOT_FOUND"
  | "NOT_READY"
  | "EXPIRED"
  | "REVOKED"
  | "STALE_HEAD"
  | "INVALID_CONTEXT"
  | "MODEL_UNAVAILABLE"
  | "MODEL_FAILED"
  | "INVALID_PROPOSAL"
  | "POLICY_REJECTED"
  | "APPLY_FAILED";

export class LocalCodingAiExecutionGateError extends Error {
  constructor(
    message: string,
    readonly kind: LocalCodingAiExecutionGateErrorKind,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingAiExecutionGateError";
  }
}

interface AiExecutionSnapshot {
  task: AiCodingTask;
  orchestratorRun: AiCodingRun;
  payload: Record<string, unknown>;
  runs: AiCodingRun[];
}

interface ReservedAiExecution {
  task: AiCodingTask;
  orchestratorRunId: string;
  run: AiCodingRun;
  created: boolean;
}

export interface ConstrainedAiProposalResult {
  proposal: LocalCodingAiProposalV1;
  metadata: ModelInvocationMetadata;
}

export interface ValidatedAiCandidatePatch {
  proposal: LocalCodingAiProposalV1;
  applyResult: AiPatchApplyResult;
  policyFiles: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePayload(logs: string | null): Record<string, unknown> | null {
  if (!logs) return null;
  try {
    const parsed = JSON.parse(logs) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mapHandoffError(error: LocalAiHandoffError): LocalCodingAiExecutionGateError {
  const kind: LocalCodingAiExecutionGateErrorKind =
    error.kind === "NOT_FOUND" ||
    error.kind === "NOT_READY" ||
    error.kind === "EXPIRED" ||
    error.kind === "REVOKED" ||
    error.kind === "STALE_HEAD"
      ? error.kind
      : "INVALID_CONTEXT";
  return new LocalCodingAiExecutionGateError(error.message, kind);
}

function clampTimeout(value = process.env["AI_CODING_MODEL_TIMEOUT_MS"]): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_TIMEOUT_MS;
  return Math.max(1_000, Math.min(60_000, parsed));
}

function clampOutputTokens(value = process.env["AI_CODING_MODEL_MAX_OUTPUT_TOKENS"]): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(256, Math.min(8_192, parsed));
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

async function gitHead(root: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 1_000_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  return stdout.trim().toLowerCase();
}

export function buildAiProposalBinding(
  lease: ApprovedAiHandoffLease,
): LocalCodingAiProposalBinding {
  return {
    taskId: lease.package.task.id,
    packageHash: lease.packageHash,
    baseHeadSha: lease.package.repository.baseHeadSha,
    currentPatchSha256: lease.package.currentPatch.sha256,
    allowedFiles: [...lease.package.allowedFiles],
  };
}

export function serializeBoundedModelPrompt(prompt: LocalCodingAiPrompt): string {
  return JSON.stringify({
    version: 1,
    system: prompt.system,
    user: prompt.user,
  });
}

function parseBoundedModelPrompt(input: string): { system: string; user: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    throw new ProviderInvocationError("Bounded coding model input is malformed", "BAD_REQUEST");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.system !== "string" ||
    typeof parsed.user !== "string" ||
    Object.keys(parsed).some((key) => !["version", "system", "user"].includes(key))
  ) {
    throw new ProviderInvocationError("Bounded coding model input is invalid", "BAD_REQUEST");
  }
  return { system: parsed.system, user: parsed.user };
}

function mapProviderFailure(error: unknown): ProviderInvocationError {
  if (error instanceof ProviderInvocationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/auth|api key|401|403/i.test(message)) {
    return new ProviderInvocationError("Constrained provider authentication failed", "AUTH");
  }
  if (/rate limit|quota|429/i.test(message)) {
    return new ProviderInvocationError("Constrained provider rate limit reached", "RATE_LIMIT");
  }
  if (/timeout|network|fetch failed|unavailable|502|503|504/i.test(message)) {
    return new ProviderInvocationError("Constrained provider is unavailable", "UNAVAILABLE");
  }
  if (/400|bad request|unsupported/i.test(message)) {
    return new ProviderInvocationError("Constrained provider rejected the request", "BAD_REQUEST");
  }
  return new ProviderInvocationError("Constrained provider invocation failed", "UNKNOWN");
}

export function createConstrainedCodingProviderAdapter(input: {
  providerSlug: string;
  modelId: string;
  baseUrl?: string | null;
  observability?: ObservabilityContext;
}): ConstrainedModelProvider {
  return {
    provider: input.providerSlug,
    model: input.modelId,
    capabilities: CONSTRAINED_MODEL_CAPABILITIES,
    async invoke(request, context) {
      if (request.responseFormat.type !== "text") {
        throw new ProviderInvocationError(
          "Coding proposal execution only accepts text responses",
          "BAD_REQUEST",
        );
      }
      const bounded = parseBoundedModelPrompt(request.input);
      try {
        const result = await executeAINoFallback({
          prompt: bounded.user,
          systemPrompt: bounded.system,
          model: {
            modelId: input.modelId,
            maxOutputTokens: request.maxOutputTokens,
          },
          provider: {
            slug: input.providerSlug,
            ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
          },
          temperature: 0,
          maxTokens: request.maxOutputTokens,
          signal: context.signal,
          observability: input.observability,
        });
        return {
          output: { type: "text" as const, text: result.content },
          usage: {
            inputTokens: result.promptTokens,
            outputTokens: result.completionTokens,
            totalTokens: result.tokensUsed,
          },
        };
      } catch (error) {
        throw mapProviderFailure(error);
      }
    },
  };
}

export async function invokeConstrainedAiProposal(input: {
  lease: ApprovedAiHandoffLease;
  adapter: ConstrainedModelInvocationAdapter;
  target: ModelTarget;
  requestId: string;
  prompt?: LocalCodingAiPrompt;
  timeoutMs?: number;
  maxOutputTokens?: number;
}): Promise<ConstrainedAiProposalResult> {
  const prompt = input.prompt ?? buildLocalCodingAiPrompt(input.lease);
  const response = await input.adapter.invoke({
    requestId: input.requestId,
    target: input.target,
    input: serializeBoundedModelPrompt(prompt),
    responseFormat: { type: "text" },
    maxOutputTokens: input.maxOutputTokens ?? clampOutputTokens(),
    timeoutMs: input.timeoutMs ?? clampTimeout(),
  });

  if (response.output.type !== "text") {
    throw new LocalCodingAiExecutionGateError(
      "Constrained model returned a non-text proposal",
      "MODEL_FAILED",
    );
  }

  let proposal: LocalCodingAiProposalV1;
  try {
    proposal = parseLocalCodingAiProposalV1(
      response.output.text,
      buildAiProposalBinding(input.lease),
    );
  } catch (error) {
    throw new LocalCodingAiExecutionGateError(
      "AI proposal failed Proposal Contract V1 validation: " +
        (error instanceof Error ? error.message.slice(0, 1_200) : String(error)),
      "INVALID_PROPOSAL",
    );
  }

  return { proposal, metadata: response.metadata };
}

export function buildAiProposalPolicyEnvelope(
  proposal: LocalCodingAiProposalV1,
  lease: ApprovedAiHandoffLease,
): Record<string, unknown> {
  return {
    taskId: proposal.taskId,
    packageHash: proposal.packageHash,
    repositoryHash: computeAiProposalRepositoryHash(lease.package.repository),
    repository: {
      repository: lease.package.repository.repository,
      branch: lease.package.repository.branch,
      baseHeadSha: lease.package.repository.baseHeadSha,
    },
    patchSha256: proposal.currentPatchSha256,
    operations: proposal.proposal.operations.map((operation) => ({
      kind: "patch_file",
      path: operation.file,
      payload: operation,
    })),
  };
}

export function buildAiPatchApplierProposal(
  proposal: LocalCodingAiProposalV1,
): { operations: Array<Record<string, unknown>> } {
  return {
    operations: proposal.proposal.operations.map((operation) => {
      if (operation.type === "replace_text") {
        return {
          kind: "replace_text",
          path: operation.file,
          search: operation.oldText,
          replacement: operation.newText,
          expectedOccurrences: operation.expectedOccurrences,
        };
      }
      if (operation.type === "delete_text") {
        return {
          kind: "delete_text",
          path: operation.file,
          search: operation.text,
          expectedOccurrences: operation.expectedOccurrences,
        };
      }
      if (operation.type === "insert_before") {
        return {
          kind: "replace_text",
          path: operation.file,
          search: operation.anchor,
          replacement: operation.content + operation.anchor,
          expectedOccurrences: operation.expectedOccurrences,
        };
      }
      return {
        kind: "replace_text",
        path: operation.file,
        search: operation.anchor,
        replacement: operation.anchor + operation.content,
        expectedOccurrences: operation.expectedOccurrences,
      };
    }),
  };
}

export async function validateAndApplyAiProposal(input: {
  lease: ApprovedAiHandoffLease;
  proposal: LocalCodingAiProposalV1;
  repositoryRoot: string;
  currentRepositoryHeadSha: string;
}): Promise<ValidatedAiCandidatePatch> {
  const policy = await validateAiProposalPolicy({
    proposal: buildAiProposalPolicyEnvelope(input.proposal, input.lease),
    handoff: input.lease,
    repositoryRoot: input.repositoryRoot,
    currentRepositoryHeadSha: input.currentRepositoryHeadSha,
    currentPatchSha256: input.lease.package.currentPatch.sha256,
  });

  if (!policy.ok) {
    throw new LocalCodingAiExecutionGateError(
      "AI proposal policy rejected: " +
        policy.errors.map((item) => item.code).join(", "),
      "POLICY_REJECTED",
      { errors: policy.errors },
    );
  }

  const applyResult = await applyAiProposalPatch(
    input.repositoryRoot,
    buildAiPatchApplierProposal(input.proposal),
    {
      isolatedWorkspace: true,
      expectedHeadSha: input.lease.package.repository.baseHeadSha,
      allowedFiles: input.lease.package.allowedFiles,
    },
  );

  if (applyResult.status !== "APPLIED") {
    throw new LocalCodingAiExecutionGateError(
      "Deterministic AI proposal application failed: " + applyResult.reason,
      "APPLY_FAILED",
      {
        status: applyResult.status,
        code: applyResult.code,
        rolledBack: applyResult.rolledBack,
      },
    );
  }

  return {
    proposal: input.proposal,
    applyResult,
    policyFiles: policy.files,
  };
}

async function loadSnapshot(taskId: string): Promise<AiExecutionSnapshot> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) {
    throw new LocalCodingAiExecutionGateError("Coding task not found", "NOT_FOUND");
  }

  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  const orchestratorRun = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      typeof run.logs === "string" &&
      run.logs.length > 0,
  );
  const payload = orchestratorRun ? parsePayload(orchestratorRun.logs) : null;
  if (!orchestratorRun || !payload) {
    throw new LocalCodingAiExecutionGateError(
      "Completed Coding Orchestrator payload was not found",
      "INVALID_CONTEXT",
    );
  }
  return { task, orchestratorRun, payload, runs };
}

function existingExecutionFromSnapshot(
  snapshot: AiExecutionSnapshot,
): AiCodingRun | null {
  const orchestration = isRecord(snapshot.payload.orchestration)
    ? snapshot.payload.orchestration
    : null;
  const execution = isRecord(snapshot.payload.aiExecution)
    ? snapshot.payload.aiExecution
    : null;
  const executionId =
    execution && typeof execution.executionId === "string"
      ? execution.executionId
      : "";
  if (
    !executionId ||
    !orchestration ||
    !["AI_EXECUTION_RUNNING", "REVIEW_AI_PATCH"].includes(
      typeof orchestration.nextAction === "string"
        ? orchestration.nextAction
        : "",
    )
  ) {
    return null;
  }

  return snapshot.runs.find(
    (run) =>
      run.id === executionId &&
      run.agentName === "AI Execution Gate" &&
      (run.status === "RUNNING" || run.status === "COMPLETED"),
  ) ?? null;
}

async function reserveExecution(
  taskId: string,
  lease: ApprovedAiHandoffLease,
): Promise<ReservedAiExecution> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!task) {
      throw new LocalCodingAiExecutionGateError("Coding task not found", "NOT_FOUND");
    }
    if (task.status !== "READY_REVIEW" || task.commitSha) {
      throw new LocalCodingAiExecutionGateError(
        "Coding task is not awaiting constrained AI execution",
        "NOT_READY",
      );
    }

    const runs = await tx
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.taskId, taskId))
      .orderBy(desc(aiCodingRunsTable.startedAt));

    const orchestratorRun = runs.find(
      (run) =>
        run.agentName === "Coding Orchestrator" &&
        run.status === "COMPLETED" &&
        typeof run.logs === "string" &&
        run.logs.length > 0,
    );
    const payload = orchestratorRun ? parsePayload(orchestratorRun.logs) : null;
    if (!orchestratorRun || !payload) {
      throw new LocalCodingAiExecutionGateError(
        "Completed Coding Orchestrator payload was not found",
        "INVALID_CONTEXT",
      );
    }

    const snapshot: AiExecutionSnapshot = {
      task,
      orchestratorRun,
      payload,
      runs,
    };
    const existing = existingExecutionFromSnapshot(snapshot);
    if (existing) {
      return {
        task,
        orchestratorRunId: orchestratorRun.id,
        run: existing,
        created: false,
      };
    }

    const activeRun = runs.find((run) => run.status === "RUNNING");
    if (activeRun) {
      throw new LocalCodingAiExecutionGateError(
        "Coding task already has an active run",
        "NOT_READY",
      );
    }

    const orchestration = isRecord(payload.orchestration)
      ? payload.orchestration
      : null;
    const aiHandoff = isRecord(payload.aiHandoff)
      ? payload.aiHandoff
      : null;

    if (
      orchestration?.nextAction !== "AI_HANDOFF_APPROVED" ||
      !aiHandoff ||
      aiHandoff.status !== "APPROVED" ||
      aiHandoff.gateStatus !== "EXPLICITLY_APPROVED" ||
      aiHandoff.modelInvoked === true ||
      aiHandoff.packageHash !== lease.packageHash ||
      aiHandoff.approvedAt !== lease.approvedAt ||
      aiHandoff.expiresAt !== lease.expiresAt ||
      Date.parse(lease.expiresAt) <= Date.now()
    ) {
      throw new LocalCodingAiExecutionGateError(
        "Approved AI handoff changed before execution reservation",
        "NOT_READY",
      );
    }

    const [created] = await tx
      .insert(aiCodingRunsTable)
      .values({
        taskId,
        agentName: "AI Execution Gate",
        status: "RUNNING",
        startedAt: new Date(),
      })
      .returning();

    const reservedAt = new Date().toISOString();
    const reservedPayload = {
      ...payload,
      aiExecution: {
        status: "RESERVED",
        executionId: created.id,
        packageHash: lease.packageHash,
        reservedAt,
        modelInvoked: false,
        privilegeEnded: false,
      },
      orchestration: {
        ...orchestration,
        status: "READY_REVIEW",
        nextAction: "AI_EXECUTION_RUNNING",
      },
    };

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(reservedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, orchestratorRun.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        resultSummary:
          "Constrained AI execution reserved. The approved lease will be consumed exactly once before model invocation.",
      })
      .where(eq(aiCodingTasksTable.id, taskId));

    return {
      task,
      orchestratorRunId: orchestratorRun.id,
      run: created,
      created: true,
    };
  });
}

async function consumePrivilege(
  taskId: string,
  orchestratorRunId: string,
  executionRunId: string,
  lease: ApprovedAiHandoffLease,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, taskId))
      .for("update");
    if (!task) {
      throw new LocalCodingAiExecutionGateError("Coding task not found", "NOT_FOUND");
    }

    const [orchestratorRun] = await tx
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.id, orchestratorRunId));
    const payload = orchestratorRun ? parsePayload(orchestratorRun.logs) : null;
    const orchestration = payload && isRecord(payload.orchestration)
      ? payload.orchestration
      : null;
    const execution = payload && isRecord(payload.aiExecution)
      ? payload.aiExecution
      : null;
    const handoff = payload && isRecord(payload.aiHandoff)
      ? payload.aiHandoff
      : null;

    if (
      !payload ||
      orchestration?.nextAction !== "AI_EXECUTION_RUNNING" ||
      execution?.status !== "RESERVED" ||
      execution.executionId !== executionRunId ||
      execution.packageHash !== lease.packageHash ||
      !handoff ||
      handoff.status !== "APPROVED" ||
      handoff.gateStatus !== "EXPLICITLY_APPROVED" ||
      handoff.modelInvoked === true ||
      Date.parse(lease.expiresAt) <= Date.now()
    ) {
      throw new LocalCodingAiExecutionGateError(
        "AI execution privilege is no longer valid",
        "NOT_READY",
      );
    }

    const consumedAt = new Date().toISOString();
    const consumedPayload = {
      ...payload,
      aiHandoff: {
        ...handoff,
        status: "CONSUMED",
        gateStatus: "MODEL_INVOCATION_CONSUMED",
        modelInvoked: true,
        consumedAt,
      },
      aiExecution: {
        ...execution,
        status: "MODEL_INVOKING",
        modelInvoked: true,
        privilegeEnded: true,
        consumedAt,
      },
    };

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(consumedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, orchestratorRunId));

    await tx
      .update(aiCodingRunsTable)
      .set({
        logs: JSON.stringify({
          executionStatus: "RUNNING",
          phase: "MODEL_INVOCATION",
          modelInvoked: true,
          privilegeEnded: true,
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, executionRunId));
  });
}

async function completeExecution(input: {
  reserved: ReservedAiExecution;
  lease: ApprovedAiHandoffLease;
  model: { provider: string; model: string };
  metadata: ModelInvocationMetadata;
  candidate: ValidatedAiCandidatePatch;
}): Promise<void> {
  const completedAt = new Date();
  const proposalHash = sha256Json(input.candidate.proposal);

  await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, input.reserved.task.id))
      .for("update");
    if (!task) {
      throw new LocalCodingAiExecutionGateError("Coding task not found", "NOT_FOUND");
    }

    const [orchestratorRun] = await tx
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.id, input.reserved.orchestratorRunId));
    const payload = orchestratorRun ? parsePayload(orchestratorRun.logs) : null;
    const execution = payload && isRecord(payload.aiExecution)
      ? payload.aiExecution
      : null;
    const handoff = payload && isRecord(payload.aiHandoff)
      ? payload.aiHandoff
      : null;
    const orchestration = payload && isRecord(payload.orchestration)
      ? payload.orchestration
      : {};

    if (
      !payload ||
      execution?.executionId !== input.reserved.run.id ||
      !handoff ||
      handoff.modelInvoked !== true
    ) {
      throw new LocalCodingAiExecutionGateError(
        "AI execution completion no longer matches its reserved run",
        "NOT_READY",
      );
    }

    const patch = input.candidate.applyResult;
    const completedPayload = {
      ...payload,
      aiHandoff: {
        ...handoff,
        status: "CONSUMED",
        gateStatus: "PRIVILEGE_ENDED",
        modelInvoked: true,
        privilegeEndedAt: completedAt.toISOString(),
      },
      aiExecution: {
        ...execution,
        status: "PROPOSAL_APPLIED",
        proposalVersion: 1,
        proposalHash,
        proposalSummary: input.candidate.proposal.proposal.summary,
        proposalRationale: input.candidate.proposal.proposal.rationale,
        provider: input.model.provider,
        model: input.model.model,
        metadata: input.metadata,
        policyStatus: "PASSED",
        candidatePatchSha256: patch.patchSha256,
        resultSha256: patch.resultSha256,
        changedFiles: patch.changedFiles,
        completedAt: completedAt.toISOString(),
        modelInvoked: true,
        privilegeEnded: true,
      },
      localExecution: {
        status: "APPLIED",
        reason: "Validated AI Proposal Contract V1 applied deterministically in an isolated workspace.",
        source: "AI_PROPOSAL",
        changedFiles: patch.changedFiles,
        patch: patch.patch,
        patchSha256: patch.patchSha256,
        resultSha256: patch.resultSha256,
        scriptsExecuted: false,
        networkUsed: false,
        commitCreated: false,
        pushed: false,
        rolledBack: false,
        warnings: patch.warnings,
      },
      orchestration: {
        ...orchestration,
        status: "READY_REVIEW",
        nextAction: "REVIEW_AI_PATCH",
      },
    };

    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "COMPLETED",
        finishedAt: completedAt,
        errorMessage: null,
        logs: JSON.stringify({
          executionStatus: "COMPLETED",
          proposalVersion: 1,
          proposalHash,
          provider: input.model.provider,
          model: input.model.model,
          metadata: input.metadata,
          candidatePatchSha256: patch.patchSha256,
          resultSha256: patch.resultSha256,
          changedFiles: patch.changedFiles,
          scriptsExecuted: false,
          commitCreated: false,
          pushed: false,
          privilegeEnded: true,
          nextAction: "REVIEW_AI_PATCH",
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, input.reserved.run.id));

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(completedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, input.reserved.orchestratorRunId));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary:
          "Constrained AI proposal produced a deterministic candidate patch. Human REVIEW_AI_PATCH approval is required before sandbox verification. No commit, push, merge, or repository script was executed.",
      })
      .where(eq(aiCodingTasksTable.id, input.reserved.task.id));
  });
}

async function failExecution(
  reserved: ReservedAiExecution,
  error: LocalCodingAiExecutionGateError,
  consumed: boolean,
): Promise<void> {
  const completedAt = new Date();
  await db.transaction(async (tx) => {
    const [orchestratorRun] = await tx
      .select()
      .from(aiCodingRunsTable)
      .where(eq(aiCodingRunsTable.id, reserved.orchestratorRunId));
    const payload = orchestratorRun ? parsePayload(orchestratorRun.logs) : null;
    if (!payload) return;

    const execution = isRecord(payload.aiExecution) ? payload.aiExecution : {};
    const handoff = isRecord(payload.aiHandoff) ? payload.aiHandoff : {};
    const orchestration = isRecord(payload.orchestration) ? payload.orchestration : {};

    const failedPayload = {
      ...payload,
      aiHandoff: consumed
        ? {
            ...handoff,
            status: "CONSUMED",
            gateStatus: "PRIVILEGE_ENDED",
            modelInvoked: true,
            privilegeEndedAt: completedAt.toISOString(),
          }
        : handoff,
      aiExecution: {
        ...execution,
        status: "FAILED",
        errorKind: error.kind,
        error: error.message.slice(0, 1_200),
        completedAt: completedAt.toISOString(),
        modelInvoked: consumed,
        privilegeEnded: consumed,
      },
      orchestration: {
        ...orchestration,
        status: "READY_REVIEW",
        nextAction: consumed ? "AI_REQUIRED" : "AI_HANDOFF_APPROVED",
      },
    };

    await tx
      .update(aiCodingRunsTable)
      .set({
        status: "FAILED",
        finishedAt: completedAt,
        errorMessage: error.message.slice(0, 2_000),
        logs: JSON.stringify({
          executionStatus: "FAILED",
          kind: error.kind,
          error: error.message.slice(0, 1_200),
          modelInvoked: consumed,
          privilegeEnded: consumed,
          nextAction: consumed ? "AI_REQUIRED" : "AI_HANDOFF_APPROVED",
        }, null, 2),
      })
      .where(eq(aiCodingRunsTable.id, reserved.run.id));

    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(failedPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, reserved.orchestratorRunId));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "READY_REVIEW",
        resultSummary: consumed
          ? "Constrained AI execution failed after the one-shot model privilege was consumed. A fresh AI handoff is required. " +
            error.message.slice(0, 500)
          : "Constrained AI execution failed before model privilege consumption; the approved lease remains retryable while fresh. " +
            error.message.slice(0, 500),
      })
      .where(eq(aiCodingTasksTable.id, reserved.task.id));
  }).catch(() => undefined);
}

async function executeReserved(
  reserved: ReservedAiExecution,
  lease: ApprovedAiHandoffLease,
): Promise<void> {
  let consumed = false;
  let workspacePath: string | null = null;

  try {
    const prompt = buildLocalCodingAiPrompt(lease);
    const resolvedModel = await resolvePreferredCodingModel();
    if (!resolvedModel.ok) {
      throw new LocalCodingAiExecutionGateError(
        resolvedModel.message,
        "MODEL_UNAVAILABLE",
        {
          reason: resolvedModel.reason,
          primaryFailure: resolvedModel.primaryFailure,
          fallbackFailure: resolvedModel.fallbackFailure,
        },
      );
    }

    const selected = resolvedModel.selection;
    const modelRoute = resolvedModel.route;
    const providerSlug = String(selected.provider.slug ?? "").toLowerCase();
    const modelId = String(selected.model.modelId ?? "");
    if (!providerSlug || !modelId) {
      throw new LocalCodingAiExecutionGateError(
        "Production coding model resolver returned an invalid provider/model",
        "MODEL_UNAVAILABLE",
      );
    }

    const observability: ObservabilityContext = {
      conversationId: reserved.task.id,
      agentName: "AI Execution Gate",
      providerName: providerSlug,
      modelName: modelId,
      requestType:
        modelRoute === "PRIMARY"
          ? "code-primary"
          : "code-fallback",
      createdBy: `coding-run:${reserved.run.id}`,
    };

    const selectedBaseUrl =
      typeof selected.provider.baseUrl === "string"
        ? selected.provider.baseUrl
        : null;

    const provider =
      providerSlug === "ollama" && !selectedBaseUrl
        ? createScheduledOllamaProviderAdapter({ modelId })
        : createConstrainedCodingProviderAdapter({
            providerSlug,
            modelId,
            baseUrl: selectedBaseUrl,
            observability,
          });
    const adapter = createConstrainedModelInvocationAdapter(provider);
    const target: ModelTarget = {
      provider: providerSlug,
      model: modelId,
    };

    await consumePrivilege(
      reserved.task.id,
      reserved.orchestratorRunId,
      reserved.run.id,
      lease,
    );
    consumed = true;

    const modelResult = await invokeConstrainedAiProposal({
      lease,
      adapter,
      target,
      requestId: reserved.run.id,
      prompt,
      timeoutMs: selected.timeoutMs,
      maxOutputTokens: selected.maxOutputTokens,
    });

    const workspace = await prepareRepositoryWorkspace(
      reserved.task.repository,
      reserved.task.branch,
    );
    if (!workspace.cleanup) {
      throw new LocalCodingAiExecutionGateError(
        "AI proposal application requires an isolated remote clone",
        "INVALID_CONTEXT",
      );
    }
    workspacePath = workspace.path;

    const actualHead = await gitHead(workspacePath);
    if (actualHead !== lease.package.repository.baseHeadSha.toLowerCase()) {
      throw new LocalCodingAiExecutionGateError(
        "Repository HEAD changed after AI handoff approval; candidate proposal was not applied",
        "STALE_HEAD",
      );
    }

    const candidate = await validateAndApplyAiProposal({
      lease,
      proposal: modelResult.proposal,
      repositoryRoot: workspacePath,
      currentRepositoryHeadSha: actualHead,
    });

    await completeExecution({
      reserved,
      lease,
      model: { provider: providerSlug, model: modelId },
      metadata: modelResult.metadata,
      candidate,
    });

    await logAudit(
      "coding-orchestrator",
      "ai_execution_candidate_ready",
      reserved.task.id,
      "coding_task",
      "success",
      {
        codingRunId: reserved.run.id,
        packageHash: lease.packageHash,
        provider: providerSlug,
        model: modelId,
        selectionReason: selected.selectionReason,
        timeoutMs: selected.timeoutMs,
        maxOutputTokens: selected.maxOutputTokens,
        changedFiles: candidate.applyResult.changedFiles.length,
        candidatePatchSha256: candidate.applyResult.patchSha256,
        modelInvoked: true,
        privilegeEnded: true,
        commitCreated: false,
        pushed: false,
        nextAction: "REVIEW_AI_PATCH",
      },
    );
  } catch (rawError) {
    const error =
      rawError instanceof LocalCodingAiExecutionGateError
        ? rawError
        : new LocalCodingAiExecutionGateError(
            rawError instanceof Error ? rawError.message : String(rawError),
            consumed ? "MODEL_FAILED" : "INVALID_CONTEXT",
          );

    await failExecution(reserved, error, consumed);
    await logAudit(
      "coding-orchestrator",
      "ai_execution_failed",
      reserved.task.id,
      "coding_task",
      "failure",
      {
        codingRunId: reserved.run.id,
        kind: error.kind,
        error: error.message.slice(0, 700),
        modelInvoked: consumed,
        privilegeEnded: consumed,
      },
    ).catch(() => undefined);
  } finally {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

interface PreparedAiExecution {
  run: AiCodingRun;
  execution: Promise<void> | null;
}

async function prepareAiExecution(taskId: string): Promise<PreparedAiExecution> {
  const snapshot = await loadSnapshot(taskId);
  const existing = existingExecutionFromSnapshot(snapshot);
  if (existing) {
    return { run: existing, execution: null };
  }

  let lease: ApprovedAiHandoffLease;
  try {
    lease = await assertApprovedAiHandoffFresh(taskId);
  } catch (error) {
    if (error instanceof LocalAiHandoffError) throw mapHandoffError(error);
    throw error;
  }

  const reserved = await reserveExecution(taskId, lease);
  if (!reserved.created) {
    return { run: reserved.run, execution: null };
  }

  await logAudit(
    "coding-orchestrator",
    "ai_execution_reserved",
    taskId,
    "coding_task",
    "success",
    {
      codingRunId: reserved.run.id,
      packageHash: lease.packageHash,
      modelInvoked: false,
      nextAction: "AI_EXECUTION_RUNNING",
    },
  );

  return {
    run: reserved.run,
    execution: executeReserved(reserved, lease),
  };
}

export async function startAiExecution(taskId: string): Promise<AiCodingRun> {
  const prepared = await prepareAiExecution(taskId);
  if (prepared.execution) {
    void prepared.execution;
  }
  return prepared.run;
}

export async function runAiExecutionToCompletion(
  taskId: string,
): Promise<AiCodingRun> {
  const prepared = await prepareAiExecution(taskId);

  if (!prepared.execution) {
    if (prepared.run.status === "COMPLETED" || prepared.run.status === "FAILED") {
      return prepared.run;
    }
    throw new LocalCodingAiExecutionGateError(
      "Constrained AI execution is already running in another execution context",
      "NOT_READY",
    );
  }

  await prepared.execution;

  const [finalRun] = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.id, prepared.run.id));

  if (!finalRun) {
    throw new LocalCodingAiExecutionGateError(
      "Constrained AI execution run disappeared before completion",
      "INVALID_CONTEXT",
    );
  }

  return finalRun;
}
