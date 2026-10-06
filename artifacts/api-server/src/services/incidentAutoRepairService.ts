import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { aiCodingRunsTable, aiCodingTasksTable, aiIncidentsTable, db } from "@workspace/db";
import { startCodingOrchestration } from "./codingOrchestratorService.js";
import { publishSafe } from "./aiEventBusService.js";
import { logger } from "../lib/logger.js";
import { codingTaskPresentationStatus } from "./codingTaskPresentationService.js";

export type IncidentSource = "github" | "supabase" | "hostinger" | "system";
export type IncidentRisk = "SAFE" | "GUARDED" | "OWNER_APPROVAL";

export interface IncidentInput {
  source: IncidentSource;
  kind: string;
  title: string;
  summary: string;
  severity?: "info" | "warning" | "critical";
  riskClass?: IncidentRisk;
  repository?: string | null;
  branch?: string | null;
  headSha?: string | null;
  environment?: string;
  fingerprint?: string;
  metadata?: Record<string, unknown>;
}

function stableFingerprint(input: IncidentInput): string {
  if (input.fingerprint?.trim()) return input.fingerprint.trim();
  return createHash("sha256").update([
    input.source,
    input.kind,
    input.repository ?? "",
    input.branch ?? "",
    input.headSha ?? "",
    input.environment ?? "production",
    input.title,
  ].join("|")).digest("hex");
}

export function classifyIncidentRisk(source: IncidentSource, kind: string): IncidentRisk {
  const normalized = kind.toLowerCase();
  if (source === "supabase" && /(ddl|schema|migration|constraint|rls|data|trigger|function)/.test(normalized)) {
    return "OWNER_APPROVAL";
  }
  if (source === "system" && /(stale|timeout|retryable)/.test(normalized)) return "SAFE";
  return "GUARDED";
}

const RISK_RANK: Record<IncidentRisk, number> = {
  SAFE: 0,
  GUARDED: 1,
  OWNER_APPROVAL: 2,
};

export function resolveIncidentRisk(
  source: IncidentSource,
  kind: string,
  requested?: IncidentRisk,
): IncidentRisk {
  const classified = classifyIncidentRisk(source, kind);
  if (!requested) return classified;
  return RISK_RANK[requested] > RISK_RANK[classified] ? requested : classified;
}

export async function upsertIncident(input: IncidentInput) {
  const fingerprint = stableFingerprint(input);
  const riskClass = resolveIncidentRisk(input.source, input.kind, input.riskClass);
  const now = new Date();
  const [existing] = await db.select().from(aiIncidentsTable)
    .where(eq(aiIncidentsTable.fingerprint, fingerprint)).limit(1);

  if (existing) {
    const escalated = RISK_RANK[riskClass] > RISK_RANK[existing.riskClass as IncidentRisk];
    const nextStatus = riskClass === "OWNER_APPROVAL"
      ? "BLOCKED"
      : existing.status === "RESOLVED"
        ? "OPEN"
        : existing.status;

    const [updated] = await db.update(aiIncidentsTable).set({
      lastSeenAt: now,
      severity: input.severity ?? existing.severity,
      summary: input.summary,
      metadataJson: { ...(existing.metadataJson as Record<string, unknown> ?? {}), ...(input.metadata ?? {}) },
      ...(escalated ? { riskClass } : {}),
      ...(nextStatus !== existing.status ? { status: nextStatus } : {}),
      ...(existing.status === "RESOLVED" && nextStatus === "OPEN" ? { resolvedAt: null } : {}),
    }).where(eq(aiIncidentsTable.id, existing.id)).returning();
    return updated ?? existing;
  }

  const [row] = await db.insert(aiIncidentsTable).values({
    fingerprint,
    source: input.source,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    severity: input.severity ?? "warning",
    riskClass,
    repository: input.repository ?? null,
    branch: input.branch ?? null,
    headSha: input.headSha ?? null,
    environment: input.environment ?? "production",
    metadataJson: input.metadata ?? {},
    status: riskClass === "OWNER_APPROVAL" ? "BLOCKED" : "OPEN",
  }).returning();
  if (!row) throw new Error("Failed to persist incident");
  publishSafe({eventType:"incident.created",sourceModule:"incident-auto-repair",sourceId:row.id,payload:{source:row.source,kind:row.kind,riskClass:row.riskClass}});
  return row;
}

function repairInstruction(incident: typeof aiIncidentsTable.$inferSelect): string {
  return [
    "INCIDENT AUTO-REPAIR",
    "Source: " + incident.source,
    "Kind: " + incident.kind,
    "Environment: " + incident.environment,
    "Summary: " + incident.summary,
    "",
    "Rules:",
    "- Analyze the failure and prepare the smallest safe fix.",
    "- Advance safe coding, automated QC, sandbox, CI, commit, PR, merge, and deployment steps automatically when their deterministic checks pass.",
    "- Never expose secrets.",
    "- Never force push or bypass branch protection.",
    "- Never execute destructive database DDL/DML automatically.",
    "- Request owner approval only for production database migration, destructive database change, or security-policy change.",
  ].join("\n");
}

export async function processOpenIncidents(limit = 5) {
  const rows = await db.select().from(aiIncidentsTable)
    .where(and(
      inArray(aiIncidentsTable.status, ["OPEN", "TRIAGED"]),
      inArray(aiIncidentsTable.riskClass, ["SAFE", "GUARDED"]),
    ))
    .orderBy(asc(aiIncidentsTable.firstSeenAt))
    .limit(Math.max(1, Math.min(20, limit)));

  let queued = 0;
  for (const incident of rows) {
    if (!incident.repository) {
      await db.update(aiIncidentsTable).set({
        status: "BLOCKED",
        lastError: "Automatic code repair requires a repository binding.",
      }).where(eq(aiIncidentsTable.id, incident.id));
      continue;
    }

    try {
      const result = await db.transaction(async tx => {
        const [locked] = await tx.select().from(aiIncidentsTable)
          .where(eq(aiIncidentsTable.id, incident.id)).for("update");
        if (!locked || !["OPEN","TRIAGED"].includes(locked.status) || locked.repairTaskId) return null;

        const [task] = await tx.insert(aiCodingTasksTable).values({
          taskNumber: "INC-" + randomUUID().slice(0, 8).toUpperCase(),
          projectName: "[Incident] " + locked.title.slice(0, 120),
          repository: locked.repository!,
          branch: locked.branch ?? "main",
          instruction: repairInstruction(locked),
          priority: locked.severity === "critical" ? 100 : 80,
          status: "ANALYZING",
        }).returning();
        if (!task) throw new Error("Failed to create incident repair task");

        const [run] = await tx.insert(aiCodingRunsTable).values({
          taskId: task.id,
          agentName: "Incident Auto-Repair",
          status: "RUNNING",
          startedAt: new Date(),
        }).returning();
        if (!run) throw new Error("Failed to create incident repair run");

        await tx.update(aiIncidentsTable).set({
          status: "REPAIRING",
          repairTaskId: task.id,
          lastError: null,
        }).where(eq(aiIncidentsTable.id, locked.id));

        return { task, run };
      });

      if (!result) continue;
      await startCodingOrchestration(result);
      queued += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ err: error, incidentId: incident.id }, "[incident] auto-repair dispatch failed");
      await db.update(aiIncidentsTable).set({ status: "FAILED", lastError: message.slice(0, 2000) })
        .where(eq(aiIncidentsTable.id, incident.id));
    }
  }
  return { scanned: rows.length, queued };
}

export async function syncIncidentRepairStatuses(limit = 50) {
  const incidents = await db.select().from(aiIncidentsTable)
    .where(inArray(aiIncidentsTable.status, ["REPAIRING", "VERIFYING"]))
    .orderBy(asc(aiIncidentsTable.firstSeenAt))
    .limit(Math.max(1, Math.min(200, limit)));

  let updated = 0;
  for (const incident of incidents) {
    if (!incident.repairTaskId) continue;
    const [task] = await db.select().from(aiCodingTasksTable)
      .where(eq(aiCodingTasksTable.id, incident.repairTaskId))
      .limit(1);
    if (!task) continue;

    const lifecycle = await db.execute(sql`
      SELECT
        a.status AS autonomous_status,
        EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_runs AS active_run
          WHERE active_run.task_id = ${task.id}::uuid
            AND active_run.status = 'RUNNING'
        ) AS has_active_run,
        EXISTS (
          SELECT 1
          FROM ai_platform.ai_coding_critical_approvals AS approval
          WHERE approval.task_id = ${task.id}::uuid
            AND approval.status IN ('PENDING', 'REQUESTED', 'AWAITING_APPROVAL')
        ) AS has_pending_critical_approval
      FROM ai_platform.ai_coding_tasks AS t
      LEFT JOIN ai_platform.ai_coding_autonomous_tasks AS a
        ON a.task_id = t.id
       AND a.enabled = TRUE
      WHERE t.id = ${task.id}::uuid
      LIMIT 1
    `);
    const row = lifecycle.rows?.[0] as {
      autonomous_status?: string | null;
      has_active_run?: boolean;
      has_pending_critical_approval?: boolean;
    } | undefined;
    const presentedStatus = codingTaskPresentationStatus({
      taskStatus: task.status,
      autonomousStatus: row?.autonomous_status ?? null,
      hasActiveRun: row?.has_active_run === true,
      hasPendingCriticalApproval: row?.has_pending_critical_approval === true,
    });

    if (presentedStatus === "FAILED" && incident.status !== "FAILED") {
      await db.update(aiIncidentsTable).set({
        status: "FAILED",
        lastError: task.resultSummary ?? "Associated repair task failed.",
      }).where(eq(aiIncidentsTable.id, incident.id));
      updated += 1;
      continue;
    }

    if (presentedStatus === "READY_REVIEW") {
      if (incident.status !== "BLOCKED") {
        await db.update(aiIncidentsTable).set({
          status: "BLOCKED",
          lastError: "Critical owner approval is required before the repair can continue.",
        }).where(eq(aiIncidentsTable.id, incident.id));
        updated += 1;
      }
      continue;
    }

    if (presentedStatus === "COMPLETED" && incident.status !== "VERIFYING") {
      await db.update(aiIncidentsTable).set({
        status: "VERIFYING",
        lastError: null,
      }).where(eq(aiIncidentsTable.id, incident.id));
      updated += 1;
    }
  }

  return { scanned: incidents.length, updated };
}

export async function listIncidents(limit = 100) {
  return db.select().from(aiIncidentsTable).orderBy(asc(aiIncidentsTable.firstSeenAt)).limit(Math.max(1, Math.min(200, limit)));
}
