/**
 * Team 17 — Interior Design — Per-admin concept draft ownership tests
 *
 * Validates that update, approval, revision, and reset operations on an
 * id_concept_draft are gated by the ownership guard added in service.ts.
 *
 * Ownership rules:
 *  - An unowned draft (lastEditedBy === null) is accessible to any admin.
 *  - The first admin to edit a draft becomes its owner (lastEditedBy is set).
 *  - Only the owning admin may subsequently edit, approve, revise, or reset.
 *  - A non-owner receives a 403 with a clear message identifying the owner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state ────────────────────────────────────────────────────────

const { mockDb } = vi.hoisted(() => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {};
  mockDb["select"]              = vi.fn().mockReturnValue(mockDb);
  mockDb["from"]                = vi.fn().mockReturnValue(mockDb);
  mockDb["where"]               = vi.fn().mockReturnValue(mockDb);
  mockDb["limit"]               = vi.fn().mockResolvedValue([]);
  mockDb["update"]              = vi.fn().mockReturnValue(mockDb);
  mockDb["set"]                 = vi.fn().mockReturnValue(mockDb);
  mockDb["returning"]           = vi.fn().mockResolvedValue([]);
  mockDb["insert"]              = vi.fn().mockReturnValue(mockDb);
  mockDb["values"]              = vi.fn().mockReturnValue(mockDb);
  mockDb["onConflictDoNothing"] = vi.fn().mockReturnValue(mockDb);
  return { mockDb };
});

vi.mock("@workspace/db", () => ({
  db:                        mockDb,
  creativeProjectsTable:     {},
  creativeProjectStepsTable: {},
}));

vi.mock("../schema.js", () => ({
  idConceptDraftsTable:        {},
  idProjectsTable:             {},
  idBriefsTable:               {},
  idOutputsTable:              {},
  CONCEPT_DRAFT_REVIEW_STATES: [
    "ai_generated",
    "edited_by_admin",
    "ready_for_review",
    "revision_requested",
    "approved_for_rendering",
  ],
}));

vi.mock("../validation.js", () => ({
  runFullValidation:         vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  generateSafetyDisclaimers: vi.fn().mockReturnValue([]),
}));

vi.mock("../brandIntelligenceAdapter.js", () => ({
  fetchBrandIntelligence:  vi.fn().mockResolvedValue(null),
  readBrandStyleSnapshot:  vi.fn().mockResolvedValue(null),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  updateConceptDraft,
  updateDraftReviewState,
  requestRevision,
  resetDraftToOriginal,
} from "../service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id:                    1,
    projectUuid:           "ownership-test-uuid",
    reviewState:           "edited_by_admin",
    hasUnsavedEdits:       false,
    spacePlanDraft:        { zones: ["living"] },
    materialsDraft:        { floors: "timber" },
    furnitureDraft:        { sofa: "3-seater" },
    lightingDraft:         { ambient: "LED" },
    visualConceptDraft:    "Japandi minimalism",
    originalSpacePlan:     { zones: ["living"] },
    originalMaterials:     { floors: "timber" },
    originalFurniture:     { sofa: "3-seater" },
    originalLighting:      { ambient: "LED" },
    originalVisualConcept: "Japandi minimalism",
    approvedSpacePlan:     null,
    approvedMaterials:     null,
    approvedFurniture:     null,
    approvedLighting:      null,
    approvedVisualConcept: null,
    approvedAt:            null,
    approvedBy:            null,
    revisionRequestedBy:   null,
    revisionRequestedAt:   null,
    revisionReason:        null,
    lastEditedBy:          null,   // unowned by default
    lastEditedAt:          null,
    createdAt:             new Date("2026-01-01T00:00:00Z"),
    updatedAt:             new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function mockSelectRow(row: ReturnType<typeof makeDraft> | null) {
  (mockDb["limit"] as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    row ? [row] : [],
  );
}

function mockUpdateReturn(row: ReturnType<typeof makeDraft>) {
  (mockDb["returning"] as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockDb["select"]    as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["from"]      as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["where"]     as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["limit"]     as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockDb["update"]    as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["set"]       as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["returning"] as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Unowned draft is accessible to any admin
// ════════════════════════════════════════════════════════════════════════════

describe("Test 1: Unowned draft is accessible to any admin", () => {
  it("updateConceptDraft succeeds for admin-A when lastEditedBy is null", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: null }));
    mockUpdateReturn(makeDraft({ lastEditedBy: "admin-A", reviewState: "edited_by_admin" }));

    const result = await updateConceptDraft("ownership-test-uuid", { spacePlan: {} }, "admin-A");
    expect(result).toBeDefined();
    expect(mockDb["update"]).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Owned draft blocks a different admin from updating
// ════════════════════════════════════════════════════════════════════════════

describe("Test 2: Owned draft blocks a different admin from updating", () => {
  it("updateConceptDraft by admin-B throws 403 when draft is owned by admin-A", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));

    await expect(
      updateConceptDraft("ownership-test-uuid", { spacePlan: {} }, "admin-B"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 message clearly identifies the owning admin", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));

    await expect(
      updateConceptDraft("ownership-test-uuid", { materials: {} }, "admin-B"),
    ).rejects.toThrow(/admin-A/);
  });

  it("db.update is not called when the ownership guard fires", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));

    await expect(
      updateConceptDraft("ownership-test-uuid", { furniture: {} }, "admin-B"),
    ).rejects.toThrow();

    expect(mockDb["update"]).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: Owner can update their own draft
// ════════════════════════════════════════════════════════════════════════════

describe("Test 3: Owner can update their own draft", () => {
  it("updateConceptDraft succeeds when editorId matches lastEditedBy", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));
    mockUpdateReturn(makeDraft({ lastEditedBy: "admin-A" }));

    const result = await updateConceptDraft("ownership-test-uuid", { lighting: {} }, "admin-A");
    expect(result).toBeDefined();
    expect(mockDb["update"]).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Owned draft blocks a different admin from changing review state
// ════════════════════════════════════════════════════════════════════════════

describe("Test 4: Owned draft blocks a different admin from changing review state", () => {
  it("updateDraftReviewState by admin-B throws 403 when draft is owned by admin-A", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A", reviewState: "edited_by_admin" }));

    await expect(
      updateDraftReviewState("ownership-test-uuid", "ready_for_review", "admin-B"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Owner can change review state
// ════════════════════════════════════════════════════════════════════════════

describe("Test 5: Owner can change review state", () => {
  it("updateDraftReviewState succeeds for owning admin", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A", reviewState: "edited_by_admin" }));
    mockUpdateReturn(makeDraft({ lastEditedBy: "admin-A", reviewState: "ready_for_review" }));

    const result = await updateDraftReviewState("ownership-test-uuid", "ready_for_review", "admin-A");
    expect(result.reviewState).toBe("ready_for_review");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Owned draft blocks a different admin from requesting revision
// ════════════════════════════════════════════════════════════════════════════

describe("Test 6: Owned draft blocks a different admin from requesting revision", () => {
  it("requestRevision by admin-B throws 403 when draft is owned by admin-A", async () => {
    mockSelectRow(makeDraft({
      lastEditedBy: "admin-A",
      reviewState:  "approved_for_rendering",
    }));

    await expect(
      requestRevision("ownership-test-uuid", "admin-B", "needs changes"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Owner can request revision on their approved draft
// ════════════════════════════════════════════════════════════════════════════

describe("Test 7: Owner can request revision", () => {
  it("requestRevision succeeds when editorId matches lastEditedBy on approved draft", async () => {
    mockSelectRow(makeDraft({
      lastEditedBy: "admin-A",
      reviewState:  "approved_for_rendering",
    }));
    mockUpdateReturn(makeDraft({
      lastEditedBy:        "admin-A",
      reviewState:         "revision_requested",
      revisionRequestedBy: "admin-A",
      revisionReason:      "needs update",
    }));

    const result = await requestRevision("ownership-test-uuid", "admin-A", "needs update");
    expect(result.reviewState).toBe("revision_requested");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Owned draft blocks a different admin from resetting to original
// ════════════════════════════════════════════════════════════════════════════

describe("Test 8: Owned draft blocks a different admin from resetting", () => {
  it("resetDraftToOriginal by admin-B throws 403 when draft is owned by admin-A", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));

    await expect(
      resetDraftToOriginal("ownership-test-uuid", ["spacePlan"], "admin-B"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("db.update is not called when the ownership guard blocks a reset", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));

    await expect(
      resetDraftToOriginal("ownership-test-uuid", ["materials"], "admin-B"),
    ).rejects.toThrow();

    expect(mockDb["update"]).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 9: Owner can reset their draft to original
// ════════════════════════════════════════════════════════════════════════════

describe("Test 9: Owner can reset their draft to original", () => {
  it("resetDraftToOriginal succeeds when editorId matches lastEditedBy", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "admin-A" }));
    mockUpdateReturn(makeDraft({ lastEditedBy: "admin-A" }));

    const result = await resetDraftToOriginal("ownership-test-uuid", ["spacePlan", "materials"], "admin-A");
    expect(result).toBeDefined();
    expect(mockDb["update"]).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 10: First edit on unowned draft claims ownership
// ════════════════════════════════════════════════════════════════════════════

describe("Test 10: First edit on an unowned draft claims ownership", () => {
  it("updateConceptDraft writes lastEditedBy so subsequent calls know the owner", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: null }));
    // Service writes editorId as lastEditedBy — returned row reflects that
    mockUpdateReturn(makeDraft({ lastEditedBy: "admin-A", reviewState: "edited_by_admin" }));

    const result = await updateConceptDraft("ownership-test-uuid", { spacePlan: {} }, "admin-A");

    // The returned draft records the new owner
    expect(result.lastEditedBy).toBe("admin-A");

    // The db.set() call must include lastEditedBy
    const setArgs = (mockDb["set"] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs).toHaveProperty("lastEditedBy", "admin-A");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 11: Ownership error message is user-actionable
// ════════════════════════════════════════════════════════════════════════════

describe("Test 11: Ownership error message is clear and actionable", () => {
  it("403 error names the owner so a coordinator knows who to contact", async () => {
    mockSelectRow(makeDraft({ lastEditedBy: "senior-admin-007" }));

    let caught: Error & { status?: number } = new Error("not thrown");
    try {
      await updateConceptDraft("ownership-test-uuid", { visualConcept: "new" }, "junior-admin");
    } catch (e) {
      caught = e as Error & { status?: number };
    }

    expect(caught.status).toBe(403);
    // Message must name the actual owner
    expect(caught.message).toContain("senior-admin-007");
    // Message must explain the restriction
    expect(caught.message).toMatch(/own(s|ed|ing)/i);
  });
});
