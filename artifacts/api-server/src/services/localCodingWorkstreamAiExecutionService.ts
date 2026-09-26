import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  aiCodingTaskGraphsTable,
  aiCodingTasksTable,
  aiCodingWorkstreamAiHandoffsTable,
  aiCodingWorkstreamsTable,
  aiJobsTable,
  db,
  type AiCodingWorkstream,
  type AiJob,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { computePriorityScore } from "./priorityEngine.js";
import {
  type AiHandoffPackage,
  type ApprovedAiHandoffLease,
  type AiHandoffSnippet,
} from "./localCodingAiHandoffService.js";
import {
  approveWorkstreamAiHandoff,
  assertApprovedWorkstreamAiHandoffFresh,
  consumeApprovedWorkstreamAiHandoff,
  LocalCodingWorkstreamAiHandoffError,
  prepareWorkstreamAiHandoff,
  revokeWorkstreamAiHandoff,
  type ApprovedWorkstreamAiHandoffLease,
} from "./localCodingWorkstreamAiHandoffService.js";
import {
  buildCodingWorkstreamBranchName,
  heartbeatCodingWorkstreamClaim,
  startCodingWorkstreamClaim,
} from "./localCodingMultiWorkerOrchestratorService.js";
import { codingWorkstreamOwnsFile } from "./localCodingMultiWorkerExecutionService.js";
import {
  createConstrainedCodingProviderAdapter,
  invokeConstrainedAiProposal,
  validateAndApplyAiProposal,
} from "./localCodingAiExecutionGateService.js";
import { createConstrainedModelInvocationAdapter } from "./localCodingAiModelAdapterService.js";
import { resolvePreferredCodingModel } from "./localCodingAiPreferredModelService.js";
import { buildLocalCodingAiPrompt } from "./localCodingAiPromptBuilderService.js";
import { computeAiHandoffPackageHash } from "./localCodingAiProposalPolicyService.js";
import {
  isSensitiveRepositoryPath,
  type GitCommitContext,
  type ImportReference,
  type LocalSymbol,
} from "./localCodingEngineService.js";
import { prepareRepositoryWorkspace } from "./repositoryAnalyzerService.js";

const execFileAsync = promisify(execFile);

export const CODING_WORKSTREAM_AI_JOB_TYPE = "coding_workstream_ai_execution";
export const CODING_WORKSTREAM_AI_CAPABILITY = "coding_ai_execution";
const AI_PHASE_WORKER_ID = "coding-workstream-ai-control";
const AI_PHASE_LEASE_MS = 60 * 60 * 1_000;
const AI_PHASE_HEARTBEAT_MS = 30_000;
const MAX_ALLOWED_FILES = 12;
const MAX_SNIPPETS = 5;
const MAX_FILE_BYTES = 250_000;
const MAX_SNIPPET_CHARS = 6_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA64_RE = /^[0-9a-f]{64}$/i;

export type WorkstreamAiExecutionErrorCode =
  | "NOT_FOUND"
  | "NOT_READY"
  | "INVALID_CONTEXT"
  | "STALE_CONTEXT"
  | "LEASE_LOST"
  | "MODEL_UNAVAILABLE"
  | "MODEL_FAILED"
  | "POLICY_REJECTED";

export class LocalCodingWorkstreamAiExecutionError extends Error {
  constructor(
    message: string,
    readonly code: WorkstreamAiExecutionErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingWorkstreamAiExecutionError";
  }
}

interface WorkstreamAiJobPayload {
  graphId: string;
  workstreamId: string;
  childTaskId: string;
  claimAttempt: number;
  leaseToken: string;
  authorizationPackageHash: string;
  analyzerResultHash: string;
  requestedBy?: string;
}

interface LoadedExecutionContext {
  workstream: AiCodingWorkstream;
  graphTaskId: string;
  childTask: {
    id: string;
    repository: string;
    branch: string;
    projectName: string;
    instruction: string;
  };
  analyzerResult: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => JSON.stringify(key) + ":" + stableStringify(record[key]))
      .join(",") +
    "}"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashWorkstreamAnalyzerResult(value: unknown): string {
  return sha256(stableStringify(value));
}

export function isAnalyzerBranchFromPriorWorkstreamAttempt(
  taskId: string,
  workstreamKey: string,
  analyzerBranch: string,
  currentAttempt: number,
): boolean {
  if (!Number.isInteger(currentAttempt) || currentAttempt <= 1) return false;
  for (let attempt = 1; attempt < currentAttempt; attempt += 1) {
    if (buildCodingWorkstreamBranchName(taskId, workstreamKey, attempt) === analyzerBranch) return true;
  }
  return false;
}

function normalizeRepoPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized.includes("\0") ||
    isSensitiveRepositoryPath(normalized)
  ) {
    return null;
  }
  return normalized;
}

function insideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(".." + sep));
}

function localExecutionPlanRequiresAi(result: Record<string, unknown>): boolean {
  const plan = isRecord(result.localExecutionPlan) ? result.localExecutionPlan : null;
  return plan?.status === "AI_REQUIRED";
}

function pendingAiCandidate(result: Record<string, unknown>): boolean {
  const execution = isRecord(result.workstreamAiExecution)
    ? result.workstreamAiExecution
    : null;
  return (
    execution?.status === "CANDIDATE_READY" &&
    execution?.nextAction === "REVIEW_AI_PATCH" &&
    execution?.reviewStatus !== "APPROVED"
  );
}

async function recoverExpiredAiControlClaim(workstreamId: string): Promise<void> {
  const [current] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));

  if (
    !current ||
    !["CLAIMED", "RUNNING"].includes(current.status) ||
    current.workerId !== AI_PHASE_WORKER_ID ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt.getTime() > Date.now()
  ) {
    return;
  }

  await revokeWorkstreamAiHandoff(workstreamId).catch((error) => {
    if (
      error instanceof LocalCodingWorkstreamAiHandoffError &&
      ["NOT_FOUND", "CONSUMED", "REVOKED"].includes(error.code)
    ) {
      return;
    }
    throw error;
  });

  await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "REVIEW_REQUIRED",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
    })
    .where(
      and(
        eq(aiCodingWorkstreamsTable.id, workstreamId),
        eq(aiCodingWorkstreamsTable.workerId, AI_PHASE_WORKER_ID),
        inArray(aiCodingWorkstreamsTable.status, ["CLAIMED", "RUNNING"]),
      ),
    );
}

async function claimWorkstreamForAi(
  workstreamId: string,
): Promise<AiCodingWorkstream> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AI_PHASE_LEASE_MS);
  const lockKey = "coding-workstream-ai-claim:" + workstreamId;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");
    if (!workstream) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Coding workstream not found.",
        "NOT_FOUND",
      );
    }
    if (workstream.status !== "REVIEW_REQUIRED") {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Only a REVIEW_REQUIRED workstream can enter the constrained AI phase.",
        "NOT_READY",
        { status: workstream.status },
      );
    }
    if (!workstream.childTaskId || !workstream.childRunId) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream is missing its child coding task/run binding.",
        "INVALID_CONTEXT",
      );
    }
    if (!SHA40_RE.test(workstream.baseSha ?? "")) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream is missing the analyzer base Git SHA.",
        "INVALID_CONTEXT",
      );
    }

    const result = isRecord(workstream.resultJson)
      ? workstream.resultJson
      : null;
    if (!result || !localExecutionPlanRequiresAi(result)) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream analyzer did not classify this task as AI_REQUIRED.",
        "NOT_READY",
      );
    }
    if (pendingAiCandidate(result)) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream already has an AI candidate patch awaiting explicit review.",
        "NOT_READY",
      );
    }

    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
    if (!graph) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }
    if (!["APPROVED", "RUNNING"].includes(graph.status)) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Coding task graph is not active for constrained AI work.",
        "NOT_READY",
        { graphStatus: graph.status },
      );
    }

    const attempt = workstream.attemptCount + 1;
    const leaseToken = randomUUID();
    const branchName = buildCodingWorkstreamBranchName(
      graph.taskId,
      workstream.workstreamKey,
      attempt,
    );

    const [claimed] = await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "CLAIMED",
        workerId: AI_PHASE_WORKER_ID,
        leaseToken,
        leaseExpiresAt: expiresAt,
        heartbeatAt: now,
        claimedAt: now,
        branchName,
        attemptCount: attempt,
        errorMessage: null,
      })
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstream.id),
          eq(aiCodingWorkstreamsTable.status, "REVIEW_REQUIRED"),
        ),
      )
      .returning();

    if (!claimed) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream AI-phase claim lost a concurrent update.",
        "LEASE_LOST",
      );
    }
    return claimed;
  });
}

async function releaseAiClaim(
  workstreamId: string,
  leaseToken: string | null,
  resultJson?: Record<string, unknown>,
  errorMessage?: string | null,
): Promise<void> {
  const now = new Date();
  const conditions = [
    eq(aiCodingWorkstreamsTable.id, workstreamId),
    inArray(aiCodingWorkstreamsTable.status, ["CLAIMED", "RUNNING"]),
  ];
  if (leaseToken) {
    conditions.push(eq(aiCodingWorkstreamsTable.leaseToken, leaseToken));
  }

  await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "REVIEW_REQUIRED",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      ...(resultJson ? { resultJson } : {}),
      ...(errorMessage !== undefined ? { errorMessage } : {}),
    })
    .where(and(...conditions));
}

export async function prepareWorkstreamAiExecutionHandoff(
  workstreamId: string,
): Promise<{
  handoffId: string;
  packageHash: string;
  status: string;
  claimAttempt: number;
  branchName: string;
  leaseExpiresAt: string;
  package: unknown;
}> {
  await recoverExpiredAiControlClaim(workstreamId);
  const claimed = await claimWorkstreamForAi(workstreamId);

  try {
    const prepared = await prepareWorkstreamAiHandoff(workstreamId);
    await logAudit(
      "coding-multi-worker",
      "workstream_ai_handoff_prepared",
      workstreamId,
      "coding_workstream",
      "success",
      {
        graphId: claimed.graphId,
        claimAttempt: claimed.attemptCount,
        packageHash: prepared.handoff.packageHash,
        modelInvoked: false,
      },
    ).catch(() => undefined);

    return {
      handoffId: prepared.handoff.id,
      packageHash: prepared.handoff.packageHash,
      status: prepared.handoff.status,
      claimAttempt: claimed.attemptCount,
      branchName: claimed.branchName ?? "",
      leaseExpiresAt: claimed.leaseExpiresAt!.toISOString(),
      package: prepared.handoff.packageJson,
    };
  } catch (error) {
    await releaseAiClaim(
      workstreamId,
      claimed.leaseToken,
      undefined,
      error instanceof Error ? error.message.slice(0, 2_000) : String(error),
    ).catch(() => undefined);
    throw error;
  }
}

export async function approveWorkstreamAiExecutionHandoff(
  workstreamId: string,
  handoffId: string,
): Promise<ApprovedWorkstreamAiHandoffLease> {
  const lease = await approveWorkstreamAiHandoff(workstreamId, handoffId);
  const now = new Date();
  const extension = new Date(Date.parse(lease.expiresAt) + 30_000);

  const [current] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));
  const leaseToken = current?.leaseToken ?? null;

  const [extended] = leaseToken
    ? await db
        .update(aiCodingWorkstreamsTable)
        .set({ leaseExpiresAt: extension, heartbeatAt: now })
        .where(
          and(
            eq(aiCodingWorkstreamsTable.id, workstreamId),
            eq(aiCodingWorkstreamsTable.attemptCount, lease.claimAttempt),
            eq(aiCodingWorkstreamsTable.leaseToken, leaseToken),
            inArray(aiCodingWorkstreamsTable.status, ["CLAIMED", "RUNNING"]),
            sql`${aiCodingWorkstreamsTable.leaseExpiresAt} > ${now}`,
          ),
        )
        .returning()
    : [];

  if (!extended) {
    await revokeWorkstreamAiHandoff(workstreamId).catch(() => undefined);
    throw new LocalCodingWorkstreamAiExecutionError(
      "Workstream claim expired while the AI handoff was being approved.",
      "LEASE_LOST",
    );
  }

  await logAudit(
    "coding-multi-worker",
    "workstream_ai_handoff_approved",
    workstreamId,
    "coding_workstream",
    "success",
    {
      handoffId: lease.handoffId,
      claimAttempt: lease.claimAttempt,
      packageHash: lease.packageHash,
      expiresAt: lease.expiresAt,
      modelInvoked: false,
    },
  ).catch(() => undefined);

  return lease;
}

export async function revokeWorkstreamAiExecutionHandoff(
  workstreamId: string,
): Promise<{ status: string; revokedAt: string | null }> {
  const revoked = await revokeWorkstreamAiHandoff(workstreamId);
  const [current] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));

  if (
    current &&
    ["CLAIMED", "RUNNING"].includes(current.status) &&
    current.workerId === AI_PHASE_WORKER_ID
  ) {
    await releaseAiClaim(workstreamId, current.leaseToken, undefined, null);
  }

  return {
    status: revoked.status,
    revokedAt: revoked.revokedAt?.toISOString() ?? null,
  };
}

export interface EnqueueWorkstreamAiExecutionOptions {
  expectedPackageHash: string;
  requestedBy?: string;
  tenantId?: string;
}

export function parseWorkstreamAiJobPayload(
  value: unknown,
): WorkstreamAiJobPayload {
  if (!isRecord(value)) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "coding_workstream_ai_execution payload must be an object.",
      "INVALID_CONTEXT",
    );
  }

  const uuid = (key: string): string => {
    const current = typeof value[key] === "string" ? value[key].trim() : "";
    if (!UUID_RE.test(current)) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Invalid UUID in workstream AI job payload: " + key,
        "INVALID_CONTEXT",
      );
    }
    return current;
  };
  const text = (key: string): string => {
    const current = typeof value[key] === "string" ? value[key].trim() : "";
    if (!current) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Missing workstream AI job payload field: " + key,
        "INVALID_CONTEXT",
      );
    }
    return current;
  };

  const claimAttempt = Number(value.claimAttempt);
  if (!Number.isInteger(claimAttempt) || claimAttempt < 1) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "workstream AI job claimAttempt must be a positive integer.",
      "INVALID_CONTEXT",
    );
  }

  const authorizationPackageHash = text("authorizationPackageHash").toLowerCase();
  const analyzerResultHash = text("analyzerResultHash").toLowerCase();
  if (!SHA64_RE.test(authorizationPackageHash) || !SHA64_RE.test(analyzerResultHash)) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Workstream AI job hashes must be SHA-256.",
      "INVALID_CONTEXT",
    );
  }

  const requestedBy =
    typeof value.requestedBy === "string" && value.requestedBy.trim()
      ? value.requestedBy.trim().slice(0, 200)
      : undefined;

  return {
    graphId: uuid("graphId"),
    workstreamId: uuid("workstreamId"),
    childTaskId: uuid("childTaskId"),
    claimAttempt,
    leaseToken: text("leaseToken"),
    authorizationPackageHash,
    analyzerResultHash,
    ...(requestedBy ? { requestedBy } : {}),
  };
}

async function loadExecutionContext(
  payload: WorkstreamAiJobPayload,
): Promise<LoadedExecutionContext> {
  const [workstream] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, payload.workstreamId));
  if (!workstream) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Coding workstream not found.",
      "NOT_FOUND",
    );
  }
  if (
    workstream.graphId !== payload.graphId ||
    workstream.childTaskId !== payload.childTaskId ||
    workstream.attemptCount !== payload.claimAttempt ||
    workstream.leaseToken !== payload.leaseToken ||
    !["CLAIMED", "RUNNING"].includes(workstream.status) ||
    !workstream.leaseExpiresAt ||
    workstream.leaseExpiresAt.getTime() <= Date.now()
  ) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Queued workstream AI execution no longer matches its active claim.",
      "STALE_CONTEXT",
    );
  }

  const [graph] = await db
    .select()
    .from(aiCodingTaskGraphsTable)
    .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
  if (!graph || !["APPROVED", "RUNNING"].includes(graph.status)) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Coding task graph is no longer active.",
      "STALE_CONTEXT",
    );
  }

  const [childTask] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, payload.childTaskId));
  if (!childTask) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Child coding task not found.",
      "NOT_FOUND",
    );
  }

  const [parentTask] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, graph.taskId));
  if (
    !parentTask ||
    childTask.repository !== parentTask.repository ||
    childTask.branch !== parentTask.branch
  ) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Child coding task repository binding no longer matches its parent graph task.",
      "STALE_CONTEXT",
    );
  }

  const analyzerResult = isRecord(workstream.resultJson)
    ? workstream.resultJson
    : null;
  if (
    !analyzerResult ||
    !localExecutionPlanRequiresAi(analyzerResult) ||
    hashWorkstreamAnalyzerResult(analyzerResult) !== payload.analyzerResultHash
  ) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Analyzer result changed after workstream AI execution was queued.",
      "STALE_CONTEXT",
    );
  }
  const analyzerContext = isRecord(analyzerResult.contextPackage)
    ? analyzerResult.contextPackage
    : null;
  const expectedAnalyzerBranch =
    typeof workstream.branchName === "string" && workstream.branchName.trim()
      ? workstream.branchName
      : childTask.branch;
  if (
    analyzerResult.codingTaskId !== childTask.id ||
    analyzerResult.sourceTarget !== childTask.repository ||
    !isAnalyzerBranchFromPriorWorkstreamAttempt(graph.taskId, workstream.workstreamKey, String(analyzerResult.branch ?? ""), payload.claimAttempt) ||
    !analyzerContext ||
    analyzerContext.repository !== childTask.repository ||
    analyzerContext.branch !== analyzerResult.branch
  ) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Analyzer result no longer matches the bound child task repository/isolated branch.",
      "STALE_CONTEXT",
      {
        childTaskBranch: childTask.branch,
        expectedAnalyzerBranch,
        analyzerResultBranch: analyzerResult.branch,
        analyzerContextBranch: analyzerContext?.branch,
      },
    );
  }

  return {
    workstream,
    graphTaskId: graph.taskId,
    childTask: {
      id: childTask.id,
      repository: childTask.repository,
      branch: childTask.branch,
      projectName: childTask.projectName,
      instruction: childTask.instruction,
    },
    analyzerResult,
  };
}

async function findActiveWorkstreamAiJob(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workstreamId: string,
  claimAttempt: number,
): Promise<AiJob | null> {
  const [existing] = await tx
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.jobType, CODING_WORKSTREAM_AI_JOB_TYPE),
        inArray(aiJobsTable.status, ["queued", "waiting", "running", "retrying"]),
        sql`${aiJobsTable.payloadJson}->>'workstreamId' = ${workstreamId}`,
        sql`(${aiJobsTable.payloadJson}->>'claimAttempt')::int = ${claimAttempt}`,
      ),
    )
    .orderBy(desc(aiJobsTable.id))
    .limit(1);
  return existing ?? null;
}

export async function enqueueWorkstreamAiExecution(
  workstreamId: string,
  options: EnqueueWorkstreamAiExecutionOptions,
): Promise<AiJob> {
  const expectedPackageHash = options.expectedPackageHash.trim().toLowerCase();
  if (!SHA64_RE.test(expectedPackageHash)) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "expectedPackageHash must be a SHA-256 hash.",
      "INVALID_CONTEXT",
    );
  }

  const authorization = await assertApprovedWorkstreamAiHandoffFresh(workstreamId);
  if (authorization.packageHash.toLowerCase() !== expectedPackageHash) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Approved workstream AI handoff changed before enqueue.",
      "STALE_CONTEXT",
    );
  }

  const [workstream] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));
  if (
    !workstream ||
    !workstream.childTaskId ||
    !workstream.leaseToken ||
    workstream.attemptCount !== authorization.claimAttempt ||
    !isRecord(workstream.resultJson)
  ) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Workstream execution binding is incomplete.",
      "INVALID_CONTEXT",
    );
  }

  const analyzerResultHash = hashWorkstreamAnalyzerResult(workstream.resultJson);
  const payload: WorkstreamAiJobPayload = {
    graphId: workstream.graphId,
    workstreamId: workstream.id,
    childTaskId: workstream.childTaskId,
    claimAttempt: workstream.attemptCount,
    leaseToken: workstream.leaseToken,
    authorizationPackageHash: authorization.packageHash.toLowerCase(),
    analyzerResultHash,
    ...(options.requestedBy
      ? { requestedBy: options.requestedBy.trim().slice(0, 200) }
      : {}),
  };
  const priority = Math.max(0, Math.min(100, workstream.priority));
  const lockKey =
    CODING_WORKSTREAM_AI_JOB_TYPE +
    ":" +
    workstream.id +
    ":" +
    String(workstream.attemptCount);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const existing = await findActiveWorkstreamAiJob(
      tx,
      workstream.id,
      workstream.attemptCount,
    );
    if (existing) return existing;

    const now = new Date();
    const [job] = await tx
      .insert(aiJobsTable)
      .values({
        jobCode: "JOB-" + randomUUID().slice(0, 8).toUpperCase(),
        jobType: CODING_WORKSTREAM_AI_JOB_TYPE,
        requiredCapability: CODING_WORKSTREAM_AI_CAPABILITY,
        payloadJson: {
          ...payload,
          ...(options.tenantId ? { _tenantId: options.tenantId } : {}),
        },
        priority,
        priorityScore: String(
          computePriorityScore({
            basePriority: priority,
            createdAt: now,
            retryCount: 0,
          }),
        ),
        maxRetry: 0,
        retryStrategy: "manual",
        status: "queued",
        retryCount: 0,
      })
      .returning();
    if (!job) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Failed to queue constrained workstream AI execution.",
        "INVALID_CONTEXT",
      );
    }
    return job;
  });

  await logAudit(
    "coding-multi-worker",
    "workstream_ai_execution_enqueued",
    workstreamId,
    "coding_workstream",
    "success",
    {
      jobId: result.id,
      claimAttempt: workstream.attemptCount,
      authorizationPackageHash: payload.authorizationPackageHash,
      analyzerResultHash,
      maxRetry: 0,
    },
  ).catch(() => undefined);

  return result;
}

export function selectWorkstreamAiAllowedFiles(
  result: Record<string, unknown>,
  ownershipPaths: string[],
): string[] {
  const context = isRecord(result.contextPackage) ? result.contextPackage : {};
  const plan = isRecord(result.localExecutionPlan) ? result.localExecutionPlan : {};
  const candidates: string[] = [];

  // Exact ownership paths may intentionally point at files that do not exist yet.
  // Include those first so create-file workstreams stay bounded to the approved path.
  for (const raw of ownershipPaths) {
    const portable = raw.trim().replace(/\\/g, "/");
    if (
      portable &&
      !portable.endsWith("/") &&
      !/[?*\[\]{}]/.test(portable)
    ) {
      candidates.push(portable);
    }
  }

  candidates.push(...strings(context.affectedFiles));
  const relevant = Array.isArray(context.relevantFiles) ? context.relevantFiles : [];
  for (const item of relevant) {
    if (isRecord(item) && typeof item.path === "string") candidates.push(item.path);
  }
  candidates.push(...strings(plan.targetFiles));

  const symbols = Array.isArray(context.symbols) ? context.symbols : [];
  for (const item of symbols) {
    if (isRecord(item) && typeof item.file === "string") candidates.push(item.file);
  }
  const dependencies = Array.isArray(context.dependencies)
    ? context.dependencies
    : [];
  for (const item of dependencies) {
    if (isRecord(item) && typeof item.file === "string") candidates.push(item.file);
  }
  candidates.push(...strings(context.relatedTests));

  const unique: string[] = [];
  for (const raw of candidates) {
    const file = normalizeRepoPath(raw);
    if (
      file &&
      codingWorkstreamOwnsFile(file, ownershipPaths) &&
      !unique.includes(file)
    ) {
      unique.push(file);
    }
    if (unique.length >= MAX_ALLOWED_FILES) break;
  }
  return unique;
}

async function safeSnippet(
  repositoryRoot: string,
  file: string,
): Promise<AiHandoffSnippet | null> {
  const root = await realpath(resolve(repositoryRoot)).catch(() => null);
  if (!root) return null;
  const candidate = resolve(root, file);
  if (!insideRoot(root, candidate)) return null;

  const info = await lstat(candidate).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) {
    return null;
  }
  const resolvedFile = await realpath(candidate).catch(() => null);
  if (!resolvedFile || !insideRoot(root, resolvedFile)) return null;

  const content = await readFile(resolvedFile, "utf8").catch(() => null);
  if (content == null) return null;
  const bounded = content.slice(0, MAX_SNIPPET_CHARS);
  return {
    file,
    startLine: 1,
    endLine: Math.max(1, bounded.split("\n").length),
    content: bounded,
    reason: "focus",
  };
}

function boundedSymbols(
  value: unknown,
  allowed: Set<string>,
): LocalSymbol[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is LocalSymbol => {
      if (!isRecord(item) || typeof item.file !== "string") return false;
      const file = normalizeRepoPath(item.file);
      return Boolean(file && allowed.has(file));
    })
    .slice(0, 40);
}

function boundedDependencies(
  value: unknown,
  allowed: Set<string>,
): ImportReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ImportReference => {
      if (!isRecord(item) || typeof item.file !== "string") return false;
      const file = normalizeRepoPath(item.file);
      return Boolean(file && allowed.has(file));
    })
    .slice(0, 40);
}

function boundedCommits(value: unknown): GitCommitContext[] {
  return Array.isArray(value)
    ? (value.filter((item) => isRecord(item)).slice(0, 6) as unknown as GitCommitContext[])
    : [];
}

async function buildSyntheticContextLease(
  context: LoadedExecutionContext,
  authorization: ApprovedWorkstreamAiHandoffLease,
  repositoryRoot: string,
): Promise<ApprovedAiHandoffLease> {
  const analyzer = context.analyzerResult;
  const contextPackage = isRecord(analyzer.contextPackage)
    ? analyzer.contextPackage
    : null;
  if (!contextPackage) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Analyzer context package is missing.",
      "INVALID_CONTEXT",
    );
  }

  const expectedHead = authorization.package.workstream.baseSha.toLowerCase();
  const analyzerHead =
    typeof contextPackage.headSha === "string"
      ? contextPackage.headSha.toLowerCase()
      : "";
  if (analyzerHead !== expectedHead) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Analyzer context HEAD no longer matches the approved workstream base SHA.",
      "STALE_CONTEXT",
    );
  }

  const ownershipPaths = authorization.package.workstream.ownershipPaths;
  const allowedFiles = selectWorkstreamAiAllowedFiles(analyzer, ownershipPaths);
  if (allowedFiles.length === 0) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "No concrete non-sensitive files inside the workstream ownership boundary are available for AI.",
      "INVALID_CONTEXT",
    );
  }

  const snippets: AiHandoffSnippet[] = [];
  const newAuthorizedTargets: string[] = [];
  for (const file of allowedFiles.slice(0, MAX_SNIPPETS)) {
    const snippet = await safeSnippet(repositoryRoot, file);
    if (snippet) {
      snippets.push(snippet);
      continue;
    }
    const entry = await lstat(resolve(repositoryRoot, file)).catch(() => null);
    if (!entry) newAuthorizedTargets.push(file);
  }
  if (snippets.length === 0 && newAuthorizedTargets.length === 0) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "No safe source snippets could be prepared for the workstream AI context.",
      "INVALID_CONTEXT",
    );
  }

  const allowed = new Set(allowedFiles);
  const findings = Array.isArray(analyzer.findings) ? analyzer.findings : [];
  const diagnostics = [
    ...newAuthorizedTargets.map((file) => ({
      command: "repository-analyzer",
      kind: "info",
      file,
      message:
        "Authorized target does not exist at the approved base SHA; create_file is permitted only for this exact allowed path.",
    })),
    ...findings
      .filter((item) => isRecord(item))
      .slice(0, Math.max(0, 24 - newAuthorizedTargets.length))
      .map((item) => ({
      command: "repository-analyzer",
      kind: typeof item.severity === "string" ? item.severity : "info",
      ...(typeof item.file === "string" && allowed.has(item.file)
        ? { file: item.file }
        : {}),
      message:
        typeof item.detail === "string"
          ? item.detail.slice(0, 1_000)
          : typeof item.title === "string"
            ? item.title.slice(0, 1_000)
            : "Analyzer finding",
      })),
  ];

  const pkg: AiHandoffPackage = {
    version: 1,
    task: {
      id: context.childTask.id,
      projectName: context.childTask.projectName,
      instruction: authorization.package.workstream.instruction,
    },
    repository: {
      repository: context.childTask.repository,
      branch: authorization.package.workstream.branchName,
      baseHeadSha: expectedHead,
    },
    reason:
      "Workstream analyzer classified the bounded task as AI_REQUIRED. " +
      "This context is subordinate to the explicitly approved per-workstream authorization lease.",
    allowedFiles,
    diagnostics,
    snippets,
    symbols: boundedSymbols(contextPackage.symbols, allowed),
    dependencies: boundedDependencies(contextPackage.dependencies, allowed),
    relatedTests: strings(contextPackage.relatedTests)
      .map((item) => normalizeRepoPath(item))
      .filter(
        (item): item is string =>
          Boolean(item && codingWorkstreamOwnsFile(item, ownershipPaths)),
      )
      .slice(0, 12),
    recentCommits: boundedCommits(contextPackage.recentCommits),
    verificationCommands: strings(contextPackage.verificationCommands).slice(0, 8),
    currentPatch: {
      sha256: sha256(""),
      excerpt: "",
      truncated: false,
    },
    policy: {
      readOnlyContext: true,
      repositoryAccess: false,
      networkAccess: false,
      shellAccess: false,
      secretAccess: false,
      sourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      allowedFilesOnly: true,
    },
  };

  return {
    package: pkg,
    packageHash: computeAiHandoffPackageHash(pkg),
    approvedAt: authorization.approvedAt,
    expiresAt: authorization.expiresAt,
  };
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

async function persistCandidate(input: {
  payload: WorkstreamAiJobPayload;
  sourceResult: Record<string, unknown>;
  authorization: ApprovedWorkstreamAiHandoffLease;
  contextLease: ApprovedAiHandoffLease;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
  proposal: {
    proposal: { summary: string; rationale: string };
  };
  candidate: {
    applyResult: {
      patch: string;
      patchSha256: string | null;
      resultSha256: string | null;
      changedFiles: string[];
      warnings: string[];
    };
  };
  executionId: string;
}): Promise<void> {
  const now = new Date();
  const patchSha256 = input.candidate.applyResult.patchSha256;
  const resultSha256 = input.candidate.applyResult.resultSha256;
  if (!patchSha256 || !resultSha256) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Applied AI candidate is missing deterministic patch/result hashes.",
      "POLICY_REJECTED",
    );
  }

  const execution = {
    version: 1,
    status: "CANDIDATE_READY",
    nextAction: "REVIEW_AI_PATCH",
    reviewStatus: "PENDING",
    executionId: input.executionId,
    claimAttempt: input.payload.claimAttempt,
    authorizationHandoffId: input.authorization.handoffId,
    authorizationPackageHash: input.authorization.packageHash,
    contextPackageHash: input.contextLease.packageHash,
    proposalSummary: input.proposal.proposal.summary,
    proposalRationale: input.proposal.proposal.rationale,
    provider: input.provider,
    model: input.model,
    metadata: input.metadata,
    policyStatus: "PASSED",
    changedFiles: input.candidate.applyResult.changedFiles,
    patch: input.candidate.applyResult.patch,
    patchSha256,
    resultSha256,
    warnings: input.candidate.applyResult.warnings,
    scriptsExecuted: false,
    networkUsed: false,
    commitCreated: false,
    pushed: false,
    rolledBack: false,
    modelInvoked: true,
    privilegeEnded: true,
    createdAt: now.toISOString(),
  };

  const resultJson = {
    ...input.sourceResult,
    workstreamAiExecution: execution,
  };

  const [updated] = await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "REVIEW_REQUIRED",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      resultJson,
      errorMessage: null,
    })
    .where(
      and(
        eq(aiCodingWorkstreamsTable.id, input.payload.workstreamId),
        eq(aiCodingWorkstreamsTable.attemptCount, input.payload.claimAttempt),
        eq(aiCodingWorkstreamsTable.leaseToken, input.payload.leaseToken),
        eq(aiCodingWorkstreamsTable.status, "RUNNING"),
      ),
    )
    .returning();

  if (!updated) {
    throw new LocalCodingWorkstreamAiExecutionError(
      "Workstream lease was lost before the AI candidate patch could be persisted.",
      "LEASE_LOST",
    );
  }

  await db
    .update(aiCodingTasksTable)
    .set({
      status: "READY_REVIEW",
      resultSummary:
        "Per-workstream constrained AI produced a deterministic candidate patch. Explicit REVIEW_AI_PATCH approval is required. No scripts, network, commit, push, or merge were executed.",
    })
    .where(eq(aiCodingTasksTable.id, input.payload.childTaskId));
}

async function persistExecutionFailure(
  payload: WorkstreamAiJobPayload,
  sourceResult: Record<string, unknown> | null,
  error: unknown,
  consumed: boolean,
): Promise<void> {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  const prior = sourceResult ?? {};
  const resultJson = {
    ...prior,
    workstreamAiExecution: {
      version: 1,
      status: "FAILED",
      nextAction: "AI_REQUIRED",
      claimAttempt: payload.claimAttempt,
      authorizationPackageHash: payload.authorizationPackageHash,
      error: message.slice(0, 1_200),
      modelInvoked: consumed,
      privilegeEnded: consumed,
      failedAt: now.toISOString(),
    },
  };

  await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "REVIEW_REQUIRED",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
      resultJson,
      errorMessage: message.slice(0, 2_000),
    })
    .where(
      and(
        eq(aiCodingWorkstreamsTable.id, payload.workstreamId),
        eq(aiCodingWorkstreamsTable.attemptCount, payload.claimAttempt),
        eq(aiCodingWorkstreamsTable.leaseToken, payload.leaseToken),
        inArray(aiCodingWorkstreamsTable.status, ["CLAIMED", "RUNNING"]),
      ),
    );

  await db
    .update(aiCodingTasksTable)
    .set({
      status: "READY_REVIEW",
      resultSummary: consumed
        ? "Per-workstream constrained AI failed after the one-shot authorization was consumed. Prepare a fresh workstream AI handoff."
        : "Per-workstream constrained AI failed before model invocation. Prepare a fresh workstream AI handoff.",
    })
    .where(eq(aiCodingTasksTable.id, payload.childTaskId))
    .catch(() => undefined);
}

export async function executeCodingWorkstreamAiJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = parseWorkstreamAiJobPayload(job.payloadJson);
  const [initialWorkstream] = await db
    .select({ resultJson: aiCodingWorkstreamsTable.resultJson })
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, payload.workstreamId));
  const failureSourceResult = isRecord(initialWorkstream?.resultJson)
    ? initialWorkstream.resultJson
    : null;
  let loaded: LoadedExecutionContext | null = null;
  let consumed = false;
  let workspacePath: string | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  try {
    loaded = await loadExecutionContext(payload);
    await startCodingWorkstreamClaim(payload.workstreamId, payload.leaseToken);

    let heartbeatError: Error | null = null;
    heartbeatTimer = setInterval(() => {
      void heartbeatCodingWorkstreamClaim(
        payload.workstreamId,
        payload.leaseToken,
      ).catch((error: unknown) => {
        heartbeatError =
          error instanceof Error ? error : new Error(String(error));
      });
    }, AI_PHASE_HEARTBEAT_MS);
    heartbeatTimer.unref?.();

    const authorization =
      await assertApprovedWorkstreamAiHandoffFresh(payload.workstreamId);
    if (
      authorization.packageHash.toLowerCase() !==
        payload.authorizationPackageHash ||
      authorization.claimAttempt !== payload.claimAttempt
    ) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Approved workstream authorization changed before model execution.",
        "STALE_CONTEXT",
      );
    }

    const workspace = await prepareRepositoryWorkspace(
      loaded.childTask.repository,
      authorization.package.workstream.branchName,
    );
    if (!workspace.cleanup) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream AI execution requires an isolated remote clone.",
        "INVALID_CONTEXT",
      );
    }
    workspacePath = workspace.path;

    const actualHead = await gitHead(workspacePath);
    if (
      actualHead !== authorization.package.workstream.baseSha.toLowerCase()
    ) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Repository HEAD changed after workstream authorization approval.",
        "STALE_CONTEXT",
        { expected: authorization.package.workstream.baseSha, actual: actualHead },
      );
    }

    const contextLease = await buildSyntheticContextLease(
      loaded,
      authorization,
      workspacePath,
    );
    const prompt = buildLocalCodingAiPrompt(contextLease);

    const resolved = await resolvePreferredCodingModel();
    if (!resolved.ok) {
      throw new LocalCodingWorkstreamAiExecutionError(
        resolved.message,
        "MODEL_UNAVAILABLE",
        {
          reason: resolved.reason,
          primaryFailure: resolved.primaryFailure,
          fallbackFailure: resolved.fallbackFailure ?? null,
        },
      );
    }

    if (heartbeatError) throw heartbeatError;

    const selected = resolved.selection;
    const providerSlug = String(selected.provider.slug ?? "").toLowerCase();
    const modelId = String(selected.model.modelId ?? "");
    if (!providerSlug || !modelId) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Production coding model resolver returned an invalid provider/model.",
        "MODEL_UNAVAILABLE",
      );
    }

    const executionId =
      "workstream-ai:" + payload.workstreamId + ":" + String(job.id);
    await consumeApprovedWorkstreamAiHandoff(
      payload.workstreamId,
      payload.authorizationPackageHash,
      executionId,
    );
    consumed = true;

    const provider = createConstrainedCodingProviderAdapter({
      providerSlug,
      modelId,
      baseUrl:
        typeof selected.provider.baseUrl === "string"
          ? selected.provider.baseUrl
          : null,
      observability: {
        conversationId: loaded.graphTaskId,
        agentName: "Workstream AI Execution Gate",
        providerName: providerSlug,
        modelName: modelId,
        requestType: "code",
        createdBy: "workstream-ai-job:" + String(job.id),
      },
    });
    const adapter = createConstrainedModelInvocationAdapter(provider);
    const modelResult = await invokeConstrainedAiProposal({
      lease: contextLease,
      adapter,
      target: { provider: providerSlug, model: modelId },
      requestId: executionId,
      prompt,
      timeoutMs: selected.timeoutMs,
      maxOutputTokens: selected.maxOutputTokens,
    });

    if (heartbeatError) throw heartbeatError;

    const candidate = await validateAndApplyAiProposal({
      lease: contextLease,
      proposal: modelResult.proposal,
      repositoryRoot: workspacePath,
      currentRepositoryHeadSha: actualHead,
    });
    const ownershipPaths = authorization.package.workstream.ownershipPaths;
    const outsideOwnership = candidate.applyResult.changedFiles.filter(
      (file) => !codingWorkstreamOwnsFile(file, ownershipPaths),
    );
    if (outsideOwnership.length > 0) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "AI candidate patch escaped its workstream ownership boundary.",
        "POLICY_REJECTED",
        { outsideOwnership, ownershipPaths },
      );
    }

    await persistCandidate({
      payload,
      sourceResult: loaded.analyzerResult,
      authorization,
      contextLease,
      provider: providerSlug,
      model: modelId,
      metadata: modelResult.metadata as unknown as Record<string, unknown>,
      proposal: modelResult.proposal,
      candidate,
      executionId,
    });

    await logAudit(
      "coding-multi-worker",
      "workstream_ai_candidate_ready",
      payload.workstreamId,
      "coding_workstream",
      "success",
      {
        jobId: job.id,
        graphId: payload.graphId,
        childTaskId: payload.childTaskId,
        claimAttempt: payload.claimAttempt,
        authorizationPackageHash: authorization.packageHash,
        contextPackageHash: contextLease.packageHash,
        provider: providerSlug,
        model: modelId,
        changedFiles: candidate.applyResult.changedFiles.length,
        patchSha256: candidate.applyResult.patchSha256,
        modelInvoked: true,
        privilegeEnded: true,
        nextAction: "REVIEW_AI_PATCH",
      },
    ).catch(() => undefined);

    return {
      jobId: job.id,
      graphId: payload.graphId,
      workstreamId: payload.workstreamId,
      childTaskId: payload.childTaskId,
      claimAttempt: payload.claimAttempt,
      authorizationPackageHash: authorization.packageHash,
      contextPackageHash: contextLease.packageHash,
      provider: providerSlug,
      model: modelId,
      changedFiles: candidate.applyResult.changedFiles,
      patchSha256: candidate.applyResult.patchSha256,
      modelInvoked: true,
      privilegeEnded: true,
      nextAction: "REVIEW_AI_PATCH",
    };
  } catch (error) {
    if (!consumed) {
      await revokeWorkstreamAiHandoff(payload.workstreamId).catch(() => undefined);
    }
    await persistExecutionFailure(
      payload,
      loaded?.analyzerResult ?? failureSourceResult,
      error,
      consumed,
    ).catch(() => undefined);

    await logAudit(
      "coding-multi-worker",
      "workstream_ai_execution_failed",
      payload.workstreamId,
      "coding_workstream",
      "failure",
      {
        jobId: job.id,
        claimAttempt: payload.claimAttempt,
        modelInvoked: consumed,
        privilegeEnded: consumed,
        error: error instanceof Error ? error.message.slice(0, 700) : String(error),
      },
    ).catch(() => undefined);
    throw error;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function recoverFailedCodingWorkstreamAiJob(
  payloadValue: Record<string, unknown>,
  errorMessage: string,
): Promise<void> {
  let payload: WorkstreamAiJobPayload;
  try {
    payload = parseWorkstreamAiJobPayload(payloadValue);
  } catch {
    return;
  }

  const [handoff] = await db
    .select()
    .from(aiCodingWorkstreamAiHandoffsTable)
    .where(
      and(
        eq(aiCodingWorkstreamAiHandoffsTable.workstreamId, payload.workstreamId),
        eq(aiCodingWorkstreamAiHandoffsTable.claimAttempt, payload.claimAttempt),
      ),
    )
    .limit(1);
  const consumed = handoff?.status === "CONSUMED";

  if (!consumed) {
    await revokeWorkstreamAiHandoff(payload.workstreamId).catch(() => undefined);
  }

  const [workstream] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, payload.workstreamId));
  const sourceResult = isRecord(workstream?.resultJson)
    ? workstream!.resultJson
    : null;

  await persistExecutionFailure(
    payload,
    sourceResult,
    new Error(errorMessage),
    consumed,
  );
}

export async function approveWorkstreamAiCandidatePatch(
  workstreamId: string,
): Promise<AiCodingWorkstream> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");
    if (!current) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Coding workstream not found.",
        "NOT_FOUND",
      );
    }
    if (current.status !== "REVIEW_REQUIRED" || !isRecord(current.resultJson)) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "Workstream is not awaiting an AI candidate review.",
        "NOT_READY",
      );
    }

    const execution = isRecord(current.resultJson.workstreamAiExecution)
      ? current.resultJson.workstreamAiExecution
      : null;
    if (
      !execution ||
      execution.status !== "CANDIDATE_READY" ||
      execution.nextAction !== "REVIEW_AI_PATCH" ||
      execution.reviewStatus !== "PENDING" ||
      execution.policyStatus !== "PASSED" ||
      execution.scriptsExecuted !== false ||
      execution.networkUsed !== false ||
      execution.commitCreated !== false ||
      execution.pushed !== false
    ) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "AI candidate patch is not eligible for explicit approval.",
        "NOT_READY",
      );
    }

    const [updated] = await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        resultJson: {
          ...current.resultJson,
          workstreamAiExecution: {
            ...execution,
            reviewStatus: "APPROVED",
            reviewedAt: now.toISOString(),
            nextAction: "REVIEW_WORKSTREAM",
          },
        },
        errorMessage: null,
      })
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstreamId),
          eq(aiCodingWorkstreamsTable.status, "REVIEW_REQUIRED"),
        ),
      )
      .returning();

    if (!updated) {
      throw new LocalCodingWorkstreamAiExecutionError(
        "AI candidate approval lost a concurrent update.",
        "LEASE_LOST",
      );
    }

    return updated;
  });
}
