/**
 * workforce.ts — Digital Workforce API (Phase 4.8)
 *
 * GET  /ai/workforce/departments           — list all departments
 * GET  /ai/workforce/skills                — list all skills
 * GET  /ai/workforce/tools                 — list all tools
 * GET  /ai/workforce/employees             — list employees (filter: dept, status, provider, skill)
 * GET  /ai/workforce/employees/:id         — employee full profile
 * PATCH /ai/workforce/employees/:id/status — update status
 * GET  /ai/workforce/workload              — all workload records
 * GET  /ai/workforce/org-chart             — hierarchical org structure
 */

import { Router } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import {
  db,
  aiDepartmentsTable,
  aiEmployeesTable,
  aiSkillsTable,
  aiToolsTable,
  aiEmployeeSkillsTable,
  aiWorkloadTable,
  employeeToolPermissionsTable,
  aiProvidersTable,
  aiModelsTable,
} from "@workspace/db";

const router = Router();

// ── Departments ───────────────────────────────────────────────────────────────

router.get("/ai/workforce/departments", async (_req, res): Promise<void> => {
  const depts = await db
    .select({
      department: aiDepartmentsTable,
      employeeCount: sql<number>`(
        SELECT count(*)::int FROM ai_employees e
        WHERE e.department_id = ai_departments.id AND e.status != 'offline'
      )`,
    })
    .from(aiDepartmentsTable)
    .orderBy(aiDepartmentsTable.departmentCode);

  res.json(depts.map((d) => ({
    ...d.department,
    employeeCount: d.employeeCount,
  })));
});

// ── Skills ────────────────────────────────────────────────────────────────────

router.get("/ai/workforce/skills", async (_req, res): Promise<void> => {
  const skills = await db
    .select()
    .from(aiSkillsTable)
    .orderBy(aiSkillsTable.category, aiSkillsTable.skillName);
  res.json(skills);
});

// ── Tools ─────────────────────────────────────────────────────────────────────

router.get("/ai/workforce/tools", async (_req, res): Promise<void> => {
  const tools = await db
    .select()
    .from(aiToolsTable)
    .orderBy(aiToolsTable.category, aiToolsTable.toolName);
  res.json(tools);
});

// ── Employees — list ──────────────────────────────────────────────────────────

router.get("/ai/workforce/employees", async (req, res): Promise<void> => {
  const { department, status, provider, skill, search } = req.query as Record<string, string | undefined>;

  // Base employee query with department + provider join
  const rows = await db
    .select({
      employee: aiEmployeesTable,
      department: { id: aiDepartmentsTable.id, name: aiDepartmentsTable.departmentName, code: aiDepartmentsTable.departmentCode },
      provider:   { id: aiProvidersTable.id, name: aiProvidersTable.name, slug: aiProvidersTable.slug },
      model:      { id: aiModelsTable.id, name: aiModelsTable.name, modelId: aiModelsTable.modelId },
    })
    .from(aiEmployeesTable)
    .leftJoin(aiDepartmentsTable, eq(aiEmployeesTable.departmentId, aiDepartmentsTable.id))
    .leftJoin(aiProvidersTable,   eq(aiEmployeesTable.providerId,   aiProvidersTable.id))
    .leftJoin(aiModelsTable,      eq(aiEmployeesTable.modelId,      aiModelsTable.id))
    .orderBy(aiEmployeesTable.priority, aiEmployeesTable.employeeName);

  // Fetch skills per employee
  const employeeIds = rows.map((r) => r.employee.id);
  const skillRows = employeeIds.length > 0
    ? await db
        .select({ employeeId: aiEmployeeSkillsTable.employeeId, skill: aiSkillsTable })
        .from(aiEmployeeSkillsTable)
        .innerJoin(aiSkillsTable, eq(aiEmployeeSkillsTable.skillId, aiSkillsTable.id))
        .where(inArray(aiEmployeeSkillsTable.employeeId, employeeIds))
    : [];

  const skillsByEmployee = skillRows.reduce<Record<number, typeof aiSkillsTable.$inferSelect[]>>(
    (acc, r) => {
      acc[r.employeeId] = [...(acc[r.employeeId] ?? []), r.skill];
      return acc;
    }, {},
  );

  // Fetch workload
  const workloadRows = employeeIds.length > 0
    ? await db
        .select()
        .from(aiWorkloadTable)
        .where(inArray(aiWorkloadTable.employeeId, employeeIds))
    : [];
  const workloadByEmployee = Object.fromEntries(workloadRows.map((w) => [w.employeeId, w]));

  // Assemble + filter
  let result = rows.map((r) => ({
    ...r.employee,
    department: r.department,
    provider:   r.provider,
    model:      r.model,
    skills:     skillsByEmployee[r.employee.id] ?? [],
    workload:   workloadByEmployee[r.employee.id] ?? null,
  }));

  if (department && department !== "all") {
    result = result.filter((e) => e.department?.code === department || String(e.departmentId) === department);
  }
  if (status && status !== "all") {
    result = result.filter((e) => e.status === status);
  }
  if (provider && provider !== "all") {
    result = result.filter((e) => e.provider?.slug === provider);
  }
  if (skill && skill !== "all") {
    result = result.filter((e) => e.skills.some((s) => s.skillCode === skill || String(s.id) === skill));
  }
  if (search) {
    const q = search.toLowerCase();
    result = result.filter((e) =>
      e.employeeName.toLowerCase().includes(q) ||
      e.position.toLowerCase().includes(q) ||
      e.department?.name.toLowerCase().includes(q),
    );
  }

  res.json(result);
});

// ── Employee — detail ─────────────────────────────────────────────────────────

router.get("/ai/workforce/employees/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      employee: aiEmployeesTable,
      department: { id: aiDepartmentsTable.id, name: aiDepartmentsTable.departmentName, code: aiDepartmentsTable.departmentCode },
      provider:   { id: aiProvidersTable.id, name: aiProvidersTable.name, slug: aiProvidersTable.slug },
      model:      { id: aiModelsTable.id, name: aiModelsTable.name, modelId: aiModelsTable.modelId },
    })
    .from(aiEmployeesTable)
    .leftJoin(aiDepartmentsTable, eq(aiEmployeesTable.departmentId, aiDepartmentsTable.id))
    .leftJoin(aiProvidersTable,   eq(aiEmployeesTable.providerId,   aiProvidersTable.id))
    .leftJoin(aiModelsTable,      eq(aiEmployeesTable.modelId,      aiModelsTable.id))
    .where(eq(aiEmployeesTable.id, id));

  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }

  // Skills with proficiency
  const skills = await db
    .select({ skill: aiSkillsTable, proficiency: aiEmployeeSkillsTable })
    .from(aiEmployeeSkillsTable)
    .innerJoin(aiSkillsTable, eq(aiEmployeeSkillsTable.skillId, aiSkillsTable.id))
    .where(eq(aiEmployeeSkillsTable.employeeId, id));

  // Tools
  const tools = await db
    .select({ tool: aiToolsTable, perm: employeeToolPermissionsTable })
    .from(employeeToolPermissionsTable)
    .innerJoin(aiToolsTable, eq(employeeToolPermissionsTable.toolId, aiToolsTable.id))
    .where(eq(employeeToolPermissionsTable.employeeId, id));

  // Workload
  const [workload] = await db
    .select()
    .from(aiWorkloadTable)
    .where(eq(aiWorkloadTable.employeeId, id));

  // Supervisor
  let supervisor = null;
  if (row.employee.supervisorId) {
    const [sup] = await db
      .select({ id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName, position: aiEmployeesTable.position })
      .from(aiEmployeesTable)
      .where(eq(aiEmployeesTable.id, row.employee.supervisorId));
    supervisor = sup ?? null;
  }

  // Subordinates
  const subordinates = await db
    .select({ id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName, position: aiEmployeesTable.position, status: aiEmployeesTable.status })
    .from(aiEmployeesTable)
    .where(eq(aiEmployeesTable.supervisorId, id));

  // Cost stats from cost records (linked via agentSlug for backward compat)
  let performance = { totalRequests: 0, totalTokens: 0, totalCostUsd: 0, avgLatencyMs: 0, successRate: 0 };
  if (row.employee.agentSlug) {
    const [cs] = await db.execute<{
      total_requests: string; total_tokens: string; total_cost: string;
      avg_latency: string; success_rate: string;
    }>(sql`
      SELECT
        count(*)::int               AS total_requests,
        coalesce(sum(total_tokens),0)::int AS total_tokens,
        coalesce(sum(estimated_cost_usd::numeric),0) AS total_cost,
        coalesce(avg(latency_ms),0) AS avg_latency,
        coalesce(count(*) FILTER (WHERE status='success')::numeric / nullif(count(*),0), 0) AS success_rate
      FROM ai_cost_records
      WHERE agent_slug = ${row.employee.agentSlug}
    `).catch(() => [{ total_requests:"0", total_tokens:"0", total_cost:"0", avg_latency:"0", success_rate:"0" }]);

    if (cs) {
      performance = {
        totalRequests: parseInt(cs.total_requests ?? "0", 10),
        totalTokens:   parseInt(cs.total_tokens ?? "0", 10),
        totalCostUsd:  parseFloat(cs.total_cost ?? "0"),
        avgLatencyMs:  parseFloat(cs.avg_latency ?? "0"),
        successRate:   parseFloat(cs.success_rate ?? "0"),
      };
    }
  }

  res.json({
    ...row.employee,
    department: row.department,
    provider:   row.provider,
    model:      row.model,
    skills:     skills.map((s) => ({ ...s.skill, proficiency: s.proficiency.proficiency, scores: { experience: s.proficiency.experienceScore, accuracy: s.proficiency.accuracyScore, speed: s.proficiency.speedScore, cost: s.proficiency.costScore } })),
    tools:      tools.map((t) => ({ ...t.tool, permissions: { read: t.perm.canRead, write: t.perm.canWrite, execute: t.perm.canExecute } })),
    workload:   workload ?? null,
    supervisor,
    subordinates,
    performance,
  });
});

// ── Employee — update status ──────────────────────────────────────────────────

router.patch("/ai/workforce/employees/:id/status", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body as { status?: string };
  const allowed = ["active", "busy", "offline", "maintenance"];

  if (isNaN(id) || !status || !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
    return;
  }

  await db.update(aiEmployeesTable).set({ status }).where(eq(aiEmployeesTable.id, id));
  res.json({ ok: true, id, status });
});

// ── Workload ──────────────────────────────────────────────────────────────────

router.get("/ai/workforce/workload", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      workload:  aiWorkloadTable,
      employee:  { id: aiEmployeesTable.id, name: aiEmployeesTable.employeeName, position: aiEmployeesTable.position, status: aiEmployeesTable.status },
      department: { code: aiDepartmentsTable.departmentCode, name: aiDepartmentsTable.departmentName },
    })
    .from(aiWorkloadTable)
    .innerJoin(aiEmployeesTable, eq(aiWorkloadTable.employeeId, aiEmployeesTable.id))
    .leftJoin(aiDepartmentsTable, eq(aiEmployeesTable.departmentId, aiDepartmentsTable.id));

  res.json(rows);
});

// ── Org chart ─────────────────────────────────────────────────────────────────

router.get("/ai/workforce/org-chart", async (_req, res): Promise<void> => {
  const employees = await db
    .select({
      id:           aiEmployeesTable.id,
      name:         aiEmployeesTable.employeeName,
      position:     aiEmployeesTable.position,
      role:         aiEmployeesTable.role,
      level:        aiEmployeesTable.level,
      status:       aiEmployeesTable.status,
      supervisorId: aiEmployeesTable.supervisorId,
      departmentId: aiEmployeesTable.departmentId,
      deptName:     aiDepartmentsTable.departmentName,
      deptCode:     aiDepartmentsTable.departmentCode,
    })
    .from(aiEmployeesTable)
    .leftJoin(aiDepartmentsTable, eq(aiEmployeesTable.departmentId, aiDepartmentsTable.id));

  // Build tree
  type OrgNode = typeof employees[0] & { subordinates: OrgNode[] };
  const map = new Map<number, OrgNode>();
  employees.forEach((e) => map.set(e.id, { ...e, subordinates: [] }));

  const roots: OrgNode[] = [];
  map.forEach((node) => {
    if (node.supervisorId && map.has(node.supervisorId)) {
      map.get(node.supervisorId)!.subordinates.push(node);
    } else {
      roots.push(node);
    }
  });

  // Group by department
  const deptMap = new Map<string, { deptCode: string; deptName: string; roots: OrgNode[] }>();
  roots.forEach((node) => {
    const key = node.deptCode ?? "other";
    if (!deptMap.has(key)) deptMap.set(key, { deptCode: key, deptName: node.deptName ?? "Other", roots: [] });
    deptMap.get(key)!.roots.push(node);
  });

  res.json([...deptMap.values()]);
});

export default router;
