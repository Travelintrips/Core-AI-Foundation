/**
 * packagePolicy.test.ts — Team 15 Graphic Design
 *
 * Tests for package tier policies: revision limits, source file access,
 * SLA computation, upgrade path, and human QC flag.
 */

import { describe, it, expect } from "vitest";
import {
  resolveGdPolicy,
  assertRevisionAllowed,
  assertSourceFileAccess,
  computeSlaDueDate,
  isHumanQcRequired,
  getUpgradeTier,
  GD_PACKAGE_POLICIES,
} from "../packagePolicy.js";

// ── resolveGdPolicy ───────────────────────────────────────────────────────────

describe("resolveGdPolicy", () => {
  it("returns base policy for business-card at starter", () => {
    const policy = resolveGdPolicy("starter", "business-card");
    expect(policy.tier).toBe("starter");
    expect(policy.revisionsIncluded).toBe(1);
    expect(policy.sourceFilesIncluded).toBe(false);
  });

  it("applies logo service override at starter (2 revisions)", () => {
    const policy = resolveGdPolicy("starter", "logo");
    expect(policy.revisionsIncluded).toBe(2);
  });

  it("applies logo override at professional (5 revisions)", () => {
    const policy = resolveGdPolicy("professional", "logo");
    expect(policy.revisionsIncluded).toBe(5);
  });

  it("enterprise returns unlimited revisions (999)", () => {
    const policy = resolveGdPolicy("enterprise", "poster");
    expect(policy.revisionsIncluded).toBe(999);
  });

  it("never overrides tier or label from service override", () => {
    const policy = resolveGdPolicy("starter", "logo");
    expect(policy.tier).toBe("starter");
    expect(policy.label).toBe("Starter");
  });
});

// ── assertRevisionAllowed ─────────────────────────────────────────────────────

describe("assertRevisionAllowed", () => {
  it("allows first revision at starter for business-card (limit=1)", () => {
    const remaining = assertRevisionAllowed("starter", "business-card", 0);
    expect(remaining).toBe(0); // 1 included, 0 used, 1 consumed → 0 left
  });

  it("throws when revision limit is exhausted", () => {
    expect(() => assertRevisionAllowed("starter", "business-card", 1)).toThrow(/limit reached/);
  });

  it("allows many revisions at enterprise", () => {
    const remaining = assertRevisionAllowed("enterprise", "letterhead", 50);
    expect(remaining).toBe(948); // 999 - 50 - 1
  });

  it("logo at starter gets 2 revisions — second call succeeds", () => {
    expect(() => assertRevisionAllowed("starter", "logo", 1)).not.toThrow();
    expect(() => assertRevisionAllowed("starter", "logo", 2)).toThrow();
  });
});

// ── assertSourceFileAccess ────────────────────────────────────────────────────

describe("assertSourceFileAccess", () => {
  it("throws for starter tier", () => {
    expect(() => assertSourceFileAccess("starter", "logo")).toThrow(/not included/);
  });

  it("throws for professional tier", () => {
    expect(() => assertSourceFileAccess("professional", "logo")).toThrow(/not included/);
  });

  it("allows access at business tier", () => {
    expect(() => assertSourceFileAccess("business", "logo")).not.toThrow();
  });

  it("allows access at enterprise tier", () => {
    expect(() => assertSourceFileAccess("enterprise", "brochure")).not.toThrow();
  });
});

// ── computeSlaDueDate ─────────────────────────────────────────────────────────

describe("computeSlaDueDate", () => {
  it("adds slaDays to start date for starter (5 days)", () => {
    const start = new Date("2026-07-16T00:00:00Z");
    const due = computeSlaDueDate("starter", "flyer", start);
    expect(due.getDate()).toBe(21); // 16 + 5
    expect(due.getMonth()).toBe(6); // July
  });

  it("returns next day for enterprise (1 day SLA)", () => {
    const start = new Date("2026-07-16T12:00:00Z");
    const due = computeSlaDueDate("enterprise", "poster", start);
    expect(due.getDate()).toBe(17);
  });

  it("uses 2-day SLA for business tier", () => {
    const start = new Date("2026-07-16T00:00:00Z");
    const due = computeSlaDueDate("business", "brochure", start);
    expect(due.getDate()).toBe(18);
  });
});

// ── isHumanQcRequired ─────────────────────────────────────────────────────────

describe("isHumanQcRequired", () => {
  it("is false for starter", () => {
    expect(isHumanQcRequired("starter", "logo")).toBe(false);
  });

  it("is false for professional", () => {
    expect(isHumanQcRequired("professional", "certificate")).toBe(false);
  });

  it("is true for business", () => {
    expect(isHumanQcRequired("business", "stationery")).toBe(true);
  });

  it("is true for enterprise", () => {
    expect(isHumanQcRequired("enterprise", "banner")).toBe(true);
  });
});

// ── getUpgradeTier ────────────────────────────────────────────────────────────

describe("getUpgradeTier", () => {
  it("starter → professional", () => expect(getUpgradeTier("starter")).toBe("professional"));
  it("professional → business", () => expect(getUpgradeTier("professional")).toBe("business"));
  it("business → enterprise", () => expect(getUpgradeTier("business")).toBe("enterprise"));
  it("enterprise → null (top tier)", () => expect(getUpgradeTier("enterprise")).toBeNull());
});

// ── Policy invariants ─────────────────────────────────────────────────────────

describe("GD_PACKAGE_POLICIES invariants", () => {
  const tiers = ["starter", "professional", "business", "enterprise"] as const;

  it.each(tiers)("%s: dispatchPriority increases with tier", (tier) => {
    const policy = GD_PACKAGE_POLICIES[tier];
    expect(policy.dispatchPriority).toBeGreaterThanOrEqual(1);
    expect(policy.dispatchPriority).toBeLessThanOrEqual(4);
  });

  it("revisions increase across tiers for a base service", () => {
    const tiers = ["starter", "professional", "business", "enterprise"] as const;
    const revisions = tiers.map((t) => resolveGdPolicy(t, "flyer").revisionsIncluded);
    expect(revisions[0]).toBeLessThan(revisions[1]);
    expect(revisions[1]).toBeLessThan(revisions[2]);
    expect(revisions[2]).toBeLessThan(revisions[3]);
  });

  it("slaDays decreases across tiers", () => {
    const slas = tiers.map((t) => GD_PACKAGE_POLICIES[t].slaDays);
    expect(slas[0]).toBeGreaterThan(slas[1]);
    expect(slas[1]).toBeGreaterThan(slas[2]);
    expect(slas[2]).toBeGreaterThan(slas[3]);
  });

  it("brandDna is disabled for starter only", () => {
    expect(GD_PACKAGE_POLICIES.starter.brandDnaEnabled).toBe(false);
    expect(GD_PACKAGE_POLICIES.professional.brandDnaEnabled).toBe(true);
    expect(GD_PACKAGE_POLICIES.business.brandDnaEnabled).toBe(true);
    expect(GD_PACKAGE_POLICIES.enterprise.brandDnaEnabled).toBe(true);
  });
});
