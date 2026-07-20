/**
 * goals/goalRepository.ts — Goal Taxonomy data-access layer
 *
 * All DB interaction lives here. The service layer must NOT import from
 * @workspace/db directly — it calls this module instead.
 *
 * Uses raw SQL via the shared `pool` for Goal-specific queries so we don't
 * need to rebuild the @workspace/db package every time we iterate on the
 * goal schema. Drizzle tables are used where they exist (aiGoalsTable,
 * aiGoalServiceMappingsTable).
 */
import { db, pool, aiGoalsTable, aiGoalServiceMappingsTable } from "@workspace/db";
import { eq, and, asc, isNull, inArray } from "drizzle-orm";
import type {
  Goal,
  GoalServiceMapping,
  GoalServiceStub,
  CreateGoalInput,
  UpdateGoalInput,
  CreateMappingInput,
  ListGoalsOptions,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToGoal(row: typeof aiGoalsTable.$inferSelect): Goal {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    parentGoalId: row.parentGoalId ?? null,
    metadataJson: (row.metadataJson as Record<string, unknown> | null) ?? null,
    displayOrder: row.displayOrder,
    status: row.status as Goal["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Goal reads ────────────────────────────────────────────────────────────────

export async function listGoals(opts: ListGoalsOptions = {}): Promise<Goal[]> {
  const conditions = [];

  if (!opts.includeInactive) {
    conditions.push(eq(aiGoalsTable.status, "active"));
  }
  if (opts.rootOnly) {
    conditions.push(isNull(aiGoalsTable.parentGoalId));
  }

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(aiGoalsTable)
          .where(and(...conditions))
          .orderBy(asc(aiGoalsTable.displayOrder), asc(aiGoalsTable.id))
      : await db
          .select()
          .from(aiGoalsTable)
          .orderBy(asc(aiGoalsTable.displayOrder), asc(aiGoalsTable.id));

  return rows.map(rowToGoal);
}

export async function findGoalBySlug(
  slug: string,
  includeInactive = false,
): Promise<Goal | undefined> {
  const conditions = [eq(aiGoalsTable.slug, slug)];
  if (!includeInactive) conditions.push(eq(aiGoalsTable.status, "active"));

  const [row] = await db
    .select()
    .from(aiGoalsTable)
    .where(and(...conditions))
    .limit(1);

  return row ? rowToGoal(row) : undefined;
}

export async function findGoalById(id: number): Promise<Goal | undefined> {
  const [row] = await db
    .select()
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.id, id))
    .limit(1);
  return row ? rowToGoal(row) : undefined;
}

/** Returns all direct children of a parent goal. */
export async function listChildGoals(parentGoalId: number): Promise<Goal[]> {
  const rows = await db
    .select()
    .from(aiGoalsTable)
    .where(
      and(
        eq(aiGoalsTable.parentGoalId, parentGoalId),
        eq(aiGoalsTable.status, "active"),
      ),
    )
    .orderBy(asc(aiGoalsTable.displayOrder), asc(aiGoalsTable.id));
  return rows.map(rowToGoal);
}

/** Checks whether a slug already exists (used in create to return 409 early). */
export async function slugExists(slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: aiGoalsTable.id })
    .from(aiGoalsTable)
    .where(eq(aiGoalsTable.slug, slug))
    .limit(1);
  return !!row;
}

// ── Goal writes ───────────────────────────────────────────────────────────────

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const [row] = await db
    .insert(aiGoalsTable)
    .values({
      slug: input.slug,
      name: input.name,
      description: input.description,
      icon: input.icon,
      parentGoalId: input.parentGoalId,
      metadataJson: input.metadataJson ?? {},
      displayOrder: input.displayOrder ?? 0,
      status: input.status ?? "active",
    })
    .returning();
  return rowToGoal(row!);
}

export async function updateGoal(id: number, input: UpdateGoalInput): Promise<Goal | undefined> {
  const set: Partial<typeof aiGoalsTable.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.icon !== undefined) set.icon = input.icon;
  if ("parentGoalId" in input) set.parentGoalId = input.parentGoalId ?? undefined;
  if (input.metadataJson !== undefined) set.metadataJson = input.metadataJson;
  if (input.displayOrder !== undefined) set.displayOrder = input.displayOrder;
  if (input.status !== undefined) set.status = input.status;

  if (Object.keys(set).length === 0) return findGoalById(id);

  const [row] = await db
    .update(aiGoalsTable)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(aiGoalsTable.id, id))
    .returning();

  return row ? rowToGoal(row) : undefined;
}

// ── Mapping reads ─────────────────────────────────────────────────────────────

/**
 * Returns all active service stubs for a goal, enriched with service data
 * via a raw SQL join against ai_services (no Drizzle schema needed for that
 * table on this side — we project only public-safe columns).
 */
export async function listServicesForGoal(goalId: number): Promise<GoalServiceStub[]> {
  const { rows } = await pool.query<{
    service_id: number;
    service_code: string;
    service_name: string;
    short_description: string | null;
    starting_price: string | null;
    currency: string;
    estimated_delivery: string | null;
    relevance_score: number;
    is_primary: boolean;
    display_order: number;
  }>(
    // Team 04 (Phase 6): select s.id so GoalServiceStub carries the numeric serviceId.
    // Also joins ai_service_categories to enforce Team 01 commercial eligibility policy:
    //   s.status = 'active'              (service-level gate)
    //   c.visibility = 'public'          (category-level gate 1)
    //   c.commercial_status = 'commercial_ready' (category-level gate 2)
    //   c.status = 'active'              (category-level gate 3)
    // Internally-only or commercially-blocked services are excluded even when a
    // goal mapping exists. This matches isServiceCommerciallyEligible() from
    // artifacts/api-server/src/policy/commercialEligibilityPolicy.ts.
    `SELECT
       s.id              AS service_id,
       s.service_code,
       s.service_name,
       s.short_description,
       s.starting_price,
       s.currency,
       s.estimated_delivery,
       m.relevance_score,
       m.is_primary,
       m.display_order
     FROM ai_goal_service_mappings m
     JOIN ai_services s           ON s.id  = m.service_id
     JOIN ai_service_categories c ON c.id  = s.category_id
     WHERE m.goal_id = $1
       AND m.status             = 'active'
       AND s.status             = 'active'
       AND c.visibility         = 'public'
       AND c.commercial_status  = 'commercial_ready'
       AND c.status             = 'active'
     ORDER BY m.display_order ASC, m.relevance_score DESC, m.id ASC`,
    [goalId],
  );

  return rows.map((r) => ({
    serviceId: r.service_id,
    serviceCode: r.service_code,
    serviceName: r.service_name,
    shortDescription: r.short_description,
    startingPrice: r.starting_price,
    currency: r.currency,
    estimatedDelivery: r.estimated_delivery,
    relevanceScore: r.relevance_score,
    isPrimary: r.is_primary,
    displayOrder: r.display_order,
  }));
}

export async function findMapping(
  goalId: number,
  serviceId: number,
): Promise<GoalServiceMapping | undefined> {
  const [row] = await db
    .select()
    .from(aiGoalServiceMappingsTable)
    .where(
      and(
        eq(aiGoalServiceMappingsTable.goalId, goalId),
        eq(aiGoalServiceMappingsTable.serviceId, serviceId),
      ),
    )
    .limit(1);
  return row
    ? {
        ...row,
        status: row.status as GoalServiceMapping["status"],
      }
    : undefined;
}

export async function listMappingsByGoalId(goalId: number): Promise<GoalServiceMapping[]> {
  const rows = await db
    .select()
    .from(aiGoalServiceMappingsTable)
    .where(eq(aiGoalServiceMappingsTable.goalId, goalId))
    .orderBy(asc(aiGoalServiceMappingsTable.displayOrder));
  return rows.map((r) => ({ ...r, status: r.status as GoalServiceMapping["status"] }));
}

// ── Mapping writes ────────────────────────────────────────────────────────────

export async function createMapping(
  goalId: number,
  input: CreateMappingInput,
): Promise<GoalServiceMapping> {
  const [row] = await db
    .insert(aiGoalServiceMappingsTable)
    .values({
      goalId,
      serviceId: input.serviceId,
      relevanceScore: input.relevanceScore ?? 50,
      displayOrder: input.displayOrder ?? 0,
      isPrimary: input.isPrimary ?? false,
      status: "active",
    })
    .returning();
  return { ...row!, status: row!.status as GoalServiceMapping["status"] };
}

export async function deleteMappingById(id: number): Promise<boolean> {
  const result = await db
    .delete(aiGoalServiceMappingsTable)
    .where(eq(aiGoalServiceMappingsTable.id, id))
    .returning({ id: aiGoalServiceMappingsTable.id });
  return result.length > 0;
}

export async function deleteMappingByGoalAndService(
  goalId: number,
  serviceId: number,
): Promise<boolean> {
  const result = await db
    .delete(aiGoalServiceMappingsTable)
    .where(
      and(
        eq(aiGoalServiceMappingsTable.goalId, goalId),
        eq(aiGoalServiceMappingsTable.serviceId, serviceId),
      ),
    )
    .returning({ id: aiGoalServiceMappingsTable.id });
  return result.length > 0;
}

/** Resolve service IDs for a batch of service codes (used in admin seed helpers). */
export async function resolveServiceIdsByCodes(
  serviceCodes: string[],
): Promise<Map<string, number>> {
  if (serviceCodes.length === 0) return new Map();
  const { rows } = await pool.query<{ id: number; service_code: string }>(
    `SELECT id, service_code FROM ai_services WHERE service_code = ANY($1::text[])`,
    [serviceCodes],
  );
  return new Map(rows.map((r) => [r.service_code, r.id]));
}
