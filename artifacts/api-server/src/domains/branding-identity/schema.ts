/**
 * branding-identity/schema.ts — Team 27
 *
 * Zod schemas for the Branding & Identity Domain Plugin.
 *
 * Covers:
 *   - Brand brief (all fields from the task spec)
 *   - 13-stage workflow enum
 *   - 11 artifact-type enum
 *   - Brand properties (tokens, rules, variants)
 *   - Status enum
 *
 * RULES:
 *   - No global design tokens are modified here.
 *   - No hard-coded provider, model, tenant, or domain.
 *   - Branding fields must not leak into core schemas.
 */

import { z } from "zod";

// ── Workflow stages ───────────────────────────────────────────────────────────

export const BRANDING_STAGES = [
  "brand_brief",
  "research",
  "brand_strategy",
  "positioning",
  "verbal_direction",
  "visual_direction",
  "logo_concepts",
  "color_system",
  "typography",
  "identity_applications",
  "brand_guideline",
  "review",
  "export",
] as const;

export type BrandingStage = (typeof BRANDING_STAGES)[number];

export const BrandingStageEnum = z.enum(BRANDING_STAGES);

/** Human-readable label for each stage. */
export const BRANDING_STAGE_LABELS: Record<BrandingStage, string> = {
  brand_brief:           "Brand Brief",
  research:              "Research",
  brand_strategy:        "Brand Strategy",
  positioning:           "Positioning",
  verbal_direction:      "Verbal Direction",
  visual_direction:      "Visual Direction",
  logo_concepts:         "Logo Concepts",
  color_system:          "Color System",
  typography:            "Typography",
  identity_applications: "Identity Applications",
  brand_guideline:       "Brand Guideline",
  review:                "Review",
  export:                "Export",
};

// ── Artifact types ────────────────────────────────────────────────────────────

export const BRANDING_ARTIFACT_TYPES = [
  "brand_strategy",
  "brand_positioning",
  "brand_voice",
  "brand_moodboard",
  "logo_concept",
  "logo_system",
  "color_system",
  "typography_system",
  "identity_application",
  "brand_guideline",
  "campaign_direction",
] as const;

export type BrandingArtifactType = (typeof BRANDING_ARTIFACT_TYPES)[number];

export const BrandingArtifactTypeEnum = z.enum(BRANDING_ARTIFACT_TYPES);

/** Which stage produces each artifact type (primary association). */
export const ARTIFACT_STAGE_MAP: Record<BrandingArtifactType, BrandingStage> = {
  brand_strategy:       "brand_strategy",
  brand_positioning:    "positioning",
  brand_voice:          "verbal_direction",
  brand_moodboard:      "visual_direction",
  logo_concept:         "logo_concepts",
  logo_system:          "logo_concepts",
  color_system:         "color_system",
  typography_system:    "typography",
  identity_application: "identity_applications",
  brand_guideline:      "brand_guideline",
  campaign_direction:   "export",
};

// ── Brand properties ──────────────────────────────────────────────────────────

export const BRAND_PROPERTY_KINDS = [
  "logo_variation",
  "color_token",
  "typography_role",
  "spacing_rule",
  "clear_space",
  "application_context",
  "usage_rule",
  "prohibited_usage",
] as const;

export type BrandPropertyKind = (typeof BRAND_PROPERTY_KINDS)[number];

export const BrandPropertyKindEnum = z.enum(BRAND_PROPERTY_KINDS);

export const BrandPropertySchema = z.object({
  kind:        BrandPropertyKindEnum,
  name:        z.string().min(1).max(200),
  value:       z.string().min(1).max(2000),
  description: z.string().max(500).optional(),
  /** Which artifact section this property belongs to. */
  section:     BrandingArtifactTypeEnum.optional(),
});

export type BrandProperty = z.infer<typeof BrandPropertySchema>;

// ── Brief status ──────────────────────────────────────────────────────────────

export const BRANDING_STATUSES = [
  "draft",
  "active",
  "in_review",
  "approved",
  "exported",
  "archived",
] as const;

export type BrandingStatus = (typeof BRANDING_STATUSES)[number];

export const BrandingStatusEnum = z.enum(BRANDING_STATUSES);

// ── Hex color helper ──────────────────────────────────────────────────────────

const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color (#rrggbb)");

// ── Brand brief schema ────────────────────────────────────────────────────────

export const BrandingBriefSchema = z.object({
  // Identity
  companyName:   z.string().min(1).max(200),
  productName:   z.string().max(200).optional(),
  industry:      z.string().min(1).max(100),
  namingStatus:  z.enum(["confirmed", "pending", "open"]).default("confirmed"),

  // Audience
  targetAudience:       z.string().min(1).max(500),
  audienceAgeRange:     z.string().max(50).optional(),
  audienceGeography:    z.string().max(200).optional(),

  // Strategy
  positioning:          z.string().min(1).max(1000),
  valueProposition:     z.string().max(500).optional(),
  brandPersonality:     z.array(z.string().min(1).max(100)).min(1).max(10),
  brandValues:          z.array(z.string().min(1).max(100)).min(1).max(10),
  competitors:          z.array(z.string().max(200)).max(10).default([]),

  // Verbal
  tone:                 z.array(z.string().min(1).max(100)).min(1).max(8),
  preferredVoice:       z.string().max(500).optional(),

  // Visual
  preferredStyle:       z.enum([
    "modern", "classic", "minimalist", "bold", "elegant",
    "playful", "corporate", "vintage", "futuristic", "organic",
  ]),
  colorConstraints:     z.array(HexColorSchema).max(5).default([]),
  avoidColors:          z.array(HexColorSchema).max(5).default([]),
  inspirationUrls:      z.array(z.string().url()).max(10).default([]),

  // Channels
  usageChannels:        z.array(z.enum([
    "print", "digital", "social", "outdoor", "broadcast", "packaging", "merchandise", "web",
  ])).min(1),

  // Meta
  language:             z.string().max(10).default("id"),
  notes:                z.string().max(3000).optional(),
});

export type BrandingBrief = z.infer<typeof BrandingBriefSchema>;

// ── Stage-advance request ─────────────────────────────────────────────────────

export const StageAdvanceSchema = z.object({
  /**
   * Target stage. Must be the next stage in sequence, OR "review" (which can
   * loop back from any stage).
   */
  targetStage: BrandingStageEnum,
  note:        z.string().max(1000).optional(),
});

export type StageAdvance = z.infer<typeof StageAdvanceSchema>;

// ── Status update request ─────────────────────────────────────────────────────

export const BrandingStatusUpdateSchema = z.object({
  status: BrandingStatusEnum,
  note:   z.string().max(500).optional(),
});

// ── Artifact registration request ────────────────────────────────────────────

export const ArtifactRegistrationSchema = z.object({
  artifactType: BrandingArtifactTypeEnum,
  title:        z.string().min(1).max(300),
  description:  z.string().max(1000).optional(),
  /** Storage URL or reference returned by the rendering engine. */
  storageUrl:   z.string().url().optional(),
  /** Inline content (JSON, markdown, SVG) for lightweight artifacts. */
  content:      z.unknown().optional(),
  /** Brand properties captured in this artifact. */
  properties:   z.array(BrandPropertySchema).max(50).default([]),
  /** Stage this artifact was produced at. */
  stage:        BrandingStageEnum,
  version:      z.number().int().min(1).default(1),
});

export type ArtifactRegistration = z.infer<typeof ArtifactRegistrationSchema>;
