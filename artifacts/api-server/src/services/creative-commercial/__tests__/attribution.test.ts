/**
 * creative-commercial/__tests__/attribution.test.ts — Team 03
 *
 * Tests: attribution model accuracy, weight sum = 1, correct
 * first/last touch assignment, time-decay ordering.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: must define before vi.mock factory runs ───────────────────────

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  salesFunnelEventsTable: {},
  aiServiceRequestsTable: {},
  sql: new Proxy(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { get: () => undefined },
  ),
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
}));

// ── Import after mock ─────────────────────────────────────────────────────────

import { calculateAttribution, getCustomerTouchpoints } from "../attributionService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(rows: unknown[]) {
  return { rows };
}

const mockTouchpoints = [
  {
    id: 1, customer_profile_id: 1, service_request_id: null,
    touchpoint_type: "social", source: "instagram", medium: "social", campaign: "brand-campaign",
    weight: 0, occurred_at: new Date(Date.now() - 7200 * 1000).toISOString(),
  },
  {
    id: 2, customer_profile_id: 1, service_request_id: null,
    touchpoint_type: "email", source: "newsletter", medium: "email", campaign: null,
    weight: 0, occurred_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  },
  {
    id: 3, customer_profile_id: 1, service_request_id: null,
    touchpoint_type: "direct", source: "direct", medium: null, campaign: null,
    weight: 0, occurred_at: new Date().toISOString(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("calculateAttribution — linear model", () => {
  it("assigns equal weight to all touchpoints", async () => {
    mockExecute.mockResolvedValueOnce(makeResult(mockTouchpoints));

    const summary = await calculateAttribution({ customerProfileId: 1, model: "linear" });

    expect(summary.totalTouchpoints).toBe(3);
    const weights = Object.values(summary.multiTouchWeighted);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    expect(totalWeight).toBeCloseTo(1, 5);
    for (const w of weights) {
      expect(w).toBeCloseTo(1 / 3, 5);
    }
  });
});

describe("calculateAttribution — first_touch model", () => {
  it("assigns 100% credit to the first source", async () => {
    mockExecute.mockResolvedValueOnce(makeResult(mockTouchpoints));

    const summary = await calculateAttribution({ customerProfileId: 1, model: "first_touch" });

    expect(summary.multiTouchWeighted["instagram"]).toBeCloseTo(1, 5);
    expect(summary.multiTouchWeighted["newsletter"] ?? 0).toBeCloseTo(0, 5);
    expect(summary.multiTouchWeighted["direct"] ?? 0).toBeCloseTo(0, 5);
  });
});

describe("calculateAttribution — last_touch model", () => {
  it("assigns 100% credit to the last source", async () => {
    mockExecute.mockResolvedValueOnce(makeResult(mockTouchpoints));

    const summary = await calculateAttribution({ customerProfileId: 1, model: "last_touch" });

    expect(summary.multiTouchWeighted["direct"]).toBeCloseTo(1, 5);
    expect(summary.multiTouchWeighted["instagram"] ?? 0).toBeCloseTo(0, 5);
  });
});

describe("calculateAttribution — time_decay model", () => {
  it("assigns more weight to recent touchpoints (last > first)", async () => {
    mockExecute.mockResolvedValueOnce(makeResult(mockTouchpoints));

    const summary = await calculateAttribution({ customerProfileId: 1, model: "time_decay" });

    const directWeight = summary.multiTouchWeighted["direct"] ?? 0;
    const instagramWeight = summary.multiTouchWeighted["instagram"] ?? 0;
    expect(directWeight).toBeGreaterThan(instagramWeight);
  });

  it("weights sum to 1 under time_decay", async () => {
    mockExecute.mockResolvedValueOnce(makeResult(mockTouchpoints));

    const summary = await calculateAttribution({ customerProfileId: 1, model: "time_decay" });

    const total = Object.values(summary.multiTouchWeighted).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 4);
  });
});

describe("calculateAttribution — empty touchpoints", () => {
  it("returns zero summary when customer has no touchpoints and no funnel events", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([])); // stored touchpoints
    mockExecute.mockResolvedValueOnce(makeResult([])); // funnel events fallback

    const summary = await calculateAttribution({ customerProfileId: 999 });

    expect(summary.totalTouchpoints).toBe(0);
    expect(summary.firstTouch).toBeNull();
    expect(summary.lastTouch).toBeNull();
    expect(summary.multiTouchWeighted).toEqual({});
  });
});

describe("getCustomerTouchpoints — fallback to funnel events", () => {
  it("falls back to sales_funnel_events when cc_attribution_touchpoints is empty", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([])); // stored empty
    mockExecute.mockResolvedValueOnce(makeResult([
      { event_type: "page.viewed", utm_source: "google", utm_medium: "organic", utm_campaign: null, created_at: new Date().toISOString() },
      { event_type: "service.viewed", utm_source: "google", utm_medium: "organic", utm_campaign: null, created_at: new Date().toISOString() },
    ]));

    const touchpoints = await getCustomerTouchpoints(1);
    expect(touchpoints.length).toBe(2);
    expect(touchpoints[0]!.source).toBe("google");
    expect(touchpoints[0]!.touchpointType).toBe("organic");
  });

  it("filters out funnel events without utm_source", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([]));
    mockExecute.mockResolvedValueOnce(makeResult([
      { event_type: "page.viewed", utm_source: null, utm_medium: null, utm_campaign: null, created_at: new Date().toISOString() },
    ]));

    const touchpoints = await getCustomerTouchpoints(1);
    expect(touchpoints.length).toBe(0);
  });
});
