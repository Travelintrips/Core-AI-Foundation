import { and, desc, eq } from "drizzle-orm";
import {
  aiCodingBridgeCommandsTable,
  aiCodingCiBindingsTable,
  aiCodingTaskGraphsTable,
  aiCodingWorkstreamsTable,
  db,
} from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { appendCodingBridgeResponse } from "./localCodingControlBridgeService.js";
import { scheduleCiSelfRepair } from "./localCodingCiSelfRepairService.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function shouldEmitGithubGreenConversationEvent(input: {
  success: boolean;
  previousState: string | null | undefined;
}): boolean {
  return input.success && input.previousState !== "GREEN";
}

async function emitGithubGreenConversationEvent(input: {
  graphId: string;
  eventId: string;
  repository: string;
  headSha: string;
  pullRequestNumber: string | null;
  checkName: string | null;
}) {
  const [graph] = await db
    .select()
    .from(aiCodingTaskGraphsTable)
    .where(eq(aiCodingTaskGraphsTable.id, input.graphId))
    .limit(1);
  if (!graph) return { emitted: false, reason: "GRAPH_NOT_FOUND" as const };

  const commands = await db
    .select()
    .from(aiCodingBridgeCommandsTable)
    .where(
      and(
        eq(aiCodingBridgeCommandsTable.taskId, graph.taskId),
        eq(aiCodingBridgeCommandsTable.commandType, "EVENT_BINDING"),
      ),
    )
    .orderBy(desc(aiCodingBridgeCommandsTable.createdAt))
    .limit(20);

  const command = commands.find((row) => {
    const metadata = isRecord(row.metadataJson) ? row.metadataJson : {};
    return typeof metadata["conversationId"] === "string" &&
      Boolean(String(metadata["conversationId"]).trim());
  });
  if (!command) return { emitted: false, reason: "NO_CONVERSATION_BINDING" as const };

  await appendCodingBridgeResponse({
    commandId: command.id,
    taskId: graph.taskId,
    kind: "COMPLETED",
    message:
      `GitHub CI is green for ${input.repository} @ ${input.headSha}` +
      (input.pullRequestNumber ? ` (PR #${input.pullRequestNumber})` : "") +
      ". Continue the approved next action without waiting for a manual status check.",
    checkpoint: {
      status: "CI_GREEN",
      eventType: "COMPLETED",
      githubEventId: input.eventId,
      repository: input.repository,
      headSha: input.headSha,
      pullRequestNumber: input.pullRequestNumber,
      checkName: input.checkName,
      autoContinueRequested: true,
    },
    metadata: {
      eventType: "COMPLETED",
      githubCiGreen: true,
      githubEventId: input.eventId,
      repository: input.repository,
      headSha: input.headSha,
      pullRequestNumber: input.pullRequestNumber,
      checkName: input.checkName,
      autoContinueRequested: true,
    },
  });

  return { emitted: true, taskId: graph.taskId, commandId: command.id };
}

type CiPayload = {
  repository?: unknown;
  headSha?: unknown;
  headBranch?: unknown;
  status?: unknown;
  conclusion?: unknown;
  pullRequestNumber?: unknown;
  checkName?: unknown;
  failureSummary?: unknown;
};

export async function handleCodingGithubCiEvent(event: {
  eventId: string;
  eventType: string;
  payloadJson: unknown;
}) {
  const p = (event.payloadJson ?? {}) as CiPayload;
  if (typeof p.repository !== "string" || typeof p.headSha !== "string") {
    return { ok: true, skipped: "missing_binding_keys" };
  }

  const rows = await db
    .select()
    .from(aiCodingCiBindingsTable)
    .where(
      and(
        eq(aiCodingCiBindingsTable.repository, p.repository),
        eq(aiCodingCiBindingsTable.headSha, p.headSha),
      ),
    );
  if (rows.length === 0) return { ok: true, skipped: "unbound_sha" };

  for (const binding of rows) {
    const [ws] = await db
      .select()
      .from(aiCodingWorkstreamsTable)
      .where(eq(aiCodingWorkstreamsTable.id, binding.workstreamId))
      .limit(1);

    if (!ws || ws.headSha !== binding.headSha) {
      await db
        .update(aiCodingCiBindingsTable)
        .set({
          state: "STALE",
          lastCheckpointJson: {
            eventId: event.eventId,
            reason: "workstream_head_sha_mismatch",
          },
        })
        .where(eq(aiCodingCiBindingsTable.id, binding.id));
      continue;
    }

    const completed = p.status === "completed";
    const success = completed && p.conclusion === "success";
    const failure =
      completed &&
      typeof p.conclusion === "string" &&
      p.conclusion !== "success";
    const state = success ? "GREEN" : failure ? "FAILED" : "WAITING";

    const priorCheckpoint =
      binding.lastCheckpointJson &&
      typeof binding.lastCheckpointJson === "object" &&
      !Array.isArray(binding.lastCheckpointJson)
        ? (binding.lastCheckpointJson as Record<string, unknown>)
        : {};

    await db
      .update(aiCodingCiBindingsTable)
      .set({
        state,
        lastCheckpointJson: {
          ...priorCheckpoint,
          eventId: event.eventId,
          eventType: event.eventType,
          status: p.status ?? null,
          conclusion: p.conclusion ?? null,
          pullRequestNumber: p.pullRequestNumber ?? null,
          headBranch: p.headBranch ?? null,
          checkName: p.checkName ?? null,
        },
      })
      .where(eq(aiCodingCiBindingsTable.id, binding.id));

    publishSafe({
      eventType: success
        ? "coding.ci.green"
        : failure
          ? "coding.ci.failed"
          : "coding.ci.progress",
      sourceModule: "coding-ci-gate",
      sourceId: binding.id,
      correlationId: event.eventId,
      payload: {
        workstreamId: binding.workstreamId,
        repository: binding.repository,
        headSha: binding.headSha,
        pullRequestNumber: binding.pullRequestNumber,
        nextAction: success
          ? "CONTINUE_WITH_EXISTING_APPROVAL_GATES"
          : failure
            ? "CI_SELF_REPAIR"
            : "WAIT_FOR_REQUIRED_CHECKS",
      },
    });

    if (success) {
      const { continueAfterGreenCi, executeGreenCiNextAction } = await import(
        "./localCodingCiAutoContinueService.js"
      );
      const checkpoint = await continueAfterGreenCi({
        bindingId: binding.id,
        eventId: event.eventId,
      });
      await executeGreenCiNextAction(checkpoint);

      if (
        checkpoint.continued &&
        shouldEmitGithubGreenConversationEvent({
          success,
          previousState: binding.state,
        })
      ) {
        await emitGithubGreenConversationEvent({
          graphId: checkpoint.graphId,
          eventId: event.eventId,
          repository: binding.repository,
          headSha: binding.headSha,
          pullRequestNumber: binding.pullRequestNumber,
          checkName: typeof p.checkName === "string" ? p.checkName : null,
        });
      }
    } else if (failure) {
      await scheduleCiSelfRepair({
        bindingId: binding.id,
        eventId: event.eventId,
        eventType: event.eventType,
        headSha: p.headSha,
        headBranch: typeof p.headBranch === "string" ? p.headBranch : null,
        conclusion: String(p.conclusion),
        failureSummary:
          typeof p.failureSummary === "string" ? p.failureSummary : null,
        checkName: typeof p.checkName === "string" ? p.checkName : null,
      });
    }
  }

  return { ok: true, bindings: rows.length };
}
