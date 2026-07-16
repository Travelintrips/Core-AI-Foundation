/**
 * Blueprint Service Integration Tests (Team 7)
 *
 * Tests the service layer (index.ts) in isolation — no DB, no HTTP.
 * Uses the in-process store and built-in blueprints.
 *
 * Covers:
 *  - listBlueprints filtering (domain, status, tags, pagination)
 *  - getBlueprintById / getBlueprintBySlug
 *  - getBlueprintsByDomain
 *  - createCustomBlueprint (valid + invalid)
 *  - updateCustomBlueprint (valid, not-found, builtin-immutable)
 *  - deprecateCustomBlueprint
 *  - validateBlueprintPayload
 *  - checkBlueprintCompatibility (not-found case)
 *  - normalizeBlueprintPayload
 *  - getBlueprintStats
 */

import { describe, it, expect } from "vitest";
import {
  listBlueprints,
  getBlueprintById,
  getBlueprintBySlug,
  getBlueprintsByDomain,
  createCustomBlueprint,
  updateCustomBlueprint,
  deprecateCustomBlueprint,
  validateBlueprintPayload,
  checkBlueprintCompatibility,
  normalizeBlueprintPayload,
  getBlueprintStats,
} from "../index.js";
import type { CreateBlueprintInput } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCustomInput(overrides: Partial<CreateBlueprintInput> = {}): CreateBlueprintInput {
  return {
    domain: "graphic_design",
    name: "Custom Test Blueprint",
    description: "A custom test blueprint",
    version: "1.0.0",
    status: "draft",
    dimensions: { width: 1920, height: 1080, unit: "px", dpi: 96 },
    zones: [
      { id: "z-main", name: "Main", x: 0, y: 0, width: 1920, height: 1080, required: true, slotRefs: ["s-text"] },
    ],
    slots: [
      { id: "s-text", name: "Text", type: "text", required: true, maxItems: 1, constraints: { maxChars: 200 } },
    ],
    constraints: { maxZones: 4, maxSlots: 8 },
    supportedComponents: [
      { type: "rich-text-editor", versionRange: ">=1.0.0", required: true, fillsSlotTypes: ["text"] },
    ],
    requiredData: [
      { key: "brandName", label: "Brand", type: "string", required: true },
    ],
    outputCapabilities: [{ format: "pdf" }],
    industryTags: ["advertising"],
    styleTags: ["minimalist"],
    ...overrides,
  };
}

// ── listBlueprints ────────────────────────────────────────────────────────────

describe("listBlueprints", () => {
  it("returns all built-in blueprints by default", () => {
    const result = listBlueprints();
    expect(result.length).toBeGreaterThanOrEqual(6);
  });

  it("filters by domain", () => {
    const result = listBlueprints({ domain: "presentation" });
    expect(result.every((b) => b.domain === "presentation")).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by status: active", () => {
    const result = listBlueprints({ status: "active" });
    expect(result.every((b) => b.status === "active")).toBe(true);
  });

  it("filters by industryTag", () => {
    const result = listBlueprints({ industryTag: "advertising" });
    expect(result.every((b) => b.industryTags.includes("advertising"))).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by styleTag", () => {
    const result = listBlueprints({ styleTag: "minimalist" });
    expect(result.every((b) => b.styleTags.includes("minimalist"))).toBe(true);
  });

  it("paginates with limit and offset", () => {
    const all = listBlueprints();
    const page1 = listBlueprints({ limit: 2, offset: 0 });
    const page2 = listBlueprints({ limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
    expect(page1.length + page2.length).toBeLessThanOrEqual(all.length);
  });

  it("returns empty array for nonexistent domain-filter combo", () => {
    const result = listBlueprints({ domain: "fashion", industryTag: "fintech-unlikely-tag-xyz" });
    expect(result).toHaveLength(0);
  });
});

// ── getBlueprintById ──────────────────────────────────────────────────────────

describe("getBlueprintById", () => {
  it("returns a built-in blueprint by id", () => {
    const bp = getBlueprintById("bp-graphic-design-v1");
    expect(bp).not.toBeNull();
    expect(bp!.domain).toBe("graphic_design");
  });

  it("returns null for unknown id", () => {
    expect(getBlueprintById("bp-does-not-exist")).toBeNull();
  });
});

// ── getBlueprintBySlug ────────────────────────────────────────────────────────

describe("getBlueprintBySlug", () => {
  it("returns a built-in blueprint by slug", () => {
    const bp = getBlueprintBySlug("graphic-design-standard");
    expect(bp).not.toBeNull();
    expect(bp!.id).toBe("bp-graphic-design-v1");
  });

  it("returns null for unknown slug", () => {
    expect(getBlueprintBySlug("nonexistent-slug")).toBeNull();
  });
});

// ── getBlueprintsByDomain ─────────────────────────────────────────────────────

describe("getBlueprintsByDomain", () => {
  it("returns blueprints for each domain", () => {
    const domains = ["graphic_design", "presentation", "interior", "fashion", "packaging", "product_design"] as const;
    for (const domain of domains) {
      const bps = getBlueprintsByDomain(domain);
      expect(bps.length).toBeGreaterThanOrEqual(1);
      expect(bps.every((b) => b.domain === domain)).toBe(true);
    }
  });
});

// ── createCustomBlueprint ─────────────────────────────────────────────────────

describe("createCustomBlueprint", () => {
  it("creates a valid custom blueprint", () => {
    const { blueprint, validation } = createCustomBlueprint(makeCustomInput());
    expect(validation.valid).toBe(true);
    expect(blueprint).not.toBeNull();
    expect(blueprint!.id).toMatch(/^bp-custom-/);
    expect(blueprint!.slug).toMatch(/^custom-/);
    expect(blueprint!.schemaVersion).toBe("1.0");
  });

  it("returns null blueprint when invalid", () => {
    const { blueprint, validation } = createCustomBlueprint(makeCustomInput({ name: "" }));
    expect(validation.valid).toBe(false);
    expect(blueprint).toBeNull();
  });

  it("created blueprint is retrievable by id", () => {
    const { blueprint } = createCustomBlueprint(makeCustomInput({ name: "Retrievable Blueprint" }));
    expect(blueprint).not.toBeNull();
    const found = getBlueprintById(blueprint!.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Retrievable Blueprint");
  });

  it("created blueprint appears in listBlueprints", () => {
    const { blueprint } = createCustomBlueprint(makeCustomInput({ domain: "packaging", name: "List Test Blueprint" }));
    expect(blueprint).not.toBeNull();
    const list = listBlueprints({ domain: "packaging" });
    expect(list.some((b) => b.id === blueprint!.id)).toBe(true);
  });
});

// ── updateCustomBlueprint ─────────────────────────────────────────────────────

describe("updateCustomBlueprint", () => {
  it("updates a custom blueprint field", () => {
    const { blueprint: created } = createCustomBlueprint(makeCustomInput({ name: "Before Update" }));
    expect(created).not.toBeNull();

    const { blueprint: updated, validation } = updateCustomBlueprint(created!.id, { name: "After Update" });
    expect(validation.valid).toBe(true);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("After Update");
  });

  it("returns notFound for unknown id", () => {
    const result = updateCustomBlueprint("bp-nonexistent", { name: "X" });
    expect(result.notFound).toBe(true);
  });

  it("returns error for builtin id", () => {
    const result = updateCustomBlueprint("bp-graphic-design-v1", { name: "Hacked" });
    expect(result.validation.valid).toBe(false);
    expect(result.validation.issues.some((i) => i.code === "BUILTIN_IMMUTABLE")).toBe(true);
  });
});

// ── deprecateCustomBlueprint ──────────────────────────────────────────────────

describe("deprecateCustomBlueprint", () => {
  it("deprecates a custom blueprint", () => {
    const { blueprint } = createCustomBlueprint(makeCustomInput({ name: "To Deprecate" }));
    expect(blueprint).not.toBeNull();

    const result = deprecateCustomBlueprint(blueprint!.id);
    expect(result.success).toBe(true);

    const found = getBlueprintById(blueprint!.id);
    expect(found!.status).toBe("deprecated");
  });

  it("returns builtin: true for builtin id", () => {
    const result = deprecateCustomBlueprint("bp-graphic-design-v1");
    expect(result.builtin).toBe(true);
    expect(result.success).toBe(false);
  });

  it("returns notFound for unknown id", () => {
    const result = deprecateCustomBlueprint("bp-nonexistent");
    expect(result.notFound).toBe(true);
  });
});

// ── validateBlueprintPayload ──────────────────────────────────────────────────

describe("validateBlueprintPayload", () => {
  it("returns valid for a well-formed payload", () => {
    const bp = getBlueprintById("bp-graphic-design-v1")!;
    const result = validateBlueprintPayload(bp);
    expect(result.valid).toBe(true);
  });

  it("returns invalid for null", () => {
    const result = validateBlueprintPayload(null);
    expect(result.valid).toBe(false);
  });

  it("returns invalid for empty object", () => {
    const result = validateBlueprintPayload({});
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

// ── checkBlueprintCompatibility ───────────────────────────────────────────────

describe("checkBlueprintCompatibility", () => {
  it("returns blueprintNotFound for unknown blueprintId", () => {
    const result = checkBlueprintCompatibility({
      blueprintId: "bp-does-not-exist",
      schemaVersion: "1.0",
    });
    expect(result.blueprintNotFound).toBe(true);
    expect(result.compatible).toBe(false);
  });

  it("returns compatible for matching request on built-in", () => {
    const result = checkBlueprintCompatibility({
      blueprintId: "bp-graphic-design-v1",
      schemaVersion: "1.0",
      componentTypes: ["rich-text-editor", "image-picker"],
      slotTypesFilled: { text: 1, image: 1 },
    });
    expect(result.compatible).toBe(true);
  });
});

// ── normalizeBlueprintPayload ─────────────────────────────────────────────────

describe("normalizeBlueprintPayload", () => {
  it("normalizes and validates a valid blueprint", () => {
    const bp = getBlueprintById("bp-graphic-design-v1")!;
    const result = normalizeBlueprintPayload(bp);
    expect(result.valid).toBe(true);
    expect(result.blueprint).not.toBeNull();
  });

  it("returns invalid for non-object payload", () => {
    const result = normalizeBlueprintPayload("not an object");
    expect(result.valid).toBe(false);
    expect(result.validationIssues.some((i) => i.code === "NOT_AN_OBJECT")).toBe(true);
  });

  it("returns changes array", () => {
    const bp = { ...getBlueprintById("bp-graphic-design-v1")!, industryTags: ["ADVERTISING", "advertising"] };
    const result = normalizeBlueprintPayload(bp);
    expect(Array.isArray(result.changes)).toBe(true);
  });
});

// ── getBlueprintStats ─────────────────────────────────────────────────────────

describe("getBlueprintStats", () => {
  it("returns correct builtin count", () => {
    const stats = getBlueprintStats();
    expect(stats.builtin).toBe(6);
    expect(stats.total).toBeGreaterThanOrEqual(6);
  });

  it("has all 6 domains in byDomain", () => {
    const stats = getBlueprintStats();
    const domains = ["graphic_design", "presentation", "interior", "fashion", "packaging", "product_design"];
    for (const domain of domains) {
      expect(stats.byDomain[domain]).toBeGreaterThanOrEqual(1);
    }
  });

  it("byStatus covers active, draft, deprecated", () => {
    const stats = getBlueprintStats();
    expect(typeof stats.byStatus.active).toBe("number");
    expect(typeof stats.byStatus.draft).toBe("number");
    expect(typeof stats.byStatus.deprecated).toBe("number");
  });
});
