/**
 * Tests: PropertySectionRegistry + PropertyFieldRendererRegistry
 *
 * Covers spec requirements:
 * 1. register section
 * 2. duplicate section rejection
 * 3. ordering
 * 4. visibility condition
 * 5. capability gating
 * 6. field renderer resolution
 * 7. unsupported field renderer
 * 19. plugin section
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PropertySectionRegistry, PropertyFieldRendererRegistry } from "../registry";
import type { PropertySectionDefinition, PropertyPanelContext } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<PropertyPanelContext> = {}): PropertyPanelContext {
  return {
    capabilities: [],
    isReadOnly: false,
    tenantId: "tenant-1",
    ...overrides,
  };
}

function makeSection(
  id: string,
  overrides: Partial<PropertySectionDefinition> = {},
): PropertySectionDefinition {
  return {
    id,
    label: `Section ${id}`,
    fields: [{ id: "f1", type: "text", label: "Field 1" }],
    ...overrides,
  };
}

// ── PropertySectionRegistry ───────────────────────────────────────────────────

describe("PropertySectionRegistry — register section", () => {
  it("registers a section and returns it via getSections", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("s1"));
    const sections = reg.getSections(makeCtx());
    expect(sections).toHaveLength(1);
    expect(sections[0]!.id).toBe("s1");
  });

  it("size reflects registered count", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("a"));
    reg.register(makeSection("b"));
    expect(reg.size).toBe(2);
  });
});

describe("PropertySectionRegistry — duplicate rejection", () => {
  it("throws on duplicate section ID", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("dup"));
    expect(() => reg.register(makeSection("dup"))).toThrow(
      /duplicate section id "dup"/i,
    );
  });

  it("does not throw for different IDs", () => {
    const reg = new PropertySectionRegistry();
    expect(() => {
      reg.register(makeSection("x"));
      reg.register(makeSection("y"));
    }).not.toThrow();
  });
});

describe("PropertySectionRegistry — ordering", () => {
  it("sorts by explicit order ascending", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("c", { order: 30 }));
    reg.register(makeSection("a", { order: 10 }));
    reg.register(makeSection("b", { order: 20 }));
    const ids = reg.getSections(makeCtx()).map((s) => s.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("uses registration order as tiebreaker when order is equal or absent", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("first"));
    reg.register(makeSection("second"));
    reg.register(makeSection("third"));
    const ids = reg.getSections(makeCtx()).map((s) => s.id);
    expect(ids).toEqual(["first", "second", "third"]);
  });

  it("explicit order wins over registration order", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("late", { order: 1 }));   // registered last but order=1
    reg.register(makeSection("early", { order: 5 }));
    const ids = reg.getSections(makeCtx()).map((s) => s.id);
    expect(ids[0]).toBe("late");
  });
});

describe("PropertySectionRegistry — visibility condition", () => {
  it("hides section when visible=false", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("hidden", { visible: false }));
    expect(reg.getSections(makeCtx())).toHaveLength(0);
  });

  it("shows section when visible=true", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("shown", { visible: true }));
    expect(reg.getSections(makeCtx())).toHaveLength(1);
  });

  it("evaluates dynamic visibility function", () => {
    const reg = new PropertySectionRegistry();
    reg.register(
      makeSection("dynamic", {
        visible: (ctx) => ctx.selectedElementId === "el-1",
      }),
    );
    expect(reg.getSections(makeCtx())).toHaveLength(0);
    expect(
      reg.getSections(makeCtx({ selectedElementId: "el-1" })),
    ).toHaveLength(1);
  });

  it("default (no visible property) shows the section", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("default-vis"));
    expect(reg.getSections(makeCtx())).toHaveLength(1);
  });
});

describe("PropertySectionRegistry — capability gating", () => {
  it("hides section when required capability is absent", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("gated", { capabilities: ["advanced-edit"] }));
    expect(reg.getSections(makeCtx({ capabilities: [] }))).toHaveLength(0);
  });

  it("shows section when required capability is present", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("gated", { capabilities: ["advanced-edit"] }));
    expect(
      reg.getSections(makeCtx({ capabilities: ["advanced-edit"] })),
    ).toHaveLength(1);
  });

  it("requires all listed capabilities", () => {
    const reg = new PropertySectionRegistry();
    reg.register(
      makeSection("multi-cap", { capabilities: ["cap-a", "cap-b"] }),
    );
    expect(
      reg.getSections(makeCtx({ capabilities: ["cap-a"] })),
    ).toHaveLength(0);
    expect(
      reg.getSections(makeCtx({ capabilities: ["cap-a", "cap-b"] })),
    ).toHaveLength(1);
  });
});

describe("PropertySectionRegistry — plugin section (test 19)", () => {
  it("plugin sections registered via register() appear alongside core sections", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("core-1", { order: 1 }));
    // Plugin registers its own section
    const pluginSection = makeSection("plugin-material", { order: 2, stability: "beta" });
    reg.register(pluginSection);
    const sections = reg.getSections(makeCtx());
    expect(sections).toHaveLength(2);
    expect(sections[1]!.id).toBe("plugin-material");
    expect(sections[1]!.stability).toBe("beta");
  });

  it("plugin section can use visibility conditions", () => {
    const reg = new PropertySectionRegistry();
    reg.register(
      makeSection("plugin-premium", {
        capabilities: ["premium"],
        stability: "experimental",
      }),
    );
    expect(reg.getSections(makeCtx({ capabilities: [] }))).toHaveLength(0);
    expect(
      reg.getSections(makeCtx({ capabilities: ["premium"] })),
    ).toHaveLength(1);
  });
});

describe("PropertySectionRegistry — unregister", () => {
  it("removes a section by ID", () => {
    const reg = new PropertySectionRegistry();
    reg.register(makeSection("to-remove"));
    reg.unregister("to-remove");
    expect(reg.getSections(makeCtx())).toHaveLength(0);
  });
});

// ── PropertyFieldRendererRegistry ─────────────────────────────────────────────

describe("PropertyFieldRendererRegistry — renderer resolution (test 6)", () => {
  it("resolves a registered renderer by type", () => {
    const reg = new PropertyFieldRendererRegistry();
    const renderer = { type: "text", render: () => null };
    reg.register(renderer);
    expect(reg.resolve("text")).toBe(renderer);
  });

  it("has() returns true for registered type", () => {
    const reg = new PropertyFieldRendererRegistry();
    reg.register({ type: "color", render: () => null });
    expect(reg.has("color")).toBe(true);
    expect(reg.has("unknown")).toBe(false);
  });
});

describe("PropertyFieldRendererRegistry — unsupported renderer (test 7)", () => {
  it("returns null for unknown type", () => {
    const reg = new PropertyFieldRendererRegistry();
    expect(reg.resolve("nonexistent-type")).toBeNull();
  });

  it("records a diagnostic for missing renderer", () => {
    const reg = new PropertyFieldRendererRegistry();
    reg.resolve("missing-type");
    const diag = reg.getDiagnostics();
    expect(diag.some((d) => d.includes("missing-type"))).toBe(true);
  });

  it("deduplicates diagnostics", () => {
    const reg = new PropertyFieldRendererRegistry();
    reg.resolve("missing-type");
    reg.resolve("missing-type");
    const diag = reg.getDiagnostics().filter((d) => d.includes("missing-type"));
    expect(diag).toHaveLength(1);
  });

  it("clearDiagnostics empties the list", () => {
    const reg = new PropertyFieldRendererRegistry();
    reg.resolve("x");
    reg.clearDiagnostics();
    expect(reg.getDiagnostics()).toHaveLength(0);
  });
});

describe("PropertyFieldRendererRegistry — overwrite", () => {
  it("last registration wins for same type", () => {
    const reg = new PropertyFieldRendererRegistry();
    const r1 = { type: "text", render: () => null };
    const r2 = { type: "text", render: () => null };
    reg.register(r1);
    reg.register(r2);
    expect(reg.resolve("text")).toBe(r2);
  });
});
