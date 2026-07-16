/**
 * types.ts — Graphic Design Domain (Team 15)
 *
 * Shared TypeScript types for brief schema, QC, manifests, and package policy.
 * No runtime dependencies — pure type definitions.
 */

// ── Service codes ─────────────────────────────────────────────────────────────

export const GRAPHIC_DESIGN_SERVICES = [
  "logo",
  "business-card",
  "letterhead",
  "flyer",
  "poster",
  "banner",
  "brochure",
  "social-media",
  "certificate",
  "stationery",
] as const;

export type GraphicDesignServiceCode = (typeof GRAPHIC_DESIGN_SERVICES)[number];

// ── Package tiers ─────────────────────────────────────────────────────────────

export const GD_PACKAGE_TIERS = ["starter", "professional", "business", "enterprise"] as const;
export type GdPackageTier = (typeof GD_PACKAGE_TIERS)[number];

// ── Print specification ───────────────────────────────────────────────────────

export interface PrintSpec {
  widthMm: number;
  heightMm: number;
  bleedMm: number;
  safeAreaMm: number;
  resolutionDpi: number;
  colorMode: "cmyk" | "rgb";
  /** True when this service produces only digital files (no print-ready PDF) */
  digitalOnly: boolean;
}

// ── Brief schema ──────────────────────────────────────────────────────────────

/** Fields shared by all Graphic Design brief inputs (gd_ prefix). */
export interface GdCommonBriefFields {
  gdCompanyName?: string;
  gdIndustry?: string;
  gdTargetAudience?: string;
  gdPrimaryColor?: string;
  gdSecondaryColor?: string;
  gdAccentColor?: string;
  gdFontPreference?: string;
  gdStyle?: "modern" | "classic" | "minimalist" | "bold" | "playful" | "corporate";
  gdExistingBrandAssets?: string;      // URL or description
  gdUploadedLogo?: string;             // storage path
  gdTagline?: string;
  gdSpecialRequirements?: string;
}

/** Logo-specific brief fields. */
export interface GdLogoBriefFields extends GdCommonBriefFields {
  gdLogoVariants?: Array<"horizontal" | "stacked" | "icon">;
  gdLogoSymbolIdea?: string;
  gdLogoColorCount?: number;
  gdLogoUsageContext?: string;         // where logo will appear
  gdLogoFileFormats?: Array<"svg" | "png" | "eps" | "pdf">;
}

/** Business card brief fields. */
export interface GdBusinessCardBriefFields extends GdCommonBriefFields {
  gdBcFrontName?: string;
  gdBcFrontTitle?: string;
  gdBcFrontPhone?: string;
  gdBcFrontEmail?: string;
  gdBcFrontWebsite?: string;
  gdBcFrontAddress?: string;
  gdBcBackContent?: string;           // what to put on the back
  gdBcFinish?: "matte" | "glossy" | "silk" | "soft-touch";
  gdBcCorners?: "square" | "rounded";
  gdBcQuantity?: number;
}

/** Letterhead brief fields. */
export interface GdLetterheadBriefFields extends GdCommonBriefFields {
  gdLhAddress?: string;
  gdLhPhone?: string;
  gdLhEmail?: string;
  gdLhWebsite?: string;
  gdLhFooterText?: string;
  gdLhHeaderLayout?: "left" | "center" | "right";
  gdLhIncludeWatermark?: boolean;
}

/** Flyer brief fields. */
export interface GdFlyerBriefFields extends GdCommonBriefFields {
  gdFlyerHeadline?: string;
  gdFlyerSubheadline?: string;
  gdFlyerBodyText?: string;
  gdFlyerCallToAction?: string;
  gdFlyerEventDate?: string;
  gdFlyerEventVenue?: string;
  gdFlyerSize?: "a4" | "a5" | "dl";
  gdFlyerSides?: "single" | "double";
}

/** Poster brief fields. */
export interface GdPosterBriefFields extends GdCommonBriefFields {
  gdPosterHeadline?: string;
  gdPosterSubheadline?: string;
  gdPosterBodyText?: string;
  gdPosterCallToAction?: string;
  gdPosterSize?: "a3" | "a2" | "a1" | "b2" | "custom";
  gdPosterOrientation?: "portrait" | "landscape";
  gdPosterImageStyle?: "photography" | "illustration" | "abstract";
}

/** Banner brief fields. */
export interface GdBannerBriefFields extends GdCommonBriefFields {
  gdBannerHeadline?: string;
  gdBannerSubheadline?: string;
  gdBannerType?: "rollup" | "horizontal" | "backdrop" | "xbanner";
  gdBannerWidthMm?: number;
  gdBannerHeightMm?: number;
  gdBannerCallToAction?: string;
  gdBannerVenueContext?: string;      // trade show, office lobby, etc.
}

/** Brochure brief fields. */
export interface GdBrochureBriefFields extends GdCommonBriefFields {
  gdBrochureFoldType?: "trifold" | "bifold" | "z-fold" | "gatefold";
  gdBrochurePageCount?: number;
  gdBrochureHeadline?: string;
  gdBrochureSections?: string[];
  gdBrochureCallToAction?: string;
  gdBrochureContactInfo?: string;
}

/** Social media kit brief fields. */
export interface GdSocialMediaBriefFields extends GdCommonBriefFields {
  gdSmPlatforms?: Array<"instagram" | "facebook" | "linkedin" | "twitter" | "tiktok">;
  gdSmContentTheme?: string;
  gdSmPostCaption?: string;
  gdSmHashtags?: string;
  gdSmPostCount?: number;              // number of post variants
  gdSmIncludeStory?: boolean;
  gdSmIncludeCover?: boolean;
}

/** Certificate brief fields. */
export interface GdCertificateBriefFields extends GdCommonBriefFields {
  gdCertTitle?: string;
  gdCertIssuingOrg?: string;
  gdCertRecipientLabel?: string;      // e.g. "This certifies that"
  gdCertBodyText?: string;
  gdCertSignatoryName?: string;
  gdCertSignatoryTitle?: string;
  gdCertSignature2Name?: string;
  gdCertSignature2Title?: string;
  gdCertBorderStyle?: "classic" | "modern" | "minimal" | "ornate";
  gdCertOrientation?: "landscape" | "portrait";
  gdCertSeal?: boolean;
}

/** Stationery set brief fields. */
export interface GdStationeryBriefFields extends GdCommonBriefFields {
  gdStItems?: Array<"letterhead" | "business-card" | "envelope" | "with-compliments" | "notepad">;
  gdStAddress?: string;
  gdStPhone?: string;
  gdStEmail?: string;
  gdStWebsite?: string;
  gdStEnvelopeSize?: "dl" | "c4" | "c5";
  gdStConsistencyLevel?: "exact" | "coordinated";
}

/** Union of all service brief types (discriminated by service code). */
export type GraphicDesignBriefInput =
  | ({ serviceCode: "logo" } & GdLogoBriefFields)
  | ({ serviceCode: "business-card" } & GdBusinessCardBriefFields)
  | ({ serviceCode: "letterhead" } & GdLetterheadBriefFields)
  | ({ serviceCode: "flyer" } & GdFlyerBriefFields)
  | ({ serviceCode: "poster" } & GdPosterBriefFields)
  | ({ serviceCode: "banner" } & GdBannerBriefFields)
  | ({ serviceCode: "brochure" } & GdBrochureBriefFields)
  | ({ serviceCode: "social-media" } & GdSocialMediaBriefFields)
  | ({ serviceCode: "certificate" } & GdCertificateBriefFields)
  | ({ serviceCode: "stationery" } & GdStationeryBriefFields);

// ── QC types ──────────────────────────────────────────────────────────────────

export interface GdQcDimensions {
  briefCompleteness: number;   // 0–100
  printSpecValid: number;      // 0–100 (100 for digital-only)
  textFitting: number;         // 0–100
  bleedSafeArea: number;       // 0–100 (100 for digital-only)
  deliverableCount: number;    // 0–100
}

export interface GdQcResult {
  qcScore: number;
  passed: boolean;
  dimensions: GdQcDimensions;
  warnings: string[];
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
}

// ── Deliverable manifest ──────────────────────────────────────────────────────

export interface GdDeliverableEntry {
  fileName: string;
  purpose: "primary" | "variant" | "source" | "export" | "thumbnail" | "manifest" | "qc";
  mimeType: string;
  storagePath?: string;
  fileSizeBytes?: number;
  checksumSha256?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface GdDeliverableManifest {
  version: "1.0";
  gdRequestId: number;
  serviceCode: GraphicDesignServiceCode;
  packageTier: GdPackageTier;
  exportedAt: string;            // ISO-8601
  tenantId: string;
  deliverables: GdDeliverableEntry[];
  printSpec: PrintSpec | null;   // null for digital-only
  qcSummary: { score: number; passed: boolean; warnings: string[] };
}

// ── Blueprint / component mapping types ───────────────────────────────────────

export interface GdBlueprint {
  serviceCode: GraphicDesignServiceCode;
  /** Which Team 7–14 rendering engine to route through */
  engineTeam: 9 | 10 | 11;        // image-gen | template-engine | pdf-export
  /** Job type registered in JOB_COMPLETION_REQUIREMENTS */
  jobType: string;
  /** Human-readable brief prompt template name */
  promptTemplate: string;
}

export interface GdRequiredComponent {
  name: string;
  required: boolean;
  source: "brief" | "brand-dna" | "asset-library" | "generated";
  description: string;
}
