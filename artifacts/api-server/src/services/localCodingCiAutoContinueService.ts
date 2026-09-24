import { eq } from "drizzle-orm";
import { aiCodingCiBindingsTable, aiCodingTaskGraphsTable, aiCodingWorkstreamsTable, db } from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";

export async function continueAfterGreenCi(input: { bindingId: string; eventId: string }) {
  return db.transaction(async (tx) => {
    const [binding] = await tx.select().from(aiCodingCiBindingsTable)
      .where(eq(aiCodingCiBindingsTable.id, input.bindingId)).for("update");
    if (!binding || binding.state !== "GREEN") return { continued: false, reason: "BINDING_NOT_GREEN" as const };

    const [workstream] = await tx.select().from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, binding.workstreamId)).for("update");
    if (!workstream || workstream.headSha !== binding.headSha) return { continued: false, reason: "STALE_HEAD_SHA" as const };

    const [graph] = await tx.select().from(aiCodingTaskGraphsTable)
      .where(eq(aiCodingTaskGraphsTable.id, workstream.graphId)).limit(1);
    if (!graph) return { continued: false, reason: "GRAPH_NOT_FOUND" as const };

    let nextAction = "NO_AUTOMATIC_ACTION";
    if (workstream.status === "COMPLETED") nextAction = "DISPATCH_READY_WORKSTREAMS";
    else if (workstream.status === "REVIEW_REQUIRED") nextAction = "WAIT_FOR_EXPLICIT_REVIEW";
    else if (workstream.status === "FAILED") nextAction = "REVIEW_CI_FAILURE";
    else if (workstream.status === "READY") nextAction = "READY_FOR_EXISTING_WORKER_CLAIM";

    const checkpoint = {
      eventId: input.eventId, taskId: graph.taskId, graphId: graph.id,
      workstreamId: workstream.id, workstreamStatus: workstream.status,
      repository: binding.repository, pullRequestNumber: binding.pullRequestNumber,
      headSha: binding.headSha, nextAction, approvalGatesPreserved: true,
    };
    await tx.update(aiCodingCiBindingsTable).set({ lastCheckpointJson: checkpoint })
      .where(eq(aiCodingCiBindingsTable.id, binding.id));

    publishSafe({ eventType: "coding.ci.checkpoint.ready", sourceModule: "coding-ci-auto-continue",
      sourceId: binding.id, correlationId: input.eventId, payload: checkpoint });
    return { continued: true, ...checkpoint };
  });
}


type GreenCiCheckpoint = Extract<Awaited<ReturnType<typeof continueAfterGreenCi>>, { continued: true }>;

export async function executeGreenCiNextAction(checkpoint: Awaited<ReturnType<typeof continueAfterGreenCi>>) {
  if (!checkpoint.continued || checkpoint.nextAction !== "DISPATCH_READY_WORKSTREAMS") {
    return { executed: false, reason: "NO_BOUNDED_DISPATCH_ACTION" as const };
  }
  const ready = checkpoint as GreenCiCheckpoint;
  const { dispatchReadyCodingWorkstreams } = await import("./localCodingMultiWorkerExecutionService.js");
  const result = await dispatchReadyCodingWorkstreams(ready.graphId, {
    baseSha: ready.headSha,
    maxParallel: 8,
    workerPoolId: "coding-ci-auto-continue",
  });
  publishSafe({
    eventType: "coding.ci.auto_continue.dispatched",
    sourceModule: "coding-ci-auto-continue",
    sourceId: ready.workstreamId,
    correlationId: ready.eventId,
    payload: {
      taskId: ready.taskId,
      graphId: ready.graphId,
      dispatched: result.dispatched.map((item) => item.workstreamId),
      manualReview: result.manualReview.map((item) => item.workstreamId),
      approvalGatesPreserved: true,
    },
  });
  return { executed: true, result };
}
