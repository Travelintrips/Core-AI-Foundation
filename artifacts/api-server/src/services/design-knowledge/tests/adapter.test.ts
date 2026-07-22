/**
 * Team 23 — Design Knowledge Adapter: 16 required tests
 *
 * Tests:
 *  1. query validation — empty query rejects
 *  2. provider registration — register appears in listProviders
 *  3. duplicate provider — re-registering same id throws
 *  4. provider priority — lower priority number returns results first
 *  5. unavailable provider — listed in unavailableProviders, no throw
 *  6. timeout handling — timed-out provider listed as unavailable
 *  7. result dedup — identical recs from two providers produce one result
 *  8. source attribution — every recommendation has ≥1 citation
 *  9. confidence bounds — confidence is "high"|"medium"|"low"
 * 10. recommendation reason — reason.summary is non-empty
 * 11. no-source recommendation warning — hasSource:false is explicit
 * 12. tenant scope — tenantId is threaded through to result
 * 13. platform scope — platformId is threaded through to result
 * 14. no raw provider payload — no providerRawPayload field in result
 * 15. no automatic mutation — isAdvisory is always true
 * 16. compatibility with existing template knowledge — provider returns well-formed recs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { KnowledgeProviderRegistry } from "../registry.js";
import { DesignKnowledgeAdapter } from "../adapter.js";
import type {
  KnowledgeAdapter,
  DesignKnowledgeQuery,
  DesignRecommendation,
} from "../types.js";

// ─── Mock findBestTemplates so no DB is needed ────────────────────────────────

vi.mock("../../templateKnowledgeMatchingService.js", () => ({
  findBestTemplates: vi.fn().mockResolvedValue({
    matches: [
      {
        template: {
          id: 1,
          name: "Minimalist Brand Kit",
          description: "Clean minimalist template for modern brands",
          style: "minimalist",
          industry: "fashion",
          category: "branding",
          brandDnaTags: { audiences: ["premium"], personalities: ["elegant"], voices: [] },
          colorTheme: { primary: "#1a1a1a" },
          typography: { heading: "Inter", body: "Inter" },
          isPremium: false,
          featured: false,
          views: 120,
          selections: 30,
          status: "published",
        },
        totalScore:     82,
        confidence:     "high",
        dimensions:     [{ dimension: "style", weight: 10, rawScore: 1, weightedScore: 10, reason: "Exact style match" }],
        gapExplanation: undefined,
        isNearestMatch: undefined,
      },
    ],
    bestScore:      82,
    meetsThreshold: true,
    offerGeneration: false,
    inputSummary:   { industry: "fashion", style: "minimalist", personalities: [], audience: "premium" },
  }),
}));

vi.mock("../../memoryResolver.js", () => ({
  resolveAgentContext: vi.fn().mockResolvedValue({
    clientMemory:  {},
    projectMemory: [],
    systemContext: { stepIndex: 0, totalSteps: 1, completedSteps: [], currentStep: "test" },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<DesignRecommendation> = {}): DesignRecommendation {
  return {
    id:           "test-id",
    type:         "principle",
    title:        "Test principle",
    body:         "Test body content",
    confidence:   "high",
    reason: {
      summary:   "Test reason",
      citations: [
        {
          source: {
            providerId:   "test-provider",
            providerName: "Test Provider",
            retrievedAt:  new Date().toISOString(),
          },
          referenceId:    "ref-1",
          referenceLabel: "Reference 1",
        },
      ],
    },
    applicability: ["All contexts"],
    hasSource:     true,
    scope:         {},
    isAdvisory:    true,
    ...overrides,
  };
}

function makeAdapter(
  id: string,
  recs: DesignRecommendation[] = [makeRec()],
  available = true,
  delayMs = 0,
): KnowledgeAdapter {
  return {
    id,
    name: `Provider ${id}`,
    capability: {
      supportedTypes:         ["principle"],
      supportsIndustryFilter: false,
      supportsStyleFilter:    false,
      supportsTenantScope:    false,
      supportsPlatformScope:  false,
      maxResultsPerQuery:     10,
    },
    async isAvailable() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return available;
    },
    async query() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return recs;
    },
  };
}

const BASE_QUERY: DesignKnowledgeQuery = {
  query: "minimalist logo design for fashion brand",
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Design Knowledge Adapter — Team 23", () => {
  let registry: KnowledgeProviderRegistry;
  let adapter: DesignKnowledgeAdapter;

  beforeEach(() => {
    registry = new KnowledgeProviderRegistry();
    adapter  = new DesignKnowledgeAdapter(registry);
  });

  // ── 1. query validation ────────────────────────────────────────────────────
  it("1. rejects a query with an empty query string", async () => {
    await expect(adapter.query({ query: "" })).rejects.toThrow(
      /non-empty string/i,
    );
    await expect(adapter.query({ query: "   " })).rejects.toThrow(
      /non-empty string/i,
    );
  });

  // ── 2. provider registration ───────────────────────────────────────────────
  it("2. registered provider appears in listProviders", () => {
    registry.register(makeAdapter("p1"), 10);
    const list = adapter.listProviders();
    expect(list.some((p) => p.id === "p1")).toBe(true);
  });

  // ── 3. duplicate provider ──────────────────────────────────────────────────
  it("3. registering a duplicate provider id throws", () => {
    registry.register(makeAdapter("p1"), 10);
    expect(() => registry.register(makeAdapter("p1"), 20)).toThrow(/already registered/i);
  });

  // ── 4. provider priority ──────────────────────────────────────────────────
  it("4. providers are listed in priority order (lower number first)", () => {
    registry.register(makeAdapter("low-pri"),  90);
    registry.register(makeAdapter("high-pri"), 10);
    const list = adapter.listProviders();
    const ids  = list.map((p) => p.id);
    expect(ids.indexOf("high-pri")).toBeLessThan(ids.indexOf("low-pri"));
  });

  // ── 5. unavailable provider ────────────────────────────────────────────────
  it("5. unavailable provider is listed in unavailableProviders and does not throw", async () => {
    registry.register(makeAdapter("unavailable-p", [], false), 10);
    const result = await adapter.query(BASE_QUERY);
    expect(result.unavailableProviders).toContain("unavailable-p");
    expect(result.resolvedProviders).not.toContain("unavailable-p");
  });

  // ── 6. timeout handling ────────────────────────────────────────────────────
  it("6. provider that exceeds timeout is listed as unavailable", async () => {
    // 10 000 ms delay — will exceed the 5 000 ms registry timeout
    registry.register(makeAdapter("slow-p", [makeRec()], true, 10_000), 10);
    const result = await adapter.query(BASE_QUERY);
    expect(result.unavailableProviders).toContain("slow-p");
  }, 10_000);

  // ── 7. result dedup ────────────────────────────────────────────────────────
  it("7. identical recommendations from two providers are deduplicated", async () => {
    const sharedRec = makeRec({ type: "principle", title: "Same rec", body: "Same body" });
    registry.register(makeAdapter("p-a", [sharedRec]), 10);
    registry.register(makeAdapter("p-b", [sharedRec]), 20);
    const result = await adapter.query(BASE_QUERY);
    const titles = result.recommendations.map((r) => r.title);
    const count  = titles.filter((t) => t === "Same rec").length;
    expect(count).toBe(1);
  });

  // ── 8. source attribution ─────────────────────────────────────────────────
  it("8. every recommendation with hasSource:true has at least one citation", async () => {
    const recWithSource = makeRec({ hasSource: true });
    registry.register(makeAdapter("p1", [recWithSource]), 10);
    const result = await adapter.query(BASE_QUERY);
    for (const rec of result.recommendations.filter((r) => r.hasSource)) {
      expect(rec.reason.citations.length).toBeGreaterThan(0);
    }
  });

  // ── 9. confidence bounds ──────────────────────────────────────────────────
  it("9. all recommendation confidence values are within allowed bounds", async () => {
    const recs = [
      makeRec({ confidence: "high" }),
      makeRec({ id: "id2", confidence: "medium", body: "medium body" }),
      makeRec({ id: "id3", confidence: "low",    body: "low body" }),
    ];
    registry.register(makeAdapter("p1", recs), 10);
    const result = await adapter.query(BASE_QUERY);
    for (const rec of result.recommendations) {
      expect(["high", "medium", "low"]).toContain(rec.confidence);
    }
  });

  // ── 10. recommendation reason ─────────────────────────────────────────────
  it("10. all recommendations have a non-empty reason.summary", async () => {
    registry.register(makeAdapter("p1", [makeRec()]), 10);
    const result = await adapter.query(BASE_QUERY);
    for (const rec of result.recommendations) {
      expect(typeof rec.reason.summary).toBe("string");
      expect(rec.reason.summary.trim().length).toBeGreaterThan(0);
    }
  });

  // ── 11. no-source recommendation warning ─────────────────────────────────
  it("11. recommendations without source have hasSource:false (explicit flag)", async () => {
    const noSourceRec = makeRec({ hasSource: false, reason: { summary: "Heuristic only", citations: [] } });
    registry.register(makeAdapter("p1", [noSourceRec]), 10);
    const result = await adapter.query(BASE_QUERY);
    const noSrc   = result.recommendations.filter((r) => !r.hasSource);
    expect(noSrc.length).toBeGreaterThan(0);
    for (const rec of noSrc) {
      expect(rec.reason.citations).toHaveLength(0);
    }
  });

  // ── 12. tenant scope ──────────────────────────────────────────────────────
  it("12. tenantId in scope is threaded through to query result", async () => {
    registry.register(makeAdapter("p1"), 10);
    const result = await adapter.query({
      ...BASE_QUERY,
      scope: { tenantId: "tenant-abc" },
    });
    expect(result.query.scope?.tenantId).toBe("tenant-abc");
  });

  // ── 13. platform scope ────────────────────────────────────────────────────
  it("13. platformId in scope is threaded through to query result", async () => {
    registry.register(makeAdapter("p1"), 10);
    const result = await adapter.query({
      ...BASE_QUERY,
      scope: { platformId: "platform-xyz" },
    });
    expect(result.query.scope?.platformId).toBe("platform-xyz");
  });

  // ── 14. no raw provider payload ───────────────────────────────────────────
  it("14. result does not contain raw provider payload fields", async () => {
    registry.register(makeAdapter("p1"), 10);
    const result = await adapter.query(BASE_QUERY);
    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toMatch(/providerRawPayload/i);
    expect(resultStr).not.toMatch(/rawPayload/i);
    expect(resultStr).not.toMatch(/api_key|apiKey|secret/i);
  });

  // ── 15. no automatic mutation ─────────────────────────────────────────────
  it("15. all recommendations have isAdvisory:true", async () => {
    registry.register(makeAdapter("p1"), 10);
    const result = await adapter.query(BASE_QUERY);
    for (const rec of result.recommendations) {
      expect(rec.isAdvisory).toBe(true);
    }
  });

  // ── 16. compatibility with existing template knowledge ────────────────────
  it("16. templateKnowledgeProvider returns well-formed recommendations", async () => {
    // Import the real provider — findBestTemplates is mocked above
    const { templateKnowledgeProvider } = await import(
      "../providers/templateKnowledgeProvider.js"
    );
    registry.register(templateKnowledgeProvider, 10);

    const result = await adapter.query({
      query:  "minimalist branding for fashion",
      filter: { style: "minimalist", industry: "fashion" },
    });

    expect(result.recommendations.length).toBeGreaterThan(0);

    const tmplRec = result.recommendations.find((r) => r.type === "template");
    expect(tmplRec).toBeDefined();
    if (tmplRec) {
      expect(tmplRec.hasSource).toBe(true);
      expect(tmplRec.isAdvisory).toBe(true);
      expect(tmplRec.reason.citations.length).toBeGreaterThan(0);
      expect(typeof tmplRec.title).toBe("string");
      expect(tmplRec.confidence).toMatch(/^(high|medium|low)$/);
    }
  });
});
