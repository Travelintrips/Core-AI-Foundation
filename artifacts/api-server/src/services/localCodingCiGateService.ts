import { and, eq } from "drizzle-orm";
import { aiCodingCiBindingsTable, aiCodingWorkstreamsTable, db } from "@workspace/db";
import { publishSafe } from "./aiEventBusService.js";
import { scheduleCiSelfRepair } from "./localCodingCiSelfRepairService.js";

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
