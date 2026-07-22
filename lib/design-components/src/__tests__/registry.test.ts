/**
 * Team 22 — Universal Design Component & Object Library
 * ComponentRegistry — 18 required test cases
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ComponentRegistry,
  ComponentRegistrationError,
} from "../registry.js";
import type {
  ComponentDefinition,
  ComponentInstantiationRequest,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeComponent(
  overrides: Partial<ComponentDefinition> = {},
): ComponentDefinition {
  return {
    id: "builtin:furniture/sofa",
    version: "1.0.0",
    label: "Sofa",
    description: "A reusable sofa component for interior design.",
    category: { id: "furniture", label: "Furniture" },
    source: { kind: "builtin" },
    status: "active",
    compatibility: {
      domains: ["interior"],
      requiredCapabilities: [],
      dependencies: [],
      incompatibleWith: [],
    },
    placement: { contexts: ["canvas", "layer"] },
    parameters: {
      material: {
        kind: "material_reference",
        label: "Material",
        required: false,
      },
      width: {
        kind: "number",
        label: "Width (mm)",
        required: true,
        min: 600,
        max: 4000,
      },
      style: {
        kind: "enum",
        label: "Style",
        required: false,
        options: [
          { value: "modern", label: "Modern" },
          { value: "classic", label: "Classic" },
        ],
      },
    },
    variants: [
      {
        id: "v-modern",
        label: "Modern",
        parameterOverrides: { style: "modern" },
        previewUrl: "https://cdn.example.com/sofa-modern.png",
      },
      {
        id: "v-classic",
        label: "Classic",
        parameterOverrides: { style: "classic" },
      },
    ],
    defaultVariantId: "v-modern",
    assets: [],
    tags: ["sofa", "seating", "furniture"],
    permissions: [],
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<ComponentInstantiationRequest> = {},
): ComponentInstantiationRequest {
  return {
    componentId: "builtin:furniture/sofa",
    targetArtifactId: "artifact-abc",
    parameters: { width: 1200 },
    requestedBy: "user-1",
    idempotencyKey: "idem-001",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ComponentRegistry", () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  // ── Test 1: component validation ─────────────────────────────────────────
  it("1. validates a well-formed ComponentDefinition on register", () => {
    const def = makeComponent();
    expect(() => registry.register(def)).not.toThrow();
    const resolved = registry.resolve("builtin:furniture/sofa");
    expect(resolved).toBeDefined();
    expect(resolved!.label).toBe("Sofa");
    expect(resolved!.status).toBe("active");
  });

  it("1b. rejects a component with empty ID", () => {
    const def = makeComponent({ id: "   " });
    expect(() => registry.register(def)).toThrow(ComponentRegistrationError);
  });

  // ── Test 2: duplicate ID ─────────────────────────────────────────────────
  it("2. rejects a duplicate (id + version) combination", () => {
    registry.register(makeComponent());
    expect(() => registry.register(makeComponent())).toThrow(
      ComponentRegistrationError,
    );
    expect(() => registry.register(makeComponent())).toThrow(
      /version "1.0.0" is already registered/,
    );
  });

  it("2b. allows the same ID with a different version", () => {
    registry.register(makeComponent({ version: "1.0.0" }));
    expect(() =>
      registry.register(makeComponent({ version: "2.0.0" })),
    ).not.toThrow();
    expect(registry.listVersions("builtin:furniture/sofa")).toHaveLength(2);
  });

  // ── Test 3: version selection ─────────────────────────────────────────────
  it("3. resolves the latest version when version is omitted", () => {
    registry.register(makeComponent({ version: "1.0.0" }));
    registry.register(makeComponent({ version: "1.2.0" }));
    registry.register(makeComponent({ version: "1.1.0" }));
    const resolved = registry.resolve("builtin:furniture/sofa");
    expect(resolved!.version).toBe("1.2.0");
  });

  it("3b. resolves an exact version when specified", () => {
    registry.register(makeComponent({ version: "1.0.0" }));
    registry.register(makeComponent({ version: "2.0.0" }));
    const resolved = registry.resolve("builtin:furniture/sofa", "1.0.0");
    expect(resolved!.version).toBe("1.0.0");
  });

  it("3c. returns undefined for an unknown version", () => {
    registry.register(makeComponent({ version: "1.0.0" }));
    expect(registry.resolve("builtin:furniture/sofa", "9.9.9")).toBeUndefined();
  });

  // ── Test 4: variant selection ─────────────────────────────────────────────
  it("4. resolves a variant by ID", () => {
    registry.register(makeComponent());
    const variant = registry.resolveVariant(
      "builtin:furniture/sofa",
      "v-modern",
    );
    expect(variant).toBeDefined();
    expect(variant!.label).toBe("Modern");
    expect(variant!.parameterOverrides.style).toBe("modern");
  });

  it("4b. returns undefined for a missing variant ID", () => {
    registry.register(makeComponent());
    expect(
      registry.resolveVariant("builtin:furniture/sofa", "v-nonexistent"),
    ).toBeUndefined();
  });

  it("4c. returns undefined when component itself is not found", () => {
    expect(
      registry.resolveVariant("not:registered/comp", "v-a"),
    ).toBeUndefined();
  });

  // ── Test 5: parameter validation ─────────────────────────────────────────
  it("5. flags missing required parameter in instantiation request", () => {
    registry.register(makeComponent());
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: {} }), // width is required
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "parameters")).toBe(true);
    expect(result.issues[0]!.message).toMatch(/width/);
  });

  it("5b. passes validation when all required parameters are present", () => {
    registry.register(makeComponent());
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── Test 6: dependency validation ─────────────────────────────────────────
  it("6. reports missing dependencies", () => {
    registry.register(
      makeComponent({
        id: "builtin:room/layout",
        compatibility: {
          domains: ["interior"],
          requiredCapabilities: [],
          dependencies: ["builtin:furniture/sofa"], // not yet registered
          incompatibleWith: [],
        },
      }),
    );
    const missing = registry.validateDependencies("builtin:room/layout");
    expect(missing).toContain("builtin:furniture/sofa");
  });

  it("6b. reports no issues when all dependencies are active", () => {
    registry.register(makeComponent()); // sofa is active
    registry.register(
      makeComponent({
        id: "builtin:room/layout",
        compatibility: {
          domains: ["interior"],
          requiredCapabilities: [],
          dependencies: ["builtin:furniture/sofa"],
          incompatibleWith: [],
        },
      }),
    );
    const missing = registry.validateDependencies("builtin:room/layout");
    expect(missing).toHaveLength(0);
  });

  it("6c. treats an unavailable dependency as missing", () => {
    registry.register(makeComponent({ status: "unavailable" })); // sofa unavailable
    registry.register(
      makeComponent({
        id: "builtin:room/layout",
        compatibility: {
          domains: ["interior"],
          requiredCapabilities: [],
          dependencies: ["builtin:furniture/sofa"],
          incompatibleWith: [],
        },
      }),
    );
    const missing = registry.validateDependencies("builtin:room/layout");
    expect(missing).toContain("builtin:furniture/sofa");
  });

  // ── Test 7: compatibility filter ─────────────────────────────────────────
  it("7. filterByCompatibility returns only domain-matching components", () => {
    registry.register(makeComponent()); // interior domain
    registry.register(
      makeComponent({
        id: "builtin:garment/body-panel",
        compatibility: {
          domains: ["fashion"],
          requiredCapabilities: [],
          dependencies: [],
          incompatibleWith: [],
        },
      }),
    );
    const interior = registry.filterByCompatibility("interior");
    expect(interior.map((d) => d.id)).toContain("builtin:furniture/sofa");
    expect(interior.map((d) => d.id)).not.toContain(
      "builtin:garment/body-panel",
    );
  });

  it("7b. filterByCompatibility respects required capabilities", () => {
    registry.register(
      makeComponent({
        id: "builtin:room/3d-view",
        compatibility: {
          domains: ["interior"],
          requiredCapabilities: ["3d-rendering"],
          dependencies: [],
          incompatibleWith: [],
        },
      }),
    );
    const without3d = registry.filterByCompatibility("interior", []);
    expect(without3d.map((d) => d.id)).not.toContain("builtin:room/3d-view");

    const with3d = registry.filterByCompatibility("interior", ["3d-rendering"]);
    expect(with3d.map((d) => d.id)).toContain("builtin:room/3d-view");
  });

  // ── Test 8: browser search ────────────────────────────────────────────────
  it("8. search finds a component by label substring", () => {
    registry.register(makeComponent()); // "Sofa"
    registry.register(
      makeComponent({
        id: "builtin:furniture/table",
        label: "Dining Table",
        description: "A table for dining rooms.",
        tags: ["table", "furniture"],
      }),
    );
    const results = registry.search("sofa");
    expect(results.map((d) => d.id)).toContain("builtin:furniture/sofa");
    expect(results.map((d) => d.id)).not.toContain("builtin:furniture/table");
  });

  it("8b. search finds a component by tag", () => {
    registry.register(makeComponent()); // tags: ["sofa", "seating", "furniture"]
    const results = registry.search("seating");
    expect(results.map((d) => d.id)).toContain("builtin:furniture/sofa");
  });

  it("8c. search returns all components when query is empty", () => {
    registry.register(makeComponent());
    registry.register(
      makeComponent({ id: "builtin:furniture/table", label: "Table", tags: [] }),
    );
    expect(registry.search("")).toHaveLength(2);
  });

  // ── Test 9: source filter ────────────────────────────────────────────────
  it("9. listBySource returns only builtin components", () => {
    registry.register(makeComponent({ source: { kind: "builtin" } }));
    registry.register(
      makeComponent({
        id: "acme-plugin:ring/solitaire",
        source: { kind: "plugin", pluginId: "acme-plugin" },
      }),
    );
    const builtins = registry.listBySource("builtin");
    expect(builtins.every((d) => d.source.kind === "builtin")).toBe(true);
    expect(builtins.map((d) => d.id)).not.toContain("acme-plugin:ring/solitaire");
  });

  it("9b. listBySource with pluginId narrows to that plugin only", () => {
    registry.register(
      makeComponent({
        id: "acme-plugin:ring/solitaire",
        source: { kind: "plugin", pluginId: "acme-plugin" },
      }),
    );
    registry.register(
      makeComponent({
        id: "other-plugin:gem/diamond",
        source: { kind: "plugin", pluginId: "other-plugin" },
      }),
    );
    const acme = registry.listBySource("plugin", "acme-plugin");
    expect(acme.map((d) => d.id)).toContain("acme-plugin:ring/solitaire");
    expect(acme.map((d) => d.id)).not.toContain("other-plugin:gem/diamond");
  });

  // ── Test 10: unavailable component ───────────────────────────────────────
  it("10. unavailable component is surfaced by listAll but blocked in instantiation", () => {
    registry.register(makeComponent({ status: "unavailable" }));

    // Still in listAll (browser can show disabled state)
    const all = registry.listAll();
    expect(all.some((d) => d.id === "builtin:furniture/sofa")).toBe(true);

    // Instantiation validation rejects it
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "componentId")).toBe(true);
    expect(result.issues[0]!.message).toMatch(/unavailable/);
  });

  // ── Test 11: deprecated component ────────────────────────────────────────
  it("11. deprecated component is resolvable and flagged", () => {
    registry.register(
      makeComponent({
        status: "deprecated",
        deprecationMessage: "Use builtin:furniture/sofa-v2 instead.",
        deprecatedSince: "2.0.0",
        replacedBy: "builtin:furniture/sofa-v2",
      }),
    );
    const def = registry.resolve("builtin:furniture/sofa");
    expect(def).toBeDefined();
    expect(def!.status).toBe("deprecated");
    expect(def!.deprecationMessage).toBeTruthy();
    expect(def!.replacedBy).toBe("builtin:furniture/sofa-v2");

    // Deprecated component CAN still be instantiated (caller decides)
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
    );
    expect(result.valid).toBe(true);
  });

  // ── Test 12: instantiation request ───────────────────────────────────────
  it("12. validates a complete instantiation request successfully", () => {
    registry.register(makeComponent());
    const result = registry.validateInstantiationRequest(
      makeRequest({
        variantId: "v-classic",
        parameters: { width: 1800 },
        transform: { x: 100, y: 200, rotation: 45 },
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  // ── Test 13: invalid parameters ──────────────────────────────────────────
  it("13. rejects request with missing required parameters", () => {
    registry.register(makeComponent()); // width is required
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { style: "modern" } }), // no width
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.message).toMatch(/width/);
  });

  it("13b. rejects request missing componentId", () => {
    const result = registry.validateInstantiationRequest(
      makeRequest({ componentId: "" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.field).toBe("componentId");
  });

  it("13c. rejects request for unknown component", () => {
    const result = registry.validateInstantiationRequest(
      makeRequest({ componentId: "not:registered/comp" }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.field).toBe("componentId");
    expect(result.issues[0]!.message).toMatch(/not registered/);
  });

  // ── Test 14: duplicate idempotency key boundary ───────────────────────────
  it("14. checkAndMarkIdempotencyKey detects a duplicate key", () => {
    const isFirst = registry.checkAndMarkIdempotencyKey("idem-abc");
    expect(isFirst).toBe(false); // first time — not a duplicate

    const isDuplicate = registry.checkAndMarkIdempotencyKey("idem-abc");
    expect(isDuplicate).toBe(true); // second time — duplicate

    // Different key is fresh
    expect(registry.checkAndMarkIdempotencyKey("idem-xyz")).toBe(false);
  });

  it("14b. hasIdempotencyKey reflects marking state without side effects", () => {
    expect(registry.hasIdempotencyKey("idem-peek")).toBe(false);
    registry.checkAndMarkIdempotencyKey("idem-peek");
    expect(registry.hasIdempotencyKey("idem-peek")).toBe(true);
  });

  // ── Test 15: unsafe schema rejection ──────────────────────────────────────
  it("15. rejects a component with a plugin_schema_reference containing exec in schemaId", () => {
    const unsafe = makeComponent({
      id: "bad-plugin:unsafe/comp",
      parameters: {
        config: {
          kind: "plugin_schema_reference",
          label: "Config",
          schemaId: "exec:run-arbitrary-code",
          pluginId: "bad-plugin",
        },
      },
    });
    expect(() => registry.register(unsafe)).toThrow(ComponentRegistrationError);
    expect(() => registry.register(unsafe)).toThrow(/unsafe/i);
  });

  it("15b. rejects a plugin schema reference with eval in pluginId", () => {
    const unsafe = makeComponent({
      id: "eval-plugin:dangerous/thing",
      parameters: {
        logic: {
          kind: "plugin_schema_reference",
          label: "Logic",
          schemaId: "logic-schema/v1",
          pluginId: "eval-helper",
        },
      },
    });
    expect(() => registry.register(unsafe)).toThrow(ComponentRegistrationError);
  });

  it("15c. accepts a safe plugin_schema_reference", () => {
    const safe = makeComponent({
      id: "safe-plugin:complex/config",
      parameters: {
        fabricSpec: {
          kind: "plugin_schema_reference",
          label: "Fabric Spec",
          schemaId: "acme-plugin:fabric-spec/v2",
          pluginId: "acme-plugin",
        },
      },
    });
    expect(() => registry.register(safe)).not.toThrow();
  });

  // ── Test 16: permission ───────────────────────────────────────────────────
  it("16. rejects instantiation when caller lacks required permissions", () => {
    registry.register(
      makeComponent({ permissions: ["premium:jewelry-3d"] }),
    );
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
      [], // caller has no permissions
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === "permissions")).toBe(true);
    expect(result.issues[0]!.message).toMatch(/premium:jewelry-3d/);
  });

  it("16b. allows instantiation when caller holds required permissions", () => {
    registry.register(
      makeComponent({ permissions: ["premium:jewelry-3d"] }),
    );
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
      ["premium:jewelry-3d", "other-permission"],
    );
    expect(result.valid).toBe(true);
  });

  it("16c. allows instantiation when component has no permissions set", () => {
    registry.register(makeComponent({ permissions: [] }));
    const result = registry.validateInstantiationRequest(
      makeRequest({ parameters: { width: 1200 } }),
      [],
    );
    expect(result.valid).toBe(true);
  });

  // ── Test 17: plugin contribution ─────────────────────────────────────────
  it("17. plugin can register multiple components via registerAll", () => {
    const pluginComponents: ComponentDefinition[] = [
      makeComponent({
        id: "acme-plugin:ring/solitaire",
        source: { kind: "plugin", pluginId: "acme-plugin", pluginVersion: "1.0.0" },
        label: "Solitaire Ring",
      }),
      makeComponent({
        id: "acme-plugin:ring/halo",
        source: { kind: "plugin", pluginId: "acme-plugin", pluginVersion: "1.0.0" },
        label: "Halo Ring",
      }),
    ];
    registry.registerAll(pluginComponents);

    const plugin = registry.listBySource("plugin", "acme-plugin");
    expect(plugin).toHaveLength(2);
    expect(plugin.map((d) => d.id)).toContain("acme-plugin:ring/solitaire");
    expect(plugin.map((d) => d.id)).toContain("acme-plugin:ring/halo");
  });

  it("17b. stats correctly reflect plugin contributions", () => {
    registry.register(makeComponent({ source: { kind: "builtin" } }));
    registry.register(
      makeComponent({
        id: "acme-plugin:comp/a",
        source: { kind: "plugin", pluginId: "acme-plugin" },
      }),
    );
    const s = registry.stats();
    expect(s.bySource.builtin).toBe(1);
    expect(s.bySource.plugin).toBe(1);
  });

  // ── Test 18: no domain-specific core fields ───────────────────────────────
  it("18. core ComponentDefinition type has no hardcoded domain enum — domains are open strings", () => {
    // Register components with arbitrary domain strings (not graphic/interior/fashion/packaging)
    const archComp = makeComponent({
      id: "builtin:arch/column",
      label: "Architectural Column",
      category: { id: "architectural", label: "Architectural Elements" },
      compatibility: {
        domains: ["architecture", "landscape"],  // non-hardcoded domains
        requiredCapabilities: [],
        dependencies: [],
        incompatibleWith: [],
      },
    });
    expect(() => registry.register(archComp)).not.toThrow();

    const jewelryComp = makeComponent({
      id: "builtin:jewelry/gem",
      label: "Gemstone",
      category: { id: "jewelry", label: "Jewelry Components" },
      compatibility: {
        domains: ["jewelry", "product-design", "packaging"], // cross-domain
        requiredCapabilities: [],
        dependencies: [],
        incompatibleWith: [],
      },
    });
    expect(() => registry.register(jewelryComp)).not.toThrow();

    // Domain filter works with custom domain names
    const archResults = registry.filterByCompatibility("architecture");
    expect(archResults.map((d) => d.id)).toContain("builtin:arch/column");

    const jewelryResults = registry.filterByCompatibility("jewelry");
    expect(jewelryResults.map((d) => d.id)).toContain("builtin:jewelry/gem");
  });

  // ── filter() API (browser integration) ───────────────────────────────────
  it("filter() combines domain + source + query", () => {
    registry.register(makeComponent()); // interior builtin
    registry.register(
      makeComponent({
        id: "acme-plugin:ring/solitaire",
        label: "Solitaire Ring",
        source: { kind: "plugin", pluginId: "acme-plugin" },
        compatibility: {
          domains: ["jewelry"],
          requiredCapabilities: [],
          dependencies: [],
          incompatibleWith: [],
        },
        tags: ["ring", "jewelry"],
      }),
    );

    const interiorBuiltin = registry.filter({
      domain: "interior",
      sourceKind: "builtin",
    });
    expect(interiorBuiltin.map((d) => d.id)).toContain(
      "builtin:furniture/sofa",
    );
    expect(interiorBuiltin.map((d) => d.id)).not.toContain(
      "acme-plugin:ring/solitaire",
    );

    const ringSearch = registry.filter({ query: "ring", domain: "jewelry" });
    expect(ringSearch.map((d) => d.id)).toContain("acme-plugin:ring/solitaire");
  });
});
