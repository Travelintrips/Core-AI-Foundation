import { eq } from "drizzle-orm";
import {
  aiCodingCiBindingsTable,
  aiCodingTaskGraphsTable,
  aiCodingTasksTable,
  aiCodingWorkstreamsTable,
  db,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ALLOWED_ATTEMPTS = 5;
const SHA40_RE = /^[0-9a-f]{40}$/i;
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function resolveCiSelfRepairMaxAttempts(
  value = process.env["AI_CODING_CI_SELF_REPAIR_MAX_ATTEMPTS"],
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ATTEMPTS;
  return Math.max(1, Math.min(MAX_ALLOWED_ATTEMPTS, parsed));
}

export function decideCiSelfRepair(input: {
  eventType: string;
  headSha: string;
  headBranch: string | null;
  previousCheckpoint: unknown;
  maxAttempts?: number;
}):
  | { action: "WAIT_FOR_CHECK_DIAGNOSTICS"; attempt: number }
  | { action: "DUPLICATE"; attempt: number }
  | { action: "EXHAUSTED"; attempt: number; maxAttempts: number }
  | { action: "SCHEDULE"; attempt: number; maxAttempts: number } {
  const previous = isRecord(input.previousCheckpoint)
    ? input.previousCheckpoint
    : {};
  const priorRepair = isRecord(previous.ciSelfRepair)
    ? previous.ciSelfRepair
    : {};
  const priorAttempt =
    typeof priorRepair.attempt === "number" && Number.isInteger(priorRepair.attempt)
      ? priorRepair.attempt
      : 0;
  const maxAttempts = Math.max(
    1,
    Math.min(MAX_ALLOWED_ATTEMPTS, input.maxAttempts ?? resolveCiSelfRepairMaxAttempts()),
  );

  if (input.eventType !== "coding.github.check_run") {
    return { action: "WAIT_FOR_CHECK_DIAGNOSTICS", attempt: priorAttempt };
  }
  if (
    priorRepair.scheduledForHeadSha === input.headSha &&
    priorRepair.status !== "WAITING_CI"
  ) {
    return { action: "DUPLICATE", attempt: priorAttempt };
  }
  const attempt = priorAttempt + 1;
  if (attempt > maxAttempts) {
    return { action: "EXHAUSTED", attempt: priorAttempt, maxAttempts };
  }
  if (
    !input.headBranch ||
    !SAFE_BRANCH_RE.test(input.headBranch) ||
    input.headBranch.startsWith("-")
  ) {
    return { action: "WAIT_FOR_CHECK_DIAGNOSTICS", attempt: priorAttempt };
  }
  return { action: "SCHEDULE", attempt, maxAttempts };
}

export async function scheduleCiSelfRepair(input: {
  bindingId: string;
  eventId: string;
  eventType: string;
  headSha: string;
  headBranch: string | null;
  conclusion: string;
  failureSummary: string | null;
  checkName: string | null;
}): Promise<Record<string, unknown>> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [binding] = await tx
      .select()
      .from(aiCodingCiBindingsTable)
      .where(eq(aiCodingCiBindingsTable.id, input.bindingId))
      .for("update");

    if (!binding || binding.headSha !== input.headSha) {
      return { scheduled: false, reason: "STALE_BINDING" };
    }

    const decision = decideCiSelfRepair({
      eventType: input.eventType,
      headSha: input.headSha,
      headBranch: input.headBranch,
      previousCheckpoint: binding.lastCheckpointJson,
    });

    const [workstream] = await tx
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, binding.workstreamId))
      .for("update");

    if (!workstream) {
      return { scheduled: false, reason: "WORKSTREAM_NOT_FOUND" };
    }

    const priorCheckpoint = isRecord(binding.lastCheckpointJson)
      ? binding.lastCheckpointJson
      : {};
    const failureSummary = (input.failureSummary ?? "GitHub CI check failed.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1800);

    if (decision.action === "WAIT_FOR_CHECK_DIAGNOSTICS") {
      await tx
        .update(aiCodingCiBindingsTable)
        .set({
          state: "FAILED",
          lastCheckpointJson: {
            ...priorCheckpoint,
            eventId: input.eventId,
            eventType: input.eventType,
            conclusion: input.conclusion,
            nextAction: "WAIT_FOR_CHECK_DIAGNOSTICS",
          },
        })
        .where(eq(aiCodingCiBindingsTable.id, binding.id));
      return { scheduled: false, reason: decision.action };
    }

    if (decision.action === "DUPLICATE") {
      return { scheduled: false, reason: "DUPLICATE_REPAIR_EVENT" };
    }

    if (decision.action === "EXHAUSTED") {
      const checkpoint = {
        ...priorCheckpoint,
        eventId: input.eventId,
        eventType: input.eventType,
        conclusion: input.conclusion,
        nextAction: "MANUAL_REVIEW_REQUIRED",
        ciSelfRepair: {
          ...(isRecord(priorCheckpoint.ciSelfRepair)
            ? priorCheckpoint.ciSelfRepair
            : {}),
          status: "EXHAUSTED",
          attempt: decision.attempt,
          maxAttempts: decision.maxAttempts,
          exhaustedAt: now.toISOString(),
        },
      };
      await tx
        .update(aiCodingCiBindingsTable)
        .set({ state: "FAILED", lastCheckpointJson: checkpoint })
        .where(eq(aiCodingCiBindingsTable.id, binding.id));

      publishSafe({
        eventType: "coding.ci.self_repair.exhausted",
        sourceModule: "coding-ci-self-repair",
        sourceId: binding.id,
        correlationId: input.eventId,
        payload: {
          workstreamId: workstream.id,
          headSha: binding.headSha,
          attempts: decision.attempt,
          maxAttempts: decision.maxAttempts,
        },
      });
      return { scheduled: false, reason: "MAX_ATTEMPTS_REACHED" };
    }

    if (!SHA40_RE.test(input.headSha)) {
      return { scheduled: false, reason: "INVALID_HEAD_SHA" };
    }

    const priorResult = isRecord(workstream.resultJson)
      ? workstream.resultJson
      : {};
    const priorContext = isRecord(priorResult.contextPackage)
      ? priorResult.contextPackage
      : {};
    const priorPlan = isRecord(priorResult.localExecutionPlan)
      ? priorResult.localExecutionPlan
      : {};
    const findings = Array.isArray(priorResult.findings)
      ? priorResult.findings.filter(isRecord)
      : [];

    const resultJson = {
      ...priorResult,
      branch: input.headBranch,
      contextPackage: {
        ...priorContext,
        branch: input.headBranch,
        headSha: input.headSha.toLowerCase(),
      },
      localExecutionPlan: {
        ...priorPlan,
        status: "AI_REQUIRED",
        reason:
          "GitHub CI failed on the published PR branch. A bounded constrained AI repair is required.",
        targetFiles:
          strings(priorPlan.targetFiles).length > 0
            ? strings(priorPlan.targetFiles)
            : strings(workstream.ownershipPaths),
      },
      findings: [
        {
          severity: "error",
          title: input.checkName
            ? `CI failure: ${input.checkName}`
            : "CI failure",
          detail: failureSummary,
        },
        ...findings,
      ].slice(0, 30),
      ciSelfRepair: {
        status: "REPAIR_REQUIRED",
        attempt: decision.attempt,
        maxAttempts: decision.maxAttempts,
        eventId: input.eventId,
        eventType: input.eventType,
        repository: binding.repository,
        pullRequestNumber: binding.pullRequestNumber,
        headSha: input.headSha.toLowerCase(),
        headBranch: input.headBranch,
        conclusion: input.conclusion,
        checkName: input.checkName,
        failureSummary,
        scheduledAt: now.toISOString(),
      },
    };

    const [graph] = await tx
      .select()
      .from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId))
      .for("update");

    if (!graph) {
      return { scheduled: false, reason: "GRAPH_NOT_FOUND" };
    }

    await tx
      .update(aiCodingWorkstreamsTable)
      .set({
        status: "REVIEW_REQUIRED",
        baseSha: input.headSha.toLowerCase(),
        headSha: input.headSha.toLowerCase(),
        completedAt: null,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        resultJson,
        errorMessage: failureSummary,
      })
      .where(eq(aiCodingWorkstreamsTable.id, workstream.id));

    await tx
      .update(aiCodingTaskGraphsTable)
      .set({ status: "RUNNING", completedAt: null })
      .where(eq(aiCodingTaskGraphsTable.id, graph.id));

    if (workstream.childTaskId) {
      await tx
        .update(aiCodingTasksTable)
        .set({
          status: "READY_REVIEW",
          commitSha: null,
          resultSummary:
            `CI self-repair attempt ${decision.attempt}/${decision.maxAttempts} scheduled after ${input.checkName ?? "GitHub check"} failed.`,
        })
        .where(eq(aiCodingTasksTable.id, workstream.childTaskId));
    }

    const checkpoint = {
      ...priorCheckpoint,
      eventId: input.eventId,
      eventType: input.eventType,
      conclusion: input.conclusion,
      nextAction: "CI_SELF_REPAIR",
      ciSelfRepair: {
        status: "SCHEDULED",
        attempt: decision.attempt,
        maxAttempts: decision.maxAttempts,
        scheduledForHeadSha: input.headSha.toLowerCase(),
        headBranch: input.headBranch,
        checkName: input.checkName,
        failureSummary,
        scheduledAt: now.toISOString(),
      },
    };

    await tx
      .update(aiCodingCiBindingsTable)
      .set({ state: "REPAIRING", lastCheckpointJson: checkpoint })
      .where(eq(aiCodingCiBindingsTable.id, binding.id));

    publishSafe({
      eventType: "coding.ci.self_repair.scheduled",
      sourceModule: "coding-ci-self-repair",
      sourceId: binding.id,
      correlationId: input.eventId,
      payload: {
        taskId: graph.taskId,
        graphId: graph.id,
        workstreamId: workstream.id,
        attempt: decision.attempt,
        maxAttempts: decision.maxAttempts,
        headSha: input.headSha.toLowerCase(),
        headBranch: input.headBranch,
        approvalGatesPreserved: true,
      },
    });

    return {
      scheduled: true,
      taskId: graph.taskId,
      graphId: graph.id,
      workstreamId: workstream.id,
      attempt: decision.attempt,
      maxAttempts: decision.maxAttempts,
    };
  });
}
