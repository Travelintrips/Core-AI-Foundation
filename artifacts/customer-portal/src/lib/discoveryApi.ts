/**
 * Discovery API Adapter — Team 03
 *
 * Covers Goals (Team 02) and Solution Collections (Team 04).
 *
 * ── Goal endpoints ──────────────────────────────────────────────────────────
 *   GET /api/ai/goals                     → { goals: GoalView[] }
 *   GET /api/ai/goals/:slug               → { goal: GoalView }
 *   GET /api/ai/goals/:slug/services      → GoalWithServices
 *
 * ── Solution Collection endpoints (Team 04) ─────────────────────────────────
 *   GET /api/ai/solution-collections      → { collections: SafeCollection[] }
 *   GET /api/ai/solution-collections/:slug → { collection, services[] }
 *
 * ── Navigation contract ─────────────────────────────────────────────────────
 *   GoalServiceStub now includes serviceId (number) — Team 04 Phase 6 fix.
 *   Use /services/${serviceId} for navigation.
 *   serviceCode is metadata only — never used for routing.
 *   serviceName is a display label only — never used as an identifier.
 *
 * ── Data integrity ──────────────────────────────────────────────────────────
 *   No runtime fixture fallback.
 *   No hardcoded service lists.
 *   No fake data.
 *   API failures throw; React Query handles retry and error state.
 *   Test fixtures live ONLY in __tests__/use-discovery.test.ts.
 */

// ── Goal types ────────────────────────────────────────────────────────────────

/** Customer-facing goal summary (from GET /api/ai/goals). */
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

/**
 * Service stub attached to a GoalDetail.
 *
 * CONTRACT (Team 04 Phase 6 fix applied):
 *   serviceId — numeric PK from ai_services.id — use for /services/:id routing.
 *   serviceCode — machine-stable business identifier — metadata only, NOT for routing.
 *   serviceName — mutable display label — NOT an identifier.
 */
export type GoalService = {
  /** Numeric primary key. Use /services/${serviceId} for navigation. */
  serviceId: number;
  /** Machine-stable business code. METADATA ONLY — do not use for routing. */
  serviceCode: string;
  serviceName: string;
  shortDescription: string | null;
  startingPrice: string | null;
  currency: string;
  estimatedDelivery: string | null;
  /** 0–100 relevance score set by admin (deterministic, not AI). */
  relevanceScore: number;
  /** Whether this is the primary recommended service for the goal. */
  isPrimary: boolean;
  displayOrder: number;
};

/** Goal with its mapped services (from GET /api/ai/goals/:slug/services). */
export type GoalDetail = GoalSummary & {
  services: GoalService[];
};

// ── Collection types (Team 04) ────────────────────────────────────────────────

/**
 * Public solution collection summary (from GET /api/ai/solution-collections).
 * Internal `id` and admin metadata are stripped server-side.
 */
export type CollectionSummary = {
  code: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  status: string;
  visibility: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Eligible service from a solution collection detail.
 * `membership` and `categoryId` are stripped server-side.
 */
export type CollectionService = {
  id: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string | null;
  startingPrice: string | null;
  currency: string;
  estimatedDelivery: string | null;
  status: string;
};

/** Collection with its commercially eligible services. */
export type CollectionDetail = {
  collection: CollectionSummary;
  services: CollectionService[];
};

// ── Normalisation helpers ─────────────────────────────────────────────────────

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
    // Team 04 Phase 6 fix: serviceId is now present in the API response
    serviceId:        typeof raw.serviceId        === "number"  ? raw.serviceId        : 0,
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

function normaliseCollection(raw: Record<string, unknown>): CollectionSummary {
  return {
    code:             typeof raw.code             === "string" ? raw.code             : "",
    slug:             typeof raw.slug             === "string" ? raw.slug             : "",
    name:             typeof raw.name             === "string" ? raw.name             : "",
    shortDescription: typeof raw.shortDescription === "string" ? raw.shortDescription : null,
    status:           typeof raw.status           === "string" ? raw.status           : "active",
    visibility:       typeof raw.visibility       === "string" ? raw.visibility       : "public",
    displayOrder:     typeof raw.displayOrder     === "number" ? raw.displayOrder     : 0,
    createdAt:        typeof raw.createdAt        === "string" ? raw.createdAt        : "",
    updatedAt:        typeof raw.updatedAt        === "string" ? raw.updatedAt        : "",
  };
}

function normaliseCollectionService(raw: Record<string, unknown>): CollectionService {
  return {
    id:               typeof raw.id               === "number" ? raw.id               : 0,
    serviceCode:      typeof raw.serviceCode      === "string" ? raw.serviceCode      : "",
    serviceName:      typeof raw.serviceName      === "string" ? raw.serviceName      : "",
    shortDescription: typeof raw.shortDescription === "string" ? raw.shortDescription : null,
    startingPrice:    typeof raw.startingPrice    === "string" ? raw.startingPrice    : null,
    currency:         typeof raw.currency         === "string" ? raw.currency         : "IDR",
    estimatedDelivery:typeof raw.estimatedDelivery === "string"? raw.estimatedDelivery : null,
    status:           typeof raw.status           === "string" ? raw.status           : "active",
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

// ── Goal fetch functions ──────────────────────────────────────────────────────

/**
 * Fetch all active goals.
 * GET /api/ai/goals → { goals: GoalView[] }
 *
 * Returns GoalSummary[] without per-goal service counts.
 * Throws on network or server error.
 */
export async function fetchGoals(signal?: AbortSignal): Promise<GoalSummary[]> {
  const raw = await apiGet<{ goals?: Record<string, unknown>[] }>("/api/ai/goals", signal);
  const goals = Array.isArray(raw?.goals) ? raw.goals : [];
  return goals.map(normaliseGoal);
}

/**
 * Fetch a single goal with its commercially eligible services.
 * GET /api/ai/goals/:slug/services → GoalWithServices
 *
 * Returns null on 404 (unknown or inactive slug).
 * Throws on other API errors.
 *
 * Navigation: use service.serviceId for /services/:id routing.
 * Backend applies Team 01 commercial eligibility — frontend trusts this filtering.
 */
export async function fetchGoalDetail(slug: string, signal?: AbortSignal): Promise<GoalDetail | null> {
  try {
    const raw = await apiGet<Record<string, unknown>>(
      `/api/ai/goals/${encodeURIComponent(slug)}/services`,
      signal,
    );
    const summary = normaliseGoal(raw);
    const rawSvcs = Array.isArray(raw.services)
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

// ── Solution Collection fetch functions (Team 04) ─────────────────────────────

/**
 * Fetch all public active solution collections.
 * GET /api/ai/solution-collections → { collections: SafeCollection[] }
 *
 * Server already filters to status=active & visibility=public.
 * No auth required — public endpoint.
 */
export async function fetchCollections(signal?: AbortSignal): Promise<CollectionSummary[]> {
  const raw = await apiGet<{ collections?: Record<string, unknown>[] }>(
    "/api/ai/solution-collections",
    signal,
  );
  const collections = Array.isArray(raw?.collections) ? raw.collections : [];
  return collections.map(normaliseCollection);
}

/**
 * Fetch a single public solution collection with its eligible services.
 * GET /api/ai/solution-collections/:slug → { collection, services }
 *
 * Returns null on 404.
 * Services are commercially eligible — filtered by Team 01 policy server-side.
 */
export async function fetchCollectionDetail(
  slug: string,
  signal?: AbortSignal,
): Promise<CollectionDetail | null> {
  try {
    const raw = await apiGet<{
      collection?: Record<string, unknown>;
      services?: Record<string, unknown>[];
    }>(`/api/ai/solution-collections/${encodeURIComponent(slug)}`, signal);

    const collection = raw?.collection ? normaliseCollection(raw.collection) : null;
    if (!collection) return null;

    const services = Array.isArray(raw?.services)
      ? (raw.services as Record<string, unknown>[]).map(normaliseCollectionService)
      : [];

    return { collection, services };
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
}
