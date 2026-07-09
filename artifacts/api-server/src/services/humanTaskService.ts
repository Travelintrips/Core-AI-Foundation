/**
 * humanTaskService.ts — Phase 6.5 Human Task Center
 *
 * createTask()    → create a new human task (AI → human handoff)
 * assignTask()    → assign to a user/role
 * acceptTask()    → human accepts the task
 * rejectTask()    → human rejects the task
 * completeTask()  → human marks it done
 * reassignTask()  → re-route to a different user/role
 * expireTask()    → SLA expired — mark + event + audit
 * escalateTask()  → create an escalation task linked to the original
 * listTasks()     → paginated list with filters
 * getTask()       → single task with history
 * getStats()      → analytics aggregates
 * checkSla()      → called by scheduler to expire/warn overdue tasks
 */

import { randomUUID } from "crypto";
import { eq, and, desc, sql, count, avg, gte, lte, ne, inArray } from "drizzle-orm";
import {
  db,
  aiHumanTasksTable,
  aiHumanTaskHistoryTable,
} from "@workspace/db";
import type { AiHumanTask, InsertAiHumanTask } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { logger } from "../lib/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CreateTaskParams {
  sourceModule: string;
  sourceType: string;
  sourceId?: string;
  executionPlanId?: number;
  assignedDepartment?: string;
  assignedUser?: string;
  assignedRole?: string;
  priority?: number;
  reason?: string;
  instructions?: string;
  payloadJson?: Record<string, unknown>;
  dueAt?: Date;
  notificationHookUrl?: string;
}

export interface AssignTaskParams {
  assignedDepartment?: string;
  assignedUser?: string;
  assignedRole?: string;
  performedBy?: string;
  notes?: string;
}

export interface CompleteTaskParams {
  performedBy?: string;
  notes?: string;
  resultPayload?: Record<string, unknown>;
}

export interface RejectTaskParams {
  performedBy?: string;
  notes?: string;
  reason?: string;
}

export interface ReassignTaskParams {
  assignedDepartment?: string;
  assignedUser?: string;
  assignedRole?: string;
  performedBy?: string;
  notes?: string;
}

export interface ListTasksParams {
  status?: string;
  department?: string;
  priority?: number;
  assignedUser?: string;
  sourceModule?: string;
  slaStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateTaskCode(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `HT-${ts}-${rnd}`;
}

async function addHistory(
  taskId: number,
  action: string,
  oldStatus: string | null | undefined,
  newStatus: string | null | undefined,
  performedBy?: string,
  notes?: string,
): Promise<void> {
  await db.insert(aiHumanTaskHistoryTable).values({
    taskId,
    action,
    oldStatus: oldStatus ?? undefined,
    newStatus: newStatus ?? undefined,
    performedBy,
    notes,
  });
}

// ── createTask ─────────────────────────────────────────────────────────────────

export async function createTask(params: CreateTaskParams): Promise<AiHumanTask> {
  const taskCode = generateTaskCode();
  const initialStatus = params.assignedUser || params.assignedDepartment || params.assignedRole
    ? "assigned"
    : "pending";

  const [task] = await db
    .insert(aiHumanTasksTable)
    .values({
      taskCode,
      sourceModule: params.sourceModule,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      executionPlanId: params.executionPlanId,
      assignedDepartment: params.assignedDepartment,
      assignedUser: params.assignedUser,
      assignedRole: params.assignedRole,
      priority: params.priority ?? 50,
      status: initialStatus,
      reason: params.reason,
      instructions: params.instructions,
      payloadJson: params.payloadJson ?? {},
      dueAt: params.dueAt,
      slaStatus: "on_time",
      notificationHookUrl: params.notificationHookUrl,
    } as InsertAiHumanTask)
    .returning();

  await addHistory(task.id, "created", undefined, initialStatus, "system", params.reason);

  await publishSafe({
    eventType: "human.task.created",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode, sourceModule: params.sourceModule, sourceType: params.sourceType, status: initialStatus },
  });

  await logAudit("human_task_center", "create_task", taskCode, "human_task", "success", { taskId: task.id });

  // Fire notification hook if configured (placeholder — connect to Fonnte/WAHA/SMTP later)
  if (task.notificationHookUrl) {
    fireNotificationHook(task.notificationHookUrl, "created", task).catch((err) =>
      logger.warn({ err, taskCode }, "[humanTask] notification hook failed"),
    );
  }

  return task;
}

// ── State machine ──────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  assign:   ["pending", "assigned"],
  accept:   ["assigned"],
  reject:   ["pending", "assigned", "accepted", "in_progress"],
  complete: ["accepted", "in_progress"],
  reassign: ["pending", "assigned", "accepted", "in_progress"],
};

function guardTransition(task: AiHumanTask, action: keyof typeof ALLOWED_TRANSITIONS): void {
  const allowed = ALLOWED_TRANSITIONS[action] ?? [];
  if (!allowed.includes(task.status)) {
    throw Object.assign(
      new Error(`Cannot ${action} task ${task.taskCode}: current status "${task.status}" is not in [${allowed.join(", ")}]`),
      { code: "INVALID_TRANSITION" },
    );
  }
}

// ── assignTask ─────────────────────────────────────────────────────────────────

export async function assignTask(
  taskId: number,
  params: AssignTaskParams,
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  guardTerminal(existing);
  guardTransition(existing, "assign");

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({
      status: "assigned",
      assignedDepartment: params.assignedDepartment ?? existing.assignedDepartment,
      assignedUser: params.assignedUser ?? existing.assignedUser,
      assignedRole: params.assignedRole ?? existing.assignedRole,
    })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(task.id, "assigned", existing.status, "assigned", params.performedBy, params.notes);

  await publishSafe({
    eventType: "human.task.assigned",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode: task.taskCode, assignedUser: params.assignedUser, assignedRole: params.assignedRole },
  });

  return task;
}

// ── acceptTask ─────────────────────────────────────────────────────────────────

export async function acceptTask(
  taskId: number,
  params: { performedBy?: string; notes?: string },
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  guardTerminal(existing);
  guardTransition(existing, "accept");

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(task.id, "accepted", existing.status, "accepted", params.performedBy, params.notes);

  await publishSafe({
    eventType: "human.task.accepted",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode: task.taskCode, performedBy: params.performedBy },
  });

  return task;
}

// ── rejectTask ─────────────────────────────────────────────────────────────────

export async function rejectTask(
  taskId: number,
  params: RejectTaskParams,
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  guardTerminal(existing);
  guardTransition(existing, "reject");

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({
      status: "rejected",
      reason: params.reason ?? existing.reason,
      completedAt: new Date(),
    })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(task.id, "rejected", existing.status, "rejected", params.performedBy, params.notes);

  await publishSafe({
    eventType: "human.task.rejected",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode: task.taskCode, reason: params.reason },
  });

  await logAudit("human_task_center", "reject_task", task.taskCode, "human_task", "success", { taskId: task.id });

  return task;
}

// ── completeTask ───────────────────────────────────────────────────────────────

export async function completeTask(
  taskId: number,
  params: CompleteTaskParams,
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  guardTerminal(existing);
  guardTransition(existing, "complete");

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({
      status: "completed",
      completedAt: new Date(),
      payloadJson: params.resultPayload
        ? { ...(existing.payloadJson as object), result: params.resultPayload }
        : existing.payloadJson,
    })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(task.id, "completed", existing.status, "completed", params.performedBy, params.notes);

  await publishSafe({
    eventType: "human.task.completed",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode: task.taskCode, performedBy: params.performedBy },
  });

  await logAudit("human_task_center", "complete_task", task.taskCode, "human_task", "success", { taskId: task.id });

  return task;
}

// ── reassignTask ───────────────────────────────────────────────────────────────

export async function reassignTask(
  taskId: number,
  params: ReassignTaskParams,
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  guardTerminal(existing);
  guardTransition(existing, "reassign");

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({
      status: "assigned",
      assignedDepartment: params.assignedDepartment ?? existing.assignedDepartment,
      assignedUser: params.assignedUser,
      assignedRole: params.assignedRole ?? existing.assignedRole,
    })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(
    task.id,
    "reassigned",
    existing.status,
    "assigned",
    params.performedBy,
    params.notes ?? `Reassigned to ${params.assignedUser ?? params.assignedRole ?? params.assignedDepartment}`,
  );

  return task;
}

// ── expireTask ─────────────────────────────────────────────────────────────────

export async function expireTask(taskId: number, reason?: string): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);
  if (isTerminal(existing.status)) return existing;

  const [task] = await db
    .update(aiHumanTasksTable)
    .set({ status: "expired", slaStatus: "expired", completedAt: new Date() })
    .where(eq(aiHumanTasksTable.id, taskId))
    .returning();

  await addHistory(task.id, "expired", existing.status, "expired", "system", reason ?? "SLA deadline exceeded");

  await publishSafe({
    eventType: "human.task.overdue",
    sourceModule: "human_task_center",
    sourceId: String(task.id),
    payload: { taskCode: task.taskCode, dueAt: task.dueAt },
  });

  await logAudit("human_task_center", "expire_task", task.taskCode, "human_task", "failure", { taskId: task.id });

  return task;
}

// ── escalateTask ───────────────────────────────────────────────────────────────

export async function escalateTask(
  taskId: number,
  params: { escalateTo?: string; performedBy?: string; notes?: string },
): Promise<AiHumanTask> {
  const existing = await requireTask(taskId);

  // Create an escalation task at higher priority
  const escalated = await createTask({
    sourceModule: "human_task_center",
    sourceType: "escalation",
    sourceId: String(taskId),
    assignedRole: params.escalateTo ?? "Manager",
    priority: Math.min((existing.priority ?? 50) + 30, 100),
    reason: `Escalated from task ${existing.taskCode}`,
    instructions: params.notes ?? existing.instructions ?? undefined,
    payloadJson: { originalTaskId: taskId, originalTaskCode: existing.taskCode },
    dueAt: existing.dueAt ?? undefined,
  });

  await addHistory(existing.id, "escalated", existing.status, existing.status, params.performedBy, `Escalated → task ${escalated.taskCode}`);

  await publishSafe({
    eventType: "human.task.escalated",
    sourceModule: "human_task_center",
    sourceId: String(taskId),
    payload: { taskCode: existing.taskCode, escalatedTaskCode: escalated.taskCode },
  });

  return escalated;
}

// ── listTasks ──────────────────────────────────────────────────────────────────

export async function listTasks(params: ListTasksParams): Promise<{
  items: AiHumanTask[];
  total: number;
  limit: number;
  offset: number;
}> {
  const limit  = Math.min(params.limit  ?? 50, 200);
  const offset = params.offset ?? 0;

  const conditions: ReturnType<typeof eq>[] = [];
  if (params.status)       conditions.push(eq(aiHumanTasksTable.status, params.status));
  if (params.department)   conditions.push(eq(aiHumanTasksTable.assignedDepartment, params.department));
  if (params.assignedUser) conditions.push(eq(aiHumanTasksTable.assignedUser, params.assignedUser));
  if (params.sourceModule) conditions.push(eq(aiHumanTasksTable.sourceModule, params.sourceModule));
  if (params.slaStatus)    conditions.push(eq(aiHumanTasksTable.slaStatus, params.slaStatus));
  if (params.priority !== undefined) conditions.push(eq(aiHumanTasksTable.priority, params.priority));
  if (params.dateFrom)     conditions.push(gte(aiHumanTasksTable.createdAt, new Date(params.dateFrom)));
  if (params.dateTo)       conditions.push(lte(aiHumanTasksTable.createdAt, new Date(params.dateTo)));

  const where = conditions.length ? and(...conditions) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db.select().from(aiHumanTasksTable).where(where).orderBy(desc(aiHumanTasksTable.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(aiHumanTasksTable).where(where),
  ]);

  return { items, total: Number(total), limit, offset };
}

// ── getTask ────────────────────────────────────────────────────────────────────

export async function getTask(taskId: number): Promise<{
  task: AiHumanTask;
  history: typeof aiHumanTaskHistoryTable.$inferSelect[];
}> {
  const task = await requireTask(taskId);
  const history = await db
    .select()
    .from(aiHumanTaskHistoryTable)
    .where(eq(aiHumanTaskHistoryTable.taskId, taskId))
    .orderBy(desc(aiHumanTaskHistoryTable.createdAt));
  return { task, history };
}

// ── getStats ───────────────────────────────────────────────────────────────────

export async function getStats(): Promise<{
  total: number;
  pending: number;
  assigned: number;
  inProgress: number;
  completed: number;
  rejected: number;
  overdue: number;
  expired: number;
  averageCompletionTimeMs: number | null;
  overdueRate: number;
  byDepartment: { department: string; count: number }[];
  bySourceModule: { sourceModule: string; count: number }[];
}> {
  const [statusRows, slaRows, deptRows, moduleRows, avgRow] = await Promise.all([
    // Counts by lifecycle status
    db
      .select({ status: aiHumanTasksTable.status, cnt: count() })
      .from(aiHumanTasksTable)
      .groupBy(aiHumanTasksTable.status),

    // Counts by slaStatus (for accurate overdue metric)
    db
      .select({ slaStatus: aiHumanTasksTable.slaStatus, cnt: count() })
      .from(aiHumanTasksTable)
      .groupBy(aiHumanTasksTable.slaStatus),

    db
      .select({ department: aiHumanTasksTable.assignedDepartment, cnt: count() })
      .from(aiHumanTasksTable)
      .where(sql`assigned_department is not null`)
      .groupBy(aiHumanTasksTable.assignedDepartment),

    db
      .select({ sourceModule: aiHumanTasksTable.sourceModule, cnt: count() })
      .from(aiHumanTasksTable)
      .groupBy(aiHumanTasksTable.sourceModule),

    // Average completion time for completed tasks
    db
      .select({ avgMs: sql<number>`avg(extract(epoch from (completed_at - created_at)) * 1000)` })
      .from(aiHumanTasksTable)
      .where(eq(aiHumanTasksTable.status, "completed")),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of statusRows) {
    byStatus[row.status] = Number(row.cnt);
    total += Number(row.cnt);
  }

  const bySla: Record<string, number> = {};
  for (const row of slaRows) {
    bySla[row.slaStatus] = Number(row.cnt);
  }

  // "overdue" = tasks with slaStatus overdue or expired (SLA metric, not lifecycle status)
  // "expired" = tasks with lifecycle status = "expired"
  const overdue = (bySla["overdue"] ?? 0) + (bySla["expired"] ?? 0);
  const overdueRate = total > 0 ? overdue / total : 0;

  return {
    total,
    pending:    byStatus["pending"]     ?? 0,
    assigned:   byStatus["assigned"]    ?? 0,
    inProgress: byStatus["in_progress"] ?? 0,
    completed:  byStatus["completed"]   ?? 0,
    rejected:   byStatus["rejected"]    ?? 0,
    overdue,
    expired:    byStatus["expired"]     ?? 0,
    averageCompletionTimeMs: avgRow[0]?.avgMs ? Number(avgRow[0].avgMs) : null,
    overdueRate,
    byDepartment: deptRows.map((r) => ({ department: r.department ?? "Unassigned", count: Number(r.cnt) })),
    bySourceModule: moduleRows.map((r) => ({ sourceModule: r.sourceModule, count: Number(r.cnt) })),
  };
}

// ── checkSla ───────────────────────────────────────────────────────────────────

/**
 * Called periodically (e.g. by scheduler) to update SLA status.
 * - Tasks with dueAt within 1h → slaStatus = "warning"
 * - Tasks past dueAt still active → slaStatus = "overdue"
 * - Optionally auto-expire tasks past dueAt by a grace period
 */
export async function checkSla(): Promise<{ warned: number; overdue: number }> {
  const now = new Date();
  const warningThreshold = new Date(now.getTime() + 60 * 60 * 1000); // 1h ahead
  const activeStatuses = ["pending", "assigned", "accepted", "in_progress"];

  // Mark warning
  const warnResult = await db
    .update(aiHumanTasksTable)
    .set({ slaStatus: "warning" })
    .where(
      and(
        inArray(aiHumanTasksTable.status, activeStatuses),
        eq(aiHumanTasksTable.slaStatus, "on_time"),
        sql`due_at is not null`,
        sql`due_at <= ${warningThreshold.toISOString()}::timestamptz`,
        sql`due_at > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();

  // Mark overdue
  const overdueResult = await db
    .update(aiHumanTasksTable)
    .set({ slaStatus: "overdue" })
    .where(
      and(
        inArray(aiHumanTasksTable.status, activeStatuses),
        ne(aiHumanTasksTable.slaStatus, "overdue"),
        sql`due_at is not null`,
        sql`due_at <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning();

  if (overdueResult.length > 0) {
    await publishSafe({
      eventType: "human.task.overdue",
      sourceModule: "human_task_center",
      sourceId: "sla_check",
      payload: { overdueCount: overdueResult.length, taskIds: overdueResult.map((t) => t.id) },
    });
  }

  logger.info({ warned: warnResult.length, overdue: overdueResult.length }, "[humanTask] SLA check complete");
  return { warned: warnResult.length, overdue: overdueResult.length };
}

// ── Internals ──────────────────────────────────────────────────────────────────

async function requireTask(taskId: number): Promise<AiHumanTask> {
  const [task] = await db
    .select()
    .from(aiHumanTasksTable)
    .where(eq(aiHumanTasksTable.id, taskId));
  if (!task) throw Object.assign(new Error(`Human task ${taskId} not found`), { code: "NOT_FOUND" });
  return task;
}

function isTerminal(status: string): boolean {
  return ["completed", "rejected", "cancelled", "expired"].includes(status);
}

function guardTerminal(task: AiHumanTask): void {
  if (isTerminal(task.status)) {
    throw Object.assign(
      new Error(`Task ${task.taskCode} is already in terminal state: ${task.status}`),
      { code: "TERMINAL_STATE" },
    );
  }
}

/**
 * Placeholder notification hook — fire-and-forget.
 * Replace body with actual Fonnte / WAHA / SMTP / push call.
 *
 * Security: only allows HTTPS URLs with non-private/loopback hostnames
 * to prevent SSRF attacks against internal network targets.
 */
async function fireNotificationHook(
  hookUrl: string,
  event: string,
  task: AiHumanTask,
): Promise<void> {
  const parsed = new URL(hookUrl);

  // Only HTTPS allowed
  if (parsed.protocol !== "https:") {
    logger.warn({ hookUrl, taskCode: task.taskCode }, "[humanTask] notification hook rejected — non-HTTPS URL");
    return;
  }

  // Block private/loopback hostnames
  const host = parsed.hostname.toLowerCase();
  const blocklist = ["localhost", "127.", "10.", "172.16.", "192.168.", "::1", "0.0.0.0"];
  if (blocklist.some((prefix) => host === prefix || host.startsWith(prefix))) {
    logger.warn({ hookUrl, taskCode: task.taskCode }, "[humanTask] notification hook rejected — private/loopback target");
    return;
  }

  await fetch(hookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, taskCode: task.taskCode, taskId: task.id, status: task.status }),
    signal: AbortSignal.timeout(5000),
  });
}
