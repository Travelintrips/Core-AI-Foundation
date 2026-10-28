/** Read-only completion evidence from persisted AI Core bridge events.
 * This snapshot is diagnostic, NOT a trusted CI/deployment attestation.
 * It must never directly authorize outbound WhatsApp.
 */
import { asc, eq } from "drizzle-orm";
import { aiCodingBridgeResponsesTable, aiCodingTasksTable, db } from "@workspace/db";

export async function getCodingTaskCompletionEvidence(taskId: string) {
  const [task] = await db.select({ status: aiCodingTasksTable.status })
    .from(aiCodingTasksTable).where(eq(aiCodingTasksTable.id, taskId)).limit(1);
  if (!task) return { found: false as const, taskId, notificationAuthorized: false };
  const rows = await db.select({
    id: aiCodingBridgeResponsesTable.id,
    kind: aiCodingBridgeResponsesTable.kind,
    commandId: aiCodingBridgeResponsesTable.commandId,
    createdAt: aiCodingBridgeResponsesTable.createdAt,
    acknowledgedAt: aiCodingBridgeResponsesTable.acknowledgedAt,
  }).from(aiCodingBridgeResponsesTable)
    .where(eq(aiCodingBridgeResponsesTable.taskId, taskId))
    .orderBy(asc(aiCodingBridgeResponsesTable.createdAt));
  // Terminal events must belong to the same command as ACK.
  // An ACK from a previous job cannot validate a different command's completion.
  const completionCommands = new Set(rows.filter(r => r.kind === "COMPLETED").map(r => r.commandId));
  const matchingAck = rows.some(r => r.kind === "ACK" && completionCommands.has(r.commandId));
  const kinds = new Set(rows.map(r => r.kind));
  return {
    found: true as const, taskId, status: task.status,
    events: rows.map(r => ({
      id: r.id, commandId: r.commandId, kind: r.kind,
      createdAt: r.createdAt, acknowledgedAt: r.acknowledgedAt,
    })),
    hasAck: kinds.has("ACK"), hasProgress: kinds.has("PROGRESS"),
    hasCompletedEvent: kinds.has("COMPLETED"),
    hasFailedEvent: kinds.has("FAILED"),
    bridgeCompleted: task.status === "COMPLETED" && matchingAck && kinds.has("COMPLETED"),
    trustedCiVerified: false, trustedDeploymentVerified: false,
    trustedProductionE2eVerified: false,
    notificationAuthorized: false,
  };
}
