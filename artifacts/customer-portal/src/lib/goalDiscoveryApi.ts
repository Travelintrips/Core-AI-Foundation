/**
 * Goal Discovery API Adapter — Team 03
 *
 * Wraps the public Goal Taxonomy endpoints from Team 2:
 *   GET /api/ai/goals                  → { goals: GoalView[] }
 *   GET /api/ai/goals/:slug            → { goal: GoalView }
 *   GET /api/ai/goals/:slug/services   → GoalWithServices (GoalView + services[])
 *
 * CONTRACT SOURCE: origin/feature/v4.2c-goal-taxonomy
 *   artifacts/api-server/src/goals/types.ts — GoalView, GoalServiceStub, GoalWithServices
 *   artifacts/api-server/src/goals/goalRoutes.ts — exact response shapes per endpoint
 *
 * CONTRACT GAP (for Team 6 / Team 02):
 *   GoalServiceStub does not include a numeric serviceId.
 *   Customer portal /services/:id requires a numeric ID.
 *   Current workaround: CTA uses serviceCode for catalog search (/services?q=<serviceCode>).
 *   CTA is labelled "Lihat layanan terkait" (not "Lihat detail") to accurately represent
 *   the search behaviour.
 *   Resolution required: Team 02 or Team 04 must extend GoalServiceStub with serviceId.
 *
 * No runtime fixture fallback. API failures throw and are handled by React Query.
 * Test fixtures live only in __tests__/use-goals.test.ts.
 */

// ── Public types (customer-facing view models) ────────────────────────────────
// Mirror Team 02 GoalView and GoalServiceStub exactly.

export type GoalSummary = {
  /** URL-safe identifier — stable, use as React key and route param. */
  slug: string;
  name: string;
  description: string | null;
  /** Emoji or icon identifier. */
  icon: string | null;
  displayOrder: number;
  /** Slug of the parent goal, or null for top-level goals. */
  parentGoalSlug: string | null;
  metadata: Record<string, unknown>;
};

export type GoalService = {
  /**
   * Stable machine-generated code (e.g. "BRAND_LOGO").
   * Use as key and as search term for /services?q=<serviceCode>.
   * NOTE: numeric serviceId is absent — contract gap (see file header).
   */
  serviceCode: string;
  serviceName: string;
  shortDescription: string | null;
  startingPrice: string | null;
  currency: string;
  estimatedDelivery: string | null;
  /** 0–100 relevance score set by admin (deterministic, not AI). */
  relevanceScore: number;
  /** Whether this is the recommended primary entry point for the goal. */
  isPrimary: boolean;
  displayOrder: number;
};

export type GoalDetail = GoalSummary & {
  /**
   * Services mapped to this goal, ordered by displayOrder + relevanceScore.
   * Use services.length as the authoritative service count — GoalSummary
   * from the list endpoint does not carry a separate serviceCount field.
   */
  services: GoalService[];
};

// ── Normalisation helpers ─────────────────────────────────────────────────────
// Team 02 service layer already returns camelCase (toGoalView converts from DB).
// These functions enforce the contract types and handle malformed payloads safely.

function normaliseGoal(raw: Record<string, unknown>): GoalSummary {
  if (!raw || typeof raw !== "object") {
    throw new Error("Malformed goal: expected an object");
  }
  return {
    slug:           typeof raw.slug           === "string"  ? raw.slug           : "",
    name:           typeof raw.name           === "string"  ? raw.name           : "",
    description:    typeof raw.description    === "string"  ? raw.description    : null,
    icon:           typeof raw.icon           === "string"  ? raw.icon           : null,
    displayOrder:   typeof raw.displayOrder   === "number"  ? raw.displayOrder   : 0,
    parentGoalSlug: typeof raw.parentGoalSlug === "string"  ? raw.parentGoalSlug : null,
    metadata:
      raw.metadata != null && typeof raw.metadata === "object"
        ? (raw.metadata as Record<string, unknown>)
        : {},
  };
}

function normaliseGoalService(raw: Record<string, unknown>): GoalService {
  if (!raw || typeof raw !== "object") {
    throw new Error("Malformed goal service: expected an object");
  }
  return {
    serviceCode:      typeof raw.serviceCode      === "string"  ? raw.serviceCode      : "",
    serviceName:      typeof raw.serviceName      === "string"  ? raw.serviceName      : "",
    shortDescription: typeof raw.shortDescription === "string"  ? raw.shortDescription : null,
    startingPrice:    typeof raw.startingPrice    === "string"  ? raw.startingPrice    : null,
    currency:         typeof raw.currency         === "string"  ? raw.currency         : "IDR",
    estimatedDelivery:typeof raw.estimatedDelivery === "string" ? raw.estimatedDelivery : null,
    relevanceScore:   typeof raw.relevanceScore   === "number"  ? raw.relevanceScore   : 0,
    isPrimary:        typeof raw.isPrimary        === "boolean" ? raw.isPrimary        : false,
    displayOrder:     typeof raw.displayOrder     === "number"  ? raw.displayOrder     : 0,
  };
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

type ApiError = Error & { status?: number };

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (res.status === 404) {
    const e: ApiError = new Error(`Not found: ${path}`);
    e.status = 404;
    throw e;
  }
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Fetch all active goals.
 * GET /api/ai/goals → { goals: GoalView[] }
 *
 * Throws on network or server error; React Query handles retry and error state.
 * The returned GoalSummary list does NOT include a serviceCount — callers that
 * need a count must call fetchGoalDetail and use services.length.
 */
export async function fetchGoals(signal?: AbortSignal): Promise<GoalSummary[]> {
  const raw = await apiGet<{ goals?: Record<string, unknown>[] }>("/api/ai/goals", signal);
  const goals = Array.isArray(raw?.goals) ? raw.goals : [];
  return goals.map(normaliseGoal);
}

/**
 * Fetch a single goal with its mapped services.
 * GET /api/ai/goals/:slug/services → GoalWithServices (GoalView + services[])
 *
 * Returns null on 404 (unknown slug). Throws on other errors so React Query
 * can surface the error state to the caller.
 *
 * Use result.services.length as the authoritative service count.
 */
export async function fetchGoalDetail(slug: string, signal?: AbortSignal): Promise<GoalDetail | null> {
  try {
    const raw = await apiGet<Record<string, unknown>>(
      `/api/ai/goals/${encodeURIComponent(slug)}/services`,
      signal,
    );
    const summary  = normaliseGoal(raw);
    const rawSvcs  = Array.isArray(raw.services)
      ? (raw.services as Record<string, unknown>[])
      : [];
    return {
      ...summary,
      services: rawSvcs.map(normaliseGoalService),
    };
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}
