/**
 * contracts.test.ts — Universal Design Architecture Contracts
 *
 * Tests required by Team-01 brief:
 *  V1  — valid canonical contract (DesignProjectContext)
 *  V2  — valid DesignArtifactContract
 *  V3  — valid DesignPluginManifest
 *  V4  — valid DesignStageDefinition
 *  V5  — valid DesignCapabilityContract
 *  V6  — valid event envelope
 *  V7  — valid command envelope
 *  M1  — missing required field (projectId)
 *  M2  — missing required field (tenantId)
 *  M3  — missing required field (actor)
 *  M4  — missing stageId
 *  M5  — missing capabilityId
 *  U1  — unsupported contract version (too old)
 *  U2  — unsupported contract version (too new)
 *  U3  — non-integer contract version
 *  X1  — unknown extension field policy (passthrough, not failure)
 *  E1  — event envelope validation (valid)
 *  E2  — event envelope — missing eventType
 *  P1  — plugin manifest validation (valid)
 *  P2  — plugin manifest — invalid pluginId format
 *  P3  — plugin manifest — incompatible contract version
 *  S1  — serialization/deserialization stability
 *  S2  — round-trip: stringify → parse produces identical contract
 *  C1  — no domain leakage: core contract fields contain no Fashion/Interior terms
 *  C2  — no domain leakage: Zod schema keys are domain-agnostic
 *  D1  — detectStageCycles: acyclic DAG → no cycles
 *  D2  — detectStageCycles: cycle detected correctly
 *  A1  — all example domain contexts pass schema validation
 *  A2  — branding artifact example passes schema validation
 *  A3  — compatibility check returns structured result (not exception)
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  DesignProjectContextSchema,
  DesignArtifactContractSchema,
  DesignPluginManifestSchema,
  DesignStageDefinitionSchema,
  DesignCapabilityContractSchema,
  GenericDesignEventSchema,
  GenericDesignCommandSchema,
  DESIGN_CONTRACT_VERSION,
  MINIMUM_SUPPORTED_CONTRACT_VERSION,
  assertCompatibleVersion,
  isCompatibleVersion,
  checkCompatibility,
  ArchitectureCompatibilityError,
  parseContract,
  ok,
  fail,
  detectStageCycles,
} from "../index.js";

import {
  FASHION_PROJECT_CONTEXT,
  FASHION_PLUGIN_MANIFEST,
  INTERIOR_PROJECT_CONTEXT,
  INTERIOR_PLUGIN_MANIFEST,
  PACKAGING_PROJECT_CONTEXT,
  PACKAGING_PLUGIN_MANIFEST,
  BRANDING_PROJECT_CONTEXT,
  BRANDING_ARTIFACT_LOGO,
  BRANDING_PLUGIN_MANIFEST,
  EXAMPLE_STAGE_STARTED_EVENT,
} from "../examples/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseContext(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: "tenant_test",
    serviceType: "TEST_SERVICE",
    domainPluginId: "test-plugin",
    locale: "en-US",
    status: "draft",
    actor: {
      actorId: "usr_test",
      actorType: "customer",
      tenantId: "tenant_test",
    },
    correlationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    contractVersion: DESIGN_CONTRACT_VERSION,
    ...overrides,
  };
}

function baseArtifact(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    artifactType: "image",
    projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    stageId: "test-plugin:moodboard",
    version: 1,
    status: "ready",
    storageRef: {
      bucket: "test-bucket",
      key: "tenant_test/project/artifact.png",
    },
    provenance: {
      actorId: "usr_test",
      requestedAt: "2026-07-21T10:00:00.000Z",
    },
    generationSource: "ai_agent",
    reviewStatus: "not_submitted",
    contractVersion: DESIGN_CONTRACT_VERSION,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
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

function baseStage(overrides: Record<string, unknown> = {}) {
  return {
    stageId: "test-plugin:concept",
    title: "Concept",
    category: "concept",
    supportedArtifactTypes: ["image"],
    ...overrides,
  };
}

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

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    eventType: "STAGE_STARTED",
    occurredAt: "2026-07-21T10:00:00.000Z",
    projectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    tenantId: "tenant_test",
    actor: { actorId: "usr_test", actorType: "customer" },
    correlationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    contractVersion: DESIGN_CONTRACT_VERSION,
    payload: { stageId: "test-plugin:concept" },
    ...overrides,
  };
}

// ── V: Valid canonical contracts ───────────────────────────────────────────────

describe("V1 — valid DesignProjectContext", () => {
  it("parses a minimal context", () => {
    const result = DesignProjectContextSchema.safeParse(baseContext());
    expect(result.success).toBe(true);
  });

  it("parses context with brandContext", () => {
    const result = DesignProjectContextSchema.safeParse(
      baseContext({
        brandContext: {
          brandName: "Acme Brand",
          primaryColors: ["#FF0000"],
          brandTags: ["bold"],
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it("parses context with extensions (domain data in escape hatch)", () => {
    const result = DesignProjectContextSchema.safeParse(
      baseContext({ extensions: { fashionSeason: "SS-2026", roomType: "living" } }),
    );
    expect(result.success).toBe(true);
  });
});

describe("V2 — valid DesignArtifactContract", () => {
  it("parses a minimal artifact", () => {
    const result = DesignArtifactContractSchema.safeParse(baseArtifact());
    expect(result.success).toBe(true);
  });

  it("parses artifact with full metadata and provenance", () => {
    const result = DesignArtifactContractSchema.safeParse(
      baseArtifact({
        metadata: { label: "Primary Logo", qualityScore: 92, widthPx: 2400, heightPx: 2400 },
        provenance: {
          actorId: "usr_test",
          requestedAt: "2026-07-21T10:00:00.000Z",
          completedAt: "2026-07-21T10:02:00.000Z",
          jobId: "job_001",
          capabilityId: "test-plugin:generate_concept",
          modelRef: "image-gen-v2",
          promptDigest: "sha256:abc123",
        },
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("V3 — valid DesignPluginManifest", () => {
  it("parses a minimal manifest", () => {
    const result = DesignPluginManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
  });

  it("parses manifest with capabilities and feature flags", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({
        capabilities: [
          { capabilityId: "test-plugin:generate_concept", requiresAi: true, producesDeliverable: true },
        ],
        featureFlags: [
          { key: "test_3d_enabled", defaultEnabled: false },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("V4 — valid DesignStageDefinition", () => {
  it("parses a minimal stage", () => {
    const result = DesignStageDefinitionSchema.safeParse(baseStage());
    expect(result.success).toBe(true);
  });

  it("parses stage with dependencies and optional/repeatable flags", () => {
    const result = DesignStageDefinitionSchema.safeParse(
      baseStage({
        dependencies: ["test-plugin:brief"],
        requiredCapabilities: ["test-plugin:generate_concept"],
        completionPolicy: "client_approval",
        optional: false,
        repeatable: true,
        displayOrder: 2,
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("V5 — valid DesignCapabilityContract", () => {
  it("parses a minimal capability", () => {
    const result = DesignCapabilityContractSchema.safeParse(baseCapability());
    expect(result.success).toBe(true);
  });

  it("parses AI capability with full requirements", () => {
    const result = DesignCapabilityContractSchema.safeParse(
      baseCapability({
        aiRequirement: {
          required: true,
          modelCapabilityClass: "image_generation",
          allowFallback: true,
          maxEstimatedCostUsd: 0.5,
        },
        rendererRequirement: {
          rendererType: "image_compositor",
          outputFormat: "png",
        },
        cacheable: true,
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("V6 — valid DesignEvent envelope", () => {
  it("parses a generic event", () => {
    const result = GenericDesignEventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });
});

describe("V7 — valid DesignCommand envelope", () => {
  it("parses a generic command", () => {
    const result = GenericDesignCommandSchema.safeParse({
      ...baseEvent(),
      commandType: "START_STAGE",
    });
    expect(result.success).toBe(true);
  });
});

// ── M: Missing required fields ─────────────────────────────────────────────────

describe("M1 — missing projectId", () => {
  it("rejects context without projectId", () => {
    const { projectId: _omit, ...rest } = baseContext();
    const result = DesignProjectContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("M2 — missing tenantId", () => {
  it("rejects context without tenantId", () => {
    const { tenantId: _omit, ...rest } = baseContext();
    const result = DesignProjectContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("M3 — missing actor", () => {
  it("rejects context without actor", () => {
    const { actor: _omit, ...rest } = baseContext();
    const result = DesignProjectContextSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("M4 — missing stageId", () => {
  it("rejects stage definition without stageId", () => {
    const { stageId: _omit, ...rest } = baseStage();
    const result = DesignStageDefinitionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("M5 — missing capabilityId", () => {
  it("rejects capability without capabilityId", () => {
    const { capabilityId: _omit, ...rest } = baseCapability();
    const result = DesignCapabilityContractSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── U: Unsupported contract version ───────────────────────────────────────────

describe("U1 — unsupported version (too old)", () => {
  it("isCompatibleVersion returns false for version 0", () => {
    expect(isCompatibleVersion(0)).toBe(false);
  });

  it("assertCompatibleVersion throws ArchitectureCompatibilityError for version 0", () => {
    expect(() => assertCompatibleVersion(0)).toThrow(ArchitectureCompatibilityError);
  });

  it("error message includes the received version", () => {
    try {
      assertCompatibleVersion(0);
    } catch (e) {
      expect(e).toBeInstanceOf(ArchitectureCompatibilityError);
      const err = e as ArchitectureCompatibilityError;
      expect(err.received).toBe(0);
      expect(err.supported.min).toBe(MINIMUM_SUPPORTED_CONTRACT_VERSION);
    }
  });
});

describe("U2 — unsupported version (too new)", () => {
  it("isCompatibleVersion returns false for a far-future version", () => {
    expect(isCompatibleVersion(9999)).toBe(false);
  });

  it("assertCompatibleVersion throws for future version", () => {
    expect(() => assertCompatibleVersion(9999)).toThrow(ArchitectureCompatibilityError);
  });
});

describe("U3 — non-integer version", () => {
  it("isCompatibleVersion returns false for a float", () => {
    expect(isCompatibleVersion(1.5)).toBe(false);
  });

  it("isCompatibleVersion returns false for NaN", () => {
    expect(isCompatibleVersion(NaN)).toBe(false);
  });
});

// ── X: Unknown extension field policy ─────────────────────────────────────────

describe("X1 — unknown extension fields in extensions map", () => {
  it("core schema does not fail on unknown domain extensions", () => {
    // Domain data should go in `extensions`, not core fields.
    // Core schemas use z.object() (not passthrough) for top-level fields
    // but the extensions record accepts any key.
    const result = DesignProjectContextSchema.safeParse(
      baseContext({
        extensions: {
          unknownFieldA: "some-value",
          anotherUnknownField: 42,
          nested: { deep: true }, // allowed in extensions record
        },
      }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extensions?.["unknownFieldA"]).toBe("some-value");
    }
  });

  it("unknown top-level fields are stripped (Zod default: strip mode)", () => {
    const input = { ...baseContext(), rogue_domain_field: "fashion-detail" };
    const result = DesignProjectContextSchema.safeParse(input);
    // Zod strips unknown keys by default — parse succeeds but rogue field is removed
    expect(result.success).toBe(true);
    if (result.success) {
      expect("rogue_domain_field" in result.data).toBe(false);
    }
  });
});

// ── E: Event envelope validation ─────────────────────────────────────────────

describe("E1 — event envelope valid", () => {
  it("passes full event envelope validation", () => {
    const result = GenericDesignEventSchema.safeParse(baseEvent());
    expect(result.success).toBe(true);
  });

  it("accepts null causationId (root event)", () => {
    const result = GenericDesignEventSchema.safeParse(
      baseEvent({ causationId: null }),
    );
    expect(result.success).toBe(true);
  });

  it("sets payloadVersion default to 1 when omitted", () => {
    const result = GenericDesignEventSchema.safeParse(baseEvent());
    if (result.success) {
      expect(result.data.payloadVersion).toBe(1);
    }
  });
});

describe("E2 — event envelope missing eventType", () => {
  it("rejects event without eventType", () => {
    const { eventType: _omit, ...rest } = baseEvent();
    const result = GenericDesignEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ── P: Plugin manifest validation ────────────────────────────────────────────

describe("P1 — plugin manifest valid", () => {
  it("parses valid manifest", () => {
    const result = DesignPluginManifestSchema.safeParse(baseManifest());
    expect(result.success).toBe(true);
  });
});

describe("P2 — invalid pluginId format", () => {
  it("rejects pluginId with uppercase letters", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({ pluginId: "FashionDesign" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects pluginId starting with digit", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({ pluginId: "1fashion" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts valid snake-case pluginId", () => {
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({ pluginId: "my_domain_plugin" }),
    );
    expect(result.success).toBe(true);
  });
});

describe("P3 — incompatible plugin contract version", () => {
  it("parses manifest even with future compatibleContractVersion (validation is at registry load time)", () => {
    // The schema itself allows any positive integer — the runtime check is done
    // by assertCompatibleVersion at plugin load time, not by the Zod schema.
    const result = DesignPluginManifestSchema.safeParse(
      baseManifest({ compatibleContractVersion: 9999 }),
    );
    expect(result.success).toBe(true);
  });

  it("assertCompatibleVersion catches incompatible plugin at load time", () => {
    const manifest = { ...baseManifest(), compatibleContractVersion: 9999 };
    expect(() => assertCompatibleVersion(manifest.compatibleContractVersion)).toThrow(
      ArchitectureCompatibilityError,
    );
  });
});

// ── S: Serialization / deserialization stability ───────────────────────────────

describe("S1 — serialization stability", () => {
  it("JSON.stringify of parsed context is stable (double-parse matches)", () => {
    const parsed1 = DesignProjectContextSchema.parse(baseContext());
    const serialized = JSON.stringify(parsed1);
    const parsed2 = DesignProjectContextSchema.parse(JSON.parse(serialized));
    expect(JSON.stringify(parsed2)).toBe(serialized);
  });
});

describe("S2 — round-trip: stringify → parse produces identical artifact", () => {
  it("artifact round-trips through JSON without data loss", () => {
    const parsed1 = DesignArtifactContractSchema.parse(baseArtifact());
    const json = JSON.stringify(parsed1);
    const parsed2 = DesignArtifactContractSchema.parse(JSON.parse(json));
    expect(JSON.stringify(parsed2)).toBe(json);
  });
});

// ── C: No domain leakage ──────────────────────────────────────────────────────

const DOMAIN_TERMS = [
  "fashion", "interior", "packaging", "branding",
  "garment", "room", "dieline", "logo_type",
  "moodboard_count", "season", "room_type",
];

describe("C1 — no domain leakage in core contract field names", () => {
  it("DesignProjectContext schema keys contain no domain-specific terms", () => {
    const shape = DesignProjectContextSchema.shape;
    const keys = Object.keys(shape).map((k) => k.toLowerCase());
    for (const term of DOMAIN_TERMS) {
      for (const key of keys) {
        expect(key).not.toContain(term);
      }
    }
  });

  it("DesignArtifactContract schema keys contain no domain-specific terms", () => {
    const shape = DesignArtifactContractSchema.shape;
    const keys = Object.keys(shape).map((k) => k.toLowerCase());
    for (const term of DOMAIN_TERMS) {
      for (const key of keys) {
        expect(key).not.toContain(term);
      }
    }
  });

  it("DesignStageDefinition schema keys contain no domain-specific terms", () => {
    const shape = DesignStageDefinitionSchema.shape;
    const keys = Object.keys(shape).map((k) => k.toLowerCase());
    for (const term of DOMAIN_TERMS) {
      for (const key of keys) {
        expect(key).not.toContain(term);
      }
    }
  });
});

describe("C2 — domain detail in examples stays in extensions", () => {
  it("Fashion context domain fields are in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(FASHION_PROJECT_CONTEXT);
    // Domain terms must not appear as direct top-level keys
    expect("fashionSeason" in core).toBe(false);
    expect("targetGender" in core).toBe(false);
    // But they should be reachable via extensions
    expect(core.extensions?.["fashionSeason"]).toBe("SS-2026");
  });

  it("Interior context domain fields are in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(INTERIOR_PROJECT_CONTEXT);
    expect("roomCount" in core).toBe(false);
    expect(core.extensions?.["roomCount"]).toBe(3);
  });

  it("Packaging context domain fields are in extensions, not core", () => {
    const core = DesignProjectContextSchema.parse(PACKAGING_PROJECT_CONTEXT);
    expect("packagingSubtype" in core).toBe(false);
    expect(core.extensions?.["packagingSubtype"]).toBe("box");
  });
});

// ── D: Stage DAG / cycle detection ───────────────────────────────────────────

describe("D1 — detectStageCycles: acyclic DAG", () => {
  it("returns empty array for a valid linear workflow", () => {
    const stages = [
      { ...DesignStageDefinitionSchema.parse(baseStage({ stageId: "p:brief", dependencies: [] })) },
      {
        ...DesignStageDefinitionSchema.parse(
          baseStage({ stageId: "p:moodboard", dependencies: ["p:brief"] }),
        ),
      },
      {
        ...DesignStageDefinitionSchema.parse(
          baseStage({ stageId: "p:concept", dependencies: ["p:moodboard"] }),
        ),
      },
    ];
    expect(detectStageCycles(stages)).toHaveLength(0);
  });

  it("returns empty array for a diamond DAG (shared dependency)", () => {
    const stages = [
      DesignStageDefinitionSchema.parse(baseStage({ stageId: "p:brief", dependencies: [] })),
      DesignStageDefinitionSchema.parse(baseStage({ stageId: "p:moodboard", dependencies: ["p:brief"] })),
      DesignStageDefinitionSchema.parse(baseStage({ stageId: "p:sketch", dependencies: ["p:brief"] })),
      DesignStageDefinitionSchema.parse(
        baseStage({ stageId: "p:technical", dependencies: ["p:moodboard", "p:sketch"] }),
      ),
    ];
    expect(detectStageCycles(stages)).toHaveLength(0);
  });
});

describe("D2 — detectStageCycles: cycle detected", () => {
  it("detects a simple two-node cycle", () => {
    const stages = [
      DesignStageDefinitionSchema.parse(
        baseStage({ stageId: "p:a", dependencies: ["p:b"] }),
      ),
      DesignStageDefinitionSchema.parse(
        baseStage({ stageId: "p:b", dependencies: ["p:a"] }),
      ),
    ];
    const cycles = detectStageCycles(stages);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

// ── A: Example domain contexts pass schema validation ─────────────────────────

describe("A1 — all four domain project contexts are valid", () => {
  const cases = [
    ["Fashion", FASHION_PROJECT_CONTEXT],
    ["Interior", INTERIOR_PROJECT_CONTEXT],
    ["Packaging", PACKAGING_PROJECT_CONTEXT],
    ["Branding", BRANDING_PROJECT_CONTEXT],
  ] as const;

  for (const [domain, ctx] of cases) {
    it(`${domain} project context passes DesignProjectContextSchema`, () => {
      const result = DesignProjectContextSchema.safeParse(ctx);
      expect(result.success, JSON.stringify((result as z.SafeParseError<unknown>).error?.issues ?? [])).toBe(true);
    });
  }

  const manifests = [
    ["Fashion", FASHION_PLUGIN_MANIFEST],
    ["Interior", INTERIOR_PLUGIN_MANIFEST],
    ["Packaging", PACKAGING_PLUGIN_MANIFEST],
    ["Branding", BRANDING_PLUGIN_MANIFEST],
  ] as const;

  for (const [domain, manifest] of manifests) {
    it(`${domain} plugin manifest passes DesignPluginManifestSchema`, () => {
      const result = DesignPluginManifestSchema.safeParse(manifest);
      expect(result.success, JSON.stringify((result as z.SafeParseError<unknown>).error?.issues ?? [])).toBe(true);
    });
  }
});

describe("A2 — branding artifact example passes schema validation", () => {
  it("BRANDING_ARTIFACT_LOGO passes DesignArtifactContractSchema", () => {
    const result = DesignArtifactContractSchema.safeParse(BRANDING_ARTIFACT_LOGO);
    expect(result.success, JSON.stringify((result as z.SafeParseError<unknown>).error?.issues ?? [])).toBe(true);
  });
});

describe("A3 — compatibility check returns structured result", () => {
  it("returns compatible: true for current version", () => {
    const result = checkCompatibility(DESIGN_CONTRACT_VERSION);
    expect(result.compatible).toBe(true);
  });

  it("returns compatible: false with reason for version 0", () => {
    const result = checkCompatibility(0);
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.reason).toContain("minimum supported");
    }
  });

  it("returns compatible: false with reason for future version", () => {
    const result = checkCompatibility(999);
    expect(result.compatible).toBe(false);
  });

  it("returns compatible: false for non-integer", () => {
    const result = checkCompatibility(1.7);
    expect(result.compatible).toBe(false);
  });
});

// ── parseContract helper ──────────────────────────────────────────────────────

describe("parseContract helper", () => {
  it("returns ok() for valid input", () => {
    const result = parseContract(DesignProjectContextSchema, baseContext());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    }
  });

  it("returns fail() for invalid input with structured issues", () => {
    const result = parseContract(DesignProjectContextSchema, { tenantId: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.code).toBe("REQUIRED_FIELD_MISSING");
    }
  });

  it("ok() helper creates correct shape", () => {
    const r = ok({ foo: "bar" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ foo: "bar" });
  });

  it("fail() helper creates correct shape", () => {
    const r = fail("EVENT_VERSION_UNSUPPORTED", "bad version", []);
    expect(r.success).toBe(false);
    expect(r.code).toBe("EVENT_VERSION_UNSUPPORTED");
    expect(r.issues).toHaveLength(0);
  });
});

// ── Example event ─────────────────────────────────────────────────────────────

describe("Example STAGE_STARTED event is valid", () => {
  it("passes GenericDesignEventSchema", () => {
    const result = GenericDesignEventSchema.safeParse(EXAMPLE_STAGE_STARTED_EVENT);
    expect(result.success, JSON.stringify((result as z.SafeParseError<unknown>).error?.issues ?? [])).toBe(true);
  });
});
