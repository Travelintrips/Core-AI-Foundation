import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  aiCodingTaskGraphsTable,
  aiCodingWorkstreamDependenciesTable,
  aiCodingWorkstreamsTable,
  db,
  type AiCodingTaskGraph,
  type AiCodingWorkstream,
} from "@workspace/db";

const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 15 * 60;
const MAX_PARALLEL_CLAIMS = 8;
const SHA_RE = /^[0-9a-f]{40}$/i;

export class LocalCodingMultiWorkerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_READY"
      | "INVALID_INPUT"
      | "LEASE_LOST"
      | "CLAIM_FAILED",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingMultiWorkerError";
  }
}

export interface CodingWorkstreamClaim {
  workstreamId: string;
  workstreamKey: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  branchName: string;
  baseSha: string;
  attempt: number;
}

export interface ClaimReadyCodingWorkstreamsOptions {
  maxClaims?: number;
  leaseSeconds?: number;
  baseSha: string;
}

interface DependencyRow {
  workstreamId: string;
  dependsOnWorkstreamId: string;
}

function boundedLeaseSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return 120;
  return Math.max(
    MIN_LEASE_SECONDS,
    Math.min(MAX_LEASE_SECONDS, Math.floor(value!)),
  );
}

function boundedMaxClaims(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_PARALLEL_CLAIMS, Math.floor(value!)));
}

function validateWorkerId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new LocalCodingMultiWorkerError(
      "workerId must be a non-empty string up to 200 characters.",
      "INVALID_INPUT",
    );
  }
  return normalized;
}

function validateBaseSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_RE.test(normalized)) {
    throw new LocalCodingMultiWorkerError(
      "baseSha must be a 40-character Git SHA.",
      "INVALID_INPUT",
    );
  }
  return normalized;
}

export function buildCodingWorkstreamBranchName(
  taskId: string,
  workstreamKey: string,
  attempt: number,
): string {
  const task = taskId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const key = workstreamKey.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `ai-core/${task}/${key}-a${Math.max(1, Math.floor(attempt))}`;
}

export function selectClaimableCodingWorkstreams(
  workstreams: AiCodingWorkstream[],
  dependencies: DependencyRow[],
  now: Date,
): AiCodingWorkstream[] {
  const completedIds = new Set(
    workstreams
      .filter((item) => item.status === "COMPLETED")
      .map((item) => item.id),
  );
  const deps = new Map<string, string[]>();
  for (const row of dependencies) {
    const list = deps.get(row.workstreamId) ?? [];
    list.push(row.dependsOnWorkstreamId);
    deps.set(row.workstreamId, list);
  }

  return workstreams
    .filter((item) => {
      const prerequisites = deps.get(item.id) ?? [];
      if (!prerequisites.every((id) => completedIds.has(id))) return false;

      if (item.status === "PENDING" || item.status === "READY") return true;
      if (
        (item.status === "CLAIMED" || item.status === "RUNNING") &&
        item.leaseExpiresAt &&
        item.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        return true;
      }
      return false;
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.workstreamKey.localeCompare(b.workstreamKey);
    });
}

function claimCondition(
  workstream: AiCodingWorkstream,
  now: Date,
) {
  if (workstream.status === "PENDING" || workstream.status === "READY") {
    return and(
      eq(aiCodingWorkstreamsTable.id, workstream.id),
      eq(aiCodingWorkstreamsTable.status, workstream.status),
    );
  }

  return and(
    eq(aiCodingWorkstreamsTable.id, workstream.id),
    eq(aiCodingWorkstreamsTable.leaseToken, workstream.leaseToken),
    sql`${aiCodingWorkstreamsTable.leaseExpiresAt} <= ${now}`,
  );
}

export async function claimReadyCodingWorkstreams(
  graphId: string,
  workerIdInput: string,
  options: ClaimReadyCodingWorkstreamsOptions,
): Promise<CodingWorkstreamClaim[]> {
  const workerId = validateWorkerId(workerIdInput);
  const baseSha = validateBaseSha(options.baseSha);
  const leaseSeconds = boundedLeaseSeconds(options.leaseSeconds);
  const maxClaims = boundedMaxClaims(options.maxClaims);
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  const lockKey = `coding-task-graph-claim:${graphId}`;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, graphId))
      .for("update");

    if (!graph) {
      throw new LocalCodingMultiWorkerError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }
    if (!["APPROVED", "RUNNING"].includes(graph.status)) {
      throw new LocalCodingMultiWorkerError(
        "Coding task graph must be explicitly APPROVED before worker claims.",
        "NOT_READY",
        { status: graph.status },
      );
    }

    const workstreams = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, graphId));
    const dependencies = await tx
      .select({
        workstreamId: aiCodingWorkstreamDependenciesTable.workstreamId,
        dependsOnWorkstreamId:
          aiCodingWorkstreamDependenciesTable.dependsOnWorkstreamId,
      })
      .from(aiCodingWorkstreamDependenciesTable)
      .where(eq(aiCodingWorkstreamDependenciesTable.graphId, graphId));

    const candidates = selectClaimableCodingWorkstreams(
      workstreams,
      dependencies,
      now,
    ).slice(0, maxClaims);

    const claims: CodingWorkstreamClaim[] = [];
    for (const candidate of candidates) {
      const attempt = candidate.attemptCount + 1;
      const leaseToken = randomUUID();
      const branchName = buildCodingWorkstreamBranchName(
        graph.taskId,
        candidate.workstreamKey,
        attempt,
      );

      const [claimed] = await tx
        .update(aiCodingWorkstreamsTable)
        .set({
          status: "CLAIMED",
          workerId,
          leaseToken,
          leaseExpiresAt,
          heartbeatAt: now,
          claimedAt: candidate.claimedAt ?? now,
          branchName,
          baseSha,
          headSha: null,
          attemptCount: attempt,
          errorMessage: null,
        })
        .where(claimCondition(candidate, now))
        .returning();

      // A heartbeat may have won the race while this transaction waited.
      if (!claimed) continue;

      claims.push({
        workstreamId: claimed.id,
        workstreamKey: claimed.workstreamKey,
        workerId,
        leaseToken,
        leaseExpiresAt,
        branchName,
        baseSha,
        attempt,
      });
    }

    if (claims.length > 0 && graph.status === "APPROVED") {
      await tx
        .update(aiCodingTaskGraphsTable)
        .set({ status: "RUNNING", startedAt: graph.startedAt ?? now })
        .where(eq(aiCodingTaskGraphsTable.id, graph.id));
    }

    return claims;
  });
}

export async function startCodingWorkstreamClaim(
  workstreamId: string,
  leaseToken: string,
): Promise<AiCodingWorkstream> {
  const now = new Date();
  const [updated] = await db
    .update(aiCodingWorkstreamsTable)
    .set({
      status: "RUNNING",
      startedAt: now,
      heartbeatAt: now,
    })
    .where(
      and(
        eq(aiCodingWorkstreamsTable.id, workstreamId),
        eq(aiCodingWorkstreamsTable.status, "CLAIMED"),
        eq(aiCodingWorkstreamsTable.leaseToken, leaseToken),
        sql`${aiCodingWorkstreamsTable.leaseExpiresAt} > ${now}`,
      ),
    )
    .returning();

  if (!updated) {
    throw new LocalCodingMultiWorkerError(
      "Workstream claim lease is no longer valid.",
      "LEASE_LOST",
    );
  }
  return updated;
}

export async function heartbeatCodingWorkstreamClaim(
  workstreamId: string,
  leaseToken: string,
  leaseSecondsInput?: number,
): Promise<AiCodingWorkstream> {
  const now = new Date();
  const leaseSeconds = boundedLeaseSeconds(leaseSecondsInput);
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

  const [updated] = await db
    .update(aiCodingWorkstreamsTable)
    .set({
      heartbeatAt: now,
      leaseExpiresAt,
    })
    .where(
      and(
        eq(aiCodingWorkstreamsTable.id, workstreamId),
        inArray(aiCodingWorkstreamsTable.status, ["CLAIMED", "RUNNING"]),
        eq(aiCodingWorkstreamsTable.leaseToken, leaseToken),
        sql`${aiCodingWorkstreamsTable.leaseExpiresAt} > ${now}`,
      ),
    )
    .returning();

  if (!updated) {
    throw new LocalCodingMultiWorkerError(
      "Workstream heartbeat rejected because the lease was lost or expired.",
      "LEASE_LOST",
    );
  }
  return updated;
}

async function unlockDependents(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  graphId: string,
): Promise<void> {
  const [workstreams, dependencies] = await Promise.all([
    tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, graphId)),
    tx
      .select({
        workstreamId: aiCodingWorkstreamDependenciesTable.workstreamId,
        dependsOnWorkstreamId:
          aiCodingWorkstreamDependenciesTable.dependsOnWorkstreamId,
      })
      .from(aiCodingWorkstreamDependenciesTable)
      .where(eq(aiCodingWorkstreamDependenciesTable.graphId, graphId)),
  ]);

  const completed = new Set(
    workstreams
      .filter((item) => item.status === "COMPLETED")
      .map((item) => item.id),
  );
  const deps = new Map<string, string[]>();
  for (const row of dependencies) {
    const list = deps.get(row.workstreamId) ?? [];
    list.push(row.dependsOnWorkstreamId);
    deps.set(row.workstreamId, list);
  }

  const readyIds = workstreams
    .filter(
      (item) =>
        item.status === "PENDING" &&
        (deps.get(item.id) ?? []).every((id) => completed.has(id)),
    )
    .map((item) => item.id);

  if (readyIds.length > 0) {
    await tx
      .update(aiCodingWorkstreamsTable)
      .set({ status: "READY" })
      .where(inArray(aiCodingWorkstreamsTable.id, readyIds));
  }
}

export async function completeCodingWorkstreamClaim(
  workstreamId: string,
  leaseToken: string,
  result: {
    headSha?: string | null;
    resultJson?: Record<string, unknown> | null;
  } = {},
): Promise<AiCodingWorkstream> {
  const now = new Date();
  const headSha =
    result.headSha == null ? null : validateBaseSha(result.headSha);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");

    if (
      !current ||
      !["CLAIMED", "RUNNING"].includes(current.status) ||
      current.leaseToken !== leaseToken ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw new LocalCodingMultiWorkerError(
        "Workstream completion rejected because the lease was lost or expired.",
        "LEASE_LOST",
      );
    }

    const [completed] = await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "COMPLETED",
        headSha,
        resultJson: result.resultJson ?? null,
        completedAt: now,
        heartbeatAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
        errorMessage: null,
      })
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstreamId),
          eq(aiCodingWorkstreamsTable.leaseToken, leaseToken),
        ),
      )
      .returning();

    if (!completed) {
      throw new LocalCodingMultiWorkerError(
        "Workstream completion update was lost.",
        "LEASE_LOST",
      );
    }

    await unlockDependents(tx, completed.graphId);

    const all = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, completed.graphId));
    if (all.every((item) => item.id === completed.id || item.status === "COMPLETED")) {
      await tx
        .update(aiCodingTaskGraphsTable)
        .set({ status: "COMPLETED", completedAt: now })
        .where(eq(aiCodingTaskGraphsTable.id, completed.graphId));
    }

    return completed;
  });
}

export async function failCodingWorkstreamClaim(
  workstreamId: string,
  leaseToken: string,
  errorMessage: string,
): Promise<AiCodingWorkstream> {
  const now = new Date();
  const message = errorMessage.trim().slice(0, 2_000);
  if (!message) {
    throw new LocalCodingMultiWorkerError(
      "Failure reason is required.",
      "INVALID_INPUT",
    );
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");

    if (
      !current ||
      !["CLAIMED", "RUNNING"].includes(current.status) ||
      current.leaseToken !== leaseToken
    ) {
      throw new LocalCodingMultiWorkerError(
        "Workstream failure update rejected because the lease was lost.",
        "LEASE_LOST",
      );
    }

    const [failed] = await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "FAILED",
        errorMessage: message,
        completedAt: now,
        heartbeatAt: now,
        leaseToken: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(aiCodingWorkstreamsTable.id, workstreamId),
          eq(aiCodingWorkstreamsTable.leaseToken, leaseToken),
        ),
      )
      .returning();

    if (!failed) {
      throw new LocalCodingMultiWorkerError(
        "Workstream failure update was lost.",
        "LEASE_LOST",
      );
    }

    // Fail closed: no new workstream may be claimed until a human/replanner
    // explicitly resolves the failed graph.
    await tx
      .update(aiCodingTaskGraphsTable)
      .set({ status: "FAILED" })
      .where(eq(aiCodingTaskGraphsTable.id, failed.graphId));

    return failed;
  });
}
