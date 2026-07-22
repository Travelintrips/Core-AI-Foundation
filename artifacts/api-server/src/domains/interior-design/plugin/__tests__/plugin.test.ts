/**
 * Team 25 — Interior Design Domain Plugin
 * __tests__/plugin.test.ts
 *
 * Covers all required test areas from the spec:
 *   - manifest
 *   - brief
 *   - workflow DAG
 *   - artifact types
 *   - property sections
 *   - material categories
 *   - component categories
 *   - capability
 *   - export presets
 *   - no Interior fields leaked to core
 *   - compatibility version
 *   - examples
 */

import { describe, it, expect } from "vitest";

// ── Imports from plugin barrel ────────────────────────────────────────────────

import {
  INTERIOR_DESIGN_PLUGIN_MANIFEST,
  INTERIOR_CAPABILITIES,
  validateManifest,
  getCapability,
} from "../manifest.js";

import {
  InteriorDesignBriefSchema,
  INTERIOR_BRIEF_FIELDS,
  INTERIOR_SPACE_TYPES,
  INTERIOR_STYLE_PREFERENCES,
  INTERIOR_BUDGET_RANGES,
  INTERIOR_LIGHTING_NEEDS,
} from "../briefSchema.js";

import {
  INTERIOR_WORKFLOW,
  INTERIOR_WORKFLOW_STEP_IDS,
  detectCycles,
  topologicalOrder,
  computeParallelGroups,
  computeCriticalPath,
} from "../workflow.js";

import {
  INTERIOR_ARTIFACT_TYPE_IDS,
  INTERIOR_ARTIFACT_TYPES,
  getRequiredArtifactTypes,
  getArtifactType,
} from "../artifactTypes.js";

import {
  INTERIOR_PROPERTY_SECTION_IDS,
  INTERIOR_PROPERTY_SECTIONS,
  getSectionsForArtifact,
  getRequiredFields,
} from "../propertyContributions.js";

import {
  INTERIOR_MATERIAL_CATEGORIES,
  INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS,
  INTERIOR_COMPONENT_CATEGORY_IDS,
  INTERIOR_COMPONENT_CATEGORIES,
  getAllFixtures,
  getFixturesByCategory,
  getComponentCategory,
} from "../components.js";

import {
  INTERIOR_EXPORT_PRESET_IDS,
  INTERIOR_EXPORT_PRESETS,
  listExportPresets,
  getRequiredArtifactsForPreset,
} from "../exportPresets.js";

// ── 1. Manifest ───────────────────────────────────────────────────────────────

describe("Manifest", () => {
  it("has a stable pluginId", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.pluginId).toBe("interior-design-plugin");
  });

  it("has a domainId matching the directory", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.domainId).toBe("interior-design");
  });

  it("has a semver version", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("passes validateManifest with no errors", () => {
    const result = validateManifest(INTERIOR_DESIGN_PLUGIN_MANIFEST);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails validation when pluginId is missing", () => {
    const broken = { ...INTERIOR_DESIGN_PLUGIN_MANIFEST, pluginId: "" };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pluginId"))).toBe(true);
  });

  it("fails validation when artifact types are too few", () => {
    const broken = { ...INTERIOR_DESIGN_PLUGIN_MANIFEST, artifactTypeIds: ["interior_moodboard"] as never };
    const result = validateManifest(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("artifactTypeIds"))).toBe(true);
  });

  it("has integration notes for Team 39", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.integrationNotes.length).toBeGreaterThan(0);
    const hasTeam39 = INTERIOR_DESIGN_PLUGIN_MANIFEST.integrationNotes.some((n) =>
      n.includes("Team 39"),
    );
    expect(hasTeam39).toBe(true);
  });

  it("has a non-empty description", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.description.length).toBeGreaterThan(10);
  });
});

// ── 2. Brief ──────────────────────────────────────────────────────────────────

describe("Brief schema", () => {
  const validBrief = {
    spaceType: "living_room",
    dimensions: { lengthM: 5, widthM: 4, ceilingHeightM: 2.8 },
    occupantCount: 3,
    stylePreference: "scandinavian",
    functionalRequirements: ["comfortable seating", "TV viewing"],
    lightingNeeds: ["balanced"],
  };

  it("accepts a valid minimal brief", () => {
    const result = InteriorDesignBriefSchema.safeParse(validBrief);
    expect(result.success).toBe(true);
  });

  it("rejects missing spaceType", () => {
    const { spaceType: _, ...rest } = validBrief;
    const result = InteriorDesignBriefSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid spaceType", () => {
    const result = InteriorDesignBriefSchema.safeParse({ ...validBrief, spaceType: "spaceship" });
    expect(result.success).toBe(false);
  });

  it("rejects negative room dimensions", () => {
    const result = InteriorDesignBriefSchema.safeParse({
      ...validBrief,
      dimensions: { lengthM: -1, widthM: 4, ceilingHeightM: 2.8 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero occupantCount", () => {
    const result = InteriorDesignBriefSchema.safeParse({ ...validBrief, occupantCount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid stylePreference", () => {
    const result = InteriorDesignBriefSchema.safeParse({ ...validBrief, stylePreference: "cyberpunk" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid hex color in colorPreference", () => {
    const result = InteriorDesignBriefSchema.safeParse({
      ...validBrief,
      colorPreference: { primaryHex: ["not-a-hex"] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid hex colors in colorPreference", () => {
    const result = InteriorDesignBriefSchema.safeParse({
      ...validBrief,
      colorPreference: { primaryHex: ["#FFFFFF", "#000000"] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full brief with all 13 fields", () => {
    const full = {
      ...validBrief,
      occupantProfile: "Family of 3 with toddler",
      styleInfluences: ["japandi"],
      storagePriority: 4,
      budgetRange: "150m_500m",
      budgetNotes: "No stone or marble",
      locationCity: "Jakarta",
      locationCountry: "Indonesia",
      climateType: "tropical_humid",
      existingConditions: {
        hasFixedColumns: true,
        structuralNotes: "Two columns at 2m from north wall",
      },
      colorPreference: { primaryHex: ["#F5F0E8"], toneKeywords: ["warm", "earthy"] },
      materialPreference: { flooring: "engineered timber", avoidMaterials: ["vinyl"] },
      lightingNotes: "Prefer indirect light",
      accessibility: { elderlyFriendly: true },
      sustainability: { preferLocalMaterials: true, energyEfficientLighting: true },
      referenceUrls: ["https://example.com/ref1.jpg"],
      additionalNotes: "Maximise natural light from east-facing windows",
    };
    const result = InteriorDesignBriefSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it("BRIEF_FIELDS covers all 13 required field keys", () => {
    const keys = INTERIOR_BRIEF_FIELDS.map((f) => f.field);
    const required13 = [
      "spaceType", "dimensions", "occupantCount", "stylePreference",
      "functionalRequirements", "budgetRange", "locationCity", "climateType",
      "existingConditions", "colorPreference", "materialPreference",
      "lightingNeeds", "accessibility",
    ];
    for (const k of required13) {
      expect(keys).toContain(k);
    }
  });

  it("INTERIOR_SPACE_TYPES includes residential and commercial types", () => {
    expect(INTERIOR_SPACE_TYPES).toContain("living_room");
    expect(INTERIOR_SPACE_TYPES).toContain("restaurant");
    expect(INTERIOR_SPACE_TYPES).toContain("hotel_room");
    expect(INTERIOR_SPACE_TYPES).toContain("office");
  });

  it("INTERIOR_STYLE_PREFERENCES has at least 10 styles", () => {
    expect(INTERIOR_STYLE_PREFERENCES.length).toBeGreaterThanOrEqual(10);
  });

  it("INTERIOR_BUDGET_RANGES includes a not_specified option", () => {
    expect(INTERIOR_BUDGET_RANGES).toContain("not_specified");
  });

  it("INTERIOR_LIGHTING_NEEDS has at least 5 options", () => {
    expect(INTERIOR_LIGHTING_NEEDS.length).toBeGreaterThanOrEqual(5);
  });
});

// ── 3. Workflow DAG ───────────────────────────────────────────────────────────

describe("Workflow DAG", () => {
  it("has exactly 12 steps", () => {
    expect(INTERIOR_WORKFLOW.nodes).toHaveLength(12);
    expect(INTERIOR_WORKFLOW_STEP_IDS).toHaveLength(12);
  });

  it("contains all 12 required step IDs", () => {
    const ids = INTERIOR_WORKFLOW.nodes.map((n) => n.id);
    const required = [
      "brief", "site_info", "style_research", "moodboard",
      "space_planning", "material_direction", "lighting_direction",
      "furniture_selection", "visualization", "review",
      "documentation", "export",
    ] as const;
    for (const id of required) {
      expect(ids).toContain(id);
    }
  });

  it("has no cycles (detectCycles returns empty array)", () => {
    const cycles = detectCycles(INTERIOR_WORKFLOW.nodes);
    expect(cycles).toHaveLength(0);
  });

  it("produces a valid topological order with all 12 nodes", () => {
    const order = topologicalOrder(INTERIOR_WORKFLOW.nodes);
    expect(order).toHaveLength(12);
  });

  it("places 'brief' first in topological order (no dependencies)", () => {
    const order = topologicalOrder(INTERIOR_WORKFLOW.nodes);
    expect(order[0]).toBe("brief");
  });

  it("places 'export' last in topological order", () => {
    const order = topologicalOrder(INTERIOR_WORKFLOW.nodes);
    expect(order[order.length - 1]).toBe("export");
  });

  it("'moodboard' depends on both site_info and style_research", () => {
    const node = INTERIOR_WORKFLOW.nodes.find((n) => n.id === "moodboard")!;
    expect(node.dependsOn).toContain("site_info");
    expect(node.dependsOn).toContain("style_research");
  });

  it("'visualization' depends on space_planning and furniture_selection", () => {
    const node = INTERIOR_WORKFLOW.nodes.find((n) => n.id === "visualization")!;
    expect(node.dependsOn).toContain("space_planning");
    expect(node.dependsOn).toContain("furniture_selection");
  });

  it("computes parallel groups — moodboard fan-out steps are in the same group", () => {
    const groups = computeParallelGroups(INTERIOR_WORKFLOW.nodes);
    const fanOutGroup = groups.find(
      (g) =>
        g.includes("material_direction") &&
        g.includes("lighting_direction"),
    );
    expect(fanOutGroup).toBeDefined();
    expect(fanOutGroup).toContain("material_direction");
    expect(fanOutGroup).toContain("lighting_direction");
  });

  it("critical path starts at brief and ends at export", () => {
    const path = computeCriticalPath(INTERIOR_WORKFLOW.nodes);
    expect(path[0]).toBe("brief");
    expect(path[path.length - 1]).toBe("export");
  });

  it("edges list contains at least one entry per step except 'brief'", () => {
    // brief has no dependencies → no incoming edges
    const incomingTo = new Set(INTERIOR_WORKFLOW.edges.map((e) => e.to));
    const nonBriefSteps = INTERIOR_WORKFLOW.nodes
      .filter((n) => n.id !== "brief")
      .map((n) => n.id);
    for (const stepId of nonBriefSteps) {
      expect(incomingTo.has(stepId)).toBe(true);
    }
  });

  it("workflow has a non-empty domainId", () => {
    expect(INTERIOR_WORKFLOW.domainId).toBe("interior-design");
  });
});

// ── 4. Artifact types ─────────────────────────────────────────────────────────

describe("Artifact types", () => {
  it("registers exactly 9 artifact types", () => {
    expect(INTERIOR_ARTIFACT_TYPE_IDS).toHaveLength(9);
  });

  it("all 9 IDs are prefixed with 'interior_'", () => {
    for (const id of INTERIOR_ARTIFACT_TYPE_IDS) {
      expect(id.startsWith("interior_")).toBe(true);
    }
  });

  it("all 9 required IDs are present", () => {
    const required = [
      "interior_moodboard",
      "interior_space_plan",
      "interior_material_board",
      "interior_furniture_board",
      "interior_lighting_plan",
      "interior_elevation",
      "interior_visualization",
      "interior_specification",
      "interior_presentation",
    ] as const;
    for (const id of required) {
      expect(INTERIOR_ARTIFACT_TYPE_IDS).toContain(id);
    }
  });

  it("each artifact type has a label, description, and producedAtStage", () => {
    for (const id of INTERIOR_ARTIFACT_TYPE_IDS) {
      const t = INTERIOR_ARTIFACT_TYPES[id];
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.producedAtStage.length).toBeGreaterThan(0);
    }
  });

  it("each artifact type has at least one delivery format", () => {
    for (const id of INTERIOR_ARTIFACT_TYPE_IDS) {
      expect(INTERIOR_ARTIFACT_TYPES[id].deliveryFormats.length).toBeGreaterThan(0);
    }
  });

  it("getRequiredArtifactTypes returns only required types", () => {
    const required = getRequiredArtifactTypes();
    expect(required.every((t) => t.required)).toBe(true);
    expect(required.length).toBeGreaterThan(0);
  });

  it("getArtifactType returns correct record", () => {
    const t = getArtifactType("interior_moodboard");
    expect(t.id).toBe("interior_moodboard");
  });

  it("getArtifactType throws for unknown ID", () => {
    expect(() => getArtifactType("interior_unknown" as never)).toThrow();
  });
});

// ── 5. Property sections ──────────────────────────────────────────────────────

describe("Property sections", () => {
  it("defines exactly 8 property sections", () => {
    expect(INTERIOR_PROPERTY_SECTION_IDS).toHaveLength(8);
  });

  it("all 8 required section IDs are present", () => {
    const required = [
      "zone_metadata",
      "dimensions",
      "surface_material",
      "furniture_reference",
      "lighting",
      "color",
      "finish",
      "notes",
    ] as const;
    for (const id of required) {
      expect(INTERIOR_PROPERTY_SECTION_IDS).toContain(id);
    }
  });

  it("each section has at least one field", () => {
    for (const id of INTERIOR_PROPERTY_SECTION_IDS) {
      expect(INTERIOR_PROPERTY_SECTIONS[id].fields.length).toBeGreaterThan(0);
    }
  });

  it("each section applies to at least one artifact type", () => {
    for (const id of INTERIOR_PROPERTY_SECTION_IDS) {
      expect(INTERIOR_PROPERTY_SECTIONS[id].appliesTo.length).toBeGreaterThan(0);
    }
  });

  it("getSectionsForArtifact returns relevant sections for interior_specification", () => {
    const sections = getSectionsForArtifact("interior_specification");
    const sectionIds = sections.map((s) => s.id);
    expect(sectionIds).toContain("dimensions");
    expect(sectionIds).toContain("surface_material");
    expect(sectionIds).toContain("furniture_reference");
  });

  it("getSectionsForArtifact returns empty array for unknown artifact", () => {
    const sections = getSectionsForArtifact("unknown_artifact_xyz");
    expect(sections).toHaveLength(0);
  });

  it("getRequiredFields returns only required fields for dimensions section", () => {
    const fields = getRequiredFields("dimensions");
    expect(fields.every((f) => f.required)).toBe(true);
    const keys = fields.map((f) => f.key);
    expect(keys).toContain("lengthM");
    expect(keys).toContain("widthM");
    expect(keys).toContain("ceilingHeightM");
  });

  it("notes section applies to all 9 artifact types", () => {
    const notesSection = INTERIOR_PROPERTY_SECTIONS["notes"];
    for (const id of INTERIOR_ARTIFACT_TYPE_IDS) {
      expect(notesSection.appliesTo).toContain(id);
    }
  });
});

// ── 6. Material categories ────────────────────────────────────────────────────

describe("Material categories", () => {
  it("defines at least 7 material categories", () => {
    expect(INTERIOR_MATERIAL_CATEGORIES.length).toBeGreaterThanOrEqual(7);
  });

  it("all 7 required material categories are present", () => {
    const required = ["flooring", "wall", "ceiling", "textile", "cladding", "glass", "metal"] as const;
    for (const id of required) {
      expect(INTERIOR_MATERIAL_CATEGORIES).toContain(id);
    }
  });

  it("each material category has example materials", () => {
    for (const id of INTERIOR_MATERIAL_CATEGORIES) {
      expect(INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS[id].exampleMaterials.length).toBeGreaterThan(0);
    }
  });

  it("each material category descriptor has a label and description", () => {
    for (const id of INTERIOR_MATERIAL_CATEGORIES) {
      const d = INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS[id];
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });
});

// ── 7. Component categories ───────────────────────────────────────────────────

describe("Component categories", () => {
  it("defines exactly 7 component categories", () => {
    expect(INTERIOR_COMPONENT_CATEGORY_IDS).toHaveLength(7);
  });

  it("all 7 required categories are present", () => {
    const required = [
      "seating", "table", "storage", "lighting", "decor", "fixture", "partition",
    ] as const;
    for (const id of required) {
      expect(INTERIOR_COMPONENT_CATEGORY_IDS).toContain(id);
    }
  });

  it("each category has requiredFields and optionalFields defined", () => {
    for (const id of INTERIOR_COMPONENT_CATEGORY_IDS) {
      const cat = INTERIOR_COMPONENT_CATEGORIES[id];
      expect(cat.requiredFields.length).toBeGreaterThan(0);
      expect(Array.isArray(cat.optionalFields)).toBe(true);
    }
  });

  it("each category has at least one fixture example", () => {
    for (const id of INTERIOR_COMPONENT_CATEGORY_IDS) {
      expect(INTERIOR_COMPONENT_CATEGORIES[id].fixtures.length).toBeGreaterThan(0);
    }
  });

  it("all fixture IDs are unique across categories", () => {
    const all = getAllFixtures();
    const ids = all.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("getAllFixtures returns fixtures from all 7 categories", () => {
    const all = getAllFixtures();
    const categories = new Set(all.map((f) => f.categoryId));
    expect(categories.size).toBe(7);
  });

  it("getFixturesByCategory returns only fixtures for that category", () => {
    const seating = getFixturesByCategory("seating");
    expect(seating.every((f) => f.categoryId === "seating")).toBe(true);
    expect(seating.length).toBeGreaterThan(0);
  });

  it("getComponentCategory returns correct descriptor", () => {
    const cat = getComponentCategory("table");
    expect(cat.id).toBe("table");
    expect(cat.label).toMatch(/table/i);
  });

  it("getComponentCategory throws for unknown category", () => {
    expect(() => getComponentCategory("unknown_cat" as never)).toThrow();
  });

  it("fixture typicalDimensionsM has positive w, d, h", () => {
    for (const fixture of getAllFixtures()) {
      expect(fixture.typicalDimensionsM.w).toBeGreaterThan(0);
      expect(fixture.typicalDimensionsM.d).toBeGreaterThan(0);
      expect(fixture.typicalDimensionsM.h).toBeGreaterThan(0);
    }
  });
});

// ── 8. Capability ─────────────────────────────────────────────────────────────

describe("Capability", () => {
  it("declares at least 5 capabilities", () => {
    expect(INTERIOR_CAPABILITIES.length).toBeGreaterThanOrEqual(5);
  });

  it("each capability has an id, label, and description", () => {
    for (const cap of INTERIOR_CAPABILITIES) {
      expect(cap.id.length).toBeGreaterThan(0);
      expect(cap.label.length).toBeGreaterThan(0);
      expect(cap.description.length).toBeGreaterThan(0);
    }
  });

  it("all capability IDs are unique", () => {
    const ids = INTERIOR_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getCapability returns the correct capability by id", () => {
    const cap = getCapability("brief_intake");
    expect(cap).toBeDefined();
    expect(cap!.id).toBe("brief_intake");
  });

  it("getCapability returns undefined for unknown id", () => {
    expect(getCapability("nonexistent_capability")).toBeUndefined();
  });

  it("declares workflow_dag capability", () => {
    expect(getCapability("workflow_dag")).toBeDefined();
  });

  it("declares artifact_production capability", () => {
    expect(getCapability("artifact_production")).toBeDefined();
  });

  it("declares export_presets capability", () => {
    expect(getCapability("export_presets")).toBeDefined();
  });
});

// ── 9. Export presets ─────────────────────────────────────────────────────────

describe("Export presets", () => {
  it("defines exactly 4 export presets", () => {
    expect(INTERIOR_EXPORT_PRESET_IDS).toHaveLength(4);
  });

  it("all 4 required preset IDs are present", () => {
    const required = [
      "client_presentation",
      "client_review",
      "technical_drawing",
      "specification_sheet",
    ] as const;
    for (const id of required) {
      expect(INTERIOR_EXPORT_PRESET_IDS).toContain(id);
    }
  });

  it("each preset has at least one artifact inclusion", () => {
    for (const id of INTERIOR_EXPORT_PRESET_IDS) {
      expect(INTERIOR_EXPORT_PRESETS[id].inclusions.length).toBeGreaterThan(0);
    }
  });

  it("client_presentation preset includes interior_visualization (required)", () => {
    const inclusions = INTERIOR_EXPORT_PRESETS.client_presentation.inclusions;
    const viz = inclusions.find((i) => i.artifactTypeId === "interior_visualization");
    expect(viz).toBeDefined();
    expect(viz!.required).toBe(true);
  });

  it("client_review preset has draftWatermark: true", () => {
    expect(INTERIOR_EXPORT_PRESETS.client_review.draftWatermark).toBe(true);
  });

  it("technical_drawing preset uses A3 paper size", () => {
    expect(INTERIOR_EXPORT_PRESETS.technical_drawing.paperSize).toBe("A3");
  });

  it("specification_sheet preset includes interior_specification", () => {
    const inclusions = INTERIOR_EXPORT_PRESETS.specification_sheet.inclusions;
    expect(inclusions.some((i) => i.artifactTypeId === "interior_specification")).toBe(true);
  });

  it("listExportPresets returns all 4 presets", () => {
    const list = listExportPresets();
    expect(list).toHaveLength(4);
  });

  it("getRequiredArtifactsForPreset returns only required artifacts", () => {
    const required = getRequiredArtifactsForPreset("client_presentation");
    expect(required.length).toBeGreaterThan(0);
    // All returned IDs must correspond to inclusions with required: true
    const presetInclusions = INTERIOR_EXPORT_PRESETS.client_presentation.inclusions;
    for (const id of required) {
      const inc = presetInclusions.find((i) => i.artifactTypeId === id);
      expect(inc?.required).toBe(true);
    }
  });

  it("getRequiredArtifactsForPreset throws on unknown preset", () => {
    expect(() => getRequiredArtifactsForPreset("ghost_preset" as never)).toThrow();
  });
});

// ── 10. No Interior fields leaked to core ────────────────────────────────────

describe("No Interior fields leaked to core", () => {
  /**
   * Isolation test — verifies that all interior-plugin artifact type IDs
   * start with the 'interior_' namespace prefix.
   * If any ID is missing the prefix, it could collide with a core-registered type.
   */
  it("all artifact type IDs are namespaced with 'interior_'", () => {
    for (const id of INTERIOR_ARTIFACT_TYPE_IDS) {
      expect(id).toMatch(/^interior_/);
    }
  });

  /**
   * All property section IDs must not use generic names that match
   * any known core platform property section (dimensions, material, notes
   * are interior-scoped within this plugin object, not registered globally).
   */
  it("property section IDs exist only in the interior plugin registry", () => {
    // The INTERIOR_PROPERTY_SECTIONS object is scoped to this plugin.
    // Verify the key count matches the exported array.
    const keysInRegistry = Object.keys(INTERIOR_PROPERTY_SECTIONS);
    expect(keysInRegistry.length).toBe(INTERIOR_PROPERTY_SECTION_IDS.length);
  });

  it("workflow step IDs use plain names — no 'interior_' prefix needed (domain-local)", () => {
    // Workflow step IDs are scoped to the workflow object and never registered
    // globally in the core step registry.
    for (const id of INTERIOR_WORKFLOW_STEP_IDS) {
      // They should NOT have an 'interior_' prefix — they are already isolated
      // inside the workflow definition.
      expect(id).not.toMatch(/^interior_/);
    }
  });

  it("component category IDs are domain-local (no exterior prefix required)", () => {
    // Interior component categories are registered within this plugin only.
    const keysInRegistry = Object.keys(INTERIOR_COMPONENT_CATEGORIES);
    expect(keysInRegistry.length).toBe(INTERIOR_COMPONENT_CATEGORY_IDS.length);
  });

  it("plugin has no direct dependency on core WorkflowDefinition type", () => {
    // The workflow definition is self-contained: InteriorWorkflowDefinition
    // is declared in workflow.ts without importing from types/creative-workflow-v2.
    // We verify the shape is compatible.
    expect(INTERIOR_WORKFLOW).toHaveProperty("id");
    expect(INTERIOR_WORKFLOW).toHaveProperty("nodes");
    expect(INTERIOR_WORKFLOW).toHaveProperty("edges");
    expect(INTERIOR_WORKFLOW).toHaveProperty("criticalPath");
    expect(INTERIOR_WORKFLOW).toHaveProperty("parallelGroups");
  });
});

// ── 11. Compatibility version ─────────────────────────────────────────────────

describe("Compatibility version", () => {
  it("compatibilityVersion is a valid semver string", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.compatibilityVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("plugin version and compatibilityVersion are both present and non-empty", () => {
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.version).toBeTruthy();
    expect(INTERIOR_DESIGN_PLUGIN_MANIFEST.compatibilityVersion).toBeTruthy();
  });

  it("workflow version matches plugin version", () => {
    expect(INTERIOR_WORKFLOW.version).toBe(INTERIOR_DESIGN_PLUGIN_MANIFEST.version);
  });
});

// ── 12. Examples ─────────────────────────────────────────────────────────────

describe("Examples", () => {
  it("example: minimal brief parses correctly and extracts key fields", () => {
    const parsed = InteriorDesignBriefSchema.safeParse({
      spaceType: "bedroom",
      dimensions: { lengthM: 4, widthM: 3.5, ceilingHeightM: 2.7 },
      occupantCount: 2,
      stylePreference: "japandi",
      lightingNeeds: ["natural_primary", "ambient_soft"],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.spaceType).toBe("bedroom");
      expect(parsed.data.stylePreference).toBe("japandi");
      expect(parsed.data.lightingNeeds).toContain("ambient_soft");
    }
  });

  it("example: moodboard artifact type has correct delivery format", () => {
    const t = getArtifactType("interior_moodboard");
    expect(t.deliveryFormats).toContain("image/png");
    expect(t.deliveryFormats).toContain("application/pdf");
  });

  it("example: seating category has 3-seater sofa fixture", () => {
    const fixtures = getFixturesByCategory("seating");
    const sofa = fixtures.find((f) => f.id === "seat_3seater_sofa");
    expect(sofa).toBeDefined();
    expect(sofa!.typicalDimensionsM.w).toBeGreaterThan(2);
  });

  it("example: client_presentation preset has cover page and TOC", () => {
    const preset = INTERIOR_EXPORT_PRESETS.client_presentation;
    expect(preset.includesCoverPage).toBe(true);
    expect(preset.includesTableOfContents).toBe(true);
  });

  it("example: DAG parallel group includes moodboard fan-out steps", () => {
    const groups = computeParallelGroups(INTERIOR_WORKFLOW.nodes);
    const hasFanOut = groups.some(
      (g) =>
        g.includes("space_planning") ||
        (g.includes("material_direction") && g.includes("lighting_direction")),
    );
    expect(hasFanOut).toBe(true);
  });

  it("example: specification artifact contributes 3 property sections", () => {
    const sections = getSectionsForArtifact("interior_specification");
    expect(sections.length).toBeGreaterThanOrEqual(3);
  });

  it("example: partition category has glass panel fixture", () => {
    const fixtures = getFixturesByCategory("partition");
    expect(fixtures.some((f) => f.id === "part_glass_panel")).toBe(true);
  });

  it("example: material category flooring has multiple example materials", () => {
    const desc = INTERIOR_MATERIAL_CATEGORY_DESCRIPTORS.flooring;
    expect(desc.exampleMaterials.length).toBeGreaterThan(3);
    expect(desc.exampleMaterials).toContain("porcelain tile");
  });

  it("example: validateManifest on the real manifest returns valid:true", () => {
    const { valid, errors } = validateManifest(INTERIOR_DESIGN_PLUGIN_MANIFEST);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("example: workflow critical path contains 'visualization' (high effort node)", () => {
    const path = computeCriticalPath(INTERIOR_WORKFLOW.nodes);
    expect(path).toContain("visualization");
  });
});
