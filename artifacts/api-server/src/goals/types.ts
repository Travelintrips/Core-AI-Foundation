/**
 * goals/types.ts — Goal Taxonomy shared type contracts
 *
 * All types here are pure TypeScript — no framework or DB dependency.
 * These can be imported by the repository, service, and route layers
 * without circular dependencies.
 */

// ── Goal status ───────────────────────────────────────────────────────────────

export type GoalStatus = "active" | "draft" | "archived";
export type MappingStatus = "active" | "disabled";

// ── Domain types ──────────────────────────────────────────────────────────────

/** A single Goal as returned from the repository (raw DB row shape). */
export interface Goal {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  parentGoalId: number | null;
  metadataJson: Record<string, unknown> | null;
  displayOrder: number;
  status: GoalStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** A Goal → Service mapping row. */
export interface GoalServiceMapping {
  id: number;
  goalId: number;
  serviceId: number;
  relevanceScore: number;
  displayOrder: number;
  isPrimary: boolean;
  status: MappingStatus;
  createdAt: Date;
  updatedAt: Date;
}

// ── Service-layer view types ──────────────────────────────────────────────────

/**
 * Enriched goal returned by the service layer for public consumption.
 * Children are only populated on list endpoints that request hierarchy.
 */
export interface GoalView {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
  parentGoalSlug: string | null;
  children?: GoalView[];
  metadata: Record<string, unknown>;
}

/** Service stub attached to a GoalServiceView. Only public-safe fields. */
export interface GoalServiceStub {
  serviceCode: string;
  serviceName: string;
  shortDescription: string | null;
  startingPrice: string | null;
  currency: string;
  estimatedDelivery: string | null;
  relevanceScore: number;
  isPrimary: boolean;
  displayOrder: number;
}

/** A goal together with its mapped services — returned by GET /ai/goals/:slug/services. */
export interface GoalWithServices extends GoalView {
  services: GoalServiceStub[];
}

// ── Input types ───────────────────────────────────────────────────────────────

export interface CreateGoalInput {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  parentGoalId?: number;
  metadataJson?: Record<string, unknown>;
  displayOrder?: number;
  status?: GoalStatus;
}

export interface UpdateGoalInput {
  name?: string;
  description?: string;
  icon?: string;
  parentGoalId?: number | null;
  metadataJson?: Record<string, unknown>;
  displayOrder?: number;
  status?: GoalStatus;
}

export interface CreateMappingInput {
  serviceId: number;
  relevanceScore?: number;
  displayOrder?: number;
  isPrimary?: boolean;
}

// ── List options ──────────────────────────────────────────────────────────────

export interface ListGoalsOptions {
  /** When true, only goals without a parentGoalId are returned (default: false). */
  rootOnly?: boolean;
  /** When true, each top-level goal includes its children array. */
  withChildren?: boolean;
  /** Include draft/archived goals. Admin-only. Default: false (active only). */
  includeInactive?: boolean;
}
