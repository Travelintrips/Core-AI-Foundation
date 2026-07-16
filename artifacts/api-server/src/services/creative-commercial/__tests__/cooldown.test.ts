/**
 * creative-commercial/__tests__/cooldown.test.ts — Team 03
 *
 * Tests: idempotency, cooldown enforcement, no-duplicate delivery.
 * Uses vi.hoisted() so mock variable is available before vi.mock hoisting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted: must define mock fn before vi.mock factory runs ───────────────

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: mockExecute },
  sql: new Proxy(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, _isSql: true }),
    { get: () => undefined },
  ),
}));

// ── Import after mock ─────────────────────────────────────────────────────────

import { checkCooldown, recordRecommendation, clearCooldowns } from "../cooldownService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResult(rows: unknown[]) {
  return { rows };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("checkCooldown", () => {
  it("returns blocked=false when no active cooldown exists", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([]));

    const result = await checkCooldown({
      customerProfileId: 1,
      recType: "abandoned_checkout",
      contextKey: "test:123",
    });

    expect(result.blocked).toBe(false);
    expect(result.cooldownUntil).toBeUndefined();
  });

  it("returns blocked=true with cooldownUntil when an active cooldown exists", async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    mockExecute.mockResolvedValueOnce(
      makeResult([{ id: 42, cooldown_until: future }]),
    );

    const result = await checkCooldown({
      customerProfileId: 1,
      recType: "abandoned_checkout",
      contextKey: "test:123",
    });

    expect(result.blocked).toBe(true);
    expect(result.cooldownUntil).toBeInstanceOf(Date);
    expect(result.cooldownUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("recordRecommendation — idempotency", () => {
  it("returns existing entry without inserting if cooldown is active", async () => {
    const future = new Date(Date.now() + 7200 * 1000).toISOString();
    // Only one execute call: check for existing (finds a row)
    mockExecute.mockResolvedValueOnce(
      makeResult([{ id: 99, cooldown_until: future }]),
    );

    const result = await recordRecommendation({
      customerProfileId: 5,
      recType: "coupon_recovery",
      contextKey: "coupon:10",
      payloadJson: { couponId: 10 },
    });

    expect(result.alreadyExisted).toBe(true);
    expect(result.id).toBe(99);
    // Should NOT have called execute a second time for INSERT
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("inserts a new entry when no existing cooldown", async () => {
    const future = new Date(Date.now() + 7200 * 1000).toISOString();
    // First execute: no existing entry
    mockExecute.mockResolvedValueOnce(makeResult([]));
    // Second execute: INSERT returns new row
    mockExecute.mockResolvedValueOnce(
      makeResult([{ id: 101, cooldown_until: future }]),
    );

    const result = await recordRecommendation({
      customerProfileId: 5,
      recType: "coupon_recovery",
      contextKey: "coupon:11",
      payloadJson: { couponId: 11 },
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.id).toBe(101);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

describe("COOLDOWN_HOURS values", () => {
  it("enforces minimum 24h for abandoned_checkout", async () => {
    const { COOLDOWN_HOURS } = await import("../types.js");
    expect(COOLDOWN_HOURS["abandoned_checkout"]).toBeGreaterThanOrEqual(24);
  });

  it("enforces minimum 7 days for repeat_order", async () => {
    const { COOLDOWN_HOURS } = await import("../types.js");
    expect(COOLDOWN_HOURS["repeat_order"]).toBeGreaterThanOrEqual(168);
  });

  it("enforces minimum 48h for coupon_recovery", async () => {
    const { COOLDOWN_HOURS } = await import("../types.js");
    expect(COOLDOWN_HOURS["coupon_recovery"]).toBeGreaterThanOrEqual(48);
  });
});

describe("clearCooldowns", () => {
  it("executes DELETE and returns count of deleted rows", async () => {
    mockExecute.mockResolvedValueOnce(makeResult([{ id: 1 }, { id: 2 }]));

    const count = await clearCooldowns(1);
    expect(count).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });
});
