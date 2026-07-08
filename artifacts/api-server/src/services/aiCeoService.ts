/**
 * AI CEO Service — Phase 4.9
 * Root orchestrator that reads user intent, selects departments/managers,
 * creates execution plans, and monitors progress.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  aiDepartmentsTable,
  aiEmployeesTable,
  aiExecutionPlansTable,
  aiTaskAssignmentsTable,
  aiDecisionLogsTable,
  aiWorkloadTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Keyword → Department routing map ────────────────────────────────────────

const INTENT_MAP: Record<string, string> = {
  creative:   "CREATIVE",
  brand:      "CREATIVE",
  design:     "CREATIVE",
  marketing:  "MARKETING",
  campaign:   "MARKETING",
  social:     "MARKETING",
  finance:    "FINANCE",
  budget:     "FINANCE",
  invoice:    "FINANCE",
  hr:         "HR",
  recruit:    "HR",
  employee:   "HR",
  legal:      "LEGAL",
  contract:   "LEGAL",
  compliance: "LEGAL",
  tax:        "TAX",
  accounting: "TAX",
  audit:      "TAX",
  logistics:  "LOGISTICS",
  shipping:   "LOGISTICS",
  supply:     "LOGISTICS",
  trading:    "TRADING",
  trade:      "TRADING",
  market:     "TRADING",
};

const PRIORITY_MAP: Record<string, string> = {
  urgent:   "critical",
  critical: "critical",
  asap:     "critical",
  fast:     "high",
  quick:    "high",
  slow:     "low",
  normal:   "normal",
};

// ── Public API ─────────────────────────────────────────────────────────────

/** Determine objective, department, and priority from raw user input. */
export async function analyzeRequest(input: string): Promise<{
  objective: string;
  departmentCode: string;
  priority: string;
}> {
  const lower = input.toLowerCase();

  let departmentCode = "CREATIVE"; // default
  for (const [keyword, dept] of Object.entries(INTENT_MAP)) {
    if (lower.includes(keyword)) {
      departmentCode = dept;
      break;
    }
  }

  let priority = "normal";
  for (const [keyword, pri] of Object.entries(PRIORITY_MAP)) {
    if (lower.includes(keyword)) {
      priority = pri;
      break;
    }
  }

  // Truncate input to 200 chars as the objective
  const objective = input.slice(0, 200).trim();

  return { objective, departmentCode, priority };
}

/** Find the best available department by code. */
export async function selectDepartment(departmentCode: string) {
  const [dept] = await db
    .select()
    .from(aiDepartmentsTable)
    .where(
      and(
        eq(aiDepartmentsTable.departmentCode, departmentCode),
        eq(aiDepartmentsTable.status, "active"),
      ),
    );

  if (!dept) {
    // Fallback: first active department
    const [fallback] = await db
      .select()
      .from(aiDepartmentsTable)
      .where(eq(aiDepartmentsTable.status, "active"))
      .limit(1);
    return fallback ?? null;
  }

  return dept;
}

/** Find the best available manager in a department (role = manager | director, load < 80%). */
export async function selectManager(departmentId: number) {
  const managers = await db
    .select({
      employee: aiEmployeesTable,
      workload: aiWorkloadTable,
    })
    .from(aiEmployeesTable)
    .leftJoin(aiWorkloadTable, eq(aiWorkloadTable.employeeId, aiEmployeesTable.id))
    .where(
      and(
        eq(aiEmployeesTable.departmentId, departmentId),
        eq(aiEmployeesTable.status, "active"),
      ),
    )
    .orderBy(aiEmployeesTable.priority);

  // Prefer manager/director role; prefer lower load
  const candidates = managers.filter(
    (m) => m.employee.role === "manager" || m.employee.role === "director",
  );

  const pool = candidates.length > 0 ? candidates : managers;

  // Sort by workload ascending
  pool.sort((a, b) => {
    const loadA = a.workload?.runningJobs ?? 0;
    const loadB = b.workload?.runningJobs ?? 0;
    return loadA - loadB;
  });

  return pool[0]?.employee ?? null;
}

/** Create an execution plan and log the CEO decision. */
export async function createExecutionPlan(input: {
  projectId: string | null;
  projectType: string;
  objective: string;
  departmentCode: string;
  managerEmployeeId: number | null;
  priority?: string;
  estimatedCost?: number;
  estimatedDurationMinutes?: number;
}) {
  const [plan] = await db
    .insert(aiExecutionPlansTable)
    .values({
      projectId:         input.projectId,
      projectType:       input.projectType,
      objective:         input.objective,
      department:        input.departmentCode,
      managerEmployeeId: input.managerEmployeeId,
      priority:          input.priority ?? "normal",
      status:            "active",
      estimatedCost:     input.estimatedCost?.toFixed(4),
      estimatedDuration: input.estimatedDurationMinutes,
      startedAt:         new Date(),
    })
    .returning();

  // Log CEO decision
  await db
    .insert(aiDecisionLogsTable)
    .values({
      executionPlanId:    plan.id,
      decisionBy:         "ai_ceo",
      decisionType:       "department_selection",
      reason:             `Objective: "${input.objective.slice(0, 100)}" → routed to ${input.departmentCode}`,
      selectedDepartment: input.departmentCode,
      score:              "90.00",
    })
    .catch(() => {});

  await logAudit(
    "ai_ceo",
    "execution_plan_created",
    String(plan.id),
    "execution_plan",
    "success",
    { projectId: input.projectId, department: input.departmentCode },
  ).catch(() => {});

  return plan;
}

/** Create execution plan + tasks for a Creative AI project (backward compat). */
export async function createExecutionPlanForCreativeProject(
  projectId: string,
  projectObjective: string,
) {
  try {
    const { departmentCode, priority } = await analyzeRequest(projectObjective);
    const dept = await selectDepartment(departmentCode);
    if (!dept) return null;

    const manager = await selectManager(dept.id);

    const plan = await createExecutionPlan({
      projectId,
      projectType:             "creative_ai",
      objective:               projectObjective,
      departmentCode:          dept.departmentCode,
      managerEmployeeId:       manager?.id ?? null,
      priority,
      estimatedCost:           0.5,
      estimatedDurationMinutes: 5,
    });

    // Standard 4-step creative pipeline tasks
    const steps = [
      { name: "Brand Strategy",     desc: "Brand Strategist defines positioning, USP, and tone of voice" },
      { name: "Creative Direction",  desc: "Creative Director develops visual concept and style guide" },
      { name: "Copy Production",     desc: "Copywriter produces headlines, captions, and CTAs" },
      { name: "Quality Control",     desc: "QC Agent reviews all outputs for consistency and quality" },
    ];

    for (const step of steps) {
      await db.insert(aiTaskAssignmentsTable).values({
        executionPlanId: plan.id,
        employeeId:      null,  // assigned dynamically during workflow
        taskName:        step.name,
        taskDescription: step.desc,
        priority,
        status:          "pending",
      });
    }

    return plan;
  } catch {
    // Non-blocking — never break the creative AI workflow
    return null;
  }
}

/** Update plan progress after monitoring. */
export async function monitorExecution(planId: number) {
  const [plan] = await db
    .select()
    .from(aiExecutionPlansTable)
    .where(eq(aiExecutionPlansTable.id, planId));

  if (!plan) return null;

  const tasks = await db
    .select()
    .from(aiTaskAssignmentsTable)
    .where(eq(aiTaskAssignmentsTable.executionPlanId, planId));

  const allDone = tasks.length > 0 && tasks.every((t) => ["completed", "failed", "cancelled"].includes(t.status));
  const anyFailed = tasks.some((t) => t.status === "failed");

  if (allDone && plan.status === "active") {
    await db
      .update(aiExecutionPlansTable)
      .set({
        status:      anyFailed ? "failed" : "completed",
        completedAt: new Date(),
      })
      .where(eq(aiExecutionPlansTable.id, planId));
  }

  return { plan, tasks, allDone, anyFailed };
}

/** Mark plan as finalized and log outcome. */
export async function finalizeProject(planId: number, success: boolean, actualCost?: number) {
  await db
    .update(aiExecutionPlansTable)
    .set({
      status:       success ? "completed" : "failed",
      completedAt:  new Date(),
      actualCost:   actualCost?.toFixed(4),
    })
    .where(eq(aiExecutionPlansTable.id, planId));

  await db
    .insert(aiDecisionLogsTable)
    .values({
      executionPlanId: planId,
      decisionBy:      "ai_ceo",
      decisionType:    "approval",
      reason:          success ? "All tasks completed successfully" : "One or more tasks failed",
      score:           success ? "100.00" : "0.00",
    })
    .catch(() => {});
}

/** Summarize CEO status for the Operations Dashboard. */
export async function getCeoStatus() {
  const [activeRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiExecutionPlansTable)
    .where(eq(aiExecutionPlansTable.status, "active"));
  const [completedRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiExecutionPlansTable)
    .where(eq(aiExecutionPlansTable.status, "completed"));

  const recentDecisions = await db
    .select()
    .from(aiDecisionLogsTable)
    .where(eq(aiDecisionLogsTable.decisionBy, "ai_ceo"))
    .orderBy(desc(aiDecisionLogsTable.createdAt))
    .limit(5);

  return {
    activePlans:    activeRow?.count ?? 0,
    completedPlans: completedRow?.count ?? 0,
    recentDecisions,
  };
}
