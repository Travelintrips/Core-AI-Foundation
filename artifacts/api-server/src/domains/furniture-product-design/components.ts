/**
 * Team 28 — Furniture & Product Design Plugin — Component Definitions
 *
 * Defines product-design component types for furniture and industrial products.
 * These are additive contributions to the design component ecosystem.
 *
 * NOTE FOR TEAM 39:
 *   The core ComponentDomain type (Team 8, design-components/types.ts) does not
 *   currently include "product_design". Before integrating these definitions into
 *   the global componentRegistry, add "product_design" to ComponentDomain in
 *   artifacts/api-server/src/services/design-components/types.ts and add
 *   "product_design" to the ALL_DOMAINS constant. Until that change is merged,
 *   these definitions use a local domain type.
 *
 * TEAM 28 OWNED — do not modify outside feature/team-28-product-design-plugin.
 */

// ── Local domain type (adapter — see Team 39 note above) ─────────────────────

export type ProductDesignDomain = "product_design";

export type ProductComponentType =
  | "structural"
  | "hardware"
  | "connector"
  | "mechanism"
  | "surface"
  | "accessory";

// ── Minimal local ComponentDefinition shape ───────────────────────────────────
// Mirrors artifacts/api-server/src/services/design-components/types.ts
// ComponentDefinition interface so these can be integrated without change.

export interface PdFieldDefinition {
  type: "string" | "number" | "boolean" | "color" | "url" | "enum" | "mm" | "text";
  label: string;
  required: boolean;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
  description?: string;
}

export interface PdConstraint {
  name: string;
  description: string;
  rule: "required" | "min" | "max" | "enum" | "custom";
  value?: unknown;
}

export interface PdComponentDefinition {
  type: ProductComponentType;
  domain: ProductDesignDomain;
  name: string;
  slug: string;
  description: string;
  version: string;
  tags: string[];
  properties: Record<string, PdFieldDefinition>;
  constraints: PdConstraint[];
}

// ── Structural component ──────────────────────────────────────────────────────

const structural: PdComponentDefinition = {
  type: "structural",
  domain: "product_design",
  name: "Structural Component",
  slug: "pd-structural",
  description: "Primary load-bearing element: frame, leg, beam, post, rail, stretcher, or apron.",
  version: "1.0.0",
  tags: ["structure", "frame", "load-bearing", "furniture"],
  properties: {
    elementType: {
      type: "enum", label: "Element Type", required: true,
      options: ["leg", "frame", "beam", "post", "rail", "stretcher", "apron", "other"],
    },
    material: {
      type: "enum", label: "Material", required: true,
      options: ["solid_wood", "plywood", "mdf", "metal", "other"],
    },
    widthMm: { type: "mm", label: "Width (mm)", required: true, min: 1, max: 5000 },
    depthMm: { type: "mm", label: "Depth (mm)", required: false, min: 1, max: 5000 },
    lengthMm: { type: "mm", label: "Length/Height (mm)", required: true, min: 1, max: 20000 },
    loadCapacityKg: { type: "number", label: "Load Capacity (kg)", required: false, min: 0, max: 10000 },
    finishType: {
      type: "enum", label: "Finish Type", required: false,
      options: ["raw", "painted", "lacquered", "oiled", "waxed", "powder-coated", "other"],
    },
    quantity: { type: "number", label: "Quantity", required: true, min: 1, default: 1 },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "element_type_required", description: "Element type must be specified", rule: "required", value: "elementType" },
    { name: "material_required",     description: "Material must be specified",     rule: "required", value: "material" },
    { name: "width_positive",        description: "Width must be > 0 mm",           rule: "min",      value: 1 },
    { name: "length_positive",       description: "Length must be > 0 mm",          rule: "min",      value: 1 },
  ],
};

// ── Hardware component ────────────────────────────────────────────────────────

const hardware: PdComponentDefinition = {
  type: "hardware",
  domain: "product_design",
  name: "Hardware",
  slug: "pd-hardware",
  description: "Manufactured metal or plastic parts: fasteners, hinges, drawer slides, cam locks.",
  version: "1.0.0",
  tags: ["hardware", "fastener", "hinge", "metal"],
  properties: {
    hardwareType: {
      type: "enum", label: "Hardware Type", required: true,
      options: ["screw", "bolt", "hinge", "drawer-slide", "cam-lock", "barrel-nut", "bolt-cap", "clip", "staple", "other"],
    },
    material: {
      type: "enum", label: "Material", required: false,
      options: ["steel", "stainless-steel", "zinc-alloy", "brass", "aluminium", "plastic", "other"],
    },
    finish: {
      type: "enum", label: "Finish", required: false,
      options: ["zinc-plated", "chrome", "nickel", "black-oxide", "raw", "powder-coated", "other"],
    },
    standardSize: { type: "string", label: "Standard Size / Part No.", required: false, maxLength: 100, description: "e.g. M6×50, BLUM 71B3550" },
    quantity: { type: "number", label: "Quantity", required: true, min: 1, default: 1 },
    supplierCategory: { type: "string", label: "Supplier Category", required: false, maxLength: 200 },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "hardware_type_required", description: "Hardware type is required", rule: "required", value: "hardwareType" },
    { name: "quantity_min",           description: "Quantity must be ≥ 1",      rule: "min",      value: 1 },
  ],
};

// ── Connector / Joinery component ─────────────────────────────────────────────

const connector: PdComponentDefinition = {
  type: "connector",
  domain: "product_design",
  name: "Connector / Joinery",
  slug: "pd-connector",
  description: "Joinery element connecting structural components: dowels, biscuits, mortise-tenon, brackets.",
  version: "1.0.0",
  tags: ["joinery", "connector", "dowel", "bracket"],
  properties: {
    joineryType: {
      type: "enum", label: "Joinery Type", required: true,
      options: ["dowel", "biscuit", "mortise-tenon", "domino", "corner-bracket", "corner-block", "plate", "pocket-screw", "spline", "box-joint", "dovetail", "other"],
    },
    sizeMm: { type: "mm", label: "Size (mm)", required: false, min: 1, max: 500, description: "Diameter for dowels; width for plates" },
    material: {
      type: "enum", label: "Material", required: false,
      options: ["solid_wood", "plywood", "metal", "plastic", "other"],
    },
    quantity: { type: "number", label: "Quantity per joint", required: false, min: 1, default: 1 },
    strengthRating: {
      type: "enum", label: "Strength Rating", required: false,
      options: ["light-duty", "medium-duty", "heavy-duty"],
    },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "joinery_type_required", description: "Joinery type is required", rule: "required", value: "joineryType" },
  ],
};

// ── Mechanism component ───────────────────────────────────────────────────────

const mechanism: PdComponentDefinition = {
  type: "mechanism",
  domain: "product_design",
  name: "Mechanism",
  slug: "pd-mechanism",
  description: "Moving or adjustable part: folding mechanism, locking device, adjustment system.",
  version: "1.0.0",
  tags: ["mechanism", "adjustable", "folding", "locking"],
  properties: {
    mechanismType: {
      type: "enum", label: "Mechanism Type", required: true,
      options: ["folding-mechanism", "locking-leg", "height-adjuster", "swivel-base", "extension-leaf", "reclining-back", "lift-top", "push-to-open", "soft-close", "other"],
    },
    adjustmentRangeMm: {
      type: "number", label: "Adjustment Range (mm)", required: false, min: 0, max: 2000,
      description: "Total range of travel or adjustment",
    },
    loadCapacityKg: { type: "number", label: "Load Capacity (kg)", required: false, min: 0, max: 5000 },
    requiresToolToAdjust: {
      type: "boolean", label: "Requires Tool to Adjust", required: false, default: false,
    },
    brand: { type: "string", label: "Brand / Supplier", required: false, maxLength: 100 },
    partNumber: { type: "string", label: "Part Number", required: false, maxLength: 100 },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "mechanism_type_required", description: "Mechanism type is required", rule: "required", value: "mechanismType" },
  ],
};

// ── Surface component ─────────────────────────────────────────────────────────

const surface: PdComponentDefinition = {
  type: "surface",
  domain: "product_design",
  name: "Surface",
  slug: "pd-surface",
  description: "Applied surface treatment or covering: laminates, veneers, paints, upholstery.",
  version: "1.0.0",
  tags: ["surface", "finish", "laminate", "veneer", "upholstery"],
  properties: {
    surfaceType: {
      type: "enum", label: "Surface Type", required: true,
      options: ["laminate", "veneer", "solid-wood-top", "painted-mdf", "upholstered-panel", "glass-top", "metal-sheet", "stone-top", "fabric", "leather", "other"],
    },
    color: { type: "color", label: "Primary Color", required: false },
    texture: {
      type: "enum", label: "Texture", required: false,
      options: ["smooth", "matte", "gloss", "satin", "woodgrain", "brushed", "hammered", "embossed", "other"],
    },
    thicknessMm: { type: "mm", label: "Thickness (mm)", required: false, min: 0.1, max: 100 },
    durabilityClass: {
      type: "enum", label: "Durability Class", required: false,
      options: ["light-duty", "medium-duty", "heavy-duty", "commercial"],
    },
    maintenanceNotes: { type: "text", label: "Maintenance Notes", required: false, maxLength: 500 },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "surface_type_required", description: "Surface type is required", rule: "required", value: "surfaceType" },
  ],
};

// ── Accessory component ───────────────────────────────────────────────────────

const accessory: PdComponentDefinition = {
  type: "accessory",
  domain: "product_design",
  name: "Accessory",
  slug: "pd-accessory",
  description: "Secondary attached element: handle, knob, caster, shelf pin, cable grommet.",
  version: "1.0.0",
  tags: ["accessory", "handle", "knob", "caster", "fitting"],
  properties: {
    accessoryType: {
      type: "enum", label: "Accessory Type", required: true,
      options: ["handle", "knob", "caster", "glide", "shelf-pin", "cable-grommet", "drawer-pull", "hook", "label-holder", "key-lock", "other"],
    },
    material: {
      type: "enum", label: "Material", required: false,
      options: ["metal", "brass", "chrome", "plastic", "wood", "leather", "ceramic", "other"],
    },
    finish: {
      type: "enum", label: "Finish", required: false,
      options: ["polished", "brushed", "matte-black", "chrome", "antique-brass", "raw", "painted", "other"],
    },
    sizeMm: { type: "mm", label: "Key Dimension (mm)", required: false, min: 1, max: 1000 },
    quantity: { type: "number", label: "Quantity", required: true, min: 1, default: 1 },
    brand: { type: "string", label: "Brand / Supplier", required: false, maxLength: 100 },
    partNumber: { type: "string", label: "Part Number", required: false, maxLength: 100 },
    notes: { type: "text", label: "Notes", required: false, maxLength: 500 },
  },
  constraints: [
    { name: "accessory_type_required", description: "Accessory type is required", rule: "required", value: "accessoryType" },
    { name: "quantity_min",            description: "Quantity must be ≥ 1",        rule: "min",      value: 1 },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const PD_COMPONENT_REGISTRY: readonly PdComponentDefinition[] = Object.freeze([
  structural,
  hardware,
  connector,
  mechanism,
  surface,
  accessory,
]);

const BY_TYPE = new Map<ProductComponentType, PdComponentDefinition>(
  PD_COMPONENT_REGISTRY.map((c) => [c.type, c])
);

const BY_SLUG = new Map<string, PdComponentDefinition>(
  PD_COMPONENT_REGISTRY.map((c) => [c.slug, c])
);

export function getPdComponent(type: ProductComponentType): PdComponentDefinition | undefined {
  return BY_TYPE.get(type);
}

export function getPdComponentBySlug(slug: string): PdComponentDefinition | undefined {
  return BY_SLUG.get(slug);
}

export function listPdComponents(): readonly PdComponentDefinition[] {
  return PD_COMPONENT_REGISTRY;
}

export function isValidPdComponentType(type: string): type is ProductComponentType {
  return BY_TYPE.has(type as ProductComponentType);
}

export function getPdComponentStats() {
  return {
    total: PD_COMPONENT_REGISTRY.length,
    types: PD_COMPONENT_REGISTRY.map((c) => c.type),
    domain: "product_design" as const,
  };
}
