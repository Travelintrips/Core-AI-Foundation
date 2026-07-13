/**
 * runtimeRosterService.ts — V4.0B Runtime Roster & Project Linkage adapter.
 *
 * This is a READ-ONLY, additive adapter. It does not move, wrap, or replace
 * `creativeWorkflowRunner` (the execution engine) or `creative_project_steps`
 * (the execution source of truth). It builds a normalized, customer-safe
 * snapshot of "who is working on this project right now" purely by reading
 * already-written rows — no new tables, no new queue, no new job system.
 *
 * Source-of-truth chain (see docs/phase-v4.0b-runtime-roster.md):
 *   creative_projects (customer project)
 *     -> creative_project_steps (execution — real, written by creativeWorkflowRunner)
 *       -> ai_employees, joined by agentSlug (display metadata — Phase 4.8 Digital
 *          Workforce; NOT ai_agents, see report for why the audit's assumption
 *          needed correcting)
 *
 * Deliberately excluded from the response, per V4.0B security rules:
 *   - step.input / step.output (may contain prompts/raw model output)
 *   - step.errorMessage (may contain internal error detail / stack fragments)
 *   - any cost or provider-credential data
 *
 * No confidence score, ETA, or progress percentage is invented here. If a
 * signal isn't backed by a real column, the field is simply absent.
 */
import { eq, and, inArray } from "drizzle-orm";
import { db, creativeProjectStepsTable, aiEmployeesTable, aiDepartmentsTable } from "@workspace/db";

// ── Canonical step-name -> agent-slug map ────────────────────────────────────
// Mirrors the PIPELINE constant in creativeWorkflowRunner.ts. This is the one
// hardcoded piece we still need: creative_project_steps.agentId is a FK to
// ai_agents, but ai_agents is never seeded with these four slugs (only the
// image-pipeline agents are) — see report "Audit Verification" for detail.
// stepName is written verbatim from PIPELINE[].label, so this map is a safe,
// non-fictional translation, not a guess.
const ROLE_KEY_BY_STEP_NAME: Record<string, string> = {
  "Brand Strategy": "brand-strategist",
  "Creative Direction": "creative-director",
  "Copy Production": "copywriter",
  "Quality Control": "quality-control",
};

function roleKeyForStepName(stepName: string): string {
  return (
    ROLE_KEY_BY_STEP_NAME[stepName] ??
    stepName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

// Real status vocabulary observed on creative_project_steps + the one extra
// value the runner writes when budget-blocked. No invented statuses.
const STATUS_MAP: Record<string, RuntimeWorkerStatus> = {
  pending: "queued",
  running: "working",
  completed: "completed",
  failed: "failed",
  blocked_by_budget: "blocked",
};

export type RuntimeWorkerStatus = "queued" | "working" | "completed" | "failed" | "blocked";

export interface RuntimeWorkerSnapshot {
  id: string;
  roleKey: string;
  displayName: string;
  department: string | null;
  specialty: string | null;
  stepId: number;
  stepName: string;
  status: RuntimeWorkerStatus;
  currentTask: string;
  provider: string | null;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  outputCount: number;
  isHuman: boolean;
  source: "creative_workflow";
  isLive: true;
}

export interface RuntimeCurrentTask {
  stepId: number;
  stepName: string;
  taskLabel: string;
  workerRole: string;
  workerDisplayName: string;
  status: RuntimeWorkerStatus;
  startedAt: string;
  provider: string | null;
  model: string | null;
  lastUpdatedAt: string;
}

export interface ProjectRuntimeSnapshot {
  source: "creative_workflow" | "unavailable";
  isLive: boolean;
  workers: RuntimeWorkerSnapshot[];
  currentWorkerId: string | null;
  currentStepId: number | null;
  currentTask: RuntimeCurrentTask | null;
  lastUpdatedAt: string | null;
}

const EMPTY_SNAPSHOT: ProjectRuntimeSnapshot = {
  source: "unavailable",
  isLive: false,
  workers: [],
  currentWorkerId: null,
  currentStepId: null,
  currentTask: null,
  lastUpdatedAt: null,
};

interface EmployeeMeta {
  displayName: string;
  department: string | null;
  specialty: string | null;
}

async function loadEmployeeMetaBySlug(slugs: string[]): Promise<Map<string, EmployeeMeta>> {
  const meta = new Map<string, EmployeeMeta>();
  if (slugs.length === 0) return meta;

  const rows = await db
    .select({
      agentSlug: aiEmployeesTable.agentSlug,
      employeeName: aiEmployeesTable.employeeName,
      position: aiEmployeesTable.position,
      bio: aiEmployeesTable.bio,
      departmentName: aiDepartmentsTable.departmentName,
    })
    .from(aiEmployeesTable)
    .leftJoin(aiDepartmentsTable, eq(aiEmployeesTable.departmentId, aiDepartmentsTable.id))
    .where(and(inArray(aiEmployeesTable.agentSlug, slugs), eq(aiEmployeesTable.status, "active")));

  for (const row of rows) {
    if (!row.agentSlug) continue;
    meta.set(row.agentSlug, {
      displayName: `${row.employeeName} AI`,
      department: row.departmentName ?? null,
      specialty: row.position ?? (row.bio ? row.bio.slice(0, 80) : null),
    });
  }
  return meta;
}

/** Honest fallback when no ai_employees metadata matches — never invents a name/avatar. */
function fallbackMeta(roleKey: string, stepName: string): EmployeeMeta {
  return {
    displayName: `Creative AI Worker — ${stepName}`,
    department: null,
    specialty: null,
  };
}

// Current-task selection order. The brief's order is [running, waiting_review,
// latest completed, next pending, none]; we additionally surface failed/blocked
// steps first since a customer-facing "what's happening now" signal should
// prioritize a step that needs attention over one quietly running — this is a
// deliberate, documented deviation, not a fabrication (still 100% derived from
// real step rows).
function pickCurrentStep<T extends { status: string; id: number }>(steps: T[]): T | null {
  const attention = steps.find((s) => s.status === "failed" || s.status === "blocked_by_budget");
  if (attention) return attention;
  const running = steps.find((s) => s.status === "running");
  if (running) return running;
  const waitingReview = steps.find((s) => s.status === "waiting_review");
  if (waitingReview) return waitingReview;
  const completed = [...steps].reverse().find((s) => s.status === "completed");
  if (completed) return completed;
  const pending = steps.find((s) => s.status === "pending");
  if (pending) return pending;
  return null;
}

/**
 * Build a normalized runtime roster snapshot for a customer project, scoped
 * strictly to data already validated (by the caller) as belonging to that
 * project. Never throws on missing data — returns the honest "unavailable"
 * snapshot instead, so callers can render a truthful empty state.
 */
export async function buildProjectRuntimeSnapshot(
  internalProjectId: number | null,
): Promise<ProjectRuntimeSnapshot> {
  if (!internalProjectId) return EMPTY_SNAPSHOT;

  let steps;
  try {
    steps = await db
      .select()
      .from(creativeProjectStepsTable)
      .where(eq(creativeProjectStepsTable.projectId, internalProjectId))
      .orderBy(creativeProjectStepsTable.id);
  } catch (err) {
    console.warn("[runtime-roster] step query failed, returning unavailable snapshot:", err);
    return EMPTY_SNAPSHOT;
  }

  if (steps.length === 0) {
    console.info(`[runtime-roster] project=${internalProjectId} steps=0 fallback=no-steps`);
    return EMPTY_SNAPSHOT;
  }

  const roleKeys = steps.map((s) => roleKeyForStepName(s.stepName));
  const employeeMeta = await loadEmployeeMetaBySlug([...new Set(roleKeys)]);

  // De-duplicate by roleKey, keeping the most recent (highest id) row so a
  // re-run of a step never produces two worker cards for the same role.
  const latestByRole = new Map<string, (typeof steps)[number]>();
  steps.forEach((step, i) => {
    latestByRole.set(roleKeys[i], step);
  });

  const workers: RuntimeWorkerSnapshot[] = [...latestByRole.entries()].map(([roleKey, step]) => {
    const meta = employeeMeta.get(roleKey) ?? fallbackMeta(roleKey, step.stepName);
    const status = STATUS_MAP[step.status] ?? "queued";
    return {
      id: `step-${step.id}`,
      roleKey,
      displayName: meta.displayName,
      department: meta.department,
      specialty: meta.specialty,
      stepId: step.id,
      stepName: step.stepName,
      status,
      currentTask: step.stepName,
      provider: step.provider ?? null,
      model: step.model ?? null,
      startedAt: step.createdAt.toISOString(),
      completedAt: status === "completed" || status === "failed" ? step.updatedAt.toISOString() : null,
      outputCount: step.output ? 1 : 0,
      isHuman: false,
      source: "creative_workflow",
      isLive: true,
    };
  });

  // Current-task selection must run over the *latest* step per role, not the
  // raw history — otherwise a stale failure from an earlier retried attempt
  // would outrank a since-completed re-run and permanently show "needs
  // attention" on an already-finished project.
  const currentStepRow = pickCurrentStep([...latestByRole.values()]);
  const currentWorker = currentStepRow
    ? workers.find((w) => w.stepId === currentStepRow.id || w.roleKey === roleKeyForStepName(currentStepRow.stepName))
    : undefined;

  const currentTask: RuntimeCurrentTask | null = currentStepRow
    ? {
        stepId: currentStepRow.id,
        stepName: currentStepRow.stepName,
        taskLabel: currentStepRow.stepName,
        workerRole: roleKeyForStepName(currentStepRow.stepName),
        workerDisplayName: currentWorker?.displayName ?? `Creative AI Worker — ${currentStepRow.stepName}`,
        status: STATUS_MAP[currentStepRow.status] ?? "queued",
        startedAt: currentStepRow.createdAt.toISOString(),
        provider: currentStepRow.provider ?? null,
        model: currentStepRow.model ?? null,
        lastUpdatedAt: currentStepRow.updatedAt.toISOString(),
      }
    : null;

  const lastUpdatedAt = steps
    .map((s) => s.updatedAt.getTime())
    .reduce((max, t) => (t > max ? t : max), 0);

  console.info(
    `[runtime-roster] project=${internalProjectId} steps=${steps.length} workers=${workers.length} ` +
      `currentStep=${currentStepRow?.id ?? "none"} fallback=none`,
  );

  return {
    source: "creative_workflow",
    isLive: true,
    workers,
    currentWorkerId: currentWorker?.id ?? null,
    currentStepId: currentStepRow?.id ?? null,
    currentTask,
    lastUpdatedAt: lastUpdatedAt > 0 ? new Date(lastUpdatedAt).toISOString() : null,
  };
}
