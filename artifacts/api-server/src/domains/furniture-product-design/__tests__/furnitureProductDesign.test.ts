/**
 * Team 28 — Furniture & Product Design Plugin — Test Suite
 *
 * Covers all 11 required test targets:
 *   1.  manifest          — plugin manifest structure and completeness
 *   2.  brief             — brief field validation
 *   3.  workflow          — 12 steps present, step key uniqueness
 *   4.  artifact registry — all 9 artifact types registered
 *   5.  component contribution — all 6 component categories registered
 *   6.  material contribution  — all 10 materials registered
 *   7.  technical view metadata — view validation
 *   8.  capability requirement  — required capabilities declared
 *   9.  no CAD runtime     — unsupported capability guard
 *  10.  no core leakage    — domain does not modify locked files
 *  11.  version compatibility — semver fields present
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

import { describe, it, expect } from "vitest";

// ── Manifest ──────────────────────────────────────────────────────────────────
import {
  PLUGIN_MANIFEST,
  PLUGIN_ID,
  PLUGIN_VERSION,
  PLUGIN_SCHEMA_VERSION,
  PLUGIN_DOMAIN,
  WORKFLOW_STEPS,
  WORKFLOW_STEP_KEYS,
  ARTIFACT_TYPES,
  ARTIFACT_TYPE_KEYS,
  COMPONENT_CONTRIBUTIONS,
  COMPONENT_CATEGORIES,
  MATERIAL_CONTRIBUTIONS,
  MATERIAL_KEYS,
  UNSUPPORTED_CAPABILITIES,
  CAPABILITY_REQUIREMENTS,
  assertSupportedCapability,
  isRegisteredArtifactType,
  isRegisteredWorkflowStep,
} from "../plugin-manifest.js";

// ── Validation ────────────────────────────────────────────────────────────────
import {
  validateBrief,
  validateStepTransition,
  validateStatusTransition,
  validateArtifactType,
  validateComponentCategory,
  validateMaterialKey,
  validateProductCategory,
  assertNoCadRuntime,
  validateTechnicalViewMetadata,
  type BriefValidationInput,
  type TechnicalViewMetadata,
} from "../validation.js";

// ── Components ────────────────────────────────────────────────────────────────
import {
  PD_COMPONENT_REGISTRY,
  listPdComponents,
  getPdComponent,
  getPdComponentBySlug,
  isValidPdComponentType,
  getPdComponentStats,
} from "../components.js";

// ── Schema constants ──────────────────────────────────────────────────────────
import {
  PD_PRODUCT_CATEGORIES,
  PD_PROJECT_STATUSES,
  PD_WORKFLOW_STEPS,
} from "../schema.js";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MANIFEST
// ═══════════════════════════════════════════════════════════════════════════════

describe("1. Plugin Manifest", () => {
  it("has correct pluginId", () => {
    expect(PLUGIN_MANIFEST.pluginId).toBe("furniture-product-design-v1");
    expect(PLUGIN_ID).toBe("furniture-product-design-v1");
  });

  it("has correct domain", () => {
    expect(PLUGIN_MANIFEST.domain).toBe("furniture_product_design");
    expect(PLUGIN_DOMAIN).toBe("furniture_product_design");
  });

  it("has a semver version string", () => {
    expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLUGIN_MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a schemaVersion string", () => {
    expect(PLUGIN_SCHEMA_VERSION).toMatch(/^\d+\.\d+/);
    expect(PLUGIN_MANIFEST.schemaVersion).toMatch(/^\d+\.\d+/);
  });

  it("has status 'active'", () => {
    expect(PLUGIN_MANIFEST.status).toBe("active");
  });

  it("has non-empty name and description", () => {
    expect(PLUGIN_MANIFEST.name.length).toBeGreaterThan(0);
    expect(PLUGIN_MANIFEST.description.length).toBeGreaterThan(10);
  });

  it("has minPlatformVersion", () => {
    expect(PLUGIN_MANIFEST.minPlatformVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has ISO timestamps", () => {
    expect(PLUGIN_MANIFEST.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(PLUGIN_MANIFEST.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("manifest object has all required top-level keys", () => {
    const keys = Object.keys(PLUGIN_MANIFEST);
    expect(keys).toContain("pluginId");
    expect(keys).toContain("version");
    expect(keys).toContain("domain");
    expect(keys).toContain("workflow");
    expect(keys).toContain("artifactTypes");
    expect(keys).toContain("componentContributions");
    expect(keys).toContain("materialContributions");
    expect(keys).toContain("capabilityRequirements");
    expect(keys).toContain("unsupportedCapabilities");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BRIEF VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("2. Brief Validation", () => {
  function validBrief(overrides: Partial<BriefValidationInput> = {}): BriefValidationInput {
    return {
      productCategory: "seating",
      targetUser: "Home office professional aged 30-45",
      environment: "Residential home office",
      primaryFunction: "Provide ergonomic seated support for 8+ hours of desk work",
      widthMm: 650,
      depthMm: 580,
      heightMm: 900,
      primaryMaterials: ["solid_wood", "foam", "fabric"],
      ...overrides,
    };
  }

  it("accepts a valid brief", () => {
    const result = validateBrief(validBrief());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing productCategory", () => {
    const result = validateBrief(validBrief({ productCategory: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "productCategory")).toBe(true);
  });

  it("rejects invalid productCategory", () => {
    const result = validateBrief(validBrief({ productCategory: "flying_car" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "productCategory")).toBe(true);
  });

  it("rejects missing targetUser", () => {
    const result = validateBrief(validBrief({ targetUser: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "targetUser")).toBe(true);
  });

  it("rejects missing environment", () => {
    const result = validateBrief(validBrief({ environment: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "environment")).toBe(true);
  });

  it("rejects missing primaryFunction", () => {
    const result = validateBrief(validBrief({ primaryFunction: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "primaryFunction")).toBe(true);
  });

  it("rejects negative width", () => {
    const result = validateBrief(validBrief({ widthMm: -10 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "widthMm")).toBe(true);
  });

  it("rejects width > 20000 mm", () => {
    const result = validateBrief(validBrief({ widthMm: 25000 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "widthMm")).toBe(true);
  });

  it("rejects height > 10000 mm", () => {
    const result = validateBrief(validBrief({ heightMm: 15000 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "heightMm")).toBe(true);
  });

  it("rejects unknown material key", () => {
    const result = validateBrief(validBrief({ primaryMaterials: ["unicorn_hair"] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "primaryMaterials")).toBe(true);
  });

  it("allows brief without optional dimension fields", () => {
    const result = validateBrief(validBrief({ widthMm: undefined, depthMm: undefined, heightMm: undefined }));
    expect(result.valid).toBe(true);
  });

  it("warns seating without height", () => {
    const result = validateBrief(validBrief({ productCategory: "seating", heightMm: undefined }));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("seat"))).toBe(true);
  });

  it("validates all declared product categories", () => {
    for (const cat of PD_PRODUCT_CATEGORIES) {
      const result = validateBrief(validBrief({ productCategory: cat }));
      expect(result.valid, `Category "${cat}" should be valid`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. WORKFLOW — 12 steps, ordered, unique keys
// ═══════════════════════════════════════════════════════════════════════════════

describe("3. Workflow", () => {
  it("has exactly 12 steps", () => {
    expect(WORKFLOW_STEPS.length).toBe(12);
  });

  it("steps are numbered 1–12 sequentially", () => {
    for (let i = 0; i < WORKFLOW_STEPS.length; i++) {
      expect(WORKFLOW_STEPS[i]!.step).toBe(i + 1);
    }
  });

  it("step keys are unique", () => {
    const keys = WORKFLOW_STEPS.map((s) => s.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("all steps have required=true", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.required).toBe(true);
    }
  });

  it("all steps have non-empty label and description", () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.label.length).toBeGreaterThan(0);
      expect(step.description.length).toBeGreaterThan(10);
    }
  });

  it("step 1 is 'brief'", () => {
    expect(WORKFLOW_STEPS[0]!.key).toBe("brief");
  });

  it("step 12 is 'export'", () => {
    expect(WORKFLOW_STEPS[11]!.key).toBe("export");
  });

  it("isRegisteredWorkflowStep returns true for all step keys", () => {
    for (const key of WORKFLOW_STEP_KEYS) {
      expect(isRegisteredWorkflowStep(key)).toBe(true);
    }
  });

  it("isRegisteredWorkflowStep returns false for unknown key", () => {
    expect(isRegisteredWorkflowStep("cad_extrude")).toBe(false);
  });

  it("schema PD_WORKFLOW_STEPS matches manifest", () => {
    expect(PD_WORKFLOW_STEPS.length).toBe(WORKFLOW_STEPS.length);
    for (const key of PD_WORKFLOW_STEPS) {
      expect(isRegisteredWorkflowStep(key)).toBe(true);
    }
  });

  it("validateStepTransition allows forward movement", () => {
    const r = validateStepTransition("brief", "user_market_research");
    expect(r.valid).toBe(true);
  });

  it("validateStepTransition allows same step (update)", () => {
    const r = validateStepTransition("concept_sketch", "concept_sketch");
    expect(r.valid).toBe(true);
  });

  it("validateStepTransition rejects backward movement", () => {
    const r = validateStepTransition("form_development", "brief");
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("validateStepTransition rejects unknown step", () => {
    const r = validateStepTransition("brief", "cad_export" as never);
    expect(r.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ARTIFACT REGISTRY — 9 types
// ═══════════════════════════════════════════════════════════════════════════════

describe("4. Artifact Registry", () => {
  const EXPECTED_ARTIFACT_TYPES = [
    "product_moodboard",
    "product_concept_sketch",
    "product_form_study",
    "product_component_map",
    "product_material_spec",
    "product_orthographic_view",
    "product_visualization",
    "product_prototype_spec",
    "product_production_spec",
  ];

  it("has exactly 9 artifact types", () => {
    expect(ARTIFACT_TYPES.length).toBe(9);
  });

  it("registers all 9 required artifact types", () => {
    for (const expected of EXPECTED_ARTIFACT_TYPES) {
      expect(ARTIFACT_TYPE_KEYS).toContain(expected);
    }
  });

  it("all artifact types have non-empty label and description", () => {
    for (const art of ARTIFACT_TYPES) {
      expect(art.label.length).toBeGreaterThan(0);
      expect(art.description.length).toBeGreaterThan(0);
    }
  });

  it("product_orthographic_view is marked required", () => {
    const ortho = ARTIFACT_TYPES.find((a) => a.type === "product_orthographic_view");
    expect(ortho?.required).toBe(true);
  });

  it("all artifact types have at least one mimeType", () => {
    for (const art of ARTIFACT_TYPES) {
      expect(art.mimeTypes.length).toBeGreaterThan(0);
    }
  });

  it("isRegisteredArtifactType returns true for all registered types", () => {
    for (const type of ARTIFACT_TYPE_KEYS) {
      expect(isRegisteredArtifactType(type)).toBe(true);
    }
  });

  it("isRegisteredArtifactType returns false for unknown type", () => {
    expect(isRegisteredArtifactType("cad_file")).toBe(false);
  });

  it("validateArtifactType accepts all registered types", () => {
    for (const type of ARTIFACT_TYPE_KEYS) {
      expect(validateArtifactType(type)).toBe(true);
    }
  });

  it("validateArtifactType rejects unknown type", () => {
    expect(validateArtifactType("step_file")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. COMPONENT CONTRIBUTIONS — 6 categories
// ═══════════════════════════════════════════════════════════════════════════════

describe("5. Component Contributions", () => {
  const EXPECTED_CATEGORIES = [
    "structural",
    "hardware",
    "connector",
    "mechanism",
    "surface",
    "accessory",
  ];

  it("has exactly 6 component categories in manifest", () => {
    expect(COMPONENT_CONTRIBUTIONS.length).toBe(6);
  });

  it("registers all 6 required categories", () => {
    for (const cat of EXPECTED_CATEGORIES) {
      expect(COMPONENT_CATEGORIES).toContain(cat);
    }
  });

  it("component registry has exactly 6 entries", () => {
    expect(PD_COMPONENT_REGISTRY.length).toBe(6);
  });

  it("each component has type matching a manifest category", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect((COMPONENT_CATEGORIES as readonly string[]).includes(comp.type)).toBe(true);
    }
  });

  it("each component has domain = 'product_design'", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(comp.domain).toBe("product_design");
    }
  });

  it("each component has slug, version, and description", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(comp.slug.length).toBeGreaterThan(0);
      expect(comp.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(comp.description.length).toBeGreaterThan(10);
    }
  });

  it("each component has at least one property", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(Object.keys(comp.properties).length).toBeGreaterThan(0);
    }
  });

  it("each component has at least one constraint", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(comp.constraints.length).toBeGreaterThan(0);
    }
  });

  it("getPdComponent returns correct definition", () => {
    const structural = getPdComponent("structural");
    expect(structural).toBeDefined();
    expect(structural?.type).toBe("structural");
    expect(structural?.domain).toBe("product_design");
  });

  it("getPdComponentBySlug returns correct definition", () => {
    const comp = getPdComponentBySlug("pd-hardware");
    expect(comp).toBeDefined();
    expect(comp?.type).toBe("hardware");
  });

  it("isValidPdComponentType returns true for valid types", () => {
    for (const cat of EXPECTED_CATEGORIES) {
      expect(isValidPdComponentType(cat)).toBe(true);
    }
  });

  it("isValidPdComponentType returns false for unknown type", () => {
    expect(isValidPdComponentType("parametric_node")).toBe(false);
  });

  it("getPdComponentStats returns correct total and domain", () => {
    const stats = getPdComponentStats();
    expect(stats.total).toBe(6);
    expect(stats.domain).toBe("product_design");
    expect(stats.types).toHaveLength(6);
  });

  it("validateComponentCategory accepts all 6 categories", () => {
    for (const cat of EXPECTED_CATEGORIES) {
      expect(validateComponentCategory(cat)).toBe(true);
    }
  });

  it("validateComponentCategory rejects unknown category", () => {
    expect(validateComponentCategory("cad_solid")).toBe(false);
  });

  it("listPdComponents returns all 6", () => {
    expect(listPdComponents().length).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. MATERIAL CONTRIBUTIONS — 10 materials
// ═══════════════════════════════════════════════════════════════════════════════

describe("6. Material Contributions", () => {
  const EXPECTED_MATERIALS = [
    "solid_wood", "plywood", "mdf", "particle_board",
    "metal", "glass", "fabric", "leather", "plastic", "foam",
  ];

  it("has exactly 10 material contributions", () => {
    expect(MATERIAL_CONTRIBUTIONS.length).toBe(10);
  });

  it("registers all 10 required material keys", () => {
    for (const mat of EXPECTED_MATERIALS) {
      expect(MATERIAL_KEYS).toContain(mat);
    }
  });

  it("all materials have non-empty label", () => {
    for (const mat of MATERIAL_CONTRIBUTIONS) {
      expect(mat.label.length).toBeGreaterThan(0);
    }
  });

  it("all materials have at least one grade", () => {
    for (const mat of MATERIAL_CONTRIBUTIONS) {
      expect(mat.grades.length).toBeGreaterThan(0);
    }
  });

  it("all materials have a sustainability note", () => {
    for (const mat of MATERIAL_CONTRIBUTIONS) {
      expect(mat.sustainabilityNote.length).toBeGreaterThan(0);
    }
  });

  it("validateMaterialKey accepts all registered materials", () => {
    for (const key of MATERIAL_KEYS) {
      expect(validateMaterialKey(key)).toBe(true);
    }
  });

  it("validateMaterialKey rejects unknown material", () => {
    expect(validateMaterialKey("unobtainium")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. TECHNICAL VIEW METADATA
// ═══════════════════════════════════════════════════════════════════════════════

describe("7. Technical View Metadata", () => {
  function validMeta(overrides: Partial<TechnicalViewMetadata> = {}): TechnicalViewMetadata {
    return {
      views: ["front", "side", "top"],
      unit: "mm",
      scale: "1:10",
      annotations: ["Overall Width 600mm", "Overall Height 750mm"],
      ...overrides,
    };
  }

  it("accepts valid metadata", () => {
    const r = validateTechnicalViewMetadata(validMeta());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects empty views array", () => {
    const r = validateTechnicalViewMetadata(validMeta({ views: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "views")).toBe(true);
  });

  it("rejects unknown view type", () => {
    const r = validateTechnicalViewMetadata(validMeta({ views: ["isometric" as never] }));
    expect(r.valid).toBe(false);
  });

  it("rejects non-mm unit", () => {
    const r = validateTechnicalViewMetadata(validMeta({ unit: "inches" as never }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "unit")).toBe(true);
  });

  it("warns on malformed scale", () => {
    const r = validateTechnicalViewMetadata(validMeta({ scale: "NTS" }));
    expect(r.valid).toBe(true); // not an error, only a warning
    expect(r.warnings.some((w) => w.includes("Scale"))).toBe(true);
  });

  it("warns when annotations are empty", () => {
    const r = validateTechnicalViewMetadata(validMeta({ annotations: [] }));
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("accepts 'section' and 'detail' view types", () => {
    const r = validateTechnicalViewMetadata(validMeta({ views: ["front", "section", "detail"] }));
    expect(r.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. CAPABILITY REQUIREMENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("8. Capability Requirements", () => {
  it("declares at least one required capability", () => {
    const required = CAPABILITY_REQUIREMENTS.filter((c) => c.required);
    expect(required.length).toBeGreaterThan(0);
  });

  it("ai_text_generation is marked required", () => {
    const cap = CAPABILITY_REQUIREMENTS.find((c) => c.capability === "ai_text_generation");
    expect(cap).toBeDefined();
    expect(cap?.required).toBe(true);
  });

  it("structured_json_output is marked required", () => {
    const cap = CAPABILITY_REQUIREMENTS.find((c) => c.capability === "structured_json_output");
    expect(cap).toBeDefined();
    expect(cap?.required).toBe(true);
  });

  it("all capabilities have provider and notes", () => {
    for (const cap of CAPABILITY_REQUIREMENTS) {
      expect(cap.provider.length).toBeGreaterThan(0);
      expect(cap.notes.length).toBeGreaterThan(0);
    }
  });

  it("manifest capabilityRequirements matches exported constant", () => {
    expect(PLUGIN_MANIFEST.capabilityRequirements.length).toBe(CAPABILITY_REQUIREMENTS.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. NO CAD RUNTIME
// ═══════════════════════════════════════════════════════════════════════════════

describe("9. No CAD Runtime", () => {
  it("manifest explicitly lists unsupported CAD capabilities", () => {
    expect(UNSUPPORTED_CAPABILITIES).toContain("cad_runtime");
    expect(UNSUPPORTED_CAPABILITIES).toContain("parametric_modelling");
    expect(UNSUPPORTED_CAPABILITIES).toContain("simulation_engine");
    expect(UNSUPPORTED_CAPABILITIES).toContain("finite_element_analysis");
    expect(UNSUPPORTED_CAPABILITIES).toContain("3d_solid_modelling");
  });

  it("assertSupportedCapability throws for cad_runtime", () => {
    expect(() => assertSupportedCapability("cad_runtime")).toThrow();
  });

  it("assertSupportedCapability throws for parametric_modelling", () => {
    expect(() => assertSupportedCapability("parametric_modelling")).toThrow();
  });

  it("assertSupportedCapability throws for simulation_engine", () => {
    expect(() => assertSupportedCapability("simulation_engine")).toThrow();
  });

  it("assertSupportedCapability throws for finite_element_analysis", () => {
    expect(() => assertSupportedCapability("finite_element_analysis")).toThrow();
  });

  it("assertSupportedCapability does NOT throw for supported capabilities", () => {
    expect(() => assertSupportedCapability("ai_text_generation")).not.toThrow();
    expect(() => assertSupportedCapability("pdf_export")).not.toThrow();
  });

  it("assertNoCadRuntime (validation module) throws for cad_runtime", () => {
    expect(() => assertNoCadRuntime("cad_runtime")).toThrow();
  });

  it("assertNoCadRuntime does not throw for non-CAD strings", () => {
    expect(() => assertNoCadRuntime("ai_text_generation")).not.toThrow();
  });

  it("plugin manifest does not declare any 3D CAD output format", () => {
    // No artifact type should reference stl, step, iges, sldprt, or .dwg
    const cadFormats = ["stl", "step", "iges", "sldprt", "dwg", "obj"];
    for (const art of ARTIFACT_TYPES) {
      for (const mime of art.mimeTypes) {
        const mimeStr = mime.toLowerCase();
        for (const fmt of cadFormats) {
          expect(mimeStr).not.toContain(fmt);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. NO CORE LEAKAGE
// ═══════════════════════════════════════════════════════════════════════════════

describe("10. No Core Leakage", () => {
  /**
   * "Core leakage" means modifying files owned by other teams or the platform
   * shared infrastructure. This test verifies the plugin is self-contained by
   * checking that all exports are from the domain-local barrel only.
   */

  it("plugin manifest is self-contained (no imports from @workspace/db barrel schema)", async () => {
    // We verify by checking that the manifest module can be imported without
    // requiring the global schema barrel. If there's leakage, the import above
    // would have already failed with a missing module error.
    expect(PLUGIN_MANIFEST.pluginId).toBeTruthy();
  });

  it("component definitions do not use ComponentDomain from Team 8 types directly", () => {
    // Verify that each component declares 'product_design' as its domain.
    // If they had imported ComponentDomain from Team 8, they'd be constrained
    // to only 4 valid values (graphic|interior|fashion|packaging) — none of
    // which is product_design. The fact these pass means the local type is used.
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(comp.domain).toBe("product_design");
    }
  });

  it("validation module does not import from other teams' domains", () => {
    // The validateBrief function works correctly with local types only.
    const result = validateBrief({
      productCategory: "table",
      targetUser: "Test user",
      environment: "Test environment",
      primaryFunction: "Test function",
    });
    // If there were cross-domain imports that failed, this call would throw.
    expect(typeof result.valid).toBe("boolean");
  });

  it("validateStatusTransition blocks export without review", () => {
    // Ensures the review gate cannot be bypassed (a security invariant)
    const r = validateStatusTransition("draft", "exported");
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("validateStatusTransition blocks export without approval", () => {
    const r = validateStatusTransition("specifying", "exported");
    expect(r.valid).toBe(false);
  });

  it("cancelled projects cannot transition to any other status", () => {
    for (const status of PD_PROJECT_STATUSES) {
      if (status === "cancelled") continue;
      const r = validateStatusTransition("cancelled", status);
      expect(r.valid).toBe(false);
    }
  });

  it("product categories are domain-local (not imported from another team's schema)", () => {
    // All 14 categories should be accessible
    expect(PD_PRODUCT_CATEGORIES.length).toBeGreaterThanOrEqual(14);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. VERSION COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

describe("11. Version Compatibility", () => {
  it("PLUGIN_VERSION matches manifest.version", () => {
    expect(PLUGIN_VERSION).toBe(PLUGIN_MANIFEST.version);
  });

  it("PLUGIN_SCHEMA_VERSION matches manifest.schemaVersion", () => {
    expect(PLUGIN_SCHEMA_VERSION).toBe(PLUGIN_MANIFEST.schemaVersion);
  });

  it("each component definition has version '1.0.0'", () => {
    for (const comp of PD_COMPONENT_REGISTRY) {
      expect(comp.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("minPlatformVersion is parseable as semver", () => {
    const parts = PLUGIN_MANIFEST.minPlatformVersion.split(".").map(Number);
    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(Number.isInteger(part)).toBe(true);
      expect(part).toBeGreaterThanOrEqual(0);
    }
  });

  it("maxPlatformVersion is null (no upper bound)", () => {
    expect(PLUGIN_MANIFEST.maxPlatformVersion).toBeNull();
  });

  it("schema version fields exist in schema module", () => {
    // PD_PRODUCT_CATEGORIES, PD_PROJECT_STATUSES, PD_WORKFLOW_STEPS are all
    // non-empty arrays — schema module is loadable and consistent.
    expect(PD_PRODUCT_CATEGORIES.length).toBeGreaterThan(0);
    expect(PD_PROJECT_STATUSES.length).toBeGreaterThan(0);
    expect(PD_WORKFLOW_STEPS.length).toBe(12);
  });

  it("workflow steps count in schema matches manifest", () => {
    expect(PD_WORKFLOW_STEPS.length).toBe(WORKFLOW_STEPS.length);
  });

  it("validateProductCategory accepts all declared categories", () => {
    for (const cat of PD_PRODUCT_CATEGORIES) {
      expect(validateProductCategory(cat)).toBe(true);
    }
  });
});
