/**
 * operations.ts — AI Operations Center API (Phase 4.9)
 *
 * POST  /ai/ceo/analyze                         — analyze a request, return objective/dept/priority
 * GET   /ai/ceo/status                          — CEO overview
 * GET   /ai/execution-plans                     — list execution plans (filters: department, status, priority)
 * GET   /ai/execution-plans/:id                 — execution plan detail (with tasks)
 * POST  /ai/execution-plans                     — manually create an execution plan
 * PATCH /ai/execution-plans/:id                 — update plan status
 * GET   /ai/task-assignments                    — list tasks (filters: executionPlanId, employeeId, status)
 * PATCH /ai/task-assignments/:id/assign         — assign task to employee
 * PATCH /ai/task-assignments/:id/approve        — manager approves task
 * PATCH /ai/task-assignments/:id/reject         — manager rejects task
 * PATCH /ai/task-assignments/:id/request-revision — manager requests revision
 * POST  /ai/workforce/:departmentId/rebalance   — rebalance workload within a department
 * GET   /ai/workforce/performance               — all performance records
 * GET   /ai/workforce/performance/:employeeId   — one employee's performance
 * GET   /ai/decision-logs                       — list decision logs (filters: department, decisionType, decisionBy)
 * GET   /ai/operations/summary                  — aggregated dashboard summary
 */

import { Router } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  aiDepartmentsTable,
  aiEmployeesTable,
  aiExecutionPlansTable,
  aiTaskAssignmentsTable,
  aiDecisionLogsTable,
  aiEmployeePerformanceTable,
  aiWorkloadTable,
} from "@workspace/db";
import * as aiCeoService from "../services/aiCeoService.js";
import * as managerService from "../services/departmentManagerService.js";
import * as capacityService from "../services/capacityService.js";

const router = Router();

// ── AI CEO ─────────────────────────────────────────────────────────────────────

router.post("/ai/ceo/analyze", async (req, res): Promise<void> => {
  const { input } = req.body as { input?: string };
  if (!input || typeof input !== "string") {
    res.status(400).json({ error: "input is required" });
    return;
  }
  const result = await aiCeoService.analyzeRequest(input);
  res.json(result);
});

router.get("/ai/ceo/status", async (_req, res): Promise<void> => {
  const status = await aiCeoService.getCeoStatus();
  res.json(status);
});

// ── Execution Plans ────────────────────────────────────────────────────────────

router.get("/ai/execution-plans", async (req, res): Promise<void> => {
  const { department, status, priority } = req.query as Record<string, string | undefined>;

  const conditions = [];
  if (department) conditions.push(eq(aiExecutionPlansTable.department, department));
  if (status) conditions.push(eq(aiExecutionPlansTable.status, status));
  if (priority) conditions.push(eq(aiExecutionPlansTable.priority, priority));

  const rows = await db
    .select()
    .from(aiExecutionPlansTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiExecutionPlansTable.createdAt))
    .limit(200);

  res.json(rows);
});

function parseIntParam(value: string | undefined): number | null {
  if (value == null) return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

router.get("/ai/execution-plans/:id", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [plan] = await db.select().from(aiExecutionPlansTable).where(eq(aiExecutionPlansTable.id, id));
  if (!plan) {
    res.status(404).json({ error: "Execution plan not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(aiTaskAssignmentsTable)
    .where(eq(aiTaskAssignmentsTable.executionPlanId, id))
    .orderBy(aiTaskAssignmentsTable.id);

  const decisions = await db
    .select()
    .from(aiDecisionLogsTable)
    .where(eq(aiDecisionLogsTable.executionPlanId, id))
    .orderBy(desc(aiDecisionLogsTable.createdAt));

  res.json({ ...plan, tasks, decisions });
});

router.post("/ai/execution-plans", async (req, res): Promise<void> => {
  const body = req.body as {
    objective?: string;
    departmentCode?: string;
    priority?: string;
    projectId?: string;
    projectType?: string;
  };

  if (!body.objective || typeof body.objective !== "string") {
    res.status(400).json({ error: "objective is required" });
    return;
  }

  const deptCode = body.departmentCode ?? (await aiCeoService.analyzeRequest(body.objective)).departmentCode;
  const dept = await aiCeoService.selectDepartment(deptCode);
  if (!dept) {
    res.status(400).json({ error: "No active department found" });
    return;
  }
  const manager = await aiCeoService.selectManager(dept.id);

  const plan = await aiCeoService.createExecutionPlan({
    projectId: body.projectId ?? null,
    projectType: body.projectType ?? "custom",
    objective: body.objective,
    departmentCode: dept.departmentCode,
    managerEmployeeId: manager?.id ?? null,
    priority: body.priority,
  });

  res.status(201).json(plan);
});

router.patch("/ai/execution-plans/:id", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  const { status } = req.body as { status?: string };

  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const VALID = ["draft", "active", "completed", "failed", "cancelled"];
  if (!status || !VALID.includes(status)) {
    res.status(400).json({ error: `status must be one of ${VALID.join(", ")}` });
    return;
  }

  const [updated] = await db
    .update(aiExecutionPlansTable)
    .set({ status, completedAt: ["completed", "failed", "cancelled"].includes(status) ? new Date() : undefined })
    .where(eq(aiExecutionPlansTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Execution plan not found" });
    return;
  }
  res.json(updated);
});

// ── Task Assignments ───────────────────────────────────────────────────────────

router.get("/ai/task-assignments", async (req, res): Promise<void> => {
  const { executionPlanId, employeeId, status } = req.query as Record<string, string | undefined>;

  const conditions = [];
  const planId = parseIntParam(executionPlanId);
  const empId = parseIntParam(employeeId);
  if (planId != null) conditions.push(eq(aiTaskAssignmentsTable.executionPlanId, planId));
  if (empId != null) conditions.push(eq(aiTaskAssignmentsTable.employeeId, empId));
  if (status) conditions.push(eq(aiTaskAssignmentsTable.status, status));

  const rows = await db
    .select()
    .from(aiTaskAssignmentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiTaskAssignmentsTable.createdAt))
    .limit(300);

  res.json(rows);
});

router.patch("/ai/task-assignments/:id/assign", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  const { employeeId, managerId } = req.body as { employeeId?: number; managerId?: number };

  if (id == null || typeof employeeId !== "number" || Number.isNaN(employeeId)) {
    res.status(400).json({ error: "Invalid id / employeeId (number) is required" });
    return;
  }

  const result = await managerService.assignTask(id, employeeId, managerId);
  if (!result.success) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.json({ success: true });
});

router.patch("/ai/task-assignments/:id/approve", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const { managerId } = req.body as { managerId?: number };
  await managerService.approveTask(id, managerId ?? 0);
  res.json({ success: true });
});

router.patch("/ai/task-assignments/:id/reject", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  const { managerId, reason } = req.body as { managerId?: number; reason?: string };
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!reason || typeof reason !== "string") {
    res.status(400).json({ error: "reason is required" });
    return;
  }
  const result = await managerService.rejectTask(id, managerId ?? 0, reason);
  if (!result.success) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.json({ success: true });
});

router.patch("/ai/task-assignments/:id/request-revision", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.id);
  const { managerId, notes } = req.body as { managerId?: number; notes?: string };
  if (id == null) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (!notes || typeof notes !== "string") {
    res.status(400).json({ error: "notes is required" });
    return;
  }
  const result = await managerService.requestRevision(id, managerId ?? 0, notes);
  if (!result.success) {
    res.status(409).json({ error: result.reason });
    return;
  }
  res.json({ success: true });
});

// ── Workload rebalancing ────────────────────────────────────────────────────────

router.post("/ai/workforce/:departmentId/rebalance", async (req, res): Promise<void> => {
  const departmentId = parseIntParam(req.params.departmentId);
  if (departmentId == null) {
    res.status(400).json({ error: "Invalid departmentId" });
    return;
  }
  const result = await managerService.rebalanceWorkload(departmentId);
  res.json(result);
});

// ── Performance ─────────────────────────────────────────────────────────────────

router.get("/ai/workforce/performance", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      performance: aiEmployeePerformanceTable,
      employee: { id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName, position: aiEmployeesTable.position, departmentId: aiEmployeesTable.departmentId },
    })
    .from(aiEmployeePerformanceTable)
    .leftJoin(aiEmployeesTable, eq(aiEmployeePerformanceTable.employeeId, aiEmployeesTable.id))
    .orderBy(desc(aiEmployeePerformanceTable.qualityScore));

  res.json(rows.map((r) => ({ ...r.performance, employee: r.employee })));
});

router.get("/ai/workforce/performance/:employeeId", async (req, res): Promise<void> => {
  const employeeId = parseIntParam(req.params.employeeId);
  if (employeeId == null) {
    res.status(400).json({ error: "Invalid employeeId" });
    return;
  }
  const [row] = await db
    .select()
    .from(aiEmployeePerformanceTable)
    .where(eq(aiEmployeePerformanceTable.employeeId, employeeId));

  if (!row) {
    res.status(404).json({ error: "No performance record found" });
    return;
  }
  res.json(row);
});

// ── Decision Logs ──────────────────────────────────────────────────────────────

router.get("/ai/decision-logs", async (req, res): Promise<void> => {
  const { decisionBy, decisionType, executionPlanId } = req.query as Record<string, string | undefined>;

  const conditions = [];
  const planId = parseIntParam(executionPlanId);
  if (decisionBy) conditions.push(eq(aiDecisionLogsTable.decisionBy, decisionBy));
  if (decisionType) conditions.push(eq(aiDecisionLogsTable.decisionType, decisionType));
  if (planId != null) conditions.push(eq(aiDecisionLogsTable.executionPlanId, planId));

  const rows = await db
    .select()
    .from(aiDecisionLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiDecisionLogsTable.createdAt))
    .limit(200);

  res.json(rows);
});

// ── Operations Dashboard summary ────────────────────────────────────────────────

router.get("/ai/operations/summary", async (_req, res): Promise<void> => {
  const [plansCounts, tasksCounts, deptRows, capacity, topPerformers, trainingCandidates, promotionCandidates, recentDecisions] =
    await Promise.all([
      db
        .select({ status: aiExecutionPlansTable.status, count: sql<number>`count(*)::int` })
        .from(aiExecutionPlansTable)
        .groupBy(aiExecutionPlansTable.status),
      db
        .select({ status: aiTaskAssignmentsTable.status, count: sql<number>`count(*)::int` })
        .from(aiTaskAssignmentsTable)
        .groupBy(aiTaskAssignmentsTable.status),
      db
        .select({
          department: aiDepartmentsTable,
          activePlans: sql<number>`(
            SELECT count(*)::int FROM ai_execution_plans p
            WHERE p.department = ai_departments.department_code AND p.status = 'active'
          )`,
          employeeCount: sql<number>`(
            SELECT count(*)::int FROM ai_employees e
            WHERE e.department_id = ai_departments.id AND e.status != 'offline'
          )`,
        })
        .from(aiDepartmentsTable),
      capacityService.getAllCapacity(),
      db
        .select({
          performance: aiEmployeePerformanceTable,
          employee: { id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName },
        })
        .from(aiEmployeePerformanceTable)
        .leftJoin(aiEmployeesTable, eq(aiEmployeePerformanceTable.employeeId, aiEmployeesTable.id))
        .orderBy(desc(aiEmployeePerformanceTable.qualityScore))
        .limit(5),
      db
        .select({
          performance: aiEmployeePerformanceTable,
          employee: { id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName },
        })
        .from(aiEmployeePerformanceTable)
        .leftJoin(aiEmployeesTable, eq(aiEmployeePerformanceTable.employeeId, aiEmployeesTable.id))
        .where(eq(aiEmployeePerformanceTable.trainingRequired, true)),
      db
        .select({
          performance: aiEmployeePerformanceTable,
          employee: { id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName },
        })
        .from(aiEmployeePerformanceTable)
        .leftJoin(aiEmployeesTable, eq(aiEmployeePerformanceTable.employeeId, aiEmployeesTable.id))
        .where(sql`${aiEmployeePerformanceTable.promotionScore} >= 80`),
      db
        .select()
        .from(aiDecisionLogsTable)
        .orderBy(desc(aiDecisionLogsTable.createdAt))
        .limit(10),
    ]);

  res.json({
    plansByStatus: plansCounts,
    tasksByStatus: tasksCounts,
    departments: deptRows.map((d) => ({ ...d.department, activePlans: d.activePlans, employeeCount: d.employeeCount })),
    capacity,
    topPerformers: topPerformers.map((r) => ({ ...r.performance, employee: r.employee })),
    trainingCandidates: trainingCandidates.map((r) => ({ ...r.performance, employee: r.employee })),
    promotionCandidates: promotionCandidates.map((r) => ({ ...r.performance, employee: r.employee })),
    recentDecisions,
  });
});

export default router;
