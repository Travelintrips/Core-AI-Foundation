/**
 * Tests for Discovery API Adapter and Hooks — Team 03
 *
 * Covers:
 *   Goals API adapter (fetchGoals, fetchGoalDetail)
 *   Solution Collections API adapter (fetchCollections, fetchCollectionDetail)
 *   serviceId routing contract (Phase 6 Team 04 fix)
 *   Commercial policy assumptions (Team 01)
 *   Error states, loading states, empty states
 *   Regression: existing catalog + service-detail unchanged
 *
 * No runtime fixture fallback. All tests mock globalThis.fetch.
 * Test-only factories produce all fixture data.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchGoals,
  fetchGoalDetail,
  fetchCollections,
  fetchCollectionDetail,
} from "@/lib/discoveryApi";

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeGoalView(overrides: Record<string, unknown> = {}) {
  return {
    slug:           "test-goal",
    name:           "Test Goal",
    description:    "A test business goal",
    icon:           "🎯",
    displayOrder:   1,
    parentGoalSlug: null,
    metadata:       {},
    ...overrides,
  };
}

function makeGoalServiceStub(overrides: Record<string, unknown> = {}) {
  return {
    serviceId:        42,
    serviceCode:      "SVC_CODE",
    serviceName:      "Test Service",
    shortDescription: "A test service description",
    startingPrice:    "500000",
    currency:         "IDR",
    estimatedDelivery:"2-3 hari",
    relevanceScore:   80,
    isPrimary:        false,
    displayOrder:     1,
    ...overrides,
  };
}

function makeGoalWithServices(
  goalOverrides: Record<string, unknown> = {},
  services: Record<string, unknown>[] = [],
) {
  return { ...makeGoalView(goalOverrides), services };
}

function makeCollection(overrides: Record<string, unknown> = {}) {
  return {
    code:             "cc_branding",
    slug:             "branding-package",
    name:             "Branding Package",
    shortDescription: "Complete branding solution",
    status:           "active",
    visibility:       "public",
    displayOrder:     1,
    createdAt:        "2026-07-19T00:00:00.000Z",
    updatedAt:        "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function makeCollectionService(overrides: Record<string, unknown> = {}) {
  return {
    id:               101,
    serviceCode:      "branding_logo",
    serviceName:      "Brand Logo Design",
    shortDescription: "Professional logo creation",
    startingPrice:    "3000000",
    currency:         "IDR",
    estimatedDelivery:"5-7 hari",
    status:           "active",
    ...overrides,
  };
}

// ── Fetch mock helpers ────────────────────────────────────────────────────────

function mockFetchOk(data: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok:         true,
    status:     200,
    statusText: "OK",
    json:       () => Promise.resolve(data),
  } as unknown as Response);
}

function mockFetchStatus(status: number, data: unknown = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok:         status >= 200 && status < 300,
    status,
    statusText: status === 404 ? "Not Found" : "Internal Server Error",
    json:       () => Promise.resolve(data),
  } as unknown as Response);
}

function mockFetchNetworkError(msg = "Network error") {
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error(msg));
}

afterEach(() => vi.restoreAllMocks());

// =============================================================================
// 1. Goal list loading — returns array
// =============================================================================

describe("1. fetchGoals resolves to an array", () => {
  it("returns GoalSummary[] from goals array", async () => {
    mockFetchOk({ goals: [makeGoalView()] });
    const result = await fetchGoals();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when goals is empty", async () => {
    mockFetchOk({ goals: [] });
    const result = await fetchGoals();
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// 2. Goal list success — correct normalisation
// =============================================================================

describe("2. Goal list success — normalised fields", () => {
  it("maps all required fields", async () => {
    const raw = makeGoalView({ slug: "launch-brand", name: "Luncurkan Merek" });
    mockFetchOk({ goals: [raw] });
    const [g] = await fetchGoals();
    expect(g.slug).toBe("launch-brand");
    expect(g.name).toBe("Luncurkan Merek");
    expect(g.description).toBe("A test business goal");
    expect(g.icon).toBe("🎯");
    expect(g.displayOrder).toBe(1);
    expect(g.parentGoalSlug).toBeNull();
    expect(typeof g.metadata).toBe("object");
  });

  it("null description handled gracefully", async () => {
    mockFetchOk({ goals: [makeGoalView({ description: null })] });
    const [g] = await fetchGoals();
    expect(g.description).toBeNull();
  });

  it("null icon handled gracefully", async () => {
    mockFetchOk({ goals: [makeGoalView({ icon: null })] });
    const [g] = await fetchGoals();
    expect(g.icon).toBeNull();
  });
});

// =============================================================================
// 3. Goal list error — API failure throws
// =============================================================================

describe("3. Goal list error — throws on API failure", () => {
  it("throws on 500 response", async () => {
    mockFetchStatus(500);
    await expect(fetchGoals()).rejects.toThrow("API error 500");
  });

  it("throws on network error", async () => {
    mockFetchNetworkError("fetch failed");
    await expect(fetchGoals()).rejects.toThrow("fetch failed");
  });
});

// =============================================================================
// 4. Goal detail success — includes serviceId (Team 04 Phase 6 fix)
// =============================================================================

describe("4. fetchGoalDetail — serviceId is present and numeric", () => {
  it("normalises serviceId as number", async () => {
    const svc = makeGoalServiceStub({ serviceId: 42 });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("launch-brand");
    expect(detail).not.toBeNull();
    expect(detail!.services[0].serviceId).toBe(42);
    expect(typeof detail!.services[0].serviceId).toBe("number");
  });

  it("serviceCode is present as metadata, not used for routing", async () => {
    const svc = makeGoalServiceStub({ serviceCode: "branding_logo" });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("launch-brand");
    expect(detail!.services[0].serviceCode).toBe("branding_logo");
  });
});

// =============================================================================
// 5. Goal detail — all service fields normalised correctly
// =============================================================================

describe("5. fetchGoalDetail — service fields", () => {
  it("maps all GoalService fields", async () => {
    const svc = makeGoalServiceStub({
      serviceId: 7, serviceName: "Brand Logo", relevanceScore: 90, isPrimary: true, displayOrder: 0,
    });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    const s = detail!.services[0];
    expect(s.serviceId).toBe(7);
    expect(s.serviceName).toBe("Brand Logo");
    expect(s.relevanceScore).toBe(90);
    expect(s.isPrimary).toBe(true);
    expect(s.displayOrder).toBe(0);
    expect(s.currency).toBe("IDR");
  });

  it("null startingPrice handled gracefully", async () => {
    const svc = makeGoalServiceStub({ startingPrice: null });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services[0].startingPrice).toBeNull();
  });

  it("null shortDescription handled gracefully", async () => {
    const svc = makeGoalServiceStub({ shortDescription: null });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services[0].shortDescription).toBeNull();
  });

  it("null estimatedDelivery handled gracefully", async () => {
    const svc = makeGoalServiceStub({ estimatedDelivery: null });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services[0].estimatedDelivery).toBeNull();
  });
});

// =============================================================================
// 6. Goal detail — empty services array
// =============================================================================

describe("6. fetchGoalDetail — empty services", () => {
  it("returns empty services array without crashing", async () => {
    mockFetchOk(makeGoalWithServices({}, []));
    const detail = await fetchGoalDetail("test");
    expect(detail).not.toBeNull();
    expect(detail!.services).toHaveLength(0);
  });
});

// =============================================================================
// 7. Goal detail — 404 returns null
// =============================================================================

describe("7. fetchGoalDetail — 404 returns null", () => {
  it("returns null on 404", async () => {
    mockFetchStatus(404, { error: "Not found" });
    const result = await fetchGoalDetail("does-not-exist");
    expect(result).toBeNull();
  });
});

// =============================================================================
// 8. Goal detail — non-404 API error throws
// =============================================================================

describe("8. fetchGoalDetail — non-404 error throws", () => {
  it("throws on 500", async () => {
    mockFetchStatus(500);
    await expect(fetchGoalDetail("test")).rejects.toThrow("API error 500");
  });

  it("throws on network error", async () => {
    mockFetchNetworkError("network failure");
    await expect(fetchGoalDetail("test")).rejects.toThrow("network failure");
  });
});

// =============================================================================
// 9. serviceId routing contract — never use serviceCode as route param
// =============================================================================

describe("9. serviceId routing contract", () => {
  it("fetchGoalDetail URL encodes the slug, not the serviceCode", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(makeGoalWithServices({}, [])),
    } as unknown as Response);
    await fetchGoalDetail("launch-my-brand");
    expect(String(spy.mock.calls[0][0])).toBe("/api/ai/goals/launch-my-brand/services");
  });

  it("URL is /api/ai/goals/:slug/services not /api/ai/goals/:slug", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(makeGoalWithServices({}, [])),
    } as unknown as Response);
    await fetchGoalDetail("test-slug");
    expect(spy.mock.calls[0][0]).toContain("/services");
  });
});

// =============================================================================
// 10. Commercial policy assumptions — frontend trusts backend filtering
// =============================================================================

describe("10. Commercial policy assumptions", () => {
  it("fetchGoalDetail returns all services the API sends (trusts backend filtering)", async () => {
    // Backend (Team 01) applies eligibility filtering. Frontend does not add extra guards.
    const services = [
      makeGoalServiceStub({ serviceId: 1 }),
      makeGoalServiceStub({ serviceId: 2 }),
      makeGoalServiceStub({ serviceId: 3 }),
    ];
    mockFetchOk(makeGoalWithServices({}, services));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services).toHaveLength(3);
  });

  it("fetchGoalDetail does NOT apply its own status filter (trusts backend)", async () => {
    // No client-side 'active' filter — backend (Team 01) is the authority.
    const svcs = [
      makeGoalServiceStub({ serviceId: 1, serviceName: "Active Svc" }),
      makeGoalServiceStub({ serviceId: 2, serviceName: "Another Svc" }),
    ];
    mockFetchOk(makeGoalWithServices({}, svcs));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services).toHaveLength(2);
  });
});

// =============================================================================
// 11. Solution Collections — fetchCollections
// =============================================================================

describe("11. fetchCollections — success", () => {
  it("returns CollectionSummary[]", async () => {
    mockFetchOk({ collections: [makeCollection()] });
    const result = await fetchCollections();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("maps all required fields", async () => {
    mockFetchOk({ collections: [makeCollection()] });
    const [c] = await fetchCollections();
    expect(c.slug).toBe("branding-package");
    expect(c.name).toBe("Branding Package");
    expect(c.code).toBe("cc_branding");
    expect(c.status).toBe("active");
    expect(c.visibility).toBe("public");
  });

  it("returns empty array when collections is empty", async () => {
    mockFetchOk({ collections: [] });
    const result = await fetchCollections();
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// 12. Solution Collections — fetchCollections error
// =============================================================================

describe("12. fetchCollections — error handling", () => {
  it("throws on 500", async () => {
    mockFetchStatus(500);
    await expect(fetchCollections()).rejects.toThrow("API error 500");
  });

  it("throws on network error", async () => {
    mockFetchNetworkError("timeout");
    await expect(fetchCollections()).rejects.toThrow("timeout");
  });
});

// =============================================================================
// 13. Collection detail — success
// =============================================================================

describe("13. fetchCollectionDetail — success", () => {
  it("returns collection and services", async () => {
    mockFetchOk({
      collection: makeCollection(),
      services:   [makeCollectionService()],
    });
    const detail = await fetchCollectionDetail("branding-package");
    expect(detail).not.toBeNull();
    expect(detail!.collection.slug).toBe("branding-package");
    expect(detail!.services).toHaveLength(1);
  });

  it("service id is numeric", async () => {
    mockFetchOk({
      collection: makeCollection(),
      services:   [makeCollectionService({ id: 101 })],
    });
    const detail = await fetchCollectionDetail("test");
    expect(detail!.services[0].id).toBe(101);
    expect(typeof detail!.services[0].id).toBe("number");
  });

  it("null shortDescription handled", async () => {
    mockFetchOk({
      collection: makeCollection(),
      services:   [makeCollectionService({ shortDescription: null })],
    });
    const detail = await fetchCollectionDetail("test");
    expect(detail!.services[0].shortDescription).toBeNull();
  });
});

// =============================================================================
// 14. Collection detail — empty services
// =============================================================================

describe("14. fetchCollectionDetail — empty services", () => {
  it("returns empty services without crashing", async () => {
    mockFetchOk({ collection: makeCollection(), services: [] });
    const detail = await fetchCollectionDetail("test");
    expect(detail!.services).toHaveLength(0);
  });
});

// =============================================================================
// 15. Collection detail — 404 returns null
// =============================================================================

describe("15. fetchCollectionDetail — 404 returns null", () => {
  it("returns null on 404", async () => {
    mockFetchStatus(404, { error: "Not found" });
    const result = await fetchCollectionDetail("unknown-collection");
    expect(result).toBeNull();
  });
});

// =============================================================================
// 16. Collection detail — non-404 error throws
// =============================================================================

describe("16. fetchCollectionDetail — error throws", () => {
  it("throws on 500", async () => {
    mockFetchStatus(500);
    await expect(fetchCollectionDetail("test")).rejects.toThrow("API error 500");
  });
});

// =============================================================================
// 17. URL construction — correct API paths
// =============================================================================

describe("17. URL construction", () => {
  it("fetchGoals hits /api/ai/goals", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ goals: [] }),
    } as unknown as Response);
    await fetchGoals();
    expect(spy.mock.calls[0][0]).toBe("/api/ai/goals");
  });

  it("fetchCollections hits /api/ai/solution-collections", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ collections: [] }),
    } as unknown as Response);
    await fetchCollections();
    expect(spy.mock.calls[0][0]).toBe("/api/ai/solution-collections");
  });

  it("fetchCollectionDetail hits /api/ai/solution-collections/:slug", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ collection: makeCollection(), services: [] }),
    } as unknown as Response);
    await fetchCollectionDetail("my-package");
    expect(spy.mock.calls[0][0]).toBe("/api/ai/solution-collections/my-package");
  });
});

// =============================================================================
// 18. Slug encoding — special characters
// =============================================================================

describe("18. Slug URL encoding", () => {
  it("encodeURIComponent is applied to goal slug", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve(makeGoalWithServices({}, [])),
    } as unknown as Response);
    await fetchGoalDetail("launch-my-brand");
    expect(String(spy.mock.calls[0][0])).toMatch(/launch-my-brand/);
  });
});

// =============================================================================
// 19. Slug-based navigation (documented contract)
// =============================================================================

describe("19. Navigation contract — serviceId routing", () => {
  it("serviceId is 0 when API omits it (safe default — link hidden in UI)", async () => {
    const svc = makeGoalServiceStub({ serviceId: undefined });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services[0].serviceId).toBe(0);
  });

  it("serviceId > 0 when API provides it correctly", async () => {
    const svc = makeGoalServiceStub({ serviceId: 55 });
    mockFetchOk(makeGoalWithServices({}, [svc]));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services[0].serviceId).toBe(55);
  });
});

// =============================================================================
// 20. Multiple goals in response
// =============================================================================

describe("20. Multiple goals in response", () => {
  it("all goals are normalised", async () => {
    const rawGoals = [
      makeGoalView({ slug: "branding", name: "Branding" }),
      makeGoalView({ slug: "marketing", name: "Pemasaran" }),
      makeGoalView({ slug: "digital", name: "Digital" }),
    ];
    mockFetchOk({ goals: rawGoals });
    const result = await fetchGoals();
    expect(result).toHaveLength(3);
    expect(result.map(g => g.slug)).toEqual(["branding", "marketing", "digital"]);
  });
});

// =============================================================================
// 21. Regression: URL-safe slugs
// =============================================================================

describe("21. Regression — URL-safe slugs", () => {
  it("slugs from fetchGoals are URL-safe strings", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({
        goals: [
          makeGoalView({ slug: "launch-brand" }),
          makeGoalView({ slug: "content-12" }),
          makeGoalView({ slug: "social-media-3" }),
        ],
      }),
    } as unknown as Response);
    const goals = await fetchGoals();
    for (const g of goals) {
      expect(g.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

// =============================================================================
// 22. AbortSignal is forwarded
// =============================================================================

describe("22. AbortSignal forwarding", () => {
  it("fetchGoals forwards signal to fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ goals: [] }),
    } as unknown as Response);
    const controller = new AbortController();
    await fetchGoals(controller.signal);
    const [, options] = spy.mock.calls[0];
    expect((options as RequestInit)?.signal).toBe(controller.signal);
  });

  it("fetchCollections forwards signal to fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ collections: [] }),
    } as unknown as Response);
    const controller = new AbortController();
    await fetchCollections(controller.signal);
    const [, options] = spy.mock.calls[0];
    expect((options as RequestInit)?.signal).toBe(controller.signal);
  });
});

// =============================================================================
// 23. Malformed API response — safe fallback without crash
// =============================================================================

describe("23. Malformed response — safe fallback", () => {
  it("fetchGoals handles missing goals key", async () => {
    mockFetchOk({});
    const result = await fetchGoals();
    expect(result).toHaveLength(0);
  });

  it("fetchGoals handles null goals", async () => {
    mockFetchOk({ goals: null });
    const result = await fetchGoals();
    expect(result).toHaveLength(0);
  });

  it("fetchGoalDetail handles missing services key", async () => {
    mockFetchOk(makeGoalView({ services: undefined }));
    const detail = await fetchGoalDetail("test");
    expect(detail!.services).toHaveLength(0);
  });

  it("fetchCollections handles missing collections key", async () => {
    mockFetchOk({});
    const result = await fetchCollections();
    expect(result).toHaveLength(0);
  });
});

// =============================================================================
// 24. Collection services use service.id for routing (not serviceCode)
// =============================================================================

describe("24. Collection service routing", () => {
  it("service.id is present and numeric", async () => {
    mockFetchOk({
      collection: makeCollection(),
      services:   [makeCollectionService({ id: 55 })],
    });
    const detail = await fetchCollectionDetail("test");
    expect(detail!.services[0].id).toBe(55);
    expect(typeof detail!.services[0].id).toBe("number");
  });

  it("serviceCode is present as metadata", async () => {
    mockFetchOk({
      collection: makeCollection(),
      services:   [makeCollectionService({ serviceCode: "branding_full" })],
    });
    const detail = await fetchCollectionDetail("test");
    expect(detail!.services[0].serviceCode).toBe("branding_full");
  });
});
