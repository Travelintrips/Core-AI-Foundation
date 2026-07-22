/**
 * Team 25 — Interior Design Domain Plugin
 * briefSchema.ts
 *
 * Zod brief schema covering all 13 interior-design brief fields required by
 * the plugin spec. This schema is INTERIOR-DOMAIN-ONLY — it must not be
 * imported or referenced by core platform code.
 *
 * Note: drizzle-zod is NOT installed in api-server.
 * Use z from "zod" directly.
 */
import { z } from "zod";

// ── Enum helpers ──────────────────────────────────────────────────────────────

export const INTERIOR_SPACE_TYPES = [
  "living_room",
  "bedroom",
  "master_bedroom",
  "kitchen",
  "dining_room",
  "bathroom",
  "office",
  "study",
  "cafe",
  "restaurant",
  "hotel_room",
  "hotel_suite",
  "lobby",
  "retail_booth",
  "retail_store",
  "co_working",
  "gym",
  "clinic",
  "other",
] as const;

export type InteriorSpaceType = (typeof INTERIOR_SPACE_TYPES)[number];

export const INTERIOR_STYLE_PREFERENCES = [
  "modern",
  "minimalist",
  "scandinavian",
  "industrial",
  "traditional",
  "rustic",
  "art_deco",
  "japandi",
  "tropical",
  "mediterranean",
  "coastal",
  "bohemian",
  "maximalist",
  "mid_century_modern",
  "contemporary",
  "eclectic",
] as const;

export type InteriorStylePreference = (typeof INTERIOR_STYLE_PREFERENCES)[number];

export const INTERIOR_BUDGET_RANGES = [
  "under_50m",        // IDR < 50 million
  "50m_150m",         // IDR 50–150 million
  "150m_500m",        // IDR 150–500 million
  "500m_1b",          // IDR 500 million – 1 billion
  "above_1b",         // IDR > 1 billion
  "not_specified",
] as const;

export type InteriorBudgetRange = (typeof INTERIOR_BUDGET_RANGES)[number];

export const INTERIOR_CLIMATE_TYPES = [
  "tropical_humid",
  "tropical_dry",
  "subtropical",
  "temperate",
  "arid",
  "cold",
  "not_specified",
] as const;

export type InteriorClimateType = (typeof INTERIOR_CLIMATE_TYPES)[number];

export const INTERIOR_LIGHTING_NEEDS = [
  "natural_primary",
  "artificial_primary",
  "balanced",
  "dramatic_accent",
  "task_focused",
  "ambient_soft",
  "smart_dimmable",
] as const;

export type InteriorLightingNeed = (typeof INTERIOR_LIGHTING_NEEDS)[number];

// ── Sub-schemas ───────────────────────────────────────────────────────────────

/** Approximate room or space dimensions */
const DimensionsSchema = z.object({
  lengthM:       z.number().positive().max(200).describe("Room length in metres"),
  widthM:        z.number().positive().max(200).describe("Room width in metres"),
  ceilingHeightM: z.number().positive().max(20).describe("Ceiling height in metres"),
  /** Optional total area — derived from length×width if omitted */
  areaM2:        z.number().positive().max(40_000).optional(),
});

export type InteriorDimensions = z.infer<typeof DimensionsSchema>;

/** Existing structural conditions the designer must work around */
const ExistingConditionsSchema = z.object({
  hasFixedColumns:    z.boolean().default(false),
  hasExposedDucts:    z.boolean().default(false),
  hasLowBeams:        z.boolean().default(false),
  hasIrregularShape:  z.boolean().default(false),
  existingFlooringType: z.string().max(100).optional(),
  existingWallFinish:   z.string().max(100).optional(),
  structuralNotes:      z.string().max(500).optional(),
});

export type InteriorExistingConditions = z.infer<typeof ExistingConditionsSchema>;

/** Colour preferences expressed as hex codes and descriptive words */
const ColorPreferenceSchema = z.object({
  primaryHex:   z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be #rrggbb")).max(5).default([]),
  accentHex:    z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be #rrggbb")).max(3).default([]),
  toneKeywords: z.array(z.string().max(50)).max(8).default([]),
  avoidColors:  z.array(z.string().max(50)).max(5).default([]),
});

export type InteriorColorPreference = z.infer<typeof ColorPreferenceSchema>;

/** Material preferences per surface layer */
const MaterialPreferenceSchema = z.object({
  flooring:  z.string().max(200).optional(),
  walls:     z.string().max(200).optional(),
  ceiling:   z.string().max(200).optional(),
  textiles:  z.string().max(200).optional(),
  avoidMaterials: z.array(z.string().max(100)).max(8).default([]),
});

export type InteriorMaterialPreference = z.infer<typeof MaterialPreferenceSchema>;

/** Accessibility requirements */
const AccessibilitySchema = z.object({
  wheelchairAccess:       z.boolean().default(false),
  visualImpairmentNeeds:  z.boolean().default(false),
  hearingImpairmentNeeds: z.boolean().default(false),
  elderlyFriendly:        z.boolean().default(false),
  childSafe:              z.boolean().default(false),
  notes:                  z.string().max(300).optional(),
});

export type InteriorAccessibility = z.infer<typeof AccessibilitySchema>;

/** Sustainability goals */
const SustainabilitySchema = z.object({
  preferLocalMaterials:    z.boolean().default(false),
  preferRecycledMaterials: z.boolean().default(false),
  energyEfficientLighting: z.boolean().default(false),
  lowVOCFinishes:          z.boolean().default(false),
  greenCertificationTarget: z.enum(["none", "greenship", "leed", "edge", "other"]).default("none"),
  notes:                   z.string().max(300).optional(),
});

export type InteriorSustainability = z.infer<typeof SustainabilitySchema>;

// ── Master brief schema ───────────────────────────────────────────────────────

export const InteriorDesignBriefSchema = z.object({
  // ── 1. Space type ──────────────────────────────────────────────────────────
  spaceType: z.enum(INTERIOR_SPACE_TYPES),

  // ── 2. Dimensions ─────────────────────────────────────────────────────────
  dimensions: DimensionsSchema,

  // ── 3. Occupants ──────────────────────────────────────────────────────────
  occupantCount:    z.number().int().min(1).max(10_000),
  occupantProfile:  z.string().max(300).optional().describe(
    "Free text: who uses the space (family with kids, corporate staff, hotel guests, etc.)"
  ),

  // ── 4. Style preference ────────────────────────────────────────────────────
  stylePreference: z.enum(INTERIOR_STYLE_PREFERENCES),
  /** Secondary or mixed style influences (max 2) */
  styleInfluences: z.array(z.enum(INTERIOR_STYLE_PREFERENCES)).max(2).default([]),

  // ── 5. Functional requirements ─────────────────────────────────────────────
  functionalRequirements: z.array(z.string().max(200)).max(20).default([]),
  /** Storage priority: 1 = low, 5 = critical */
  storagePriority: z.number().int().min(1).max(5).default(3),

  // ── 6. Budget range ────────────────────────────────────────────────────────
  budgetRange: z.enum(INTERIOR_BUDGET_RANGES).default("not_specified"),
  budgetNotes: z.string().max(300).optional(),

  // ── 7. Location / climate ──────────────────────────────────────────────────
  locationCity:    z.string().max(100).optional(),
  locationCountry: z.string().max(100).optional().default("Indonesia"),
  climateType:     z.enum(INTERIOR_CLIMATE_TYPES).default("tropical_humid"),

  // ── 8. Existing conditions ─────────────────────────────────────────────────
  existingConditions: ExistingConditionsSchema.default({}),

  // ── 9. Colour preference ───────────────────────────────────────────────────
  colorPreference: ColorPreferenceSchema.default({}),

  // ── 10. Material preference ────────────────────────────────────────────────
  materialPreference: MaterialPreferenceSchema.default({}),

  // ── 11. Lighting needs ─────────────────────────────────────────────────────
  lightingNeeds: z.array(z.enum(INTERIOR_LIGHTING_NEEDS)).min(1).default(["balanced"]),
  lightingNotes: z.string().max(300).optional(),

  // ── 12. Accessibility ─────────────────────────────────────────────────────
  accessibility: AccessibilitySchema.default({}),

  // ── 13. Sustainability ─────────────────────────────────────────────────────
  sustainability: SustainabilitySchema.default({}),

  // ── Meta ──────────────────────────────────────────────────────────────────
  /** Reference image or floor-plan URLs supplied by the client (max 10) */
  referenceUrls:  z.array(z.string().url()).max(10).default([]),
  additionalNotes: z.string().max(2000).optional(),
});

export type InteriorDesignBrief = z.infer<typeof InteriorDesignBriefSchema>;

// ── Brief field manifest (for UI wizards / documentation) ────────────────────

export interface BriefFieldDescriptor {
  field: string;
  label: string;
  description: string;
  required: boolean;
}

export const INTERIOR_BRIEF_FIELDS: BriefFieldDescriptor[] = [
  { field: "spaceType",             label: "Space Type",             description: "Category of the room or venue",                                    required: true  },
  { field: "dimensions",            label: "Dimensions",             description: "Length, width, and ceiling height in metres",                      required: true  },
  { field: "occupantCount",         label: "Occupants",              description: "Number of regular occupants or maximum capacity",                  required: true  },
  { field: "stylePreference",       label: "Style Preference",       description: "Primary design aesthetic",                                         required: true  },
  { field: "functionalRequirements",label: "Functional Requirements", description: "List of activities or functions the space must support",          required: true  },
  { field: "budgetRange",           label: "Budget Range",           description: "Approximate budget bracket for the full fit-out",                  required: false },
  { field: "locationCity",          label: "Location / City",        description: "City and country — affects climate, code references, and vendors", required: false },
  { field: "climateType",           label: "Climate Type",           description: "Local climate that influences ventilation and material choices",    required: false },
  { field: "existingConditions",    label: "Existing Conditions",    description: "Structural or finishes constraints to design around",               required: false },
  { field: "colorPreference",       label: "Colour Preference",      description: "Preferred palette, accent colours, and colours to avoid",          required: false },
  { field: "materialPreference",    label: "Material Preference",    description: "Preferred surface materials per layer (floor, wall, ceiling)",     required: false },
  { field: "lightingNeeds",         label: "Lighting Needs",         description: "Lighting priorities and mood requirements",                        required: true  },
  { field: "accessibility",         label: "Accessibility",          description: "Special accessibility requirements for users or visitors",         required: false },
  { field: "sustainability",        label: "Sustainability",         description: "Eco and sustainability goals for the fit-out",                     required: false },
];
