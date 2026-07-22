/**
 * Team 10 — Universal Design API: Plugin Registry
 *
 * Domain manifests are code-defined (no DB). Each plugin describes its
 * brief schema reference, workflow, artifact types, capabilities, and
 * pipeline stages. The API core has no domain-specific endpoint logic —
 * consumers read the manifest and adapt their UI accordingly.
 *
 * To add a new plugin: append an entry to PLUGIN_REGISTRY below.
 * No migration or endpoint clone required.
 */

export interface ArtifactTypeDefinition {
  type: string;
  label: string;
  description?: string;
  mimeTypes?: string[];
}

export interface StageDefinition {
  stageId: string;
  label: string;
  order: number;
  description?: string;
}

export interface PluginManifest {
  pluginId: string;
  name: string;
  domain: string;
  version: string;
  /** Reference to the Zod/JSON-Schema brief spec for this domain */
  briefSchemaRef: string;
  /** Workflow template identifier — resolved at runtime by the workflow engine */
  workflowId: string;
  /** Feature capabilities exposed to consumers. UI reads this — never hard-codes. */
  capabilities: Record<string, boolean>;
  artifactTypes: ArtifactTypeDefinition[];
  stages: StageDefinition[];
  featureFlags?: Record<string, boolean>;
}

const PLUGIN_REGISTRY: readonly PluginManifest[] = [
  // ── Fashion & Apparel Design ───────────────────────────────────────────────
  {
    pluginId: "fashion",
    name: "Fashion & Apparel Design",
    domain: "fashion",
    version: "1.0.0",
    briefSchemaRef: "brief-schema://fashion/v1",
    workflowId: "fashion-design-workflow-v1",
    capabilities: {
      moodboard: true,
      techPack: true,
      colorwayVariants: true,
      patternGeneration: true,
      fabricSuggestion: true,
      "3dVisualization": false,
      exportCad: true,
    },
    artifactTypes: [
      { type: "moodboard", label: "Moodboard", description: "Visual direction and inspiration board" },
      { type: "concept_sketch", label: "Concept Sketch", description: "Initial garment concept illustrations" },
      { type: "technical_drawing", label: "Technical Drawing (Flat)", description: "Flat technical garment specification" },
      { type: "tech_pack", label: "Tech Pack", description: "Full production specification document" },
      { type: "colorway", label: "Colorway", description: "Color variant renderings" },
      { type: "fabric_swatch", label: "Fabric Swatch", description: "Material and texture references" },
    ],
    stages: [
      { stageId: "brief", label: "Brief & Requirements", order: 0 },
      { stageId: "moodboard", label: "Moodboard", order: 1 },
      { stageId: "concept", label: "Concept Design", order: 2 },
      { stageId: "technical", label: "Technical Drawing", order: 3 },
      { stageId: "material", label: "Material & Component Selection", order: 4 },
      { stageId: "production_spec", label: "Production Specification", order: 5 },
      { stageId: "review", label: "Client Review", order: 6 },
      { stageId: "export", label: "Export & Delivery", order: 7 },
    ],
  },

  // ── Interior Design ────────────────────────────────────────────────────────
  {
    pluginId: "interior",
    name: "Interior Design",
    domain: "interior",
    version: "1.0.0",
    briefSchemaRef: "brief-schema://interior/v1",
    workflowId: "interior-design-workflow-v1",
    capabilities: {
      moodboard: true,
      floorPlan: true,
      materialBoard: true,
      elevationDrawing: true,
      lightingPlan: true,
      "3dVisualization": true,
      furnitureSchedule: true,
    },
    artifactTypes: [
      { type: "moodboard", label: "Moodboard" },
      { type: "concept_board", label: "Concept Board", description: "Visual direction and style" },
      { type: "floor_plan", label: "Floor Plan", description: "Spatial layout drawing" },
      { type: "elevation", label: "Elevation Drawing", description: "Wall elevations and sections" },
      { type: "material_board", label: "Material & Finish Board" },
      { type: "lighting_plan", label: "Lighting Plan" },
      { type: "visualization_3d", label: "3D Visualization / Render", mimeTypes: ["image/jpeg", "image/png"] },
      { type: "furniture_schedule", label: "Furniture & Fixture Schedule" },
    ],
    stages: [
      { stageId: "brief", label: "Brief & Requirements", order: 0 },
      { stageId: "concept", label: "Concept & Style Direction", order: 1 },
      { stageId: "space_planning", label: "Space Planning", order: 2 },
      { stageId: "material", label: "Material & Component Selection", order: 3 },
      { stageId: "visualization", label: "3D Visualization", order: 4 },
      { stageId: "production_spec", label: "Production Specification", order: 5 },
      { stageId: "review", label: "Client Review", order: 6 },
      { stageId: "export", label: "Export & Delivery", order: 7 },
    ],
  },

  // ── Packaging Design ───────────────────────────────────────────────────────
  {
    pluginId: "packaging",
    name: "Packaging Design",
    domain: "packaging",
    version: "1.0.0",
    briefSchemaRef: "brief-schema://packaging/v1",
    workflowId: "packaging-design-workflow-v1",
    capabilities: {
      moodboard: true,
      structureDieline: true,
      mockupRendering: true,
      printReadyExport: true,
      barcodePlaceholder: true,
      "3dVisualization": true,
    },
    artifactTypes: [
      { type: "moodboard", label: "Moodboard" },
      { type: "dieline", label: "Structure / Dieline", description: "Flat die-cut template", mimeTypes: ["image/svg+xml", "application/pdf"] },
      { type: "artwork_flat", label: "Flat Artwork", description: "Unfolded print-ready artwork" },
      { type: "mockup_3d", label: "3D Mockup", description: "Rendered product packaging visualization" },
      { type: "print_spec", label: "Print Specification", description: "Color, substrate, and finish spec" },
      { type: "export_pdf", label: "Print-Ready PDF", mimeTypes: ["application/pdf"] },
    ],
    stages: [
      { stageId: "brief", label: "Brief & Requirements", order: 0 },
      { stageId: "moodboard", label: "Moodboard", order: 1 },
      { stageId: "structure", label: "Structure & Dieline", order: 2 },
      { stageId: "artwork", label: "Artwork Design", order: 3 },
      { stageId: "mockup", label: "3D Mockup", order: 4 },
      { stageId: "production_spec", label: "Production Specification", order: 5 },
      { stageId: "review", label: "Client Review", order: 6 },
      { stageId: "export", label: "Export & Delivery", order: 7 },
    ],
  },

  // ── Branding & Identity ────────────────────────────────────────────────────
  {
    pluginId: "branding",
    name: "Branding & Identity",
    domain: "branding",
    version: "1.0.0",
    briefSchemaRef: "brief-schema://branding/v1",
    workflowId: "branding-design-workflow-v1",
    capabilities: {
      brandStrategy: true,
      logoDesign: true,
      colorSystem: true,
      typographySystem: true,
      brandGuideline: true,
      applicationMockups: true,
      "3dVisualization": false,
    },
    artifactTypes: [
      { type: "brand_strategy", label: "Brand Strategy Document" },
      { type: "logo_concept", label: "Logo Concept", description: "Primary and alternate mark options" },
      { type: "logo_final", label: "Final Logo Package", mimeTypes: ["image/svg+xml", "image/png", "application/pdf"] },
      { type: "color_system", label: "Color System", description: "Primary, secondary, and neutral palette" },
      { type: "typography_system", label: "Typography System" },
      { type: "brand_guideline", label: "Brand Guideline", mimeTypes: ["application/pdf"] },
      { type: "application_mockup", label: "Application Mockup", description: "Real-world usage renderings" },
    ],
    stages: [
      { stageId: "brief", label: "Brief & Discovery", order: 0 },
      { stageId: "strategy", label: "Brand Strategy", order: 1 },
      { stageId: "concept", label: "Visual Concept", order: 2 },
      { stageId: "logo", label: "Logo Design", order: 3 },
      { stageId: "system", label: "Brand System", order: 4 },
      { stageId: "guideline", label: "Brand Guideline", order: 5 },
      { stageId: "review", label: "Client Review", order: 6 },
      { stageId: "export", label: "Export & Delivery", order: 7 },
    ],
  },

  // ── Graphic Design ─────────────────────────────────────────────────────────
  {
    pluginId: "graphic",
    name: "Graphic Design",
    domain: "graphic",
    version: "1.0.0",
    briefSchemaRef: "brief-schema://graphic/v1",
    workflowId: "graphic-design-workflow-v1",
    capabilities: {
      moodboard: true,
      layoutDesign: true,
      printReadyExport: true,
      socialAssets: true,
      "3dVisualization": false,
    },
    artifactTypes: [
      { type: "moodboard", label: "Moodboard" },
      { type: "layout", label: "Layout Design" },
      { type: "print_ready", label: "Print-Ready File", mimeTypes: ["application/pdf"] },
      { type: "digital_asset", label: "Digital Asset", mimeTypes: ["image/png", "image/svg+xml"] },
    ],
    stages: [
      { stageId: "brief", label: "Brief & Requirements", order: 0 },
      { stageId: "concept", label: "Concept Direction", order: 1 },
      { stageId: "layout", label: "Layout Design", order: 2 },
      { stageId: "refinement", label: "Refinement", order: 3 },
      { stageId: "review", label: "Client Review", order: 4 },
      { stageId: "export", label: "Export & Delivery", order: 5 },
    ],
  },
] as const;

// ── Lookup helpers ────────────────────────────────────────────────────────────

const _registryMap = new Map<string, PluginManifest>(
  PLUGIN_REGISTRY.map((p) => [p.pluginId, p]),
);

/** Returns the manifest for a given pluginId, or null if not found. */
export function getPluginManifest(pluginId: string): PluginManifest | null {
  return _registryMap.get(pluginId) ?? null;
}

/** Returns all registered plugin IDs. */
export function listPluginIds(): string[] {
  return Array.from(_registryMap.keys());
}

/** Infers a pluginId from a project's tags or name. Returns null if ambiguous. */
export function inferPluginId(tags?: string[] | null, name?: string | null): string | null {
  const candidates = [...(tags ?? []), ...(name ? [name.toLowerCase()] : [])];
  for (const token of candidates) {
    const lower = token.toLowerCase();
    for (const id of _registryMap.keys()) {
      if (lower.includes(id)) return id;
    }
  }
  return null;
}
