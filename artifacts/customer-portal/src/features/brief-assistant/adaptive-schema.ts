/**
 * Team 04 — Adaptive Question Engine: Dynamic Brief Schema
 *
 * Defines the DynamicBriefSchema contract that Team 03 (domain plugins) will implement.
 * This file also provides built-in default schemas for all current service types.
 *
 * DESIGN RULE: All domain-specific priority knowledge lives HERE as schema metadata,
 * never as service-switch logic inside the engine or planner core.
 */

import type { BriefData } from "@/pages/brief";
import type { ServiceType } from "@/config/brief-service-config";

// ── Schema field contract ──────────────────────────────────────────────────────

/**
 * Schema descriptor for a single BriefData field within a service context.
 * Team 03 will provide these per-domain; the built-in defaults cover current services.
 */
export interface BriefFieldSchema {
  field: keyof BriefData;
  /** Whether this field must be filled before the session can complete. */
  required: boolean;
  /**
   * Fields that must be answered (or filled) before this field becomes relevant.
   * Empty/missing = no dependencies (always available).
   */
  dependsOn?: (keyof BriefData)[];
  /**
   * Priority weight 0–100. Higher weight = asked sooner in the adaptive ordering.
   * The engine scores each field and sorts by descending score.
   */
  priorityWeight: number;
  /**
   * True if this field's answer materially affects pricing or feasibility
   * (e.g. output format determines scope). These get a scoring bonus.
   */
  affectsPricing: boolean;
  /**
   * True if answering this field expands the visible question set (unlocks others).
   * Gating fields get a scoring bonus so unlocking happens as early as possible.
   */
  isGating: boolean;
  /**
   * False means the user cannot skip this question even if the field is optional.
   * Typically true for clarification-critical fields in domain services.
   */
  skippable: boolean;
  /** Override the question text with domain-specific wording. */
  questionOverride?: string;
  /** Override the helper text with domain-specific context. */
  helperOverride?: string;
}

// ── Completion policy ──────────────────────────────────────────────────────────

export interface CompletionPolicy {
  /**
   * Minimum number of required fields that must be filled before the session
   * can be marked complete (not just go-to-review).
   */
  requiredFieldsMinimum: number;
  /**
   * If true, the user can enter review mode even before all required fields
   * are answered. If false, the session gate blocks review until the minimum is met.
   */
  allowPartialCompletion: boolean;
}

// ── Priority rules ─────────────────────────────────────────────────────────────

/**
 * A dynamic priority rule that boosts a field's score when certain other fields
 * are still empty. Encodes domain-specific sequencing in data, not in code.
 *
 * Example: "If outputFormats is empty, boost specialRequirements by 25"
 * → ensures product spec is captured before visualization detail.
 */
export interface PriorityRule {
  id: string;
  description: string;
  /** If ALL of these fields are empty, the rule applies. */
  ifAllEmpty: (keyof BriefData)[];
  /** The target field whose score is boosted when the rule fires. */
  targetField: keyof BriefData;
  /** Score bonus added to targetField when the rule fires. */
  boost: number;
}

// ── Dynamic Brief Schema ───────────────────────────────────────────────────────

/**
 * Full schema for a service type. Produced by built-in defaults now;
 * Team 03 domain plugins will produce these for extended service types.
 */
export interface DynamicBriefSchema {
  serviceType: string;
  /**
   * Schema version string. The session storage includes this so that
   * a schema update can be detected on restore.
   */
  schemaVersion: string;
  fields: BriefFieldSchema[];
  completionPolicy: CompletionPolicy;
  /** Optional dynamic scoring rules (applied after base weight calculation). */
  priorityRules?: PriorityRule[];
}

// ── Built-in schema registry ───────────────────────────────────────────────────

/**
 * Base field schemas shared by most services.
 * Service-specific schemas override priorityWeight, required, and skippable.
 */
const BASE_FIELDS: Omit<BriefFieldSchema, "priorityWeight">[] = [
  { field: "companyIndustry",      required: true,  isGating: true,  affectsPricing: false, skippable: false },
  { field: "companySize",          required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "primaryGoal",          required: true,  isGating: true,  affectsPricing: false, skippable: false },
  { field: "existingAssets",       required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "audienceDemographics", required: true,  isGating: false, affectsPricing: false, skippable: false },
  { field: "audienceChannels",     required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "audiencePainPoints",   required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "stylePreference",      required: true,  isGating: false, affectsPricing: false, skippable: false },
  { field: "colorPalette",         required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "specialRequirements",  required: false, isGating: false, affectsPricing: true,  skippable: true  },
  { field: "outputFormats",        required: true,  isGating: false, affectsPricing: true,  skippable: false },
  { field: "outputLanguage",       required: false, isGating: false, affectsPricing: false, skippable: true  },
  { field: "priority",             required: false, isGating: false, affectsPricing: false, skippable: true  },
];

function makeFields(
  weights: Partial<Record<keyof BriefData, number>>,
  overrides?: Partial<Record<keyof BriefData, Partial<BriefFieldSchema>>>,
): BriefFieldSchema[] {
  return BASE_FIELDS.map((f) => ({
    ...f,
    ...(overrides?.[f.field] ?? {}),
    priorityWeight: weights[f.field] ?? 50,
  }));
}

// ── Service-specific built-in schemas ──────────────────────────────────────────

const BRAND_IDENTITY_SCHEMA: DynamicBriefSchema = {
  serviceType: "brand_identity",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 4, allowPartialCompletion: false },
  fields: makeFields({
    companyIndustry:      90,  // positioning depends on this
    primaryGoal:          85,  // brand direction
    audienceDemographics: 80,  // brand voice target
    stylePreference:      75,  // visual identity direction
    colorPalette:         60,
    existingAssets:       55,  // what already exists
    audienceChannels:     45,
    specialRequirements:  40,
    companySize:          30,
    priority:             20,
    outputLanguage:       15,
    outputFormats:        70,
    audiencePainPoints:   35,
  }),
  priorityRules: [
    {
      id: "brand-positioning-first",
      description: "Tujuan dan audience harus tersedia sebelum preferensi aset",
      ifAllEmpty: ["primaryGoal", "audienceDemographics"],
      targetField: "existingAssets",
      boost: -20,  // negative boost = defer existingAssets until goal+audience answered
    },
  ],
};

const LOGO_DESIGN_SCHEMA: DynamicBriefSchema = {
  serviceType: "logo_design",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 3, allowPartialCompletion: false },
  fields: makeFields({
    companyIndustry:      90,
    primaryGoal:          80,
    stylePreference:      85,  // logo style is critical
    colorPalette:         75,  // logo color
    existingAssets:       60,
    audienceDemographics: 55,
    specialRequirements:  50,
    companySize:          25,
    priority:             20,
    outputLanguage:       10,
    outputFormats:        65,
    audienceChannels:     30,
    audiencePainPoints:   20,
  }),
};

const COMPANY_PROFILE_SCHEMA: DynamicBriefSchema = {
  serviceType: "company_profile",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 4, allowPartialCompletion: true },
  fields: makeFields({
    companyIndustry:      90,
    audienceDemographics: 80,
    primaryGoal:          75,
    existingAssets:       70,  // existing brand assets for profile
    outputLanguage:       65,  // language is critical for company profile
    companySize:          60,
    audienceChannels:     50,
    stylePreference:      45,
    priority:             30,
    outputFormats:        55,
    specialRequirements:  40,
    colorPalette:         35,
    audiencePainPoints:   25,
  }),
};

const PITCH_DECK_SCHEMA: DynamicBriefSchema = {
  serviceType: "pitch_deck",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 3, allowPartialCompletion: false },
  fields: makeFields({
    primaryGoal:          90,  // what's the pitch for
    audienceDemographics: 85,  // who's being pitched to
    companyIndustry:      75,
    existingAssets:       70,
    stylePreference:      60,
    outputLanguage:       55,
    companySize:          50,
    priority:             35,
    outputFormats:        65,
    specialRequirements:  45,
    colorPalette:         40,
    audienceChannels:     30,
    audiencePainPoints:   80,  // pain points are the pitch hook
  }),
};

const SOCIAL_MEDIA_SCHEMA: DynamicBriefSchema = {
  serviceType: "social_media",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 3, allowPartialCompletion: true },
  fields: makeFields({
    audienceChannels:     90,  // platform determines format
    primaryGoal:          85,
    audienceDemographics: 80,
    stylePreference:      70,
    existingAssets:       65,
    colorPalette:         60,
    companyIndustry:      45,
    priority:             35,
    outputFormats:        75,
    specialRequirements:  40,
    outputLanguage:       50,
    companySize:          20,
    audiencePainPoints:   55,
  }),
};

const COPYWRITING_SCHEMA: DynamicBriefSchema = {
  serviceType: "copywriting",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 4, allowPartialCompletion: false },
  fields: makeFields({
    primaryGoal:          90,
    audienceDemographics: 85,
    outputLanguage:       80,  // language is critical for copywriting
    audiencePainPoints:   78,  // pain points drive copy angle
    stylePreference:      60,
    existingAssets:       50,
    companyIndustry:      55,
    priority:             30,
    outputFormats:        70,
    specialRequirements:  45,
    colorPalette:         10,
    audienceChannels:     40,
    companySize:          20,
  }),
};

const IMAGE_GENERATION_SCHEMA: DynamicBriefSchema = {
  serviceType: "image_generation",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 2, allowPartialCompletion: true },
  fields: makeFields({
    stylePreference:      90,  // visual style is the brief
    colorPalette:         85,
    primaryGoal:          70,
    existingAssets:       60,
    companyIndustry:      50,
    audienceDemographics: 45,
    specialRequirements:  80,  // technical image specs
    outputFormats:        75,
    outputLanguage:       20,
    priority:             25,
    audienceChannels:     30,
    companySize:          10,
    audiencePainPoints:   35,
  }),
};

/**
 * Fashion Design — Product type and size spec MUST precede campaign/channel details.
 * Domain rule: specialRequirements (captures product spec) + outputFormats (delivery format)
 * are gating fields that unlock the visual/campaign questions.
 */
const FASHION_DESIGN_SCHEMA: DynamicBriefSchema = {
  serviceType: "fashion_design",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 4, allowPartialCompletion: false },
  fields: makeFields(
    {
      companyIndustry:      85,
      primaryGoal:          80,
      specialRequirements:  90,  // product type, size, material spec — HIGHEST PRIORITY
      outputFormats:        88,  // deliverable format (tech pack, mood board, etc.) — CRITICAL
      audienceDemographics: 65,  // campaign audience — comes AFTER product is defined
      stylePreference:      70,
      colorPalette:         68,
      existingAssets:       45,
      audienceChannels:     40,  // campaign channels come LAST
      companySize:          20,
      priority:             25,
      outputLanguage:       15,
      audiencePainPoints:   35,
    },
    {
      specialRequirements: {
        required: true,         // product spec is mandatory for fashion
        skippable: false,
        isGating: true,
        questionOverride: "Deskripsikan produk fashion Anda: jenis item, ukuran, material, dan spesifikasi teknis yang dibutuhkan.",
        helperOverride: "Contoh: Kaos oversize pria ukuran M-XL, bahan cotton combed 30s, sablon depan.",
      },
      outputFormats: {
        required: true,
        skippable: false,
        isGating: true,
        questionOverride: "Format output apa yang Anda butuhkan untuk project fashion ini?",
        helperOverride: "Misalnya: tech pack, moodboard, desain print, lookbook, atau foto produk.",
      },
    },
  ),
  priorityRules: [
    {
      id: "fashion-product-spec-first",
      description: "Spesifikasi produk harus ada sebelum membahas campaign audiens",
      ifAllEmpty: ["specialRequirements"],
      targetField: "audienceChannels",
      boost: -40,  // strongly defer channel questions until product is specified
    },
    {
      id: "fashion-format-before-campaign",
      description: "Format deliverable harus dikonfirmasi sebelum detail visual lainnya",
      ifAllEmpty: ["outputFormats"],
      targetField: "audienceDemographics",
      boost: -20,
    },
  ],
};

/**
 * Interior Design — Room dimensions and space type MUST precede material/visualization.
 * Domain rule: specialRequirements (captures room spec) is a gating field.
 */
const INTERIOR_DESIGN_SCHEMA: DynamicBriefSchema = {
  serviceType: "interior_design",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 4, allowPartialCompletion: false },
  fields: makeFields(
    {
      companyIndustry:      75,
      primaryGoal:          80,
      specialRequirements:  95,  // room type, dimensions, purpose — CRITICAL
      outputFormats:        85,  // 2D plan, 3D render, mood board — defines scope
      stylePreference:      70,  // interior style (minimalist, industrial, etc.)
      colorPalette:         65,
      audienceDemographics: 50,  // end users of the space
      existingAssets:       45,
      audienceChannels:     20,
      companySize:          15,
      priority:             30,
      outputLanguage:       25,
      audiencePainPoints:   40,
    },
    {
      specialRequirements: {
        required: true,
        skippable: false,
        isGating: true,
        questionOverride: "Jelaskan ruangan yang akan didesain: jenis ruang, dimensi (panjang × lebar × tinggi), dan fungsi utamanya.",
        helperOverride: "Contoh: Ruang tamu 5×7m tinggi 3m, untuk keluarga 4 orang, gaya modern-minimalis.",
      },
      outputFormats: {
        required: true,
        skippable: false,
        isGating: true,
        questionOverride: "Output apa yang Anda butuhkan dari project interior ini?",
        helperOverride: "Misalnya: denah 2D, render 3D, mood board, daftar material, atau kombinasi.",
      },
    },
  ),
  priorityRules: [
    {
      id: "interior-dimensions-first",
      description: "Dimensi dan jenis ruang wajib ada sebelum detail material/visualisasi",
      ifAllEmpty: ["specialRequirements"],
      targetField: "stylePreference",
      boost: -30,
    },
    {
      id: "interior-format-gates-scope",
      description: "Format output menentukan scope dan harus dikonfirmasi lebih awal",
      ifAllEmpty: ["outputFormats"],
      targetField: "colorPalette",
      boost: -25,
    },
  ],
};

const DEFAULT_SCHEMA: DynamicBriefSchema = {
  serviceType: "default",
  schemaVersion: "1.0.0",
  completionPolicy: { requiredFieldsMinimum: 3, allowPartialCompletion: true },
  fields: makeFields({
    companyIndustry:      80,
    companySize:          40,
    primaryGoal:          85,
    audienceDemographics: 78,
    stylePreference:      70,
    colorPalette:         55,
    existingAssets:       50,
    audienceChannels:     45,
    outputLanguage:       42,
    priority:             30,
    audiencePainPoints:   48,
    outputFormats:        72,
    specialRequirements:  38,
  }),
};

// ── Schema registry ────────────────────────────────────────────────────────────

const BUILTIN_SCHEMAS: Record<ServiceType | "default", DynamicBriefSchema> = {
  brand_identity:   BRAND_IDENTITY_SCHEMA,
  logo_design:      LOGO_DESIGN_SCHEMA,
  company_profile:  COMPANY_PROFILE_SCHEMA,
  pitch_deck:       PITCH_DECK_SCHEMA,
  social_media:     SOCIAL_MEDIA_SCHEMA,
  copywriting:      COPYWRITING_SCHEMA,
  image_generation: IMAGE_GENERATION_SCHEMA,
  fashion_design:   FASHION_DESIGN_SCHEMA,
  interior_design:  INTERIOR_DESIGN_SCHEMA,
  default:          DEFAULT_SCHEMA,
};

/**
 * Returns the built-in DynamicBriefSchema for a service type.
 * Returns the default schema when no specific schema is registered.
 *
 * Team 03 plugins call this as the base and override specific fields.
 */
export function getBuiltinSchema(serviceType: string): DynamicBriefSchema {
  return (
    (BUILTIN_SCHEMAS as Record<string, DynamicBriefSchema>)[serviceType] ??
    DEFAULT_SCHEMA
  );
}

/**
 * Merges a partial schema override from a domain plugin with the built-in base.
 * Plugin fields take precedence; all other fields use the built-in defaults.
 */
export function mergeSchema(
  base: DynamicBriefSchema,
  override: Partial<DynamicBriefSchema>,
): DynamicBriefSchema {
  return {
    ...base,
    ...override,
    fields: override.fields
      ? base.fields.map((bf) => {
          const of = override.fields!.find((f) => f.field === bf.field);
          return of ? { ...bf, ...of } : bf;
        })
      : base.fields,
    priorityRules: [
      ...(base.priorityRules ?? []),
      ...(override.priorityRules ?? []),
    ],
  };
}
