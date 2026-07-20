/**
 * commercialEligibilityPolicy.test.ts
 *
 * Tests for the canonical CommercialEligibilityPolicy (V4.2B).
 * All tests are pure — no database, no network, no Express.
 */
import { describe, it, expect } from "vitest";
import {
  isCategoryCommerciallyEligible,
  getCategoryIneligibilityReason,
  isServiceCommerciallyEligible,
  getServiceIneligibilityReason,
  isPackageCommerciallyEligible,
  ELIGIBLE_STATUS,
  ELIGIBLE_VISIBILITY,
  ELIGIBLE_COMMERCIAL_STATUS,
} from "../commercialEligibilityPolicy.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Builds the minimum eligible category input. Override individual fields to test violations. */
function eligibleCategory(overrides: Partial<Parameters<typeof isCategoryCommerciallyEligible>[0]> = {}) {
  return {
    status:           ELIGIBLE_STATUS,
    visibility:       ELIGIBLE_VISIBILITY,
    commercialStatus: ELIGIBLE_COMMERCIAL_STATUS,
    ...overrides,
  };
}

/** Builds the minimum eligible service input (with its eligible parent category). */
function eligibleService(overrides: Partial<Parameters<typeof isServiceCommerciallyEligible>[0]> = {}) {
  return {
    status:                   ELIGIBLE_STATUS,
    categoryStatus:           ELIGIBLE_STATUS,
    categoryVisibility:       ELIGIBLE_VISIBILITY,
    categoryCommercialStatus: ELIGIBLE_COMMERCIAL_STATUS,
    ...overrides,
  };
}

// ── Category eligibility ──────────────────────────────────────────────────────

describe("isCategoryCommerciallyEligible", () => {
  it("returns true for a fully eligible category", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory())).toBe(true);
  });

  it("returns false when status is 'draft'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ status: "draft" }))).toBe(false);
  });

  it("returns false when status is 'archived'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ status: "archived" }))).toBe(false);
  });

  it("returns false when visibility is 'internal'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ visibility: "internal" }))).toBe(false);
  });

  it("returns false when visibility is 'disabled'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ visibility: "disabled" }))).toBe(false);
  });

  it("returns false when commercial_status is 'internal_only' (the V4.2A bug)", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ commercialStatus: "internal_only" }))).toBe(false);
  });

  it("returns false when commercial_status is 'beta'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ commercialStatus: "beta" }))).toBe(false);
  });

  it("returns false when commercial_status is 'disabled'", () => {
    expect(isCategoryCommerciallyEligible(eligibleCategory({ commercialStatus: "disabled" }))).toBe(false);
  });

  it("returns false when ALL three conditions fail", () => {
    expect(isCategoryCommerciallyEligible({
      status: "archived",
      visibility: "internal",
      commercialStatus: "internal_only",
    })).toBe(false);
  });
});

describe("getCategoryIneligibilityReason", () => {
  it("returns null for an eligible category", () => {
    expect(getCategoryIneligibilityReason(eligibleCategory())).toBeNull();
  });

  it("reports status as the reason when status is not active", () => {
    const reason = getCategoryIneligibilityReason(eligibleCategory({ status: "archived" }));
    expect(reason).toContain("status");
    expect(reason).toContain("archived");
  });

  it("reports visibility as the reason when status is active but visibility is internal", () => {
    const reason = getCategoryIneligibilityReason(eligibleCategory({ visibility: "internal" }));
    expect(reason).toContain("visibility");
    expect(reason).toContain("internal");
  });

  it("reports commercial_status as the reason when only commercial_status fails", () => {
    const reason = getCategoryIneligibilityReason(eligibleCategory({ commercialStatus: "internal_only" }));
    expect(reason).toContain("commercial_status");
    expect(reason).toContain("internal_only");
  });

  it("prioritises status failure over visibility when both fail", () => {
    const reason = getCategoryIneligibilityReason(eligibleCategory({ status: "draft", visibility: "internal" }));
    expect(reason).toContain("status");
  });
});

// ── Service eligibility ───────────────────────────────────────────────────────

describe("isServiceCommerciallyEligible", () => {
  it("returns true for a fully eligible service with an eligible category", () => {
    expect(isServiceCommerciallyEligible(eligibleService())).toBe(true);
  });

  it("returns false when the service itself is archived (even with an eligible category)", () => {
    expect(isServiceCommerciallyEligible(eligibleService({ status: "archived" }))).toBe(false);
  });

  it("returns false when the service is draft", () => {
    expect(isServiceCommerciallyEligible(eligibleService({ status: "draft" }))).toBe(false);
  });

  it("returns false when the category is internal_only (the V4.2A bug reproduced at service level)", () => {
    expect(isServiceCommerciallyEligible(eligibleService({ categoryCommercialStatus: "internal_only" }))).toBe(false);
  });

  it("returns false when the category visibility is internal", () => {
    expect(isServiceCommerciallyEligible(eligibleService({ categoryVisibility: "internal" }))).toBe(false);
  });

  it("returns false when the category is archived", () => {
    expect(isServiceCommerciallyEligible(eligibleService({ categoryStatus: "archived" }))).toBe(false);
  });

  it("returns false when both service and category are ineligible", () => {
    expect(isServiceCommerciallyEligible({
      status: "draft",
      categoryStatus: "archived",
      categoryVisibility: "internal",
      categoryCommercialStatus: "internal_only",
    })).toBe(false);
  });
});

describe("getServiceIneligibilityReason", () => {
  it("returns null for a fully eligible service", () => {
    expect(getServiceIneligibilityReason(eligibleService())).toBeNull();
  });

  it("reports service status when the service itself is not active", () => {
    const reason = getServiceIneligibilityReason(eligibleService({ status: "archived" }));
    expect(reason).toContain("service status");
    expect(reason).toContain("archived");
  });

  it("delegates to category reason when service is active but category fails", () => {
    const reason = getServiceIneligibilityReason(
      eligibleService({ categoryCommercialStatus: "internal_only" }),
    );
    expect(reason).toContain("commercial_status");
    expect(reason).toContain("internal_only");
  });
});

// ── Package eligibility ───────────────────────────────────────────────────────

describe("isPackageCommerciallyEligible", () => {
  it("returns true for an active package", () => {
    expect(isPackageCommerciallyEligible({ status: "active" })).toBe(true);
  });

  it("returns false for a draft package", () => {
    expect(isPackageCommerciallyEligible({ status: "draft" })).toBe(false);
  });

  it("returns false for an archived package", () => {
    expect(isPackageCommerciallyEligible({ status: "archived" })).toBe(false);
  });
});

// ── Consistency: policy constants ─────────────────────────────────────────────

describe("policy constants", () => {
  it("ELIGIBLE_STATUS is 'active'", () => {
    expect(ELIGIBLE_STATUS).toBe("active");
  });

  it("ELIGIBLE_VISIBILITY is 'public'", () => {
    expect(ELIGIBLE_VISIBILITY).toBe("public");
  });

  it("ELIGIBLE_COMMERCIAL_STATUS is 'commercial_ready'", () => {
    expect(ELIGIBLE_COMMERCIAL_STATUS).toBe("commercial_ready");
  });
});
