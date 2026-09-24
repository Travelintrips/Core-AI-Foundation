import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  aiCodingTaskGraphsTable,
  aiCodingWorkstreamAiHandoffsTable,
  aiCodingWorkstreamsTable,
  db,
  type AiCodingTaskGraph,
  type AiCodingWorkstream,
  type AiCodingWorkstreamAiHandoff,
} from "@workspace/db";
import { validateCodingMultiTaskPlanV1 } from "./localCodingMultiTaskPlannerService.js";
import { hashCodingMultiTaskPlan } from "./localCodingTaskGraphService.js";

const DEFAULT_TTL_SECONDS = 900;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3_600;
const SHA40_RE = /^[0-9a-f]{40}$/i;
const SHA64_RE = /^[0-9a-f]{64}$/i;

export class LocalCodingWorkstreamAiHandoffError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_CLAIM"
      | "STALE_CONTEXT"
      | "EXPIRED"
      | "REVOKED"
      | "CONSUMED"
      | "INVALID_CONTEXT",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingWorkstreamAiHandoffError";
  }
}

export interface WorkstreamAiHandoffPackageV1 {
  version: 1;
  taskId: string;
  graph: {
    id: string;
    version: number;
    planHash: string;
    objective: string;
  };
  workstream: {
    id: string;
    key: string;
    title: string;
    role: string;
    instruction: string;
    claimAttempt: number;
    branchName: string;
    baseSha: string;
    ownershipPaths: string[];
    acceptanceCriteria: string[];
    verificationProfiles: string[];
  };
  policy: {
    readOnlyContext: true;
    allowedPathScopesOnly: true;
    repositoryConnectorAccess: false;
    shellAccess: false;
    networkAccess: false;
    secretAccess: false;
    envAccess: false;
    directSourceWrite: false;
    commitPushMerge: false;
    modelInvoked: false;
    requiresExplicitApprovalBeforeModel: true;
    oneShotPrivilege: true;
  };
}

export interface ApprovedWorkstreamAiHandoffLease {
  handoffId: string;
  workstreamId: string;
  graphId: string;
  claimAttempt: number;
  package: WorkstreamAiHandoffPackageV1;
  packageHash: string;
  approvedAt: string;
  expiresAt: string;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sameStringArray(left: unknown, right: string[]): boolean {
  const values = strings(left);
  return (
    values.length === right.length &&
    values.every((value, index) => value === right[index])
  );
}

function assertApprovedPlanWorkstreamBinding(
  graph: AiCodingTaskGraph,
  workstream: AiCodingWorkstream,
): void {
  let plan;
  try {
    plan = validateCodingMultiTaskPlanV1(graph.planJson);
  } catch (error) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Persisted coding task graph plan is no longer a valid Plan V1 contract.",
      "STALE_CONTEXT",
      { graphId: graph.id, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  if (
    plan.taskId !== graph.taskId ||
    hashCodingMultiTaskPlan(plan) !== graph.planHash.toLowerCase()
  ) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Persisted coding task graph no longer matches its approved plan hash.",
      "STALE_CONTEXT",
      { graphId: graph.id },
    );
  }

  const planned = plan.workstreams.find(
    (item) => item.id === workstream.workstreamKey,
  );
  if (
    !planned ||
    planned.title !== workstream.title ||
    planned.role !== workstream.role ||
    planned.instruction !== workstream.instruction ||
    planned.priority !== workstream.priority ||
    !sameStringArray(workstream.ownershipPaths, planned.ownershipPaths) ||
    !sameStringArray(
      workstream.acceptanceCriteria,
      planned.acceptanceCriteria,
    ) ||
    !sameStringArray(
      workstream.verificationProfiles,
      planned.verificationProfiles,
    )
  ) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Persisted workstream no longer matches the explicitly approved task graph.",
      "STALE_CONTEXT",
      {
        graphId: graph.id,
        workstreamId: workstream.id,
        workstreamKey: workstream.workstreamKey,
      },
    );
  }
}

function assertGraphBinding(graph: AiCodingTaskGraph): void {
  if (!SHA64_RE.test(graph.planHash)) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Coding task graph is missing a valid plan hash.",
      "INVALID_CONTEXT",
      { graphId: graph.id },
    );
  }
  if (!["APPROVED", "RUNNING"].includes(graph.status)) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Coding task graph is not approved for worker AI handoffs.",
      "NOT_READY",
      { graphId: graph.id, status: graph.status },
    );
  }
}

function assertFreshClaim(
  workstream: AiCodingWorkstream,
  now: Date,
): void {
  if (!["CLAIMED", "RUNNING"].includes(workstream.status)) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream is not owned by an active worker claim.",
      "NOT_READY",
      { workstreamId: workstream.id, status: workstream.status },
    );
  }
  if (
    workstream.attemptCount <= 0 ||
    !workstream.workerId ||
    !workstream.leaseToken ||
    !workstream.leaseExpiresAt ||
    workstream.leaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream worker lease is missing or expired.",
      "STALE_CLAIM",
      { workstreamId: workstream.id, attempt: workstream.attemptCount },
    );
  }
  if (!workstream.branchName || !SHA40_RE.test(workstream.baseSha ?? "")) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream claim is missing isolated branch/base SHA binding.",
      "INVALID_CONTEXT",
      { workstreamId: workstream.id },
    );
  }
}

export function buildWorkstreamAiHandoffPackage(
  graph: AiCodingTaskGraph,
  workstream: AiCodingWorkstream,
): WorkstreamAiHandoffPackageV1 {
  assertGraphBinding(graph);
  if (graph.id !== workstream.graphId) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream does not belong to the supplied task graph.",
      "INVALID_CONTEXT",
    );
  }
  assertApprovedPlanWorkstreamBinding(graph, workstream);
  if (workstream.attemptCount <= 0 || !workstream.branchName) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream has not been claimed for an isolated execution attempt.",
      "INVALID_CONTEXT",
    );
  }
  const baseSha = (workstream.baseSha ?? "").toLowerCase();
  if (!SHA40_RE.test(baseSha)) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream is missing a valid base Git SHA.",
      "INVALID_CONTEXT",
    );
  }

  return {
    version: 1,
    taskId: graph.taskId,
    graph: {
      id: graph.id,
      version: graph.version,
      planHash: graph.planHash.toLowerCase(),
      objective: graph.objective,
    },
    workstream: {
      id: workstream.id,
      key: workstream.workstreamKey,
      title: workstream.title,
      role: workstream.role,
      instruction: workstream.instruction,
      claimAttempt: workstream.attemptCount,
      branchName: workstream.branchName,
      baseSha,
      ownershipPaths: [...strings(workstream.ownershipPaths)].sort(),
      acceptanceCriteria: [...strings(workstream.acceptanceCriteria)],
      verificationProfiles: [...strings(workstream.verificationProfiles)].sort(),
    },
    policy: {
      readOnlyContext: true,
      allowedPathScopesOnly: true,
      repositoryConnectorAccess: false,
      shellAccess: false,
      networkAccess: false,
      secretAccess: false,
      envAccess: false,
      directSourceWrite: false,
      commitPushMerge: false,
      modelInvoked: false,
      requiresExplicitApprovalBeforeModel: true,
      oneShotPrivilege: true,
    },
  };
}

export function hashWorkstreamAiHandoffPackage(
  pkg: WorkstreamAiHandoffPackageV1,
): string {
  return createHash("sha256")
    .update(JSON.stringify(pkg), "utf8")
    .digest("hex");
}

export function resolveWorkstreamAiHandoffTtlSeconds(
  value = process.env["AI_CODING_WORKSTREAM_HANDOFF_TTL_SECONDS"],
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, parsed));
}

function iso(value: Date): string {
  return value.toISOString();
}

function leaseFromRow(
  row: AiCodingWorkstreamAiHandoff,
): ApprovedWorkstreamAiHandoffLease {
  if (!row.approvedAt || !row.expiresAt) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Approved workstream AI handoff is missing approval timestamps.",
      "INVALID_CONTEXT",
    );
  }
  return {
    handoffId: row.id,
    workstreamId: row.workstreamId,
    graphId: row.graphId,
    claimAttempt: row.claimAttempt,
    package: row.packageJson as WorkstreamAiHandoffPackageV1,
    packageHash: row.packageHash,
    approvedAt: iso(row.approvedAt),
    expiresAt: iso(row.expiresAt),
  };
}

function assertRowFresh(
  row: AiCodingWorkstreamAiHandoff,
  graph: AiCodingTaskGraph,
  workstream: AiCodingWorkstream,
  now: Date,
): WorkstreamAiHandoffPackageV1 {
  if (row.status === "REVOKED") {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff was revoked.",
      "REVOKED",
    );
  }
  if (row.status === "CONSUMED") {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff one-shot privilege was already consumed.",
      "CONSUMED",
      { consumedExecutionId: row.consumedExecutionId },
    );
  }

  assertGraphBinding(graph);
  assertFreshClaim(workstream, now);

  if (
    row.graphId !== graph.id ||
    row.workstreamId !== workstream.id ||
    row.claimAttempt !== workstream.attemptCount ||
    row.planHash.toLowerCase() !== graph.planHash.toLowerCase() ||
    row.baseSha.toLowerCase() !== (workstream.baseSha ?? "").toLowerCase()
  ) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff no longer matches its graph/claim binding.",
      "STALE_CONTEXT",
    );
  }

  const pkg = buildWorkstreamAiHandoffPackage(graph, workstream);
  const currentHash = hashWorkstreamAiHandoffPackage(pkg);
  if (currentHash !== row.packageHash.toLowerCase()) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff package changed after preparation.",
      "STALE_CONTEXT",
      {
        expectedPackageHash: row.packageHash,
        currentPackageHash: currentHash,
      },
    );
  }
  return pkg;
}

async function loadGraphAndWorkstream(
  workstreamId: string,
): Promise<{
  graph: AiCodingTaskGraph;
  workstream: AiCodingWorkstream;
}> {
  const [workstream] = await db
    .select()
    .from(aiCodingWorkstreamsTable)
    .where(eq(aiCodingWorkstreamsTable.id, workstreamId));
  if (!workstream) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Coding workstream not found.",
      "NOT_FOUND",
    );
  }
  const [graph] = await db
    .select()
    .from(aiCodingTaskGraphsTable)
    .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
  if (!graph) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Coding task graph not found.",
      "NOT_FOUND",
    );
  }
  return { graph, workstream };
}

export async function prepareWorkstreamAiHandoff(
  workstreamId: string,
  now = new Date(),
): Promise<{ handoff: AiCodingWorkstreamAiHandoff; created: boolean }> {
  const lockKey = `coding-workstream-ai-handoff:${workstreamId}`;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");
    if (!workstream) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding workstream not found.",
        "NOT_FOUND",
      );
    }

    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
    if (!graph) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }

    assertGraphBinding(graph);
    assertFreshClaim(workstream, now);

    const pkg = buildWorkstreamAiHandoffPackage(graph, workstream);
    const packageHash = hashWorkstreamAiHandoffPackage(pkg);

    const [existing] = await tx
      .select()
      .from(aiCodingWorkstreamAiHandoffsTable)
      .where(
        and(
          eq(aiCodingWorkstreamAiHandoffsTable.workstreamId, workstream.id),
          eq(
            aiCodingWorkstreamAiHandoffsTable.claimAttempt,
            workstream.attemptCount,
          ),
        ),
      )
      .limit(1);

    if (existing) {
      if (
        existing.packageHash.toLowerCase() === packageHash &&
        ["PREPARED", "APPROVED"].includes(existing.status)
      ) {
        return { handoff: existing, created: false };
      }
      throw new LocalCodingWorkstreamAiHandoffError(
        "This workstream claim attempt already has a terminal or stale AI handoff.",
        existing.status === "CONSUMED"
          ? "CONSUMED"
          : existing.status === "REVOKED"
            ? "REVOKED"
            : "STALE_CONTEXT",
        { handoffId: existing.id, status: existing.status },
      );
    }

    const [handoff] = await tx
      .insert(aiCodingWorkstreamAiHandoffsTable)
      .values({
        graphId: graph.id,
        workstreamId: workstream.id,
        claimAttempt: workstream.attemptCount,
        packageVersion: 1,
        packageHash,
        planHash: graph.planHash.toLowerCase(),
        baseSha: (workstream.baseSha ?? "").toLowerCase(),
        status: "PREPARED",
        packageJson: pkg,
        preparedAt: now,
      })
      .returning();

    if (!handoff) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Failed to persist workstream AI handoff.",
        "INVALID_CONTEXT",
      );
    }
    return { handoff, created: true };
  });
}

export async function approveWorkstreamAiHandoff(
  workstreamId: string,
  handoffId: string,
  now = new Date(),
): Promise<ApprovedWorkstreamAiHandoffLease> {
  const ttlSeconds = resolveWorkstreamAiHandoffTtlSeconds();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1_000);

  return db.transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(aiCodingWorkstreamAiHandoffsTable)
      .where(eq(aiCodingWorkstreamAiHandoffsTable.id, handoffId))
      .for("update");
    if (!handoff || handoff.workstreamId !== workstreamId) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff not found.",
        "NOT_FOUND",
      );
    }
    if (handoff.status !== "PREPARED") {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Only a PREPARED workstream AI handoff can be explicitly approved.",
        handoff.status === "REVOKED"
          ? "REVOKED"
          : handoff.status === "CONSUMED"
            ? "CONSUMED"
            : "NOT_READY",
        { status: handoff.status },
      );
    }

    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");
    if (!workstream) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding workstream not found.",
        "NOT_FOUND",
      );
    }
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
    if (!graph) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }

    assertRowFresh(handoff, graph, workstream, now);

    const [approved] = await tx
      .update(aiCodingWorkstreamAiHandoffsTable)
      .set({
        status: "APPROVED",
        approvedAt: now,
        expiresAt,
        revokedAt: null,
      })
      .where(
        and(
          eq(aiCodingWorkstreamAiHandoffsTable.id, handoff.id),
          eq(aiCodingWorkstreamAiHandoffsTable.status, "PREPARED"),
        ),
      )
      .returning();

    if (!approved) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff approval lost a concurrent update.",
        "NOT_READY",
      );
    }
    return leaseFromRow(approved);
  });
}

export async function assertApprovedWorkstreamAiHandoffFresh(
  workstreamId: string,
  now = new Date(),
): Promise<ApprovedWorkstreamAiHandoffLease> {
  const { graph, workstream } = await loadGraphAndWorkstream(workstreamId);
  const [handoff] = await db
    .select()
    .from(aiCodingWorkstreamAiHandoffsTable)
    .where(eq(aiCodingWorkstreamAiHandoffsTable.workstreamId, workstreamId))
    .orderBy(desc(aiCodingWorkstreamAiHandoffsTable.claimAttempt))
    .limit(1);

  if (!handoff) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Approved workstream AI handoff was not found.",
      "NOT_READY",
    );
  }
  if (handoff.status !== "APPROVED") {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff is not approved.",
      handoff.status === "REVOKED"
        ? "REVOKED"
        : handoff.status === "CONSUMED"
          ? "CONSUMED"
          : "NOT_READY",
      { status: handoff.status },
    );
  }

  assertRowFresh(handoff, graph, workstream, now);
  if (!handoff.expiresAt || handoff.expiresAt.getTime() <= now.getTime()) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Workstream AI handoff approval lease expired.",
      "EXPIRED",
      { expiresAt: handoff.expiresAt?.toISOString() ?? null },
    );
  }
  return leaseFromRow(handoff);
}

export async function consumeApprovedWorkstreamAiHandoff(
  workstreamId: string,
  expectedPackageHash: string,
  executionId: string,
  now = new Date(),
): Promise<ApprovedWorkstreamAiHandoffLease> {
  if (!SHA64_RE.test(expectedPackageHash)) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "Expected workstream package hash is invalid.",
      "INVALID_CONTEXT",
    );
  }
  const normalizedExecutionId = executionId.trim().slice(0, 200);
  if (!normalizedExecutionId) {
    throw new LocalCodingWorkstreamAiHandoffError(
      "executionId is required to consume the one-shot privilege.",
      "INVALID_CONTEXT",
    );
  }

  return db.transaction(async (tx) => {
    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, workstreamId))
      .for("update");
    if (!workstream) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding workstream not found.",
        "NOT_FOUND",
      );
    }
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId));
    if (!graph) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Coding task graph not found.",
        "NOT_FOUND",
      );
    }
    const [handoff] = await tx
      .select()
      .from(aiCodingWorkstreamAiHandoffsTable)
      .where(
        and(
          eq(aiCodingWorkstreamAiHandoffsTable.workstreamId, workstreamId),
          eq(
            aiCodingWorkstreamAiHandoffsTable.claimAttempt,
            workstream.attemptCount,
          ),
        ),
      )
      .for("update");

    if (!handoff) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Approved workstream AI handoff was not found.",
        "NOT_READY",
      );
    }
    if (handoff.status !== "APPROVED") {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff one-shot privilege is not available.",
        handoff.status === "CONSUMED"
          ? "CONSUMED"
          : handoff.status === "REVOKED"
            ? "REVOKED"
            : "NOT_READY",
        { status: handoff.status },
      );
    }

    const pkg = assertRowFresh(handoff, graph, workstream, now);
    if (
      handoff.packageHash.toLowerCase() !== expectedPackageHash.toLowerCase()
    ) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff package hash does not match the execution request.",
        "STALE_CONTEXT",
      );
    }
    if (!handoff.expiresAt || handoff.expiresAt.getTime() <= now.getTime()) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff approval lease expired before consumption.",
        "EXPIRED",
      );
    }

    const approvedLease = leaseFromRow({
      ...handoff,
      packageJson: pkg,
    });

    const [consumed] = await tx
      .update(aiCodingWorkstreamAiHandoffsTable)
      .set({
        status: "CONSUMED",
        consumedAt: now,
        consumedExecutionId: normalizedExecutionId,
      })
      .where(
        and(
          eq(aiCodingWorkstreamAiHandoffsTable.id, handoff.id),
          eq(aiCodingWorkstreamAiHandoffsTable.status, "APPROVED"),
        ),
      )
      .returning();

    if (!consumed) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI one-shot privilege was consumed concurrently.",
        "CONSUMED",
      );
    }
    return approvedLease;
  });
}

export async function revokeWorkstreamAiHandoff(
  workstreamId: string,
  now = new Date(),
): Promise<AiCodingWorkstreamAiHandoff> {
  return db.transaction(async (tx) => {
    const [handoff] = await tx
      .select()
      .from(aiCodingWorkstreamAiHandoffsTable)
      .where(eq(aiCodingWorkstreamAiHandoffsTable.workstreamId, workstreamId))
      .orderBy(desc(aiCodingWorkstreamAiHandoffsTable.claimAttempt))
      .for("update");

    if (!handoff) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff not found.",
        "NOT_FOUND",
      );
    }
    if (!["PREPARED", "APPROVED"].includes(handoff.status)) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff cannot be revoked from its current state.",
        handoff.status === "CONSUMED" ? "CONSUMED" : "NOT_READY",
        { status: handoff.status },
      );
    }

    const [revoked] = await tx
      .update(aiCodingWorkstreamAiHandoffsTable)
      .set({
        status: "REVOKED",
        revokedAt: now,
      })
      .where(eq(aiCodingWorkstreamAiHandoffsTable.id, handoff.id))
      .returning();

    if (!revoked) {
      throw new LocalCodingWorkstreamAiHandoffError(
        "Workstream AI handoff revoke did not persist.",
        "INVALID_CONTEXT",
      );
    }
    return revoked;
  });
}
