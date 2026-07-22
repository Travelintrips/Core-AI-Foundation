/**
 * Team 28 — Furniture & Product Design Plugin Manifest
 *
 * Self-describing manifest for the Furniture and Industrial/Product Design
 * domain plugin. Covers the 12-step workflow, 9 artifact types, 6 component
 * contribution categories, and material contributions.
 *
 * IMPORTANT:
 *  - No CAD runtime, parametric modelling engine, or simulation engine.
 *  - All generation is AI-assisted text/structured-data output.
 *  - Plugin version follows semver; bump PLUGIN_VERSION on any breaking change.
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

export const PLUGIN_ID = "furniture-product-design-v1" as const;
export const PLUGIN_VERSION = "1.0.0" as const;
export const PLUGIN_SCHEMA_VERSION = "1.0" as const;
export const PLUGIN_DOMAIN = "furniture_product_design" as const;

// ── Capability guard ──────────────────────────────────────────────────────────

/** Capabilities this plugin explicitly does NOT provide. */
export const UNSUPPORTED_CAPABILITIES = [
  "cad_runtime",
  "parametric_modelling",
  "simulation_engine",
  "finite_element_analysis",
  "3d_solid_modelling",
] as const;

export type UnsupportedCapability = (typeof UNSUPPORTED_CAPABILITIES)[number];

// ── Workflow steps ────────────────────────────────────────────────────────────

export const WORKFLOW_STEPS = [
  {
    step: 1,
    key: "brief",
    label: "Brief",
    description: "Capture product category, user, environment, function, dimensions, ergonomics, load/usage, material, manufacturing process, budget, sustainability, safety, and compliance requirements.",
    required: true,
    outputArtifactType: null,
  },
  {
    step: 2,
    key: "user_market_research",
    label: "User/Market Research",
    description: "Analyse target users, competitive landscape, and market positioning for the product.",
    required: true,
    outputArtifactType: "product_moodboard" as const,
  },
  {
    step: 3,
    key: "functional_requirements",
    label: "Functional Requirements",
    description: "Define functional specifications derived from brief and research: load capacity, ergonomic targets, regulatory compliance, and use-case scenarios.",
    required: true,
    outputArtifactType: null,
  },
  {
    step: 4,
    key: "concept_direction",
    label: "Concept Direction",
    description: "Establish aesthetic direction, design language, and form vocabulary. Produces mood board and concept narrative.",
    required: true,
    outputArtifactType: "product_moodboard" as const,
  },
  {
    step: 5,
    key: "concept_sketch",
    label: "Concept Sketch",
    description: "AI-assisted concept sketching: thumbnail ideation, silhouette exploration, and form-factor alternatives.",
    required: true,
    outputArtifactType: "product_concept_sketch" as const,
  },
  {
    step: 6,
    key: "form_development",
    label: "Form Development",
    description: "Refine selected concept into a developed form: proportions, joinery logic, ergonomic geometry, and surface articulation.",
    required: true,
    outputArtifactType: "product_form_study" as const,
  },
  {
    step: 7,
    key: "material_component_selection",
    label: "Material/Component Selection",
    description: "Select materials (wood species, metal alloy, fabric, finish) and map structural/hardware/mechanism components.",
    required: true,
    outputArtifactType: "product_material_spec" as const,
  },
  {
    step: 8,
    key: "orthographic_technical_view",
    label: "Orthographic/Technical View",
    description: "Generate annotated orthographic views (front, side, top, section) with key dimensions in mm.",
    required: true,
    outputArtifactType: "product_orthographic_view" as const,
  },
  {
    step: 9,
    key: "visualization",
    label: "Visualization",
    description: "Produce photorealistic or stylised visualisation prompts for AI image generation. Plugin does NOT generate images directly.",
    required: true,
    outputArtifactType: "product_visualization" as const,
  },
  {
    step: 10,
    key: "prototype_specification",
    label: "Prototype Specification",
    description: "Compile prototype spec: materials list, joinery details, hardware BOM, finish schedule, and assembly notes.",
    required: true,
    outputArtifactType: "product_prototype_spec" as const,
  },
  {
    step: 11,
    key: "review",
    label: "Review",
    description: "Admin/designer review gate. Check all outputs against brief requirements. Flag revisions before export.",
    required: true,
    outputArtifactType: null,
  },
  {
    step: 12,
    key: "export",
    label: "Export",
    description: "Package and export all approved outputs: PDFs, structured JSON, and image prompts.",
    required: true,
    outputArtifactType: "product_production_spec" as const,
  },
] as const;

export type WorkflowStepKey = (typeof WORKFLOW_STEPS)[number]["key"];
export const WORKFLOW_STEP_KEYS = WORKFLOW_STEPS.map((s) => s.key);

// ── Artifact types ────────────────────────────────────────────────────────────

export const ARTIFACT_TYPES = [
  {
    type: "product_moodboard",
    label: "Product Moodboard",
    description: "Visual direction board: palette, material textures, form references, mood words.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_concept_sketch",
    label: "Concept Sketch",
    description: "Thumbnail and ideation sketches: silhouette exploration, form alternatives.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_form_study",
    label: "Form Study",
    description: "Developed form analysis: proportions, geometry, ergonomic mapping.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_component_map",
    label: "Component Map",
    description: "Structural breakdown showing parts, subassemblies, hardware, and connection points.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_material_spec",
    label: "Material Specification",
    description: "Full material schedule: species/grade, finish, supplier category, sustainability notes.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_orthographic_view",
    label: "Orthographic/Technical View",
    description: "Annotated orthographic projections with dimensions. No CAD — AI-generated annotations.",
    mimeTypes: ["application/json", "application/pdf"],
    required: true,
  },
  {
    type: "product_visualization",
    label: "Visualization",
    description: "AI image generation prompts and scene descriptions for photorealistic rendering.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_prototype_spec",
    label: "Prototype Specification",
    description: "Complete prototype package: BOM, joinery details, assembly sequence, finish schedule.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
  {
    type: "product_production_spec",
    label: "Production Specification",
    description: "Final export package: all approved outputs bundled with metadata and version stamp.",
    mimeTypes: ["application/json", "application/pdf"],
    required: false,
  },
] as const;

export type ProductArtifactType = (typeof ARTIFACT_TYPES)[number]["type"];
export const ARTIFACT_TYPE_KEYS = ARTIFACT_TYPES.map((a) => a.type);

// ── Component contributions ───────────────────────────────────────────────────

export const COMPONENT_CONTRIBUTIONS = [
  {
    category: "structural",
    label: "Structural Component",
    description: "Primary load-bearing elements: frame, leg, beam, post, rail, stretcher.",
    examples: ["frame", "leg", "beam", "post", "rail", "stretcher", "apron"],
    required: false,
  },
  {
    category: "hardware",
    label: "Hardware",
    description: "Manufactured metal or plastic parts: fasteners, hinges, drawer slides, cam locks.",
    examples: ["screw", "bolt", "hinge", "drawer-slide", "cam-lock", "barrel-nut", "bolt-cap"],
    required: false,
  },
  {
    category: "connector",
    label: "Connector / Joinery",
    description: "Joinery elements that connect structural components: dowels, biscuits, mortise-tenon, brackets.",
    examples: ["dowel", "biscuit", "mortise-tenon", "domino", "bracket", "corner-block", "plate"],
    required: false,
  },
  {
    category: "mechanism",
    label: "Mechanism",
    description: "Moving or adjustable parts: folding mechanisms, locking devices, adjustment systems.",
    examples: ["folding-mechanism", "locking-leg", "height-adjuster", "swivel-base", "extension-leaf"],
    required: false,
  },
  {
    category: "surface",
    label: "Surface",
    description: "Applied surface treatments and coverings: laminates, veneers, paints, upholstery.",
    examples: ["laminate", "veneer", "solid-wood-top", "painted-mdf", "upholstered-panel", "glass-top"],
    required: false,
  },
  {
    category: "accessory",
    label: "Accessory",
    description: "Secondary attached elements: handles, knobs, casters, shelf pins, cable grommets.",
    examples: ["handle", "knob", "caster", "glide", "shelf-pin", "cable-grommet", "drawer-pull"],
    required: false,
  },
] as const;

export type ComponentCategory = (typeof COMPONENT_CONTRIBUTIONS)[number]["category"];
export const COMPONENT_CATEGORIES = COMPONENT_CONTRIBUTIONS.map((c) => c.category);

// ── Material contributions ────────────────────────────────────────────────────

export const MATERIAL_CONTRIBUTIONS = [
  { key: "solid_wood",    label: "Solid Wood",      grades: ["select", "common", "rustic"], sustainabilityNote: "Prefer FSC-certified" },
  { key: "plywood",       label: "Plywood",         grades: ["furniture-grade", "marine", "structural"], sustainabilityNote: "CARB-compliant preferred" },
  { key: "mdf",           label: "MDF / HDF",       grades: ["standard", "moisture-resistant", "fire-resistant"], sustainabilityNote: "Low-formaldehyde E0/E1" },
  { key: "particle_board", label: "Particle Board", grades: ["standard", "melamine-clad"], sustainabilityNote: "CARB-compliant preferred" },
  { key: "metal",         label: "Metal",           grades: ["mild-steel", "stainless-steel", "aluminium", "cast-iron"], sustainabilityNote: "Recycled content preferred" },
  { key: "glass",         label: "Glass",           grades: ["tempered", "laminated", "frosted"], sustainabilityNote: "Low-iron for colour accuracy" },
  { key: "fabric",        label: "Fabric / Textile", grades: ["woven", "knit", "non-woven"], sustainabilityNote: "Recycled fibre or natural preferred" },
  { key: "leather",       label: "Leather / Vegan Leather", grades: ["full-grain", "top-grain", "pu-leather"], sustainabilityNote: "Vegetable-tanned or PU preferred" },
  { key: "plastic",       label: "Plastic / Polymer", grades: ["abs", "pp", "nylon", "acrylic"], sustainabilityNote: "Recyclable grades preferred" },
  { key: "foam",          label: "Foam / Padding",  grades: ["hr-foam", "memory-foam", "rebonded"], sustainabilityNote: "CertiPUR-certified" },
] as const;

export type MaterialKey = (typeof MATERIAL_CONTRIBUTIONS)[number]["key"];
export const MATERIAL_KEYS = MATERIAL_CONTRIBUTIONS.map((m) => m.key);

// ── Capability requirements ───────────────────────────────────────────────────

export const CAPABILITY_REQUIREMENTS = [
  { capability: "ai_text_generation",     required: true,  provider: "openai|anthropic|gemini", notes: "Used in all AI-generation steps" },
  { capability: "structured_json_output", required: true,  provider: "openai",                  notes: "response_format: json_object" },
  { capability: "image_prompt_generation", required: false, provider: "openai|anthropic",        notes: "Visualization step generates prompts only, not images" },
  { capability: "pdf_export",             required: false,  provider: "internal",               notes: "Uses existing PDF infrastructure (pdfkit)" },
  { capability: "object_storage",         required: false,  provider: "supabase",               notes: "For export attachment storage" },
] as const;

// ── Full plugin manifest ──────────────────────────────────────────────────────

export const PLUGIN_MANIFEST = {
  pluginId: PLUGIN_ID,
  version: PLUGIN_VERSION,
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  domain: PLUGIN_DOMAIN,
  name: "Furniture & Industrial/Product Design",
  description: "AI-assisted design workflow for furniture, fixtures, and industrial/consumer products. Covers brief capture through production-ready specification export across a 12-step structured workflow.",
  status: "active" as const,

  // Hard boundary — must never be violated
  unsupportedCapabilities: UNSUPPORTED_CAPABILITIES,

  workflow: WORKFLOW_STEPS,
  artifactTypes: ARTIFACT_TYPES,
  componentContributions: COMPONENT_CONTRIBUTIONS,
  materialContributions: MATERIAL_CONTRIBUTIONS,
  capabilityRequirements: CAPABILITY_REQUIREMENTS,

  // Version compatibility
  minPlatformVersion: "4.0.0",
  maxPlatformVersion: null, // no upper bound

  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
} as const;

export type PluginManifest = typeof PLUGIN_MANIFEST;

/**
 * Runtime guard: assert that a claimed capability is not in the
 * UNSUPPORTED list. Throws if called with an unsupported capability.
 */
export function assertSupportedCapability(cap: string): void {
  if ((UNSUPPORTED_CAPABILITIES as readonly string[]).includes(cap)) {
    throw new Error(
      `[furniture-product-design] Capability "${cap}" is not supported by this plugin. ` +
      `Unsupported: ${UNSUPPORTED_CAPABILITIES.join(", ")}`
    );
  }
}

/**
 * Returns true if the plugin manifest declares the given artifact type.
 */
export function isRegisteredArtifactType(type: string): type is ProductArtifactType {
  return (ARTIFACT_TYPE_KEYS as readonly string[]).includes(type);
}

/**
 * Returns true if the given workflow step key exists in the manifest.
 */
export function isRegisteredWorkflowStep(key: string): key is WorkflowStepKey {
  return (WORKFLOW_STEP_KEYS as readonly string[]).includes(key);
}
