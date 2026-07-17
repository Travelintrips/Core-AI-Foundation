/**
 * Blueprint Normalizer Tests (Team 7)
 *
 * Covers:
 *  - Idempotency (run twice → same result)
 *  - Tag normalization (lowercase, dedup, sort)
 *  - Slug normalization (kebab-case)
 *  - Zone sorting (zIndex asc, id asc)
 *  - Slot sorting (id asc)
 *  - requiredData sorting (key asc)
 *  - outputCapabilities sorting (format asc)
 *  - supportedComponents sorting (type asc)
 *  - DPI clamping
 *  - schemaVersion injection
 *  - Whitespace trimming
 *  - No mutation of original input
 */

import { describe, it, expect } from "vitest";
import { normalizeBlueprint } from "../blueprintNormalizer.js";
import { graphicDesignBlueprint } from "../blueprints/graphic-design.js";
import type { Blueprint } from "../types.js";

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: "bp-norm-test",
    slug: "norm-test",
    schemaVersion: "1.0",
    domain: "graphic_design",
    name: "Norm Test",
    description: "Test blueprint",
    version: "1.0.0",
    status: "active",
    dimensions: { width: 100, height: 100, unit: "px", dpi: 96 },
    zones: [{ id: "z-a", name: "A", x: 0, y: 0, width: 100, height: 50, required: true, slotRefs: ["s-a"], zIndex: 1 }],
    slots: [{ id: "s-a", name: "A", type: "text", required: true, maxItems: 1, constraints: {} }],
    constraints: {},
    supportedComponents: [],
    requiredData: [],
    outputCapabilities: [{ format: "pdf" }],
    industryTags: ["Advertising"],
    styleTags: ["Bold"],
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

// ── Idempotency ───────────────────────────────────────────────────────────────

describe("normalizeBlueprint — idempotency", () => {
  it("built-in blueprint is idempotent", () => {
    const { blueprint: once } = normalizeBlueprint(graphicDesignBlueprint);
    const { blueprint: twice } = normalizeBlueprint(once);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it("minimal blueprint is idempotent", () => {
    const { blueprint: once } = normalizeBlueprint(makeBlueprint());
    const { blueprint: twice } = normalizeBlueprint(once);
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

// ── No mutation ───────────────────────────────────────────────────────────────

describe("normalizeBlueprint — no mutation", () => {
  it("does not mutate the input object", () => {
    const input = makeBlueprint({ industryTags: ["BETA", "ALPHA"] });
    const originalTags = [...input.industryTags];
    normalizeBlueprint(input);
    expect(input.industryTags).toEqual(originalTags);
  });
});

// ── Tags ──────────────────────────────────────────────────────────────────────

describe("normalizeBlueprint — tags", () => {
  it("lowercases all tags", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ industryTags: ["RETAIL", "Fashion"] }));
    expect(blueprint.industryTags).toEqual(expect.arrayContaining(["retail", "fashion"]));
    expect(blueprint.industryTags.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it("deduplicates tags", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ styleTags: ["bold", "Bold", "BOLD"] }));
    expect(blueprint.styleTags).toHaveLength(1);
    expect(blueprint.styleTags[0]).toBe("bold");
  });

  it("sorts tags alphabetically", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ industryTags: ["retail", "advertising", "fashion"] }));
    expect(blueprint.industryTags).toEqual(["advertising", "fashion", "retail"]);
  });

  it("removes empty tags", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ styleTags: ["", "bold", "  "] }));
    expect(blueprint.styleTags).not.toContain("");
    expect(blueprint.styleTags).toContain("bold");
  });

  it("records change when tags are modified", () => {
    const { changes } = normalizeBlueprint(makeBlueprint({ industryTags: ["BETA", "ALPHA"] }));
    expect(changes.some((c) => c.includes("industryTags"))).toBe(true);
  });
});

// ── Slug normalization ────────────────────────────────────────────────────────

describe("normalizeBlueprint — slug", () => {
  it("lowercases slug", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ slug: "My-Blueprint" }));
    expect(blueprint.slug).toBe("my-blueprint");
  });

  it("replaces spaces and special chars with hyphens", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ slug: "my blueprint!v2" }));
    expect(blueprint.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("collapses multiple hyphens", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ slug: "my--blueprint" }));
    expect(blueprint.slug).toBe("my-blueprint");
  });
});

// ── DPI clamping ──────────────────────────────────────────────────────────────

describe("normalizeBlueprint — DPI clamping", () => {
  it("clamps DPI above 2400 to 2400", () => {
    const { blueprint, changes } = normalizeBlueprint(makeBlueprint({ dimensions: { width: 100, height: 100, unit: "px", dpi: 9999 } }));
    expect(blueprint.dimensions.dpi).toBe(2400);
    expect(changes.some((c) => c.includes("dpi"))).toBe(true);
  });

  it("clamps DPI below 72 to 72", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ dimensions: { width: 100, height: 100, unit: "px", dpi: 10 } }));
    expect(blueprint.dimensions.dpi).toBe(72);
  });

  it("does not change DPI in valid range", () => {
    const { blueprint, changes } = normalizeBlueprint(makeBlueprint({ dimensions: { width: 100, height: 100, unit: "px", dpi: 150 } }));
    expect(blueprint.dimensions.dpi).toBe(150);
    expect(changes.some((c) => c.includes("dpi"))).toBe(false);
  });
});

// ── Zone sorting ──────────────────────────────────────────────────────────────

describe("normalizeBlueprint — zone sorting", () => {
  it("sorts zones by zIndex ascending", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({
      slots: [
        { id: "s-a", name: "A", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-b", name: "B", type: "text", required: false, maxItems: 1, constraints: {} },
        { id: "s-c", name: "C", type: "text", required: false, maxItems: 1, constraints: {} },
      ],
      zones: [
        { id: "z-c", name: "C", x: 0, y: 0, width: 10, height: 10, required: false, slotRefs: ["s-c"], zIndex: 3 },
        { id: "z-a", name: "A", x: 0, y: 0, width: 10, height: 10, required: true, slotRefs: ["s-a"], zIndex: 1 },
        { id: "z-b", name: "B", x: 0, y: 0, width: 10, height: 10, required: false, slotRefs: ["s-b"], zIndex: 2 },
      ],
      constraints: { allowZoneOverlap: true },
    }));
    expect(blueprint.zones.map((z) => z.id)).toEqual(["z-a", "z-b", "z-c"]);
  });

  it("sorts slotRefs within zones", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({
      slots: [
        { id: "s-z", name: "Z", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-a", name: "A", type: "text", required: false, maxItems: 1, constraints: {} },
      ],
      zones: [
        { id: "z-a", name: "A", x: 0, y: 0, width: 100, height: 100, required: true, slotRefs: ["s-z", "s-a"], zIndex: 1 },
      ],
    }));
    expect(blueprint.zones[0]!.slotRefs).toEqual(["s-a", "s-z"]);
  });
});

// ── Slot sorting ──────────────────────────────────────────────────────────────

describe("normalizeBlueprint — slot sorting", () => {
  it("sorts slots by id alphabetically", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({
      slots: [
        { id: "s-z", name: "Z", type: "text", required: false, maxItems: 1, constraints: {} },
        { id: "s-a", name: "A", type: "text", required: true, maxItems: 1, constraints: {} },
        { id: "s-m", name: "M", type: "image", required: false, maxItems: 1, constraints: {} },
      ],
    }));
    expect(blueprint.slots.map((s) => s.id)).toEqual(["s-a", "s-m", "s-z"]);
  });
});

// ── requiredData sorting ──────────────────────────────────────────────────────

describe("normalizeBlueprint — requiredData sorting", () => {
  it("sorts requiredData by key", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({
      requiredData: [
        { key: "zField", label: "Z", type: "string", required: false },
        { key: "aField", label: "A", type: "string", required: true },
      ],
    }));
    expect(blueprint.requiredData.map((d) => d.key)).toEqual(["aField", "zField"]);
  });
});

// ── outputCapabilities sorting ────────────────────────────────────────────────

describe("normalizeBlueprint — outputCapabilities sorting", () => {
  it("sorts output capabilities by format", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({
      outputCapabilities: [
        { format: "svg" },
        { format: "pdf" },
        { format: "png" },
      ],
    }));
    expect(blueprint.outputCapabilities.map((o) => o.format)).toEqual(["pdf", "png", "svg"]);
  });
});

// ── Whitespace trimming ───────────────────────────────────────────────────────

describe("normalizeBlueprint — whitespace trimming", () => {
  it("trims name and description", () => {
    const { blueprint } = normalizeBlueprint(makeBlueprint({ name: "  My Blueprint  ", description: "  A description.  " }));
    expect(blueprint.name).toBe("My Blueprint");
    expect(blueprint.description).toBe("A description.");
  });

  it("records change when name has leading whitespace", () => {
    const { changes } = normalizeBlueprint(makeBlueprint({ name: " Leading" }));
    expect(changes.some((c) => c.toLowerCase().includes("name"))).toBe(true);
  });
});

// ── schemaVersion ─────────────────────────────────────────────────────────────

describe("normalizeBlueprint — schemaVersion", () => {
  it("sets schemaVersion to 1.0 if wrong", () => {
    const { blueprint, changes } = normalizeBlueprint(makeBlueprint({ schemaVersion: "0.9" as any }));
    expect(blueprint.schemaVersion).toBe("1.0");
    expect(changes.some((c) => c.includes("schemaVersion"))).toBe(true);
  });
});

// ── updatedAt ─────────────────────────────────────────────────────────────────

describe("normalizeBlueprint — updatedAt", () => {
  it("sets updatedAt when provided", () => {
    const ts = "2030-01-01T00:00:00.000Z";
    const { blueprint } = normalizeBlueprint(makeBlueprint(), ts);
    expect(blueprint.updatedAt).toBe(ts);
  });
});
