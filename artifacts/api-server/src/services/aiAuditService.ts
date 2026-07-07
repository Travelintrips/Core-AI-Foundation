import { db, aiAuditLogsTable } from "@workspace/db";

/**
 * Centralized audit logger. Never throws — audit failures must not break main flow.
 */
export async function logAudit(
  module: string,
  action: string,
  resourceId: string,
  resourceType: string,
  status: "success" | "failure" = "success",
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(aiAuditLogsTable).values({
      module,
      action,
      resourceId,
      resourceType,
      status,
      details: details ?? null,
    });
  } catch (err) {
    console.error("[aiAuditService] Failed to write audit log:", err);
  }
}
