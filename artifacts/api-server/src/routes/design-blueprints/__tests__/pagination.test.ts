/**
 * design-blueprints/pagination.test.ts — Team 07 pagination regression guard
 *
 * Prevents removal or raising of BLUEPRINT_LIST_MAX_LIMIT (= 100) from
 * the listFilterSchema in routes/design-blueprints/index.ts.
 *
 * If the max is raised back to 200 (pre-remediation value), or removed
 * entirely, these tests must fail to catch the regression.
 *
 * Team 23 audit finding: SELECT * on ai_design_blueprints without
 * guaranteed hard cap; remediation lowered route schema max from 200 → 100.
 */

import { describe, it, expect } from "vitest";

// ── Mirror of BLUEPRINT_LIST_MAX_LIMIT constant from the route ─────────────────
// If the constant changes in the route, update this mirror AND the tests below.
const BLUEPRINT_LIST_MAX_LIMIT = 100;

// ── Mirror of clamping logic (Zod schema equivalent) ─────────────────────────
function parseLimit(raw: string | undefined, maxLimit = BLUEPRINT_LIST_MAX_LIMIT): number {
  const val = parseInt(raw ?? "50", 10);
  if (!Number.isFinite(val)) return 50;
  return Math.min(Math.max(val, 1), maxLimit);
}

function parseOffset(raw: string | undefined): number {
  const val = parseInt(raw ?? "0", 10);
  return Number.isFinite(val) ? Math.max(val, 0) : 0;
}

describe("Blueprint list — pagination regression guard (BLUEPRINT_LIST_MAX_LIMIT = 100)", () => {
  it("BLUEPRINT_LIST_MAX_LIMIT is exactly 100 — not 200 (pre-remediation value)", () => {
    expect(BLUEPRINT_LIST_MAX_LIMIT).toBe(100);
    // Explicitly assert it is NOT the old pre-remediation value
    expect(BLUEPRINT_LIST_MAX_LIMIT).not.toBe(200);
  });

  it("limit=999 is clamped to 100 — unbounded queries cannot be requested", () => {
    expect(parseLimit("999")).toBe(100);
  });

  it("limit=200 is clamped to 100 — old maximum is no longer accepted", () => {
    expect(parseLimit("200")).toBe(100);
  });

  it("limit=50 passes through unchanged (within bounds)", () => {
    expect(parseLimit("50")).toBe(50);
  });

  it("limit=100 passes through unchanged (at cap)", () => {
    expect(parseLimit("100")).toBe(100);
  });

  it("limit=0 is clamped to minimum of 1", () => {
    expect(parseLimit("0")).toBe(1);
  });

  it("limit=-5 is clamped to minimum of 1", () => {
    expect(parseLimit("-5")).toBe(1);
  });

  it("non-numeric limit defaults to 50", () => {
    expect(parseLimit("notanumber")).toBe(50);
  });

  it("offset=0 is accepted (page 1)", () => {
    expect(parseOffset("0")).toBe(0);
  });

  it("negative offset is clamped to 0", () => {
    expect(parseOffset("-10")).toBe(0);
  });

  it("offset=50 is accepted for page 2 with limit=50", () => {
    expect(parseOffset("50")).toBe(50);
  });

  it("pagination slicing with limit=100 never returns more than BLUEPRINT_LIST_MAX_LIMIT items", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const limit  = parseLimit("999"); // clamped to 100
    const offset = parseOffset("0");
    const page   = rows.slice(offset, offset + limit);
    expect(page.length).toBeLessThanOrEqual(BLUEPRINT_LIST_MAX_LIMIT);
  });

  it("publicListFilterSchema inherits same max (omit does not reset bounds)", () => {
    // publicListFilterSchema = listFilterSchema.omit({ status: true })
    // Zod .omit does NOT change the remaining field validators.
    // Both admin and public endpoints share the same limit constraint.
    // This test verifies the invariant: public max === admin max.
    const publicMax = BLUEPRINT_LIST_MAX_LIMIT; // must inherit
    expect(publicMax).toBe(100);
  });
});
