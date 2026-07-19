/**
 * goal-taxonomy.test.ts — Unit tests for Goal Taxonomy (Team 02 / V4.2C)
 *
 * Tests run entirely in-memory (no DB) by mocking the repository layer.
 * Covers:
 *   1. Slug validation — format, length, collisions
 *   2. Hierarchy depth guard — max 2 levels
 *   3. listGoals — flat vs tree output
 *   4. getGoalWithServices — enriched response shape
 *   5. createGoal — success + conflict + validation errors
 *   6. updateGoal — partial update + self-parent guard
 *   7. addServiceToGoal — success + duplicate guard
 *   8. removeServiceFromGoal — success + not-found
 *   9. bulkMapServiceCodesToGoal — mapped / skipped reporting
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the repository so tests need no DB ───────────────────────────────────
vi.mock("../goals/goalRepository.js", () => ({
  listGoals: vi.fn(),
  findGoalBySlug: vi.fn(),
  findGoalById: vi.fn(),
  listChildGoals: vi.fn(),
  slugExists: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  listServicesForGoal: vi.fn(),
  findMapping: vi.fn(),
  listMappingsByGoalId: vi.fn(),
  createMapping: vi.fn(),
  deleteMappingById: vi.fn(),
  deleteMappingByGoalAndService: vi.fn(),
  resolveServiceIdsByCodes: vi.fn(),
}));

import * as repo from "../goals/goalRepository.js";
import {
  listGoals,
  getGoal,
  getGoalWithServices,
  createGoal,
  updateGoal,
  addServiceToGoal,
  removeServiceFromGoal,
  bulkMapServiceCodesToGoal,
  GoalNotFoundError,
  GoalConflictError,
  GoalValidationError,
  MappingConflictError,
} from "../goals/goalService.js";
import type { Goal, GoalServiceMapping, GoalServiceStub } from "../goals/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    slug: "launch-brand",
    name: "Saya ingin meluncurkan brand",
    description: "Buat identitas brand dari nol.",
    icon: "🚀",
    parentGoalId: null,
    metadataJson: { keywords: ["brand", "logo"] },
    displayOrder: 0,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeMapping(overrides: Partial<GoalServiceMapping> = {}): GoalServiceMapping {
  return {
    id: 1,
    goalId: 1,
    serviceId: 10,
    relevanceScore: 90,
    displayOrder: 0,
    isPrimary: true,
    status: "active",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeStub(overrides: Partial<GoalServiceStub> = {}): GoalServiceStub {
  return {
    serviceCode: "GD-LOGO",
    serviceName: "Logo Design",
    shortDescription: "Desain logo profesional",
    startingPrice: "500000",
    currency: "IDR",
    estimatedDelivery: "3–5 hari",
    relevanceScore: 90,
    isPrimary: true,
    displayOrder: 0,
    ...overrides,
  };
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── 1. Slug validation ─────────────────────────────────────────────────────────

describe("slug validation", () => {
  it("rejects slugs with uppercase letters", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    await expect(createGoal({ slug: "Launch-Brand", name: "Test" })).rejects.toThrow(
      GoalValidationError,
    );
  });

  it("rejects slugs with spaces", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    await expect(createGoal({ slug: "launch brand", name: "Test" })).rejects.toThrow(
      GoalValidationError,
    );
  });

  it("rejects slugs shorter than 2 chars", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    await expect(createGoal({ slug: "x", name: "Test" })).rejects.toThrow(GoalValidationError);
  });

  it("accepts valid lowercase-hyphen slugs", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    vi.mocked(repo.createGoal).mockResolvedValue(makeGoal({ slug: "launch-brand-2026" }));
    const view = await createGoal({ slug: "launch-brand-2026", name: "Test" });
    expect(view.slug).toBe("launch-brand-2026");
  });
});

// ── 2. Hierarchy depth guard ───────────────────────────────────────────────────

describe("hierarchy depth guard", () => {
  it("allows a child goal (depth 2)", async () => {
    const parent = makeGoal({ id: 1, parentGoalId: null });
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    vi.mocked(repo.findGoalById).mockResolvedValue(parent);
    vi.mocked(repo.createGoal).mockResolvedValue(
      makeGoal({ slug: "child-goal", parentGoalId: 1 }),
    );

    const view = await createGoal({ slug: "child-goal", name: "Child", parentGoalId: 1 });
    expect(view.slug).toBe("child-goal");
  });

  it("rejects grandchild goals (depth > 2)", async () => {
    // parent is itself a child (parentGoalId != null)
    const alreadyChild = makeGoal({ id: 5, parentGoalId: 1 });
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    vi.mocked(repo.findGoalById).mockResolvedValue(alreadyChild);

    await expect(
      createGoal({ slug: "grand-child", name: "Grand", parentGoalId: 5 }),
    ).rejects.toThrow(GoalValidationError);
  });

  it("rejects a goal as its own parent during update", async () => {
    const existing = makeGoal({ id: 3, slug: "test-goal" });
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(existing);

    await expect(
      updateGoal("test-goal", { parentGoalId: 3 }),
    ).rejects.toThrow(GoalValidationError);
  });
});

// ── 3. listGoals ──────────────────────────────────────────────────────────────

describe("listGoals", () => {
  it("returns flat list with correct shape", async () => {
    vi.mocked(repo.listGoals).mockResolvedValue([makeGoal()]);
    const result = await listGoals();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      slug: "launch-brand",
      name: "Saya ingin meluncurkan brand",
      parentGoalSlug: null,
    });
    // id and DB internals must NOT be in the view
    expect((result[0] as any).id).toBeUndefined();
    expect((result[0] as any).createdAt).toBeUndefined();
  });

  it("nests children under parents when withChildren=true", async () => {
    const parent = makeGoal({ id: 1, slug: "launch-brand", parentGoalId: null });
    const child = makeGoal({ id: 2, slug: "design-logo", parentGoalId: 1 });

    // roots call + all children call
    vi.mocked(repo.listGoals)
      .mockResolvedValueOnce([parent])   // rootOnly pass
      .mockResolvedValueOnce([parent, child]); // all goals pass

    const result = await listGoals({ withChildren: true });
    expect(result).toHaveLength(1);
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.slug).toBe("design-logo");
  });
});

// ── 4. getGoalWithServices ────────────────────────────────────────────────────

describe("getGoalWithServices", () => {
  it("returns goal metadata + services", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.listServicesForGoal).mockResolvedValue([makeStub()]);

    const result = await getGoalWithServices("launch-brand");
    expect(result.slug).toBe("launch-brand");
    expect(result.services).toHaveLength(1);
    expect(result.services[0]!.serviceCode).toBe("GD-LOGO");
    expect(result.services[0]!.isPrimary).toBe(true);
  });

  it("throws GoalNotFoundError for unknown slug", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(undefined);
    await expect(getGoalWithServices("unknown-goal")).rejects.toThrow(GoalNotFoundError);
  });
});

// ── 5. createGoal ─────────────────────────────────────────────────────────────

describe("createGoal", () => {
  it("creates a goal and returns view without internal fields", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(false);
    vi.mocked(repo.createGoal).mockResolvedValue(makeGoal());

    const view = await createGoal({ slug: "launch-brand", name: "Launch Brand" });
    expect(view.slug).toBe("launch-brand");
    expect((view as any).id).toBeUndefined();
  });

  it("throws GoalConflictError when slug already exists", async () => {
    vi.mocked(repo.slugExists).mockResolvedValue(true);
    await expect(createGoal({ slug: "launch-brand", name: "X" })).rejects.toThrow(
      GoalConflictError,
    );
  });
});

// ── 6. updateGoal ─────────────────────────────────────────────────────────────

describe("updateGoal", () => {
  it("applies partial updates", async () => {
    const original = makeGoal();
    const updated = makeGoal({ name: "Updated Name", displayOrder: 5 });
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(original);
    vi.mocked(repo.updateGoal).mockResolvedValue(updated);

    const view = await updateGoal("launch-brand", { name: "Updated Name", displayOrder: 5 });
    expect(view.name).toBe("Updated Name");
    expect(view.displayOrder).toBe(5);
  });

  it("throws GoalNotFoundError when goal does not exist", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(undefined);
    await expect(updateGoal("missing-slug", { name: "X" })).rejects.toThrow(GoalNotFoundError);
  });
});

// ── 7. addServiceToGoal ───────────────────────────────────────────────────────

describe("addServiceToGoal", () => {
  it("creates a mapping and returns result", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.findMapping).mockResolvedValue(undefined);
    vi.mocked(repo.createMapping).mockResolvedValue(makeMapping());

    const result = await addServiceToGoal("launch-brand", { serviceId: 10, isPrimary: true });
    expect(result.serviceId).toBe(10);
    expect(result.isPrimary).toBe(true);
  });

  it("throws MappingConflictError when mapping already exists", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.findMapping).mockResolvedValue(makeMapping());

    await expect(addServiceToGoal("launch-brand", { serviceId: 10 })).rejects.toThrow(
      MappingConflictError,
    );
  });
});

// ── 8. removeServiceFromGoal ──────────────────────────────────────────────────

describe("removeServiceFromGoal", () => {
  it("returns true when mapping is deleted", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.deleteMappingByGoalAndService).mockResolvedValue(true);

    const result = await removeServiceFromGoal("launch-brand", 10);
    expect(result).toBe(true);
  });

  it("returns false when mapping does not exist", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.deleteMappingByGoalAndService).mockResolvedValue(false);

    const result = await removeServiceFromGoal("launch-brand", 999);
    expect(result).toBe(false);
  });
});

// ── 9. bulkMapServiceCodesToGoal ──────────────────────────────────────────────

describe("bulkMapServiceCodesToGoal", () => {
  it("reports mapped and skipped service codes", async () => {
    vi.mocked(repo.findGoalBySlug).mockResolvedValue(makeGoal());
    vi.mocked(repo.resolveServiceIdsByCodes).mockResolvedValue(
      new Map([["GD-LOGO", 10], ["GD-BCARD", 11]]),
    );
    // GD-LOGO already mapped, GD-BCARD is new
    vi.mocked(repo.findMapping)
      .mockResolvedValueOnce(makeMapping()) // GD-LOGO → already mapped
      .mockResolvedValueOnce(undefined);    // GD-BCARD → new
    vi.mocked(repo.createMapping).mockResolvedValue(makeMapping({ serviceId: 11 }));

    const result = await bulkMapServiceCodesToGoal("launch-brand", [
      { serviceCode: "GD-LOGO", relevanceScore: 90, isPrimary: true },
      { serviceCode: "GD-BCARD", relevanceScore: 60 },
      { serviceCode: "DOES-NOT-EXIST" }, // not resolved
    ]);

    expect(result.mapped).toEqual(["GD-BCARD"]);
    expect(result.skipped).toEqual(expect.arrayContaining(["GD-LOGO", "DOES-NOT-EXIST"]));
  });
});
