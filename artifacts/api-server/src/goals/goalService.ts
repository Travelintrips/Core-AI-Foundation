/**
 * goals/goalService.ts — Goal Taxonomy business logic
 *
 * All decisions here are DETERMINISTIC — no AI involvement in ranking,
 * eligibility, or visibility (MASTER-00.md §4 Deterministic rule).
 *
 * The service layer builds view objects safe for public API responses and
 * enforces invariants (max hierarchy depth, slug format, duplicate detection).
 */
import * as repo from "./goalRepository.js";
import type {
  GoalView,
  GoalWithServices,
  Goal,
  CreateGoalInput,
  UpdateGoalInput,
  CreateMappingInput,
  ListGoalsOptions,
} from "./types.js";

// ── Validation helpers ────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GoalValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "GoalValidationError";
  }
}

export class GoalNotFoundError extends Error {
  constructor(slug: string) {
    super(`Goal not found: ${slug}`);
    this.name = "GoalNotFoundError";
  }
}

export class GoalConflictError extends Error {
  constructor(slug: string) {
    super(`Goal slug already exists: ${slug}`);
    this.name = "GoalConflictError";
  }
}

export class MappingConflictError extends Error {
  constructor(goalId: number, serviceId: number) {
    super(`Service ${serviceId} is already mapped to goal ${goalId}`);
    this.name = "MappingConflictError";
  }
}

function validateSlug(slug: string): void {
  if (!slug || slug.length < 2 || slug.length > 80) {
    throw new GoalValidationError("slug must be 2–80 characters", "slug");
  }
  if (!SLUG_RE.test(slug)) {
    throw new GoalValidationError(
      "slug must be lowercase alphanumeric with hyphens only (e.g. launch-brand)",
      "slug",
    );
  }
}

/** Max supported hierarchy depth = 2 (parent + child). */
async function assertMaxDepth(parentGoalId: number): Promise<void> {
  const parent = await repo.findGoalById(parentGoalId);
  if (!parent) {
    throw new GoalValidationError(`Parent goal ${parentGoalId} does not exist`, "parentGoalId");
  }
  if (parent.parentGoalId !== null) {
    throw new GoalValidationError(
      "Goal hierarchy depth is limited to 2 levels. The specified parent is already a child goal.",
      "parentGoalId",
    );
  }
}

// ── View builders ─────────────────────────────────────────────────────────────

function toGoalView(goal: Goal, parentSlug: string | null = null): GoalView {
  return {
    slug: goal.slug,
    name: goal.name,
    description: goal.description,
    icon: goal.icon,
    displayOrder: goal.displayOrder,
    parentGoalSlug: parentSlug,
    metadata: goal.metadataJson ?? {},
  };
}

// ── Public reads ──────────────────────────────────────────────────────────────

/**
 * List all active goals.
 *
 * When opts.withChildren is true, returns only root goals with their
 * children nested inside — ideal for navigation trees.
 * When false (default), returns the flat list ordered by displayOrder.
 */
export async function listGoals(opts: ListGoalsOptions = {}): Promise<GoalView[]> {
  if (opts.withChildren) {
    // Two queries: roots + all children, then assemble.
    const roots = await repo.listGoals({ rootOnly: true, includeInactive: opts.includeInactive });
    const children = await repo.listGoals({ includeInactive: opts.includeInactive });

    const rootSlugs = new Map(roots.map((r) => [r.id, r.slug]));

    return roots.map((root) => ({
      ...toGoalView(root, null),
      children: children
        .filter((c) => c.parentGoalId === root.id)
        .map((c) => toGoalView(c, root.slug)),
    }));
  }

  const goals = await repo.listGoals(opts);
  // Collect parent slugs for any children in the flat list.
  const parentIds = [...new Set(goals.filter((g) => g.parentGoalId).map((g) => g.parentGoalId!))];
  const parentSlugMap = new Map<number, string>();
  for (const pid of parentIds) {
    const p = await repo.findGoalById(pid);
    if (p) parentSlugMap.set(pid, p.slug);
  }

  return goals.map((g) =>
    toGoalView(g, g.parentGoalId ? (parentSlugMap.get(g.parentGoalId) ?? null) : null),
  );
}

/** Get a single goal by slug (public). */
export async function getGoal(slug: string): Promise<GoalView> {
  const goal = await repo.findGoalBySlug(slug);
  if (!goal) throw new GoalNotFoundError(slug);

  const parentSlug =
    goal.parentGoalId
      ? ((await repo.findGoalById(goal.parentGoalId))?.slug ?? null)
      : null;

  return toGoalView(goal, parentSlug);
}

/** Get a goal and its mapped services (public). */
export async function getGoalWithServices(slug: string): Promise<GoalWithServices> {
  const goal = await repo.findGoalBySlug(slug);
  if (!goal) throw new GoalNotFoundError(slug);

  const parentSlug =
    goal.parentGoalId
      ? ((await repo.findGoalById(goal.parentGoalId))?.slug ?? null)
      : null;

  const services = await repo.listServicesForGoal(goal.id);

  return {
    ...toGoalView(goal, parentSlug),
    services,
  };
}

// ── Admin writes ──────────────────────────────────────────────────────────────

export async function createGoal(input: CreateGoalInput): Promise<GoalView> {
  validateSlug(input.slug);

  if (await repo.slugExists(input.slug)) {
    throw new GoalConflictError(input.slug);
  }

  if (input.parentGoalId != null) {
    await assertMaxDepth(input.parentGoalId);
  }

  const goal = await repo.createGoal(input);
  return toGoalView(goal, null);
}

export async function updateGoal(slug: string, input: UpdateGoalInput): Promise<GoalView> {
  const existing = await repo.findGoalBySlug(slug, true /* includeInactive */);
  if (!existing) throw new GoalNotFoundError(slug);

  if (input.parentGoalId != null) {
    if (input.parentGoalId === existing.id) {
      throw new GoalValidationError("A goal cannot be its own parent", "parentGoalId");
    }
    await assertMaxDepth(input.parentGoalId);
  }

  const updated = await repo.updateGoal(existing.id, input);
  if (!updated) throw new GoalNotFoundError(slug);

  const parentSlug =
    updated.parentGoalId
      ? ((await repo.findGoalById(updated.parentGoalId))?.slug ?? null)
      : null;

  return toGoalView(updated, parentSlug);
}

// ── Admin mapping writes ──────────────────────────────────────────────────────

export async function addServiceToGoal(
  goalSlug: string,
  input: CreateMappingInput,
): Promise<{ goalSlug: string; serviceId: number; relevanceScore: number; isPrimary: boolean }> {
  const goal = await repo.findGoalBySlug(goalSlug, true);
  if (!goal) throw new GoalNotFoundError(goalSlug);

  const existing = await repo.findMapping(goal.id, input.serviceId);
  if (existing) throw new MappingConflictError(goal.id, input.serviceId);

  const mapping = await repo.createMapping(goal.id, input);
  return {
    goalSlug,
    serviceId: mapping.serviceId,
    relevanceScore: mapping.relevanceScore,
    isPrimary: mapping.isPrimary,
  };
}

export async function removeServiceFromGoal(
  goalSlug: string,
  serviceId: number,
): Promise<boolean> {
  const goal = await repo.findGoalBySlug(goalSlug, true);
  if (!goal) throw new GoalNotFoundError(goalSlug);
  return repo.deleteMappingByGoalAndService(goal.id, serviceId);
}

/** Admin helper: bulk-map service codes to a goal (used by seed scripts). */
export async function bulkMapServiceCodesToGoal(
  goalSlug: string,
  mappings: Array<{ serviceCode: string; relevanceScore?: number; isPrimary?: boolean }>,
): Promise<{ mapped: string[]; skipped: string[] }> {
  const goal = await repo.findGoalBySlug(goalSlug, true);
  if (!goal) throw new GoalNotFoundError(goalSlug);

  const codes = mappings.map((m) => m.serviceCode);
  const codeToId = await repo.resolveServiceIdsByCodes(codes);

  const mapped: string[] = [];
  const skipped: string[] = [];

  for (const m of mappings) {
    const serviceId = codeToId.get(m.serviceCode);
    if (!serviceId) { skipped.push(m.serviceCode); continue; }

    const existing = await repo.findMapping(goal.id, serviceId);
    if (existing) { skipped.push(m.serviceCode); continue; }

    await repo.createMapping(goal.id, {
      serviceId,
      relevanceScore: m.relevanceScore ?? 50,
      isPrimary: m.isPrimary ?? false,
    });
    mapped.push(m.serviceCode);
  }

  return { mapped, skipped };
}
