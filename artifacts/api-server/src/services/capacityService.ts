/**
 * Capacity Service — Phase 4.9
 * Tracks employee load and determines availability for task assignment.
 */
import { eq, and, sql } from "drizzle-orm";
import { db, aiWorkloadTable, aiEmployeesTable } from "@workspace/db";

export interface CapacitySnapshot {
  employeeId: number;
  runningJobs: number;
  maxParallelJobs: number;
  queueLength: number;
  availability: number;     // 0–100
  loadPercentage: number;   // 0–100
  status: string;
}

/** Get current capacity for a single employee. */
export async function getEmployeeCapacity(employeeId: number): Promise<CapacitySnapshot | null> {
  const [row] = await db
    .select({
      workload: aiWorkloadTable,
      employee: { maxParallelJobs: aiEmployeesTable.maxParallelJobs },
    })
    .from(aiWorkloadTable)
    .leftJoin(aiEmployeesTable, eq(aiWorkloadTable.employeeId, aiEmployeesTable.id))
    .where(eq(aiWorkloadTable.employeeId, employeeId));

  if (!row) return null;

  const max = row.employee?.maxParallelJobs ?? 3;
  const running = row.workload.runningJobs;
  const load = max > 0 ? Math.round((running / max) * 100) : 100;

  return {
    employeeId,
    runningJobs: running,
    maxParallelJobs: max,
    queueLength: row.workload.queuedJobs,
    availability: row.workload.availability,
    loadPercentage: load,
    status: row.workload.status,
  };
}

/** Get capacity for all employees. */
export async function getAllCapacity(): Promise<CapacitySnapshot[]> {
  const rows = await db
    .select({
      workload: aiWorkloadTable,
      employee: { id: aiEmployeesTable.id, maxParallelJobs: aiEmployeesTable.maxParallelJobs },
    })
    .from(aiWorkloadTable)
    .leftJoin(aiEmployeesTable, eq(aiWorkloadTable.employeeId, aiEmployeesTable.id));

  return rows.map((r) => {
    const max = r.employee?.maxParallelJobs ?? 3;
    const running = r.workload.runningJobs;
    const load = max > 0 ? Math.round((running / max) * 100) : 100;
    return {
      employeeId: r.workload.employeeId,
      runningJobs: running,
      maxParallelJobs: max,
      queueLength: r.workload.queuedJobs,
      availability: r.workload.availability,
      loadPercentage: load,
      status: r.workload.status,
    };
  });
}

/** Ensure a workload row exists for an employee (idempotent). */
async function ensureWorkloadRow(employeeId: number): Promise<void> {
  await db
    .insert(aiWorkloadTable)
    .values({ employeeId, availability: 100, status: "idle" })
    .onConflictDoNothing({ target: aiWorkloadTable.employeeId });
}

/**
 * Increment running jobs for an employee; returns false if at capacity.
 * Uses a single atomic conditional UPDATE (running_jobs < max_parallel_jobs)
 * so concurrent callers cannot both pass the check and over-claim a slot.
 */
export async function claimCapacity(employeeId: number): Promise<boolean> {
  const [emp] = await db
    .select({ maxParallelJobs: aiEmployeesTable.maxParallelJobs })
    .from(aiEmployeesTable)
    .where(eq(aiEmployeesTable.id, employeeId));

  if (!emp) return false;
  const max = emp.maxParallelJobs;

  await ensureWorkloadRow(employeeId);

  const [updated] = await db
    .update(aiWorkloadTable)
    .set({
      runningJobs: sql`${aiWorkloadTable.runningJobs} + 1`,
      availability: sql`GREATEST(0, 100 - ROUND((${aiWorkloadTable.runningJobs} + 1)::numeric / ${max} * 100))`,
      status: sql`CASE WHEN ${aiWorkloadTable.runningJobs} + 1 >= ${max} THEN 'busy' ELSE 'idle' END`,
    })
    .where(and(eq(aiWorkloadTable.employeeId, employeeId), sql`${aiWorkloadTable.runningJobs} < ${max}`))
    .returning();

  return !!updated;
}

/**
 * Release a running job slot for an employee after completion.
 * Atomic conditional UPDATE — never decrements below zero even under concurrency.
 */
export async function releaseCapacity(employeeId: number, succeeded: boolean): Promise<void> {
  const [emp] = await db
    .select({ maxParallelJobs: aiEmployeesTable.maxParallelJobs })
    .from(aiEmployeesTable)
    .where(eq(aiEmployeesTable.id, employeeId));

  const max = emp?.maxParallelJobs ?? 3;

  await ensureWorkloadRow(employeeId);

  await db
    .update(aiWorkloadTable)
    .set({
      runningJobs: sql`GREATEST(0, ${aiWorkloadTable.runningJobs} - 1)`,
      completedToday: succeeded ? sql`${aiWorkloadTable.completedToday} + 1` : aiWorkloadTable.completedToday,
      failedToday: succeeded ? aiWorkloadTable.failedToday : sql`${aiWorkloadTable.failedToday} + 1`,
      availability: sql`LEAST(100, 100 - ROUND(GREATEST(0, ${aiWorkloadTable.runningJobs} - 1)::numeric / ${max} * 100))`,
      status: sql`CASE WHEN GREATEST(0, ${aiWorkloadTable.runningJobs} - 1) = 0 THEN 'idle' ELSE 'busy' END`,
    })
    .where(and(eq(aiWorkloadTable.employeeId, employeeId), sql`${aiWorkloadTable.runningJobs} > 0`));
}
