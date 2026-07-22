/**
 * fixtures.ts — Sample design capabilities for Fashion, Interior, and Packaging domains.
 *
 * These are reference registrations that:
 *   1. Demonstrate the registry contract for each domain.
 *   2. Serve as test fixtures (imported by __tests__/).
 *   3. Reuse existing AI capability skill references where the semantic is identical.
 *
 * Call registerFixtures(schemaReg, capabilityReg) once at startup or in tests.
 * The function is idempotent-safe when registries are freshly created (empty).
 *
 * NOTE: These fixtures do NOT register additional DB rows — they reference
 * existing ai_capabilities.skill values by name (aiCapabilityRef).
 */

import { z } from "zod/v4";
import type { DesignSchemaRegistry } from "./designSchemaRegistry.js";
import type { DesignCapabilityRegistry } from "./designCapabilityRegistry.js";
import type { DesignSchemaEntry, DesignCapabilityEntry } from "./types.js";

// ── Schema fixtures ───────────────────────────────────────────────────────────

export const FIXTURE_SCHEMAS: DesignSchemaEntry[] = [
  // ----- Brief schemas -----
  {
    id: "design.brief.fashion",
    version: "1.0.0",
    category: "brief",
    description: "Brief schema for fashion design requests",
    validator: z.object({
      garmentType: z.string().min(1),
      targetMarket: z.string().min(1),
      styleKeywords: z.array(z.string()).min(1),
      colorPalette: z.array(z.string()).optional(),
      fabricPreferences: z.array(z.string()).optional(),
      occasionType: z.string().optional(),
      budgetTier: z.enum(["budget", "mid", "premium", "luxury"]).optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0", aliases: ["fashion.brief"] },
  },
  {
    id: "design.brief.interior",
    version: "1.0.0",
    category: "brief",
    description: "Brief schema for interior design requests",
    validator: z.object({
      roomType: z.string().min(1),
      designStyle: z.string().min(1),
      squareMeters: z.number().positive().optional(),
      colorScheme: z.array(z.string()).optional(),
      functionalRequirements: z.array(z.string()).optional(),
      budgetTier: z.enum(["budget", "mid", "premium", "luxury"]).optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0", aliases: ["interior.brief"] },
  },
  {
    id: "design.brief.packaging",
    version: "1.0.0",
    category: "brief",
    description: "Brief schema for packaging design requests",
    validator: z.object({
      productCategory: z.string().min(1),
      packagingType: z.enum(["box", "bag", "bottle", "pouch", "sleeve", "label", "other"]),
      brandKeywords: z.array(z.string()).min(1),
      colorPreferences: z.array(z.string()).optional(),
      materialConstraints: z.array(z.string()).optional(),
      printingMethod: z.string().optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0", aliases: ["packaging.brief"] },
  },

  // ----- Artifact / output schemas -----
  {
    id: "design.artifact.moodboard",
    version: "1.0.0",
    category: "artifact",
    description: "Moodboard output schema",
    validator: z.object({
      title: z.string(),
      visualTheme: z.string(),
      referenceImages: z.array(z.string().url()),
      colorPalette: z.array(z.string()),
      keywords: z.array(z.string()),
      notes: z.string().optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0" },
  },
  {
    id: "design.artifact.concept",
    version: "1.0.0",
    category: "artifact",
    description: "Design concept output schema",
    validator: z.object({
      conceptTitle: z.string(),
      description: z.string(),
      styleDirection: z.string(),
      keyElements: z.array(z.string()),
      moodboardRef: z.string().optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0" },
  },
  {
    id: "design.artifact.technical_spec",
    version: "1.0.0",
    category: "technical_specification",
    description: "Technical specification output schema",
    validator: z.object({
      specVersion: z.string(),
      materials: z.array(z.object({ name: z.string(), quantity: z.string().optional() })),
      dimensions: z.record(z.string(), z.string()).optional(),
      colorCodes: z.array(z.string()).optional(),
      productionNotes: z.string().optional(),
    }),
    compatibilityMetadata: { minVersion: "1.0.0" },
  },
  {
    id: "design.artifact.export_manifest",
    version: "1.0.0",
    category: "export_manifest",
    description: "Export manifest listing deliverable assets",
    validator: z.object({
      projectId: z.string(),
      exportedAt: z.string(),
      assets: z.array(
        z.object({
          filename: z.string(),
          format: z.string(),
          sizeBytes: z.number().optional(),
          purpose: z.string().optional(),
        }),
      ),
    }),
    compatibilityMetadata: { minVersion: "1.0.0" },
  },
];

// ── Capability fixtures ───────────────────────────────────────────────────────

export const FIXTURE_CAPABILITIES: DesignCapabilityEntry[] = [
  // ── FASHION ──────────────────────────────────────────────────────────────────
  {
    id: "design:fashion:brief:analyze",
    aiCapabilityRef: "creative_brief",     // reuses existing ai_capabilities skill
    domain: "fashion",
    stageApplicability: ["brief"],
    executionKind: "ai_text",
    inputSchemaId: "design.brief.fashion",
    outputSchemaId: "design.artifact.concept",
    costObservabilityRequired: true,
    description: "Analyze a fashion design brief and produce an initial concept",
    guardrailOverrides: { maxCostPerRequest: 0.1, maxRetryPerProvider: 2 },
  },
  {
    id: "design:fashion:moodboard:generate",
    aiCapabilityRef: "image_generation",   // reuses existing ai_capabilities skill
    domain: "fashion",
    stageApplicability: ["moodboard"],
    executionKind: "ai_image",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.moodboard",
    costObservabilityRequired: true,
    description: "Generate a fashion moodboard from a design concept",
    guardrailOverrides: { maxCostPerRequest: 0.5, providerTimeoutMs: 90000 },
  },
  {
    id: "design:fashion:technical:specify",
    domain: "fashion",
    stageApplicability: ["technical_design", "production_specification"],
    executionKind: "ai_text",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.technical_spec",
    costObservabilityRequired: true,
    description: "Generate technical specifications (measurements, materials, construction notes) from a fashion concept",
  },
  {
    id: "design:fashion:export:package",
    domain: "fashion",
    stageApplicability: ["export"],
    executionKind: "export",
    inputSchemaId: "design.artifact.technical_spec",
    outputSchemaId: "design.artifact.export_manifest",
    exportDependencies: ["zip_export"],
    costObservabilityRequired: false,
    description: "Package fashion design deliverables into a ZIP archive",
  },

  // ── INTERIOR ─────────────────────────────────────────────────────────────────
  {
    id: "design:interior:brief:analyze",
    aiCapabilityRef: "creative_brief",
    domain: "interior",
    stageApplicability: ["brief"],
    executionKind: "ai_text",
    inputSchemaId: "design.brief.interior",
    outputSchemaId: "design.artifact.concept",
    costObservabilityRequired: true,
    description: "Analyze an interior design brief and produce a design concept",
    guardrailOverrides: { maxCostPerRequest: 0.1, maxRetryPerProvider: 2 },
  },
  {
    id: "design:interior:moodboard:generate",
    aiCapabilityRef: "image_generation",
    domain: "interior",
    stageApplicability: ["moodboard"],
    executionKind: "ai_image",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.moodboard",
    costObservabilityRequired: true,
    description: "Generate an interior design moodboard from a concept",
    guardrailOverrides: { maxCostPerRequest: 0.5, providerTimeoutMs: 90000 },
  },
  {
    id: "design:interior:material:select",
    domain: "interior",
    stageApplicability: ["material_selection"],
    executionKind: "ai_text",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.technical_spec",
    costObservabilityRequired: true,
    description: "Recommend materials and components for an interior design concept",
  },

  // ── PACKAGING ─────────────────────────────────────────────────────────────────
  {
    id: "design:packaging:brief:analyze",
    aiCapabilityRef: "creative_brief",
    domain: "packaging",
    stageApplicability: ["brief"],
    executionKind: "ai_text",
    inputSchemaId: "design.brief.packaging",
    outputSchemaId: "design.artifact.concept",
    costObservabilityRequired: true,
    description: "Analyze a packaging brief and produce a design concept",
    guardrailOverrides: { maxCostPerRequest: 0.1 },
  },
  {
    id: "design:packaging:concept:visualize",
    aiCapabilityRef: "image_generation",
    domain: "packaging",
    stageApplicability: ["concept", "visualization"],
    executionKind: "ai_image",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.moodboard",
    costObservabilityRequired: true,
    description: "Render a packaging design concept visualization",
    guardrailOverrides: { maxCostPerRequest: 0.5, providerTimeoutMs: 90000 },
  },
  {
    id: "design:packaging:spec:generate",
    domain: "packaging",
    stageApplicability: ["production_specification"],
    executionKind: "ai_text",
    inputSchemaId: "design.artifact.concept",
    outputSchemaId: "design.artifact.technical_spec",
    costObservabilityRequired: true,
    description: "Generate production-ready specifications for a packaging design",
  },
];

// ── Registration helper ───────────────────────────────────────────────────────

/**
 * Register all fixture schemas and capabilities into the provided registries.
 *
 * Safe to call multiple times on fresh (empty) registries.
 * Will throw RegistrationCollisionError if called on a populated registry —
 * clear() both registries first if you need to re-register.
 */
export function registerFixtures(
  schemaRegistry: DesignSchemaRegistry,
  capabilityRegistry: DesignCapabilityRegistry,
): void {
  for (const schema of FIXTURE_SCHEMAS) {
    schemaRegistry.register(schema);
  }
  for (const capability of FIXTURE_CAPABILITIES) {
    capabilityRegistry.register(capability);
  }
}
