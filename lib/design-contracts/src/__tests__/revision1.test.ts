/**
 * revision1.test.ts — Revision 1 Enhancement Tests
 *
 * New tests required by Revision 1 brief (Tasks A–N):
 *
 *  CM1  — ContractMetadata: valid full metadata
 *  CM2  — ContractMetadata: all fields optional (empty object is valid)
 *  CM3  — ContractMetadata: source enum validation
 *  CM4  — ContractMetadata: well-known generator names
 *  AR1  — ArtifactRelationship: valid relationship
 *  AR2  — ArtifactRelationship: all relationship types accepted
 *  AR3  — ArtifactRelationship: rejects invalid UUID
 *  AR4  — ArtifactRelationship: rejects unknown relationshipType
 *  AG1  — ArtifactGraph: validateArtifactGraph returns valid for acyclic graph
 *  AG2  — ArtifactGraph: validateArtifactGraph detects self-referencing edge
 *  AG3  — ArtifactGraph: detectArtifactCycles returns empty for acyclic
 *  AG4  — ArtifactGraph: detectArtifactCycles returns cycle for cyclic graph
 *  AG5  — ArtifactGraph: findArtifactDependencies returns parent IDs
 *  AG6  — ArtifactGraph: findArtifactDependents returns child IDs
 *  AG7  — ArtifactGraph: dependency type filtering works
 *  EP1  — ExecutionPriority: all 5 values accepted by schema
 *  EP2  — ExecutionPriority: capability defaults to "medium" when omitted
 *  CC1  — CapabilityCategory: all 10 categories accepted
 *  CC2  — CapabilityCategory: capability with category parses correctly
 *  EE1  — ExecutionEstimation: valid full estimation
 *  EE2  — ExecutionEstimation: all fields optional
 *  EE3  — ExecutionEstimation: capability with estimation parses correctly
 *  DP1  — DeprecationPolicy: valid full policy
 *  DP2  — DeprecationPolicy: isDeprecated=false with no other fields
 *  DP3  — DeprecationPolicy: isDeprecated is required
 *  FS1  — FeatureStability: all 5 values accepted
 *  FS2  — FeatureStability: plugin manifest defaults to "stable"
 *  FS3  — FeatureStability: plugin manifest accepts "experimental"
 *  PD1  — PluginDependency: valid dependency
 *  PD2  — PluginDependency: optional dependency
 *  PD3  — PluginDependency: rejects invalid pluginId format
 *  PD4  — PluginDependency: rejects invalid minimumVersion
 *  PD5  — PluginManifest with dependencies array parses correctly
 *  NK1  — New example: Furniture context + manifest valid
 *  NK2  — New example: Architecture context + manifest valid
 *  NK3  — New example: Landscape context + manifest valid
 *  NK4  — New example: Industrial Product context + manifest valid
 *  NK5  — New example: Jewelry context + manifest valid
 *  NK6  — New example: all new domain data stays in extensions
 *  LN1  — Artifact lineage: EXAMPLE_ARTIFACT_LINEAGE passes ArtifactRelationshipSchema
 *  LN2  — Artifact lineage: findArtifactDependencies works on example lineage
 *  LN3  — Artifact lineage: findArtifactDependents works on example lineage
 *  BC1  — Backward compatibility: existing capabilities still parse without new fields
 *  BC2  — Backward compatibility: existing manifests without dependencies still parse
 *  BC3  — Backward compatibility: existing manifests without stability still parse
 *  VC1  — Version compatibility: DESIGN_CONTRACT_VERSION is integer ≥ 1
 *  VC2  — Version compatibility: MINIMUM_SUPPORTED_CONTRACT_VERSION ≤ DESIGN_CONTRACT_VERSION
 *  VC3  — Version compatibility: checkCompatibility is deterministic
 *  CD1  — Cycle detection (artifact graph): linear chain has no cycles
 *  CD2  — Cycle detection (artifact graph): A→B, B→A is detected
 *  CD3  — Cycle detection (artifact graph): A→B→C→A three-node cycle detected
 *  NA1  — No React import in any source file
 *  NA2  — No Express import in any source file
 *  NA3  — No database import in any source file
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  // Schema validators
  DesignCapabilityContractSchema,
  DesignPluginManifestSchema,
  // Contract metadata
  ContractMetadataSchema,
  CONTRACT_METADATA_SOURCES,
  WELL_KNOWN_GENERATORS,
  // Artifact relationship
  ArtifactRelationshipSchema,
  RELATIONSHIP_TYPES,
  type RelationshipType,
  type ArtifactRelationship,
  // Graph utilities
  validateArtifactGraph,
  detectArtifactCycles,
  findArtifactDependencies,
  findArtifactDependents,
  // Capability enums
  CAPABILITY_CATEGORIES,
  EXECUTION_PRIORITIES,
  ExecutionEstimationSchema,
  // Deprecation & stability
  DeprecationPolicySchema,
  FeatureStabilitySchema,
  FEATURE_STABILITIES,
  // Plugin dependency
  PluginDependencySchema,
  // Version
  DESIGN_CONTRACT_VERSION,
  MINIMUM_SUPPORTED_CONTRACT_VERSION,
  checkCompatibility,
  isCompatibleVersion,
} from "../index.js";

import {
  FURNITURE_PROJECT_CONTEXT,
  FURNITURE_PLUGIN_MANIFEST,
  ARCHITECTURE_PROJECT_CONTEXT,
  ARCHITECTURE_PLUGIN_MANIFEST,
  LANDSCAPE_PROJECT_CONTEXT,
  LANDSCAPE_PLUGIN_MANIFEST,
  INDUSTRIAL_PRODUCT_PROJECT_CONTEXT,
  INDUSTRIAL_PRODUCT_PLUGIN_MANIFEST,
  JEWELRY_PROJECT_CONTEXT,
  JEWELRY_PLUGIN_MANIFEST,
  EXAMPLE_ARTIFACT_LINEAGE,
} from "../examples/index.js";

import {
  DesignProjectContextSchema,
} from "../index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function baseCapability(overrides: Record<string, unknown> = {}) {
  return {
    capabilityId: "test-plugin:generate_concept",
    displayName: "Generate Concept",
    inputSchemaRef: "@workspace/plugins-test/capability/generate-concept/input",
    outputSchemaRef: "@workspace/plugins-test/capability/generate-concept/output",
    executionMode: "async_job",
    ...overrides,
  };
}

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: "test-plugin",
    displayName: "Test Plugin",
    version: "1.0.0",
    compatibleContractVersion: DESIGN_CONTRACT_VERSION,
    supportedServices: ["TEST_SERVICE"],
    briefSchemaRef: "@workspace/plugins-test/brief-schema",
    workflowRef: "@workspace/plugins-test/workflow",
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<{
  relationshipId: string;
  parentArtifactId: string;
  childArtifactId: string;
  relationshipType: string;
  createdAt: string;
}> = {}) {
  return {
    relationshipId: "11111111-1111-1111-1111-111111111111",
    parentArtifactId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    childArtifactId:  "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    relationshipType: "derived_from",
    createdAt: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

// ── CM: ContractMetadata ───────────────────────────────────────────────────────

describe("CM1 — ContractMetadata: valid full metadata", () => {
  it("parses a full ContractMetadata object", () => {
    const result = ContractMetadataSchema.safeParse({
      createdAt: "2026-07-21T10:00:00.000Z",
      updatedAt: "2026-07-21T11:00:00.000Z",
      createdBy: "usr_admin",
      updatedBy: "svc_workflow-engine",
      source: "ai",
      generator: "creative-ai",
      generatorVersion: "2.1.0",
    });
    expect(result.success).toBe(true);
  });
});

describe("CM2 — ContractMetadata: all fields optional (empty object is valid)", () => {
  it("parses an empty object as valid ContractMetadata", () => {
    const result = ContractMetadataSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("CM3 — ContractMetadata: source enum validation", () => {
  it("accepts all canonical source values", () => {
    for (const source of CONTRACT_METADATA_SOURCES) {
      const result = ContractMetadataSchema.safeParse({ source });
      expect(result.success, `source="${source}" should be accepted`).toBe(true);
    }
  });

  it("rejects unknown source value", () => {
    const result = ContractMetadataSchema.safeParse({ source: "database" });
    expect(result.success).toBe(false);
  });
});

describe("CM4 — ContractMetadata: well-known generator names are defined", () => {
  it("WELL_KNOWN_GENERATORS contains expected platform generators", () => {
    expect(WELL_KNOWN_GENERATORS).toContain("creative-ai");
    expect(WELL_KNOWN_GENERATORS).toContain("presentation-engine");
    expect(WELL_KNOWN_GENERATORS).toContain("document-engine");
    expect(WELL_KNOWN_GENERATORS).toContain("workflow-engine");
  });

  it("generator field accepts any string including well-known names", () => {
    for (const generator of WELL_KNOWN_GENERATORS) {
      const result = ContractMetadataSchema.safeParse({ generator });
      expect(result.success, `generator="${generator}" should be accepted`).toBe(true);
    }
  });
});

// ── AR: ArtifactRelationship ───────────────────────────────────────────────────

describe("AR1 — ArtifactRelationship: valid relationship", () => {
  it("parses a minimal ArtifactRelationship", () => {
    const result = ArtifactRelationshipSchema.safeParse(makeRelationship());
    expect(result.success).toBe(true);
  });

  it("parses a relationship with optional metadata", () => {
    const result = ArtifactRelationshipSchema.safeParse(
      makeRelationship({ ...makeRelationship(), ...{ metadata: { stageId: "concept", confidence: 0.92 } } }),
    );
    expect(result.success).toBe(true);
  });
});

describe("AR2 — ArtifactRelationship: all relationship types accepted", () => {
  it("accepts every RELATIONSHIP_TYPE value", () => {
    for (const type of RELATIONSHIP_TYPES) {
      const result = ArtifactRelationshipSchema.safeParse(
        makeRelationship({ relationshipType: type }),
      );
      expect(result.success, `relationshipType="${type}" should be accepted`).toBe(true);
    }
  });
});

describe("AR3 — ArtifactRelationship: rejects invalid UUID", () => {
  it("rejects non-UUID parentArtifactId", () => {
    const result = ArtifactRelationshipSchema.safeParse(
      makeRelationship({ parentArtifactId: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-UUID childArtifactId", () => {
    const result = ArtifactRelationshipSchema.safeParse(
      makeRelationship({ childArtifactId: "not-a-uuid" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("AR4 — ArtifactRelationship: rejects unknown relationshipType", () => {
  it("rejects unknown type", () => {
    const result = ArtifactRelationshipSchema.safeParse(
      makeRelationship({ relationshipType: "copies" }),
    );
    expect(result.success).toBe(false);
  });
});

// ── AG: Artifact Graph utilities ───────────────────────────────────────────────

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

// Fixed valid UUIDs for test edges — relationshipId is not used by graph algorithms,
// so reusing the same UUID across edges is fine for these unit tests.
const FIXED_EDGE_UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function rel(parent: string, child: string, type: RelationshipType = "derived_from"): ArtifactRelationship {
  return ArtifactRelationshipSchema.parse({
    relationshipId: FIXED_EDGE_UUID,
    parentArtifactId: parent,
    childArtifactId: child,
    relationshipType: type,
    createdAt: "2026-07-21T10:00:00.000Z",
  });
}

describe("AG1 — ArtifactGraph: validateArtifactGraph returns valid for acyclic graph", () => {
  it("linear chain A→B→C is valid", () => {
    const edges = [rel(A, B), rel(B, C)];
    const result = validateArtifactGraph(edges);
    expect(result.valid).toBe(true);
    expect(result.cycles).toHaveLength(0);
    expect(result.edgeCount).toBe(2);
    expect(result.nodeCount).toBe(3);
  });

  it("diamond A→B, A→C, B→D, C→D is valid", () => {
    const edges = [rel(A, B), rel(A, C), rel(B, D_ID), rel(C, D_ID)];
    const result = validateArtifactGraph(edges);
    expect(result.valid).toBe(true);
    expect(result.cycles).toHaveLength(0);
  });

  it("empty graph is valid", () => {
    const result = validateArtifactGraph([]);
    expect(result.valid).toBe(true);
    expect(result.edgeCount).toBe(0);
    expect(result.nodeCount).toBe(0);
  });
});

describe("AG2 — ArtifactGraph: validateArtifactGraph detects self-referencing edge", () => {
  it("A→A self-reference is detected as a cycle", () => {
    const edges = [rel(A, A)];
    const result = validateArtifactGraph(edges);
    expect(result.valid).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
  });
});

describe("AG3 — ArtifactGraph: detectArtifactCycles returns empty for acyclic", () => {
  it("returns [] for A→B→C", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, C)]);
    expect(cycles).toHaveLength(0);
  });
});

describe("AG4 — ArtifactGraph: detectArtifactCycles returns cycle for cyclic graph", () => {
  it("detects A→B, B→A cycle", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, A)]);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("detects three-node cycle A→B→C→A", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, C), rel(C, A)]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("AG5 — ArtifactGraph: findArtifactDependencies returns parent IDs", () => {
  it("B depends on A when A→B", () => {
    const deps = findArtifactDependencies(B, [rel(A, B), rel(B, C)]);
    expect(deps).toContain(A);
    expect(deps).not.toContain(C);
  });

  it("returns empty array when artifact has no dependencies", () => {
    const deps = findArtifactDependencies(A, [rel(A, B)]);
    expect(deps).toHaveLength(0);
  });
});

describe("AG6 — ArtifactGraph: findArtifactDependents returns child IDs", () => {
  it("A has dependent B when A→B", () => {
    const deps = findArtifactDependents(A, [rel(A, B), rel(B, C)]);
    expect(deps).toContain(B);
    expect(deps).not.toContain(C);
  });

  it("returns empty array when artifact has no dependents", () => {
    const deps = findArtifactDependents(C, [rel(A, B), rel(B, C)]);
    expect(deps).toHaveLength(0);
  });
});

describe("AG7 — ArtifactGraph: dependency type filtering works", () => {
  it("filters by relationshipType in findArtifactDependencies", () => {
    const edges = [
      rel(A, B, "derived_from"),
      rel(C, B, "references"),
    ];
    const onlyDerived = findArtifactDependencies(B, edges, ["derived_from"]);
    expect(onlyDerived).toContain(A);
    expect(onlyDerived).not.toContain(C);
  });

  it("filters by relationshipType in findArtifactDependents", () => {
    const edges = [
      rel(A, B, "derived_from"),
      rel(A, C, "references"),
    ];
    const onlyDerived = findArtifactDependents(A, edges, ["derived_from"]);
    expect(onlyDerived).toContain(B);
    expect(onlyDerived).not.toContain(C);
  });
});

// ── EP: ExecutionPriority ──────────────────────────────────────────────────────

describe("EP1 — ExecutionPriority: all 5 values accepted by schema", () => {
  it("accepts each EXECUTION_PRIORITY value as capability executionPriority", () => {
    for (const priority of EXECUTION_PRIORITIES) {
      const result = DesignCapabilityContractSchema.safeParse(
        baseCapability({ executionPriority: priority }),
      );
      expect(result.success, `executionPriority="${priority}" should be accepted`).toBe(true);
    }
  });
});

describe("EP2 — ExecutionPriority: capability defaults to 'medium' when omitted", () => {
  it("defaults executionPriority to 'medium'", () => {
    const result = DesignCapabilityContractSchema.safeParse(baseCapability());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.executionPriority).toBe("medium");
    }
  });
});

// ── CC: CapabilityCategory ─────────────────────────────────────────────────────

describe("CC1 — CapabilityCategory: all 10 categories accepted", () => {
  it("accepts each CAPABILITY_CATEGORY value", () => {
    expect(CAPABILITY_CATEGORIES).toHaveLength(10);
    for (const category of CAPABILITY_CATEGORIES) {
      const result = DesignCapabilityContractSchema.safeParse(
        baseCapability({ category }),
      );
      expect(result.success, `category="${category}" should be accepted`).toBe(true);
    }
  });
});

describe("CC2 — CapabilityCategory: capability with category parses correctly", () => {
  it("AI category capability parses and retains category value", () => {
    const result = DesignCapabilityContractSchema.safeParse(
      baseCapability({ category: "AI" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("AI");
    }
  });
});

// ── EE: ExecutionEstimation ────────────────────────────────────────────────────

describe("EE1 — ExecutionEstimation: valid full estimation", () => {
  it("parses a full ExecutionEstimation", () => {
    const result = ExecutionEstimationSchema.safeParse({
      estimatedRuntimeMs: 5000,
      estimatedTokenUsage: 2000,
      estimatedCostUsd: 0.04,
      estimatedMemoryMb: 512,
      estimatedOutputSizeBytes: 204800,
    });
    expect(result.success).toBe(true);
  });
});

describe("EE2 — ExecutionEstimation: all fields optional", () => {
  it("parses empty object as valid ExecutionEstimation", () => {
    const result = ExecutionEstimationSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("EE3 — ExecutionEstimation: capability with estimation parses correctly", () => {
  it("capability with estimation block parses and retains values", () => {
    const result = DesignCapabilityContractSchema.safeParse(
      baseCapability({
        estimation: {
          estimatedRuntimeMs: 3000,
          estimatedCostUsd: 0.02,
        },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.estimation?.estimatedRuntimeMs).toBe(3000);
    }
  });
});

// ── DP: DeprecationPolicy ──────────────────────────────────────────────────────

describe("DP1 — DeprecationPolicy: valid full policy", () => {
  it("parses a full DeprecationPolicy", () => {
    const result = DeprecationPolicySchema.safeParse({
      isDeprecated: true,
      deprecatedSince: "1.2.0",
      replacement: "fashion:render_technical_drawing",
      removeAfterVersion: 3,
      reason: "Replaced by unified rendering pipeline.",
    });
    expect(result.success).toBe(true);
  });
});

describe("DP2 — DeprecationPolicy: isDeprecated=false with no other fields", () => {
  it("parses minimal non-deprecated policy", () => {
    const result = DeprecationPolicySchema.safeParse({ isDeprecated: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isDeprecated).toBe(false);
    }
  });
});

describe("DP3 — DeprecationPolicy: isDeprecated is required", () => {
  it("rejects object without isDeprecated", () => {
    const result = DeprecationPolicySchema.safeParse({
      deprecatedSince: "1.0.0",
      reason: "old",
    });
    expect(result.success).toBe(false);
  });
});

// ── FS: FeatureStability ───────────────────────────────────────────────────────

describe("FS1 — FeatureStability: all 5 values accepted", () => {
  it("FeatureStabilitySchema accepts each FEATURE_STABILITY value", () => {
    expect(FEATURE_STABILITIES).toHaveLength(5);
    for (const stability of FEATURE_STABILITIES) {
      const result = FeatureStabilitySchema.safeParse(stability);
      expect(result.success, `stability="${stability}" should be accepted`).toBe(true);
    }
  });
});

describe("FS2 — FeatureStability: plugin manifest defaults to 'stable'", () => {
  it("stability defaults to 'stable' when omitted from manifest", () => {
    const result = DesignPluginManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stability).toBe("stable");
    }
  });
});

describe("FS3 — FeatureStability: plugin manifest accepts 'experimental'", () => {
  it("stability='experimental' parses correctly", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({ stability: "experimental" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stability).toBe("experimental");
    }
  });
});

// ── PD: PluginDependency ───────────────────────────────────────────────────────

describe("PD1 — PluginDependency: valid dependency", () => {
  it("parses a full PluginDependency", () => {
    const result = PluginDependencySchema.safeParse({
      pluginId: "export-renderer",
      minimumVersion: "1.0.0",
      optional: false,
      reason: "Required for PDF/PPTX export",
    });
    expect(result.success).toBe(true);
  });
});

describe("PD2 — PluginDependency: optional dependency", () => {
  it("parses optional dependency without minimumVersion or reason", () => {
    const result = PluginDependencySchema.safeParse({
      pluginId: "simulation-engine",
      optional: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.optional).toBe(true);
    }
  });
});

describe("PD3 — PluginDependency: rejects invalid pluginId format", () => {
  it("rejects uppercase pluginId", () => {
    const result = PluginDependencySchema.safeParse({ pluginId: "Export-Renderer" });
    expect(result.success).toBe(false);
  });

  it("rejects pluginId starting with digit", () => {
    const result = PluginDependencySchema.safeParse({ pluginId: "1renderer" });
    expect(result.success).toBe(false);
  });
});

describe("PD4 — PluginDependency: rejects invalid minimumVersion", () => {
  it("rejects non-semver minimumVersion", () => {
    const result = PluginDependencySchema.safeParse({
      pluginId: "my-dep",
      minimumVersion: "latest",
    });
    expect(result.success).toBe(false);
  });
});

describe("PD5 — PluginManifest with dependencies array parses correctly", () => {
  it("manifest with two dependencies parses and retains them", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({
        dependencies: [
          { pluginId: "export-renderer", minimumVersion: "1.0.0", optional: false, reason: "PDF export" },
          { pluginId: "material", optional: true },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toHaveLength(2);
      expect(result.data.dependencies[0].pluginId).toBe("export-renderer");
    }
  });

  it("manifest without dependencies defaults to empty array", () => {
    const result = DesignPluginManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toEqual([]);
    }
  });
});

// ── NK: New domain examples ───────────────────────────────────────────────────

describe("NK1 — New example: Furniture context + manifest valid", () => {
  it("FURNITURE_PROJECT_CONTEXT passes DesignProjectContextSchema", () => {
    const result = DesignProjectContextSchema.safeParse(FURNITURE_PROJECT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it("FURNITURE_PLUGIN_MANIFEST passes DesignPluginManifestSchema", () => {
    const result = DesignPluginManifestSchema.safeParse(FURNITURE_PLUGIN_MANIFEST);
    expect(result.success).toBe(true);
  });
});

describe("NK2 — New example: Architecture context + manifest valid", () => {
  it("ARCHITECTURE_PROJECT_CONTEXT passes DesignProjectContextSchema", () => {
    const result = DesignProjectContextSchema.safeParse(ARCHITECTURE_PROJECT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it("ARCHITECTURE_PLUGIN_MANIFEST passes DesignPluginManifestSchema", () => {
    const result = DesignPluginManifestSchema.safeParse(ARCHITECTURE_PLUGIN_MANIFEST);
    expect(result.success).toBe(true);
  });
});

describe("NK3 — New example: Landscape context + manifest valid", () => {
  it("LANDSCAPE_PROJECT_CONTEXT passes DesignProjectContextSchema", () => {
    const result = DesignProjectContextSchema.safeParse(LANDSCAPE_PROJECT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it("LANDSCAPE_PLUGIN_MANIFEST passes DesignPluginManifestSchema", () => {
    const result = DesignPluginManifestSchema.safeParse(LANDSCAPE_PLUGIN_MANIFEST);
    expect(result.success).toBe(true);
  });
});

describe("NK4 — New example: Industrial Product context + manifest valid", () => {
  it("INDUSTRIAL_PRODUCT_PROJECT_CONTEXT passes DesignProjectContextSchema", () => {
    const result = DesignProjectContextSchema.safeParse(INDUSTRIAL_PRODUCT_PROJECT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it("INDUSTRIAL_PRODUCT_PLUGIN_MANIFEST passes DesignPluginManifestSchema", () => {
    const result = DesignPluginManifestSchema.safeParse(INDUSTRIAL_PRODUCT_PLUGIN_MANIFEST);
    expect(result.success).toBe(true);
  });
});

describe("NK5 — New example: Jewelry context + manifest valid", () => {
  it("JEWELRY_PROJECT_CONTEXT passes DesignProjectContextSchema", () => {
    const result = DesignProjectContextSchema.safeParse(JEWELRY_PROJECT_CONTEXT);
    expect(result.success).toBe(true);
  });

  it("JEWELRY_PLUGIN_MANIFEST passes DesignPluginManifestSchema", () => {
    const result = DesignPluginManifestSchema.safeParse(JEWELRY_PLUGIN_MANIFEST);
    expect(result.success).toBe(true);
  });
});

describe("NK6 — New example: all new domain data stays in extensions", () => {
  it("Furniture domain data is in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(FURNITURE_PROJECT_CONTEXT);
    expect("furnitureCategory" in core).toBe(false);
    expect(core.extensions?.["furnitureCategory"]).toBe("seating");
  });

  it("Architecture domain data is in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(ARCHITECTURE_PROJECT_CONTEXT);
    expect("buildingType" in core).toBe(false);
    expect(core.extensions?.["buildingType"]).toBe("residential");
  });

  it("Landscape domain data is in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(LANDSCAPE_PROJECT_CONTEXT);
    expect("siteType" in core).toBe(false);
    expect(core.extensions?.["siteType"]).toBe("residential-garden");
  });

  it("Industrial Product domain data is in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(INDUSTRIAL_PRODUCT_PROJECT_CONTEXT);
    expect("productCategory" in core).toBe(false);
    expect(core.extensions?.["productCategory"]).toBe("consumer-electronics");
  });

  it("Jewelry domain data is in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(JEWELRY_PROJECT_CONTEXT);
    expect("metalType" in core).toBe(false);
    expect(core.extensions?.["metalType"]).toBe("18k-gold");
  });
});

// ── LN: Artifact lineage ───────────────────────────────────────────────────────

describe("LN1 — Artifact lineage: EXAMPLE_ARTIFACT_LINEAGE passes ArtifactRelationshipSchema", () => {
  it("all lineage edges are valid ArtifactRelationship objects", () => {
    for (const edge of EXAMPLE_ARTIFACT_LINEAGE) {
      const result = ArtifactRelationshipSchema.safeParse(edge);
      expect(result.success).toBe(true);
    }
  });
});

describe("LN2 — Artifact lineage: findArtifactDependencies works on example lineage", () => {
  it("Logo artifact has Moodboard as a dependency (Moodboard → Logo)", () => {
    const LOGO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const MOODBOARD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const deps = findArtifactDependencies(LOGO_ID, EXAMPLE_ARTIFACT_LINEAGE);
    expect(deps).toContain(MOODBOARD_ID);
  });
});

describe("LN3 — Artifact lineage: findArtifactDependents works on example lineage", () => {
  it("Moodboard has Logo as a dependent (Moodboard → Logo)", () => {
    const LOGO_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const MOODBOARD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const deps = findArtifactDependents(MOODBOARD_ID, EXAMPLE_ARTIFACT_LINEAGE);
    expect(deps).toContain(LOGO_ID);
  });
});

// ── BC: Backward Compatibility ─────────────────────────────────────────────────

describe("BC1 — Backward compatibility: existing capabilities still parse without new fields", () => {
  it("capability without category, executionPriority, or estimation still parses", () => {
    // This is the minimal shape that existed before Revision 1
    const legacyCapability = {
      capabilityId: "fashion:generate_moodboard",
      displayName: "Generate Moodboard",
      inputSchemaRef: "@workspace/plugins-fashion/capability/generate-moodboard/input",
      outputSchemaRef: "@workspace/plugins-fashion/capability/generate-moodboard/output",
      executionMode: "async_job",
    };
    const result = DesignCapabilityContractSchema.safeParse(legacyCapability);
    expect(result.success).toBe(true);
    if (result.success) {
      // New fields default gracefully
      expect(result.data.executionPriority).toBe("medium");
      expect(result.data.category).toBeUndefined();
      expect(result.data.estimation).toBeUndefined();
    }
  });
});

describe("BC2 — Backward compatibility: existing manifests without dependencies still parse", () => {
  it("manifest without dependencies field defaults to empty array", () => {
    const legacyManifest = {
      pluginId: "fashion",
      displayName: "Fashion Design Plugin",
      version: "1.0.0",
      compatibleContractVersion: 1,
      supportedServices: ["FASHION_DESIGN"],
      briefSchemaRef: "@workspace/plugins-fashion/brief-schema",
      workflowRef: "@workspace/plugins-fashion/workflow",
    };
    const result = DesignPluginManifestSchema.safeParse(legacyManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dependencies).toEqual([]);
    }
  });
});

describe("BC3 — Backward compatibility: existing manifests without stability still parse", () => {
  it("manifest without stability field defaults to 'stable'", () => {
    const result = DesignPluginManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stability).toBe("stable");
    }
  });
});

// ── VC: Version Compatibility ──────────────────────────────────────────────────

describe("VC1 — Version compatibility: DESIGN_CONTRACT_VERSION is integer ≥ 1", () => {
  it("DESIGN_CONTRACT_VERSION is a positive integer", () => {
    expect(Number.isInteger(DESIGN_CONTRACT_VERSION)).toBe(true);
    expect(DESIGN_CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("VC2 — Version compatibility: MINIMUM_SUPPORTED_CONTRACT_VERSION ≤ DESIGN_CONTRACT_VERSION", () => {
  it("minimum supported version does not exceed current version", () => {
    expect(MINIMUM_SUPPORTED_CONTRACT_VERSION).toBeLessThanOrEqual(DESIGN_CONTRACT_VERSION);
    expect(MINIMUM_SUPPORTED_CONTRACT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("VC3 — Version compatibility: checkCompatibility is deterministic", () => {
  it("returns the same result for the same input across multiple calls", () => {
    const r1 = checkCompatibility(DESIGN_CONTRACT_VERSION);
    const r2 = checkCompatibility(DESIGN_CONTRACT_VERSION);
    expect(r1.compatible).toBe(r2.compatible);
    expect(isCompatibleVersion(1)).toBe(isCompatibleVersion(1));
    expect(isCompatibleVersion(0)).toBe(isCompatibleVersion(0));
  });
});

// ── CD: Artifact Graph Cycle Detection ────────────────────────────────────────

describe("CD1 — Cycle detection: linear chain has no cycles", () => {
  it("A→B→C returns empty cycles", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, C)]);
    expect(cycles).toHaveLength(0);
  });
});

describe("CD2 — Cycle detection: A→B, B→A is detected", () => {
  it("two-node cycle is detected", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, A)]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe("CD3 — Cycle detection: A→B→C→A three-node cycle detected", () => {
  it("three-node cycle is detected", () => {
    const cycles = detectArtifactCycles([rel(A, B), rel(B, C), rel(C, A)]);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

// ── NA: Architecture Validation — no forbidden imports ───────────────────────

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules" && entry !== "dist") {
      files.push(...collectSourceFiles(fullPath));
    } else if (
      stat.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

const SRC_DIR = resolve(new URL("..", import.meta.url).pathname);
const SOURCE_FILES = collectSourceFiles(SRC_DIR);

describe("NA1 — No React import in any source file", () => {
  it("no source file imports react or @types/react", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const content = readFileSync(file, "utf8");
      if (/from\s+['"]react['"]/i.test(content) || /require\(['"]react['"]\)/i.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files importing React: ${offenders.join(", ")}`).toHaveLength(0);
  });
});

describe("NA2 — No Express import in any source file", () => {
  it("no source file imports express", () => {
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const content = readFileSync(file, "utf8");
      if (/from\s+['"]express['"]/i.test(content) || /require\(['"]express['"]\)/i.test(content)) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files importing Express: ${offenders.join(", ")}`).toHaveLength(0);
  });
});

describe("NA3 — No database import in any source file", () => {
  it("no source file imports pg, postgres, drizzle, @supabase, knex, or prisma", () => {
    const DB_PATTERNS = [
      /from\s+['"]pg['"]/,
      /from\s+['"]postgres['"]/,
      /from\s+['"]drizzle-orm/,
      /from\s+['"]@supabase\//,
      /from\s+['"]knex['"]/,
      /from\s+['"]@prisma\//,
      /from\s+['"]prisma['"]/,
    ];
    const offenders: string[] = [];
    for (const file of SOURCE_FILES) {
      const content = readFileSync(file, "utf8");
      if (DB_PATTERNS.some((p) => p.test(content))) {
        offenders.push(file);
      }
    }
    expect(offenders, `Files importing DB libraries: ${offenders.join(", ")}`).toHaveLength(0);
  });
});
