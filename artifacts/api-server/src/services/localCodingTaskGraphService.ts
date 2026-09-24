import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  aiCodingTaskGraphsTable,
  aiCodingWorkstreamDependenciesTable,
  aiCodingWorkstreamsTable,
  db,
  type AiCodingTaskGraph,
  type AiCodingWorkstream,
} from "@workspace/db";
import {
  validateCodingMultiTaskPlanV1,
  type CodingMultiTaskPlanV1,
} from "./localCodingMultiTaskPlannerService.js";

export class LocalCodingTaskGraphError extends Error {
  constructor(
    message: string,
    readonly code:
      | "TASK_MISMATCH"
      | "ACTIVE_GRAPH_EXISTS"
      | "PERSIST_FAILED"
      | "NOT_FOUND"
      | "NOT_READY",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalCodingTaskGraphError";
  }
}

export interface CodingTaskGraphWorkstreamSnapshot {
  id: string;
  key: string;
  title: string;
  role: string;
  instruction: string;
  status: string;
  priority: number;
  ownershipPaths: string[];
  acceptanceCriteria: string[];
  verificationProfiles: string[];
  workerId: string | null;
  branchName: string | null;
  baseSha: string | null;
  headSha: string | null;
  attemptCount: number;
  errorMessage: string | null;
  dependencies: string[];
}

export interface CodingTaskGraphSnapshot {
  graph: AiCodingTaskGraph;
  workstreams: CodingTaskGraphWorkstreamSnapshot[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function canonicalPlan(plan: CodingMultiTaskPlanV1): CodingMultiTaskPlanV1 {
  return {
    version: plan.version,
    taskId: plan.taskId,
    objective: plan.objective,
    workstreams: [...plan.workstreams]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((item) => ({
        ...item,
        dependencies: [...item.dependencies].sort(),
        ownershipPaths: [...item.ownershipPaths].sort(),
        acceptanceCriteria: [...item.acceptanceCriteria],
        verificationProfiles: [...item.verificationProfiles].sort(),
      })),
  };
}

export function hashCodingMultiTaskPlan(planInput: unknown): string {
  const plan = canonicalPlan(validateCodingMultiTaskPlanV1(planInput));
  return createHash("sha256")
    .update(JSON.stringify(plan), "utf8")
    .digest("hex");
}

export function readyPersistedCodingWorkstreams(
  snapshot: CodingTaskGraphSnapshot,
): CodingTaskGraphWorkstreamSnapshot[] {
  const completed = new Set(
    snapshot.workstreams
      .filter((item) => item.status === "COMPLETED")
      .map((item) => item.key),
  );

  return snapshot.workstreams
    .filter(
      (item) =>
        ["PENDING", "READY"].includes(item.status) &&
        item.dependencies.every((dependency) => completed.has(dependency)),
    )
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.key.localeCompare(b.key);
    });
}

async function loadGraphSnapshotById(
  graph: AiCodingTaskGraph,
): Promise<CodingTaskGraphSnapshot> {
  const [workstreams, dependencies] = await Promise.all([
    db
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.graphId, graph.id)),
    db
      .select()
      .from(aiCodingWorkstreamDependenciesTable)
      .where(eq(aiCodingWorkstreamDependenciesTable.graphId, graph.id)),
  ]);

  const keyById = new Map(workstreams.map((item) => [item.id, item.workstreamKey]));
  const dependenciesByWorkstream = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const targetKey = keyById.get(dependency.workstreamId);
    const dependsOnKey = keyById.get(dependency.dependsOnWorkstreamId);
    if (!targetKey || !dependsOnKey) continue;
    const list = dependenciesByWorkstream.get(targetKey) ?? [];
    list.push(dependsOnKey);
    dependenciesByWorkstream.set(targetKey, list);
  }

  return {
    graph,
    workstreams: workstreams
      .map((item) => ({
        id: item.id,
        key: item.workstreamKey,
        title: item.title,
        role: item.role,
        instruction: item.instruction,
        status: item.status,
        priority: item.priority,
        ownershipPaths: stringArray(item.ownershipPaths),
        acceptanceCriteria: stringArray(item.acceptanceCriteria),
        verificationProfiles: stringArray(item.verificationProfiles),
        workerId: item.workerId,
        branchName: item.branchName,
        baseSha: item.baseSha,
        headSha: item.headSha,
        attemptCount: item.attemptCount,
        errorMessage: item.errorMessage,
        dependencies: (dependenciesByWorkstream.get(item.workstreamKey) ?? []).sort(),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export async function getLatestCodingTaskGraph(
  taskId: string,
): Promise<CodingTaskGraphSnapshot | null> {
  const [graph] = await db
    .select()
    .from(aiCodingTaskGraphsTable)
    .where(eq(aiCodingTaskGraphsTable.taskId, taskId))
    .orderBy(desc(aiCodingTaskGraphsTable.version))
    .limit(1);

  return graph ? loadGraphSnapshotById(graph) : null;
}

export async function persistCodingTaskGraph(
  taskId: string,
  planInput: unknown,
): Promise<{ graph: AiCodingTaskGraph; created: boolean }> {
  const plan = canonicalPlan(validateCodingMultiTaskPlanV1(planInput));
  if (plan.taskId !== taskId) {
    throw new LocalCodingTaskGraphError(
      "Coding multi-task plan taskId does not match the target coding task.",
      "TASK_MISMATCH",
      { expectedTaskId: taskId, actualTaskId: plan.taskId },
    );
  }

  const planHash = hashCodingMultiTaskPlan(plan);
  const lockKey = `coding-task-graph:${taskId}`;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
    );

    const [latest] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.taskId, taskId))
      .orderBy(desc(aiCodingTaskGraphsTable.version))
      .limit(1);

    if (latest?.planHash === planHash) {
      return { graph: latest, created: false };
    }
    if (latest && ["APPROVED", "RUNNING"].includes(latest.status)) {
      throw new LocalCodingTaskGraphError(
        "An approved or running coding task graph must be completed/cancelled before replanning.",
        "ACTIVE_GRAPH_EXISTS",
        { graphId: latest.id, status: latest.status, version: latest.version },
      );
    }

    const version = (latest?.version ?? 0) + 1;
    const [graph] = await tx
      .insert(aiCodingTaskGraphsTable)
      .values({
        taskId,
        version,
        contractVersion: plan.version,
        planHash,
        objective: plan.objective,
        status: "PREPARED",
        planJson: plan,
      })
      .returning();

    if (!graph) {
      throw new LocalCodingTaskGraphError(
        "Failed to persist coding task graph.",
        "PERSIST_FAILED",
      );
    }

    const inserted = await tx
      .insert(aiCodingWorkstreamsTable)
      .values(
        plan.workstreams.map((item) => ({
          graphId: graph.id,
          workstreamKey: item.id,
          title: item.title,
          role: item.role,
          instruction: item.instruction,
          status: item.dependencies.length === 0 ? "READY" : "PENDING",
          priority: item.priority,
          ownershipPaths: item.ownershipPaths,
          acceptanceCriteria: item.acceptanceCriteria,
          verificationProfiles: item.verificationProfiles,
        })),
      )
      .returning();

    if (inserted.length !== plan.workstreams.length) {
      throw new LocalCodingTaskGraphError(
        "Persisted workstream count does not match the validated plan.",
        "PERSIST_FAILED",
      );
    }

    const byKey = new Map(inserted.map((item) => [item.workstreamKey, item]));
    const dependencyRows = plan.workstreams.flatMap((item) =>
      item.dependencies.map((dependencyKey) => {
        const workstream = byKey.get(item.id);
        const dependsOn = byKey.get(dependencyKey);
        if (!workstream || !dependsOn) {
          throw new LocalCodingTaskGraphError(
            "Validated dependency could not be mapped to persisted workstreams.",
            "PERSIST_FAILED",
            { workstreamKey: item.id, dependencyKey },
          );
        }
        return {
          graphId: graph.id,
          workstreamId: workstream.id,
          dependsOnWorkstreamId: dependsOn.id,
        };
      }),
    );

    if (dependencyRows.length > 0) {
      await tx.insert(aiCodingWorkstreamDependenciesTable).values(dependencyRows);
    }

    return { graph, created: true };
  });
}

export async function approveCodingTaskGraph(
  taskId: string,
  graphId: string,
): Promise<AiCodingTaskGraph> {
  return db.transaction(async (tx) => {
    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, graphId))
      .for("update");

    if (!graph || graph.taskId !== taskId) {
      throw new LocalCodingTaskGraphError(
        "Coding task graph was not found for this task.",
        "NOT_FOUND",
      );
    }
    if (graph.status !== "PREPARED") {
      throw new LocalCodingTaskGraphError(
        "Only a PREPARED coding task graph can be explicitly approved.",
        "NOT_READY",
        { status: graph.status },
      );
    }

    const [updated] = await tx
      .update(aiCodingTaskGraphsTable)
      .set({
        status: "APPROVED",
        approvedAt: new Date(),
      })
      .where(eq(aiCodingTaskGraphsTable.id, graph.id))
      .returning();

    if (!updated) {
      throw new LocalCodingTaskGraphError(
        "Coding task graph approval did not persist.",
        "PERSIST_FAILED",
      );
    }
    return updated;
  });
}
