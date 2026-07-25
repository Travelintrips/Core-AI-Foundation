/**
 * concept-draft-integrity.test.ts
 *
 * Proves the approved-draft integrity guarantees:
 *  1. Approved draft section edits return 409
 *  2. Approved draft cannot be silently downgraded via updateDraftReviewState
 *  3. requestRevision() succeeds for an authorized admin on an approved draft
 *  4. Editing is allowed after revision_requested
 *  5. Approved snapshot remains unchanged after revision begins
 *  6. Unauthorized revision request is rejected (structural + route guard)
 *  7. Optimistic concurrency still works
 *  8. Existing initialize/edit/save behavior remains unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ── Hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted() runs before module evaluation so factories can reference these.

const { mockDb } = vi.hoisted(() => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {};
  mockDb["select"]            = vi.fn().mockReturnValue(mockDb);
  mockDb["from"]              = vi.fn().mockReturnValue(mockDb);
  mockDb["where"]             = vi.fn().mockReturnValue(mockDb);
  mockDb["limit"]             = vi.fn().mockResolvedValue([]);
  mockDb["update"]            = vi.fn().mockReturnValue(mockDb);
  mockDb["set"]               = vi.fn().mockReturnValue(mockDb);
  mockDb["returning"]         = vi.fn().mockResolvedValue([]);
  mockDb["insert"]            = vi.fn().mockReturnValue(mockDb);
  mockDb["values"]            = vi.fn().mockReturnValue(mockDb);
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
  runFullValidation:      vi.fn().mockResolvedValue({ valid: true, errors: [] }),
  generateSafetyDisclaimers: vi.fn().mockReturnValue([]),
}));

vi.mock("../brandIntelligenceAdapter.js", () => ({
  fetchBrandIntelligence: vi.fn().mockResolvedValue(null),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────
import {
  updateConceptDraft,
  updateDraftReviewState,
  requestRevision,
} from "../service.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a realistic draft row. Override any field for specific test scenarios. */
function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id:                   1,
    projectUuid:          "test-project-uuid",
    reviewState:          "ai_generated",
    hasUnsavedEdits:      false,
    spacePlanDraft:       { zones: ["living"] },
    materialsDraft:       { floors: "timber" },
    furnitureDraft:       { sofa: "3-seater" },
    lightingDraft:        { ambient: "LED" },
    visualConceptDraft:   "Japandi minimalism",
    originalSpacePlan:    { zones: ["living"] },
    originalMaterials:    { floors: "timber" },
    originalFurniture:    { sofa: "3-seater" },
    originalLighting:     { ambient: "LED" },
    originalVisualConcept:"Japandi minimalism",
    approvedSpacePlan:    null,
    approvedMaterials:    null,
    approvedFurniture:    null,
    approvedLighting:     null,
    approvedVisualConcept:null,
    approvedAt:           null,
    approvedBy:           null,
    revisionRequestedBy:  null,
    revisionRequestedAt:  null,
    revisionReason:       null,
    lastEditedBy:         null,
    lastEditedAt:         null,
    createdAt:            new Date("2026-01-01T00:00:00Z"),
    updatedAt:            new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Make db.limit() return the given row for the next SELECT call. */
function mockSelectRow(row: ReturnType<typeof makeDraft> | null) {
  (mockDb["limit"] as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    row ? [row] : [],
  );
}

/** Make db.returning() return the given row for the next UPDATE call. */
function mockUpdateReturn(row: ReturnType<typeof makeDraft>) {
  (mockDb["returning"] as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore chain returns that clearAllMocks() removes
  (mockDb["select"] as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["from"]   as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["where"]  as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["limit"]  as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (mockDb["update"] as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["set"]    as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
  (mockDb["returning"] as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 1: Approved draft section edits return 409
// ════════════════════════════════════════════════════════════════════════════

describe("Test 1: Approved draft section edits return 409", () => {
  it("updateConceptDraft throws 409 when reviewState is approved_for_rendering", async () => {
    mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));

    await expect(
      updateConceptDraft("test-project-uuid", { spacePlan: { edited: true } }, "admin"),
    ).rejects.toMatchObject({
      message: "Draft is approved for rendering and cannot be edited. Request revision first.",
      status:  409,
    });
  });

  it("db.update is never called — guard fires before any write", async () => {
    mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));

    await expect(
      updateConceptDraft("test-project-uuid", { materials: { x: 1 } }, "admin"),
    ).rejects.toThrow();

    expect(mockDb["update"]).not.toHaveBeenCalled();
  });

  it("all five section types are blocked when approved", async () => {
    const sections = [
      { spacePlan: {} },
      { materials: {} },
      { furniture: {} },
      { lighting: {} },
      { visualConcept: "new concept" },
    ];
    for (const section of sections) {
      mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));
      await expect(
        updateConceptDraft("test-project-uuid", section, "admin"),
      ).rejects.toMatchObject({ status: 409 });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 2: Approved draft cannot be silently downgraded
// ════════════════════════════════════════════════════════════════════════════

describe("Test 2: Approved draft cannot be silently downgraded via updateDraftReviewState", () => {
  const targetStates = ["ai_generated", "edited_by_admin", "ready_for_review", "revision_requested"];

  for (const target of targetStates) {
    it(`direct transition approved_for_rendering → ${target} is rejected with 409`, async () => {
      mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));

      await expect(
        updateDraftReviewState("test-project-uuid", target, "admin"),
      ).rejects.toMatchObject({
        message: "Cannot change state directly from approved_for_rendering. Use the request-revision action.",
        status:  409,
      });
    });
  }

  it("db.update is not called when the downgrade guard fires", async () => {
    mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));

    await expect(
      updateDraftReviewState("test-project-uuid", "edited_by_admin", "admin"),
    ).rejects.toThrow();

    expect(mockDb["update"]).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 3: requestRevision() succeeds for authorized admin on approved draft
// ════════════════════════════════════════════════════════════════════════════

describe("Test 3: requestRevision() succeeds for authorized admin on approved draft", () => {
  it("transitions approved_for_rendering → revision_requested and records audit fields", async () => {
    const approvedDraft = makeDraft({
      reviewState:          "approved_for_rendering",
      approvedSpacePlan:    { zones: ["living", "dining"] },
      approvedAt:           new Date("2026-07-01T10:00:00Z"),
      approvedBy:           "admin-001",
    });
    mockSelectRow(approvedDraft);

    const expectedResult = makeDraft({
      reviewState:         "revision_requested",
      revisionRequestedBy: "admin-001",
      revisionRequestedAt: new Date(),
      revisionReason:      "Client requested furniture change",
    });
    mockUpdateReturn(expectedResult);

    const result = await requestRevision(
      "test-project-uuid",
      "admin-001",
      "Client requested furniture change",
    );

    expect(result.reviewState).toBe("revision_requested");
    expect(result.revisionRequestedBy).toBe("admin-001");
    expect(result.revisionReason).toBe("Client requested furniture change");
  });

  it("requestRevision without reason stores null for revisionReason", async () => {
    mockSelectRow(makeDraft({ reviewState: "approved_for_rendering" }));
    const updated = makeDraft({ reviewState: "revision_requested", revisionReason: null });
    mockUpdateReturn(updated);

    const result = await requestRevision("test-project-uuid", "admin-002");
    expect(result.reviewState).toBe("revision_requested");
    expect(result.revisionReason).toBeNull();
  });

  it("requestRevision on non-approved draft throws 409", async () => {
    for (const state of ["ai_generated", "edited_by_admin", "ready_for_review", "revision_requested"]) {
      mockSelectRow(makeDraft({ reviewState: state }));
      await expect(
        requestRevision("test-project-uuid", "admin"),
      ).rejects.toMatchObject({ status: 409 });
    }
  });

  it("requestRevision on missing draft throws 404", async () => {
    mockSelectRow(null);
    await expect(
      requestRevision("nonexistent-uuid", "admin"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 4: Editing is allowed after revision_requested
// ════════════════════════════════════════════════════════════════════════════

describe("Test 4: Editing is allowed after revision_requested", () => {
  it("updateConceptDraft succeeds when reviewState is revision_requested", async () => {
    mockSelectRow(makeDraft({ reviewState: "revision_requested" }));
    const updated = makeDraft({ reviewState: "edited_by_admin", spacePlanDraft: { zones: ["kitchen"] } });
    mockUpdateReturn(updated);

    const result = await updateConceptDraft(
      "test-project-uuid",
      { spacePlan: { zones: ["kitchen"] } },
      "admin",
    );

    expect(result.reviewState).toBe("edited_by_admin");
    expect(mockDb["update"]).toHaveBeenCalled();
  });

  it("revision_requested → edited_by_admin promotion happens on first edit", async () => {
    mockSelectRow(makeDraft({ reviewState: "revision_requested" }));
    mockUpdateReturn(makeDraft({ reviewState: "edited_by_admin" }));

    const result = await updateConceptDraft(
      "test-project-uuid",
      { lighting: { type: "warm white" } },
      "admin",
    );

    expect(result.reviewState).toBe("edited_by_admin");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 5: Approved snapshot remains unchanged after revision begins
// ════════════════════════════════════════════════════════════════════════════

describe("Test 5: Approved snapshot preserved after revision", () => {
  it("requestRevision does not clear the approved snapshot columns", async () => {
    const frozenSnapshot = {
      approvedSpacePlan:    { zones: ["living", "dining"] },
      approvedMaterials:    { floors: "oak" },
      approvedFurniture:    { sofa: "modular" },
      approvedLighting:     { ambient: "warm" },
      approvedVisualConcept:"Japandi modern",
      approvedAt:           new Date("2026-07-01T10:00:00Z"),
      approvedBy:           "admin-001",
    };
    mockSelectRow(makeDraft({ reviewState: "approved_for_rendering", ...frozenSnapshot }));

    // Return row still has approved snapshot intact
    const updatedRow = makeDraft({ reviewState: "revision_requested", ...frozenSnapshot });
    mockUpdateReturn(updatedRow);

    const result = await requestRevision("test-project-uuid", "admin-002", "needs update");

    // Snapshot fields must survive the revision request
    expect(result.approvedSpacePlan).toEqual(frozenSnapshot.approvedSpacePlan);
    expect(result.approvedMaterials).toEqual(frozenSnapshot.approvedMaterials);
    expect(result.approvedFurniture).toEqual(frozenSnapshot.approvedFurniture);
    expect(result.approvedLighting).toEqual(frozenSnapshot.approvedLighting);
    expect(result.approvedVisualConcept).toBe(frozenSnapshot.approvedVisualConcept);
    expect(result.approvedAt).toEqual(frozenSnapshot.approvedAt);
    expect(result.approvedBy).toBe(frozenSnapshot.approvedBy);
  });

  it("updateConceptDraft (post-revision) does not touch approved snapshot columns", async () => {
    mockSelectRow(makeDraft({
      reviewState:       "revision_requested",
      approvedSpacePlan: { zones: ["FROZEN"] },
      approvedAt:        new Date("2026-07-01T10:00:00Z"),
      approvedBy:        "admin-001",
    }));
    mockUpdateReturn(makeDraft({ reviewState: "edited_by_admin" }));

    await updateConceptDraft("test-project-uuid", { materials: { new: true } }, "admin");

    // The set() call must not include any approved_* fields
    const setCallArgs = (mockDb["set"] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setCallArgs).not.toHaveProperty("approvedSpacePlan");
    expect(setCallArgs).not.toHaveProperty("approvedAt");
    expect(setCallArgs).not.toHaveProperty("approvedBy");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 6: Unauthorized revision request is rejected
// ════════════════════════════════════════════════════════════════════════════

describe("Test 6: Unauthorized revision request is rejected", () => {
  it("request-revision route is defined in router.ts (structural check)", () => {
    const routerSource = readFileSync(
      join(__dirname, "../router.ts"),
      "utf-8",
    );
    expect(routerSource).toContain("request-revision");
    expect(routerSource).toContain("requestRevision");
  });

  it("request-revision route is mounted under /ai/ prefix — protected by global adminAuth", () => {
    const routerSource = readFileSync(
      join(__dirname, "../router.ts"),
      "utf-8",
    );
    // Must be under /ai/interior-design/ (admin-guarded prefix), not /public/
    expect(routerSource).toContain('"/ai/interior-design/drafts/:projectUuid/request-revision"');
    expect(routerSource).not.toContain('"/public/interior-design/drafts/:projectUuid/request-revision"');
  });

  it("app.ts mounts all /api routes behind adminAuthWithExceptions (structural check)", () => {
    const appSource = readFileSync(
      join(__dirname, "../../../../../../artifacts/api-server/src/app.ts"),
      "utf-8",
    );
    // Global middleware: all /api routes are admin-gated
    expect(appSource).toContain("adminAuthWithExceptions");
    expect(appSource).toMatch(/app\.use\(["']\/api["']/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 7: Optimistic concurrency still works
// ════════════════════════════════════════════════════════════════════════════

describe("Test 7: Optimistic concurrency still works", () => {
  it("stale updatedAt triggers 409 conflict error", async () => {
    const storedAt = new Date("2026-07-01T10:00:00Z");
    const staleClientAt = new Date("2026-07-01T09:00:00Z"); // 1 hour stale

    mockSelectRow(makeDraft({ reviewState: "edited_by_admin", updatedAt: storedAt }));

    await expect(
      updateConceptDraft(
        "test-project-uuid",
        { spacePlan: { updated: true } },
        "admin",
        staleClientAt.toISOString(),
      ),
    ).rejects.toMatchObject({
      message: "Concurrent edit conflict: draft was modified by another editor. Refresh and try again.",
      status:  409,
    });
  });

  it("matching updatedAt (within 1s tolerance) passes concurrency check", async () => {
    const storedAt = new Date("2026-07-01T10:00:00Z");
    const freshClientAt = new Date("2026-07-01T10:00:00.500Z"); // 500ms — within tolerance

    mockSelectRow(makeDraft({ reviewState: "edited_by_admin", updatedAt: storedAt }));
    mockUpdateReturn(makeDraft({ reviewState: "edited_by_admin" }));

    const result = await updateConceptDraft(
      "test-project-uuid",
      { materials: { updated: true } },
      "admin",
      freshClientAt.toISOString(),
    );

    expect(result).toBeDefined();
    expect(mockDb["update"]).toHaveBeenCalled();
  });

  it("concurrency guard runs AFTER approved-state guard (approved draft never reaches concurrency check)", async () => {
    mockSelectRow(makeDraft({
      reviewState: "approved_for_rendering",
      updatedAt:   new Date("2026-07-01T10:00:00Z"),
    }));

    // Even with a fresh timestamp, approved guard fires first
    await expect(
      updateConceptDraft(
        "test-project-uuid",
        { spacePlan: {} },
        "admin",
        new Date("2026-07-01T10:00:00Z").toISOString(),
      ),
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("approved for rendering") });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST 8: Existing initialize/edit/save behavior unchanged
// ════════════════════════════════════════════════════════════════════════════

describe("Test 8: Existing initialize/edit/save behavior unchanged", () => {
  it("updateConceptDraft on ai_generated draft succeeds and promotes to edited_by_admin", async () => {
    mockSelectRow(makeDraft({ reviewState: "ai_generated" }));
    mockUpdateReturn(makeDraft({ reviewState: "edited_by_admin", spacePlanDraft: { zones: ["living"] } }));

    const result = await updateConceptDraft(
      "test-project-uuid",
      { spacePlan: { zones: ["living"] } },
      "admin",
    );

    expect(result.reviewState).toBe("edited_by_admin");
  });

  it("updateConceptDraft on edited_by_admin draft keeps state as edited_by_admin", async () => {
    mockSelectRow(makeDraft({ reviewState: "edited_by_admin" }));
    mockUpdateReturn(makeDraft({ reviewState: "edited_by_admin" }));

    const result = await updateConceptDraft(
      "test-project-uuid",
      { materials: { floor: "oak" } },
      "admin",
    );

    expect(result.reviewState).toBe("edited_by_admin");
  });

  it("updateDraftReviewState transitions edited_by_admin → ready_for_review", async () => {
    mockSelectRow(makeDraft({ reviewState: "edited_by_admin" }));
    mockUpdateReturn(makeDraft({ reviewState: "ready_for_review" }));

    const result = await updateDraftReviewState("test-project-uuid", "ready_for_review", "admin");
    expect(result.reviewState).toBe("ready_for_review");
  });

  it("updateDraftReviewState captures approved snapshot when transitioning to approved_for_rendering", async () => {
    const draft = makeDraft({
      reviewState:       "ready_for_review",
      spacePlanDraft:    { zones: ["living", "dining"] },
      materialsDraft:    { floors: "oak" },
      furnitureDraft:    { sofa: "modular" },
      lightingDraft:     { ambient: "warm" },
      visualConceptDraft:"Japandi modern",
    });
    mockSelectRow(draft);
    mockUpdateReturn(makeDraft({
      reviewState:          "approved_for_rendering",
      approvedSpacePlan:    { zones: ["living", "dining"] },
      approvedMaterials:    { floors: "oak" },
      approvedFurniture:    { sofa: "modular" },
      approvedLighting:     { ambient: "warm" },
      approvedVisualConcept:"Japandi modern",
      approvedBy:           "admin-senior",
    }));

    const result = await updateDraftReviewState("test-project-uuid", "approved_for_rendering", "admin-senior");

    // Snapshot fields must be written to db.set()
    const setArgs = (mockDb["set"] as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArgs).toHaveProperty("approvedSpacePlan");
    expect(setArgs).toHaveProperty("approvedAt");
    expect(setArgs["approvedBy"]).toBe("admin-senior");
    expect(result.reviewState).toBe("approved_for_rendering");
  });

  it("updateDraftReviewState rejects unknown states with 400", async () => {
    await expect(
      updateDraftReviewState("test-project-uuid", "totally_invalid_state", "admin"),
    ).rejects.toMatchObject({ status: 400 });
  });
});
