/**
 * Department Manager Service — Phase 4.9
 * Handles task assignment, review, approval, rejection, revision,
 * and workload rebalancing within a department.
 */
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  db,
  aiTaskAssignmentsTable,
  aiDecisionLogsTable,
  aiEmployeesTable,
  aiWorkloadTable,
  aiExecutionPlansTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { releaseCapacity, claimCapacity } from "./capacityService.js";
import { recordTaskCompletion } from "./performanceService.js";

// ── Task Assignment ────────────────────────────────────────────────────────────

/** Assign a task to an employee; verifies capacity first. */
export async function assignTask(
  taskId: number,
  employeeId: number,
  managerId?: number,
): Promise<{ success: boolean; reason?: string }> {
  const [task] = await db
    .select()
    .from(aiTaskAssignmentsTable)
    .where(eq(aiTaskAssignmentsTable.id, taskId));

  if (!task) return { success: false, reason: "Task not found" };
  if (!["pending", "revision_requested"].includes(task.status)) {
    return { success: false, reason: `Task is in ${task.status} — cannot reassign` };
  }

  // Claim capacity first (atomic), then atomically flip the task out of its
  // current pending/revision_requested state so two concurrent callers can't
  // both succeed for the same task (the second update affects 0 rows).
  const claimed = await claimCapacity(employeeId);
  if (!claimed) return { success: false, reason: "Employee at capacity" };

  const [updated] = await db
    .update(aiTaskAssignmentsTable)
    .set({ employeeId, status: "in_progress", startedAt: new Date() })
    .where(
      and(
        eq(aiTaskAssignmentsTable.id, taskId),
        inArray(aiTaskAssignmentsTable.status, ["pending", "revision_requested"]),
      ),
    )
    .returning();

  if (!updated) {
    // Lost the race — someone else already moved this task. Give back the slot.
    await releaseCapacity(employeeId, true);
    return { success: false, reason: "Task was already claimed by another assignment" };
  }

  // Manager decision log
  const [emp] = await db.select().from(aiEmployeesTable).where(eq(aiEmployeesTable.id, employeeId));
  await db.insert(aiDecisionLogsTable).values({
    executionPlanId: task.executionPlanId,
    decisionBy:      managerId ? `manager_${managerId}` : "manager",
    decisionType:    "task_assignment",
    reason:          `Task "${task.taskName}" assigned to ${emp?.employeeName ?? employeeId}`,
    selectedEmployee: emp?.employeeName ?? String(employeeId),
    score:           "80.00",
  }).catch(() => {});

  return { success: true };
}

/** Complete a task — release capacity and update performance. */
export async function completeTask(
  taskId: number,
  outcome: "success" | "failure",
  output?: Record<string, unknown>,
  latencyMs?: number,
  costUsd?: number,
): Promise<void> {
  const [task] = await db
    .select()
    .from(aiTaskAssignmentsTable)
    .where(eq(aiTaskAssignmentsTable.id, taskId));

  if (!task) return;

  await db
    .update(aiTaskAssignmentsTable)
    .set({
      status:      outcome === "success" ? "completed" : "failed",
      completedAt: new Date(),
      output:      output ?? null,
    })
    .where(eq(aiTaskAssignmentsTable.id, taskId));

  if (task.employeeId) {
    await releaseCapacity(task.employeeId, outcome === "success");
    await recordTaskCompletion(task.employeeId, outcome, latencyMs, costUsd);
  }
}

/** Manager reviews and approves a completed task. */
export async function reviewTask(taskId: number, managerId: number) {
  const [task] = await db.select().from(aiTaskAssignmentsTable).where(eq(aiTaskAssignmentsTable.id, taskId));
  if (!task) return { success: false, reason: "Task not found" };

  await logAudit("manager", "task_reviewed", String(taskId), "task_assignment", "success", {
    managerId, taskName: task.taskName,
  }).catch(() => {});

  return { success: true };
}

/** Manager approves a task — logs decision. */
export async function approveTask(taskId: number, managerId: number) {
  await db.insert(aiDecisionLogsTable).values({
    decisionBy:   `manager_${managerId}`,
    decisionType: "approval",
    reason:       `Task ${taskId} approved by manager`,
    score:        "100.00",
  }).catch(() => {});

  return { success: true };
}

/** Manager rejects a task — marks failed. */
export async function rejectTask(taskId: number, managerId: number, reason: string) {
  const TERMINAL = ["completed", "failed", "cancelled"];
  const [task] = await db.select().from(aiTaskAssignmentsTable).where(eq(aiTaskAssignmentsTable.id, taskId));
  if (!task) return { success: false, reason: "Task not found" };
  if (TERMINAL.includes(task.status)) {
    return { success: false, reason: `Task is already ${task.status}` };
  }

  const [updated] = await db
    .update(aiTaskAssignmentsTable)
    .set({ status: "failed" })
    .where(and(eq(aiTaskAssignmentsTable.id, taskId), sql`${aiTaskAssignmentsTable.status} NOT IN ('completed','failed','cancelled')`))
    .returning();

  if (!updated) return { success: false, reason: "Task state changed concurrently" };

  // Release the employee's capacity slot — this task is no longer running.
  if (task.employeeId && task.status === "in_progress") {
    await releaseCapacity(task.employeeId, false);
    await recordTaskCompletion(task.employeeId, "failure");
  }

  await db.insert(aiDecisionLogsTable).values({
    executionPlanId: task.executionPlanId,
    decisionBy:      `manager_${managerId}`,
    decisionType:    "rejection",
    reason:          reason.slice(0, 500),
    score:           "0.00",
  }).catch(() => {});

  return { success: true };
}

/**
 * Manager requests revision — increments revision_count, re-queues task, and
 * releases the previously-assigned employee's capacity slot (the task is no
 * longer occupying their running-jobs count while it awaits reassignment).
 */
export async function requestRevision(taskId: number, managerId: number, notes: string) {
  const [task] = await db.select().from(aiTaskAssignmentsTable).where(eq(aiTaskAssignmentsTable.id, taskId));
  if (!task) return { success: false, reason: "Task not found" };

  const wasInProgress = task.status === "in_progress";

  const [updated] = await db
    .update(aiTaskAssignmentsTable)
    .set({
      status:        "revision_requested",
      revisionCount: task.revisionCount + 1,
      completedAt:   null,
    })
    .where(and(eq(aiTaskAssignmentsTable.id, taskId), eq(aiTaskAssignmentsTable.status, task.status)))
    .returning();

  if (!updated) return { success: false, reason: "Task state changed concurrently" };

  if (task.employeeId) {
    if (wasInProgress) {
      // Free the capacity slot; the task will re-claim one on reassignment.
      await releaseCapacity(task.employeeId, false);
    }
    await recordTaskCompletion(task.employeeId, "revision");
  }

  await db.insert(aiDecisionLogsTable).values({
    executionPlanId: task.executionPlanId,
    decisionBy:      `manager_${managerId}`,
    decisionType:    "revision",
    reason:          notes.slice(0, 500),
    score:           "50.00",
  }).catch(() => {});

  return { success: true };
}

/** Rebalance workload — move pending tasks away from overloaded employees. */
export async function rebalanceWorkload(departmentId: number): Promise<{
  moved: number;
  details: string[];
}> {
  // Find all active employees in department
  const employees = await db
    .select({
      employee: aiEmployeesTable,
      workload:  aiWorkloadTable,
    })
    .from(aiEmployeesTable)
    .leftJoin(aiWorkloadTable, eq(aiWorkloadTable.employeeId, aiEmployeesTable.id))
    .where(
      and(
        eq(aiEmployeesTable.departmentId, departmentId),
        eq(aiEmployeesTable.status, "active"),
      ),
    );

  const overloaded = employees.filter(
    (e) => {
      const running = e.workload?.runningJobs ?? 0;
      const max     = e.employee.maxParallelJobs;
      return running >= max;
    },
  );

  const available = employees.filter(
    (e) => {
      const running = e.workload?.runningJobs ?? 0;
      const max     = e.employee.maxParallelJobs;
      return running < max;
    },
  );

  if (overloaded.length === 0 || available.length === 0) {
    return { moved: 0, details: ["No rebalancing needed"] };
  }

  const details: string[] = [];
  let moved = 0;

  // Move pending tasks from overloaded to available employees
  for (const over of overloaded) {
    const pendingTasks = await db
      .select()
      .from(aiTaskAssignmentsTable)
      .where(
        and(
          eq(aiTaskAssignmentsTable.employeeId, over.employee.id),
          eq(aiTaskAssignmentsTable.status, "pending"),
        ),
      )
      .limit(2);

    for (const task of pendingTasks) {
      const target = available.find(
        (e) => (e.workload?.runningJobs ?? 0) < e.employee.maxParallelJobs,
      );
      if (!target) break;

      await db
        .update(aiTaskAssignmentsTable)
        .set({ employeeId: target.employee.id })
        .where(eq(aiTaskAssignmentsTable.id, task.id));

      details.push(`Task ${task.id} moved from ${over.employee.employeeName} → ${target.employee.employeeName}`);
      moved++;
    }
  }

  return { moved, details };
}
