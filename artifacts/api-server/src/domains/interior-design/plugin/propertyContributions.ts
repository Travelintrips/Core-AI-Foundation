/**
 * Team 25 — Interior Design Domain Plugin
 * propertyContributions.ts
 *
 * Defines the property contribution schema for each room/zone and artifact.
 * All IDs are opaque strings scoped to this plugin.
 * No direct DB access — these are pure data descriptors consumed by
 * the rendering pipeline and the client portal.
 */

// ── Opaque property section IDs ───────────────────────────────────────────────

export const INTERIOR_PROPERTY_SECTION_IDS = [
  "zone_metadata",
  "dimensions",
  "surface_material",
  "furniture_reference",
  "lighting",
  "color",
  "finish",
  "notes",
] as const;

export type InteriorPropertySectionId =
  (typeof INTERIOR_PROPERTY_SECTION_IDS)[number];

// ── Property field descriptor ─────────────────────────────────────────────────

export interface PropertyField {
  /** Stable key — used in JSON output and DB JSONB columns */
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "string[]" | "object";
  required: boolean;
  /** Human-readable description for spec docs and UI tooltips */
  description: string;
  /** If type is string, optional allowed values */
  allowedValues?: string[];
  /** Unit label shown alongside numeric fields */
  unit?: string;
}

export interface InteriorPropertySection {
  id: InteriorPropertySectionId;
  label: string;
  description: string;
  fields: PropertyField[];
  /** Which artifact types this section applies to */
  appliesTo: string[];
}

// ── Section definitions ───────────────────────────────────────────────────────

export const INTERIOR_PROPERTY_SECTIONS: Record<
  InteriorPropertySectionId,
  InteriorPropertySection
> = {
  // ── 1. Zone / room metadata ──────────────────────────────────────────────
  zone_metadata: {
    id: "zone_metadata",
    label: "Zone / Room Metadata",
    description:
      "Identifies and classifies a room or functional zone within the project.",
    appliesTo: [
      "interior_space_plan",
      "interior_specification",
      "interior_presentation",
    ],
    fields: [
      {
        key: "zoneId",
        label: "Zone ID",
        type: "string",
        required: true,
        description: "Opaque zone identifier — stable across revisions (e.g. z1, z2).",
      },
      {
        key: "zoneLabel",
        label: "Zone Label",
        type: "string",
        required: true,
        description: "Human-readable zone name (e.g. Seating Area, Kitchen Island).",
      },
      {
        key: "spaceType",
        label: "Space Type",
        type: "string",
        required: true,
        description: "Functional type of this zone (maps to InteriorSpaceType enum).",
      },
      {
        key: "occupancyType",
        label: "Occupancy Type",
        type: "string",
        required: false,
        description: "Residential, commercial, hospitality, or retail.",
        allowedValues: ["residential", "commercial", "hospitality", "retail", "other"],
      },
      {
        key: "isPublicFacing",
        label: "Public-Facing Zone",
        type: "boolean",
        required: false,
        description: "Whether the zone is accessible to the general public.",
      },
    ],
  },

  // ── 2. Dimensions ────────────────────────────────────────────────────────
  dimensions: {
    id: "dimensions",
    label: "Dimensions",
    description:
      "Physical measurements of the room or zone, used for scale plans and specification sheets.",
    appliesTo: [
      "interior_space_plan",
      "interior_elevation",
      "interior_specification",
    ],
    fields: [
      {
        key: "lengthM",
        label: "Length",
        type: "number",
        required: true,
        description: "Room or zone length.",
        unit: "m",
      },
      {
        key: "widthM",
        label: "Width",
        type: "number",
        required: true,
        description: "Room or zone width.",
        unit: "m",
      },
      {
        key: "ceilingHeightM",
        label: "Ceiling Height",
        type: "number",
        required: true,
        description: "Floor-to-ceiling height.",
        unit: "m",
      },
      {
        key: "areaM2",
        label: "Floor Area",
        type: "number",
        required: false,
        description: "Derived from length × width, or provided directly.",
        unit: "m²",
      },
      {
        key: "scaleLabel",
        label: "Drawing Scale",
        type: "string",
        required: false,
        description: "Scale used in plan drawings (e.g. 1:50, 1:100).",
      },
    ],
  },

  // ── 3. Surface material ──────────────────────────────────────────────────
  surface_material: {
    id: "surface_material",
    label: "Surface Material",
    description:
      "Material specification for each surface layer within the zone.",
    appliesTo: [
      "interior_material_board",
      "interior_specification",
      "interior_presentation",
    ],
    fields: [
      {
        key: "surface",
        label: "Surface",
        type: "string",
        required: true,
        description: "Which surface this entry describes.",
        allowedValues: ["flooring", "wall", "ceiling", "skirting", "cornice", "column", "other"],
      },
      {
        key: "materialName",
        label: "Material Name",
        type: "string",
        required: true,
        description: "Name or trade name of the material (e.g. Porcelain Tile, American Oak Veneer).",
      },
      {
        key: "finish",
        label: "Finish",
        type: "string",
        required: false,
        description: "Surface finish applied (e.g. matte, gloss, brushed, honed, polished).",
      },
      {
        key: "colorCode",
        label: "Colour / Reference Code",
        type: "string",
        required: false,
        description: "Hex code or manufacturer reference number.",
      },
      {
        key: "supplierCategory",
        label: "Supplier Category",
        type: "string",
        required: false,
        description: "General category of vendor for procurement.",
      },
      {
        key: "isEcoFriendly",
        label: "Eco-Friendly",
        type: "boolean",
        required: false,
        description: "Whether the material meets sustainability criteria specified in the brief.",
      },
    ],
  },

  // ── 4. Furniture reference ───────────────────────────────────────────────
  furniture_reference: {
    id: "furniture_reference",
    label: "Furniture Reference",
    description:
      "A single furniture or equipment item placed or referenced in the space plan.",
    appliesTo: [
      "interior_furniture_board",
      "interior_space_plan",
      "interior_specification",
    ],
    fields: [
      {
        key: "itemId",
        label: "Item ID",
        type: "string",
        required: true,
        description: "Opaque stable identifier for this furniture item within the project.",
      },
      {
        key: "componentCategory",
        label: "Component Category",
        type: "string",
        required: true,
        description: "One of the seven plugin component categories.",
        allowedValues: ["seating", "table", "storage", "lighting", "decor", "fixture", "partition"],
      },
      {
        key: "itemName",
        label: "Item Name",
        type: "string",
        required: true,
        description: "Descriptive name (e.g. 3-Seater Sofa, Pendant Light, Open Shelving Unit).",
      },
      {
        key: "widthM",
        label: "Width",
        type: "number",
        required: false,
        description: "Bounding width.",
        unit: "m",
      },
      {
        key: "depthM",
        label: "Depth",
        type: "number",
        required: false,
        description: "Bounding depth.",
        unit: "m",
      },
      {
        key: "heightM",
        label: "Height",
        type: "number",
        required: false,
        description: "Item height.",
        unit: "m",
      },
      {
        key: "placementNote",
        label: "Placement Note",
        type: "string",
        required: false,
        description: "Where and why this item is placed in the space.",
      },
    ],
  },

  // ── 5. Lighting ──────────────────────────────────────────────────────────
  lighting: {
    id: "lighting",
    label: "Lighting",
    description:
      "A single lighting fixture or control zone within the space.",
    appliesTo: [
      "interior_lighting_plan",
      "interior_specification",
      "interior_presentation",
    ],
    fields: [
      {
        key: "lightingLayer",
        label: "Lighting Layer",
        type: "string",
        required: true,
        description: "Ambient, task, accent, or decorative.",
        allowedValues: ["ambient", "task", "accent", "decorative", "emergency"],
      },
      {
        key: "fixtureType",
        label: "Fixture Type",
        type: "string",
        required: true,
        description: "Fixture category (e.g. recessed downlight, pendant, wall sconce, track).",
      },
      {
        key: "colorTemperatureK",
        label: "Colour Temperature",
        type: "number",
        required: false,
        description: "Kelvin value (e.g. 2700 for warm, 5000 for daylight).",
        unit: "K",
      },
      {
        key: "isDimmable",
        label: "Dimmable",
        type: "boolean",
        required: false,
        description: "Whether the circuit supports dimming.",
      },
      {
        key: "controlZone",
        label: "Control Zone",
        type: "string",
        required: false,
        description: "Zone label for switching/dimming circuits.",
      },
    ],
  },

  // ── 6. Colour ────────────────────────────────────────────────────────────
  color: {
    id: "color",
    label: "Colour",
    description:
      "A colour entry contributing to the project palette.",
    appliesTo: [
      "interior_moodboard",
      "interior_material_board",
      "interior_presentation",
    ],
    fields: [
      {
        key: "role",
        label: "Colour Role",
        type: "string",
        required: true,
        description: "How this colour functions in the palette.",
        allowedValues: ["primary", "secondary", "accent", "neutral", "background"],
      },
      {
        key: "hexCode",
        label: "Hex Code",
        type: "string",
        required: true,
        description: "6-digit hex colour code including the # prefix.",
      },
      {
        key: "paintReference",
        label: "Paint Reference",
        type: "string",
        required: false,
        description: "Manufacturer paint code or colour name (e.g. Dulux Antique White).",
      },
      {
        key: "usedOnSurfaces",
        label: "Used On Surfaces",
        type: "string[]",
        required: false,
        description: "Which surfaces carry this colour.",
      },
    ],
  },

  // ── 7. Finish ────────────────────────────────────────────────────────────
  finish: {
    id: "finish",
    label: "Finish",
    description:
      "Surface finish applied to a material, hardware, or fixture.",
    appliesTo: [
      "interior_material_board",
      "interior_specification",
    ],
    fields: [
      {
        key: "finishName",
        label: "Finish Name",
        type: "string",
        required: true,
        description: "Finish label (e.g. Matte, Gloss, Satin, Brushed, Aged, Lacquered).",
      },
      {
        key: "sheen",
        label: "Sheen Level",
        type: "string",
        required: false,
        description: "Estimated reflectance level.",
        allowedValues: ["flat", "matte", "eggshell", "satin", "semi_gloss", "high_gloss"],
      },
      {
        key: "durabilityRating",
        label: "Durability Rating",
        type: "string",
        required: false,
        description: "Intended use environment.",
        allowedValues: ["light_residential", "heavy_residential", "light_commercial", "heavy_commercial"],
      },
      {
        key: "maintenanceNotes",
        label: "Maintenance Notes",
        type: "string",
        required: false,
        description: "Cleaning and maintenance requirements.",
      },
    ],
  },

  // ── 8. Notes ─────────────────────────────────────────────────────────────
  notes: {
    id: "notes",
    label: "Notes",
    description:
      "Freeform designer notes attached to any artifact or zone.",
    appliesTo: [
      "interior_moodboard",
      "interior_space_plan",
      "interior_material_board",
      "interior_furniture_board",
      "interior_lighting_plan",
      "interior_elevation",
      "interior_visualization",
      "interior_specification",
      "interior_presentation",
    ],
    fields: [
      {
        key: "noteType",
        label: "Note Type",
        type: "string",
        required: true,
        description: "Category of note.",
        allowedValues: ["design_intent", "construction", "procurement", "client_feedback", "revision", "general"],
      },
      {
        key: "noteText",
        label: "Note Text",
        type: "string",
        required: true,
        description: "Note content.",
      },
      {
        key: "authorRole",
        label: "Author Role",
        type: "string",
        required: false,
        description: "Role of the person who added this note (not a user ID).",
      },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return all property sections that apply to a given artifact type ID. */
export function getSectionsForArtifact(
  artifactTypeId: string,
): InteriorPropertySection[] {
  return INTERIOR_PROPERTY_SECTION_IDS.map(
    (id) => INTERIOR_PROPERTY_SECTIONS[id],
  ).filter((s) => s.appliesTo.includes(artifactTypeId));
}

/** Return the full required-field list for a section. */
export function getRequiredFields(
  sectionId: InteriorPropertySectionId,
): PropertyField[] {
  return INTERIOR_PROPERTY_SECTIONS[sectionId].fields.filter((f) => f.required);
}
