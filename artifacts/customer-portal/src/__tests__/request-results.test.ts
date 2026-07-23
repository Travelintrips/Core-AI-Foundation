/**
 * request-results.test.ts — Customer Portal
 *
 * Phase 10 regression tests for the customer result page display-state logic.
 * Tests the `deriveDisplayState` pure function from request-results.tsx.
 *
 * Covers spec tests 9, 10, 11, 12, 16, 17, 18 (customer-facing states).
 * Uses plain TS (no JSX) to avoid React render overhead.
 */

import { describe, it, expect } from "vitest";
import { deriveDisplayState, type DisplayState } from "../pages/request-results.js";

// ─── helper to build a mock request-detail response ──────────────────────────

function makeData(overrides: {
  filesUnlocked?: boolean;
  productionStatus?: string | null;
  invoiceExists?: boolean;
  remainingBalance?: number | null;
  completionLinks?: Array<{ label: string; url: string }> | null;
  completionNotes?: string | null;
  customerEmail?: string;
} = {}): Parameters<typeof deriveDisplayState>[0] {
  return {
    id: 1,
    requestId: "req-test-001",
    serviceId: 1,
    serviceFlow: "fixed_price",
    createdProjectId: "proj-uuid-001",
    packageId: null,
    customerName: "Test Customer",
    customerEmail: overrides.customerEmail ?? "test@example.com",
    companyName: "Test Co",
    currency: "IDR",
    subtotal: "5000000",
    rushFee: null,
    revisionFee: null,
    humanReviewFee: null,
    additionalServiceFee: null,
    discount: null,
    tax: null,
    total: "5000000",
    status: "waiting_commercial_gate",
    briefJson: {},
    completionNotes: overrides.completionNotes ?? null,
    completionLinks: overrides.completionLinks ?? null,
    filesUnlocked: overrides.filesUnlocked ?? false,
    paymentStatus: "pending",
    remainingBalance: overrides.remainingBalance !== undefined ? overrides.remainingBalance : null,
    productionStatus: overrides.productionStatus !== undefined ? overrides.productionStatus : null,
    invoiceExists: overrides.invoiceExists ?? false,
    createdAt: new Date().toISOString(),
    pricingBreakdown: null,
  } as any;
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 9: Customer page does not show static file list
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 9: Customer page must not show static file list", () => {
  it("production_in_progress state: completionLinks = null → no file list possible", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "building",
      invoiceExists: false,
      remainingBalance: null,
      completionLinks: null,
    }));
    expect(state).toBe("production_in_progress");
    // When state is not "complete", completionLinks must be null (backend gates them)
    // so the UI cannot render a file list — this is enforced server-side
  });

  it("awaiting_payment state: state is not 'complete', no files accessible", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "remaining_paid",
      invoiceExists: true,
      remainingBalance: 1500000,
      completionLinks: null,
    }));
    expect(state).toBe("awaiting_payment");
    expect(state).not.toBe("complete");
  });

  it("null data returns unknown state — no file list", () => {
    const state = deriveDisplayState(null as any);
    expect(state).toBe("unknown");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 10: Customer page must NOT request payment without invoice
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 10: No payment demand without invoice", () => {
  it("production completed, no invoice → billing_pending (not awaiting_payment)", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: false,
      remainingBalance: null,
    }));
    expect(state).toBe("billing_pending");
    expect(state).not.toBe("awaiting_payment");
  });

  it("invoiceExists=false with remainingBalance > 0 → billing_pending (balance ignored)", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: false,
      remainingBalance: 5000000,
    }));
    // RC-5 guard: balance without invoice must NOT trigger awaiting_payment
    expect(state).toBe("billing_pending");
  });

  it("no project linked (null productionStatus) → production_in_progress, not awaiting_payment", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: null,
      invoiceExists: false,
      remainingBalance: null,
    }));
    expect(state).toBe("production_in_progress");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 11: awaiting_payment requires outstanding balance > 0
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 11: awaiting_payment requires outstanding balance > 0", () => {
  it("invoiceExists=true but remainingBalance=0 → billing_pending", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: 0,
    }));
    expect(state).toBe("billing_pending");
    expect(state).not.toBe("awaiting_payment");
  });

  it("invoiceExists=true and remainingBalance > 0 → awaiting_payment", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: 2500000,
    }));
    expect(state).toBe("awaiting_payment");
  });

  it("invoiceExists=true and remainingBalance=null → billing_pending (not awaiting_payment)", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: null,
    }));
    expect(state).toBe("billing_pending");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 12: Zero-value invoice does NOT trigger payment demand
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 12: Zero-value invoice does not trigger payment demand", () => {
  it("remainingBalance=0 with invoiceExists=true → billing_pending", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: 0,
    }));
    expect(state).toBe("billing_pending");
  });

  it("remainingBalance=null with invoiceExists=true → billing_pending", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: null,
    }));
    expect(state).toBe("billing_pending");
  });

  it("negative remainingBalance treated as non-positive → billing_pending", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: -100,
    }));
    // -100 is not > 0, so billing_pending
    expect(state).toBe("billing_pending");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 16: Unverified payment does NOT unlock files
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 16: Unverified payment does not unlock files", () => {
  it("RC-1: waiting_payment_verification → payment_under_review (not complete)", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "waiting_payment_verification",
      invoiceExists: true,
      remainingBalance: 5000000, // proof submitted but still counted as unpaid
    }));
    // RC-1 fix: waiting_payment_verification must show payment_under_review,
    // NOT awaiting_payment (which would incorrectly demand more action)
    expect(state).toBe("payment_under_review");
    expect(state).not.toBe("awaiting_payment");
    expect(state).not.toBe("complete");
  });

  it("waiting_payment_verification with invoiceExists=false → payment_under_review", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "waiting_payment_verification",
      invoiceExists: false,
      remainingBalance: null,
    }));
    // RC-1: check productionStatus BEFORE invoiceExists
    expect(state).toBe("payment_under_review");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 17: Partial payment does NOT unlock files
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 17: Partial payment does not unlock files", () => {
  it("filesUnlocked=false with any productionStatus → state is not complete", () => {
    const statuses = [
      "deposit_paid", "payment_verified", "building", "completed",
      "waiting_payment_verification", "remaining_paid",
    ];
    for (const productionStatus of statuses) {
      const state = deriveDisplayState(makeData({
        filesUnlocked: false,
        productionStatus,
        invoiceExists: true,
        remainingBalance: 2500000,
      }));
      expect(state).not.toBe("complete");
    }
  });

  it("deposit_paid with remaining balance stays as production_in_progress", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "deposit_paid",
      invoiceExists: true,
      remainingBalance: 2500000,
    }));
    // deposit_paid is in PRODUCTION_IN_PROGRESS_STATUSES
    expect(state).toBe("production_in_progress");
    expect(state).not.toBe("awaiting_payment");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 18: Verified full payment unlocks files
// ════════════════════════════════════════════════════════════════════════════════

describe("Test 18: Verified full payment unlocks files", () => {
  it("filesUnlocked=true → complete regardless of other fields", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: true,
      productionStatus: "payment_verified",
      invoiceExists: true,
      remainingBalance: 0,
      completionLinks: [{ label: "Brand Identity.pdf", url: "https://cdn.example.com/brand.pdf" }],
    }));
    expect(state).toBe("complete");
  });

  it("filesUnlocked=true wins even when remainingBalance > 0 (admin override)", () => {
    // Admin can unlock files manually before balance reaches zero
    const state = deriveDisplayState(makeData({
      filesUnlocked: true,
      productionStatus: "waiting_payment_verification",
      invoiceExists: true,
      remainingBalance: 1000000,
    }));
    // filesUnlocked=true takes precedence (after production_failed check)
    expect(state).toBe("complete");
  });

  it("production_failed takes precedence over filesUnlocked", () => {
    // RC-2: production failure is the highest-priority state
    const state = deriveDisplayState(makeData({
      filesUnlocked: true, // even if somehow set
      productionStatus: "failed",
      invoiceExists: false,
      remainingBalance: null,
    }));
    expect(state).toBe("production_failed");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Additional: RC-2 — Production failure shown as error
// ════════════════════════════════════════════════════════════════════════════════

describe("RC-2: Production failure is shown as error, not silent fallback", () => {
  it("failed → production_failed", () => {
    expect(deriveDisplayState(makeData({ productionStatus: "failed" }))).toBe("production_failed");
  });
  it("error → production_failed", () => {
    expect(deriveDisplayState(makeData({ productionStatus: "error" }))).toBe("production_failed");
  });
  it("blocked_by_budget → production_failed", () => {
    expect(deriveDisplayState(makeData({ productionStatus: "blocked_by_budget" }))).toBe("production_failed");
  });
  it("non-failed statuses do not show as production_failed", () => {
    const nonFailed = ["building", "running", "completed", "waiting_payment_verification"];
    for (const productionStatus of nonFailed) {
      const state = deriveDisplayState(makeData({ productionStatus }));
      expect(state).not.toBe("production_failed");
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Additional: RC-3 — Locked-files section uses correct condition
// ════════════════════════════════════════════════════════════════════════════════

describe("RC-3: Locked-files section guard is awaiting_payment, not completionNotes presence", () => {
  it("awaiting_payment state with no completionNotes → locked-files section should still appear", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "completed",
      invoiceExists: true,
      remainingBalance: 3000000,
      completionNotes: null,  // no notes — old code would NOT show locked section
    }));
    // New code: locked-files section is triggered by displayState === "awaiting_payment"
    // not by completionNotes presence
    expect(state).toBe("awaiting_payment");
  });

  it("billing_pending state with completionNotes → should NOT show locked-files section", () => {
    const state = deriveDisplayState(makeData({
      filesUnlocked: false,
      productionStatus: "orchestrating",
      invoiceExists: false,
      remainingBalance: null,
      completionNotes: "Proyek sedang dalam proses.",  // old code would show locked section
    }));
    // New code: completionNotes alone does not trigger locked-files section
    expect(state).toBe("production_in_progress");
    // The render layer checks displayState === "awaiting_payment", not completionNotes
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Additional: Status priority ordering (spec Phase 6)
// ════════════════════════════════════════════════════════════════════════════════

describe("Status priority: production_failed > complete > payment_under_review > in_progress > billing_pending > awaiting_payment", () => {
  const cases: Array<[string, Parameters<typeof makeData>[0], DisplayState]> = [
    ["failed production",           { productionStatus: "failed" },                                          "production_failed"],
    ["files unlocked",              { filesUnlocked: true },                                                 "complete"],
    ["payment under review",        { productionStatus: "waiting_payment_verification" },                    "payment_under_review"],
    ["active production",           { productionStatus: "building" },                                        "production_in_progress"],
    ["no invoice after production", { productionStatus: "completed", invoiceExists: false },                 "billing_pending"],
    ["invoice with balance",        { productionStatus: "completed", invoiceExists: true, remainingBalance: 1000 }, "awaiting_payment"],
    ["invoice paid",                { productionStatus: "completed", invoiceExists: true, remainingBalance: 0 },    "billing_pending"],
  ];

  for (const [label, input, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(deriveDisplayState(makeData(input))).toBe(expected);
    });
  }
});
