/**
 * graphic-design/schema.ts — Team 15
 *
 * Zod brief schemas for all 10 Graphic Design services.
 * Uses a discriminated union on serviceCode so every service can be
 * validated with a single call:
 *
 *   GraphicDesignBriefSchema.safeParse(req.body)
 *
 * Service codes follow the GD-XXXX convention used throughout this domain.
 */
import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────────

export const GD_SERVICE_CODES = [
  "GD-LOGO",
  "GD-BCARD",
  "GD-LTRHEAD",
  "GD-FLYER",
  "GD-POSTER",
  "GD-BANNER",
  "GD-BROCHURE",
  "GD-SOCIAL",
  "GD-CERT",
  "GD-STATIONERY",
] as const;

export type GdServiceCode = (typeof GD_SERVICE_CODES)[number];

export const GD_SERVICE_LABELS: Record<GdServiceCode, string> = {
  "GD-LOGO":       "Logo Concept",
  "GD-BCARD":      "Business Card",
  "GD-LTRHEAD":    "Letterhead",
  "GD-FLYER":      "Flyer",
  "GD-POSTER":     "Poster",
  "GD-BANNER":     "Banner",
  "GD-BROCHURE":   "Brochure",
  "GD-SOCIAL":     "Social Media Kit",
  "GD-CERT":       "Certificate",
  "GD-STATIONERY": "Stationery Suite",
};

// ── Shared enums ──────────────────────────────────────────────────────────────

export const StylePreferenceEnum = z.enum([
  "modern",
  "classic",
  "minimalist",
  "bold",
  "elegant",
  "playful",
  "corporate",
  "vintage",
  "futuristic",
]);

export const UrgencyLevelEnum = z.enum(["standard", "rush", "express"]);
export const PackageTierEnum   = z.enum(["basic", "standard", "premium"]);
export const OutputFormatEnum  = z.enum(["digital", "print", "both"]);

/** Hex color — #rrggbb */
const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color (#rrggbb)");

// ── Base brief fields shared by every service ─────────────────────────────────

const GraphicDesignBriefBaseSchema = z.object({
  clientName:      z.string().min(1).max(200),
  brandName:       z.string().min(1).max(200),
  industry:        z.string().min(1).max(100),
  targetAudience:  z.string().min(1).max(500),
  stylePreference: StylePreferenceEnum,
  colorPalette:    z.array(HexColorSchema).min(1).max(5),
  primaryFont:     z.string().max(100).optional(),
  secondaryFont:   z.string().max(100).optional(),
  notes:           z.string().max(2000).optional(),
  urgencyLevel:    UrgencyLevelEnum.default("standard"),
  language:        z.string().max(10).default("id"),
  packageTier:     PackageTierEnum.default("standard"),
  outputFormat:    OutputFormatEnum.default("both"),
  /** Number of physical print copies ordered (does not affect design deliverables). */
  printQuantity:   z.number().int().min(0).max(100_000).default(0),
  referenceUrls:   z.array(z.string().url()).max(5).default([]),
});

// ── Service-specific extensions ───────────────────────────────────────────────

// GD-LOGO ─────────────────────────────────────────────────────────────────────
export const LogoBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:       z.literal("GD-LOGO"),
  logoType:          z.enum(["wordmark", "lettermark", "combination", "emblem", "mascot"]).default("combination"),
  conceptVariants:   z.number().int().min(1).max(5).default(3),
  deliveryFormats:   z.array(z.enum(["ai", "eps", "svg", "pdf", "png", "jpg"])).min(1).default(["svg", "pdf", "png"]),
  includesDarkVariant:  z.boolean().default(true),
  includesMonochrome:   z.boolean().default(true),
  includesFavicon:      z.boolean().default(false),
  existingLogoUrl:      z.string().url().optional(),
});

// GD-BCARD ────────────────────────────────────────────────────────────────────
export const BusinessCardBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:     z.literal("GD-BCARD"),
  cardSize:        z.enum(["standard", "square", "mini", "euro", "us"]).default("standard"),
  sides:           z.enum(["single", "double"]).default("double"),
  orientation:     z.enum(["portrait", "landscape"]).default("landscape"),
  specialFinish:   z.enum(["none", "matte", "glossy", "soft_touch", "emboss", "foil", "spot_uv"]).default("none"),
  paperStock:      z.enum(["350gsm", "400gsm", "silk", "kraft", "transparent"]).default("350gsm"),
  roundedCorners:  z.boolean().default(false),
  contactFields:   z.array(z.enum(["phone", "email", "website", "address", "social", "qr_code", "title"])).default(["phone", "email", "website"]),
});

// GD-LTRHEAD ──────────────────────────────────────────────────────────────────
export const LetterheadBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:                z.literal("GD-LTRHEAD"),
  pageSize:                   z.enum(["A4", "letter", "legal"]).default("A4"),
  sides:                      z.enum(["single", "double"]).default("single"),
  includesEnvelope:           z.boolean().default(false),
  includesComplimentarySlip:  z.boolean().default(false),
  includesSecondPage:         z.boolean().default(false),
  includesFax:                z.boolean().default(false),
  headerStyle:                z.enum(["minimal", "banner", "sidebar", "centered"]).default("banner"),
  footerStyle:                z.enum(["minimal", "full_contact", "legal_text", "divider"]).default("full_contact"),
});

// GD-FLYER ────────────────────────────────────────────────────────────────────
export const FlyerBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:   z.literal("GD-FLYER"),
  pageSize:      z.enum(["A4", "A5", "A6", "letter", "DL", "square_21"]).default("A5"),
  sides:         z.enum(["single", "double"]).default("single"),
  orientation:   z.enum(["portrait", "landscape"]).default("portrait"),
  purposeType:   z.enum(["event", "promotion", "product", "menu", "announcement", "real_estate"]).default("promotion"),
  eventDate:     z.string().max(100).optional(),
  callToAction:  z.string().max(200).optional(),
  includesCoupon: z.boolean().default(false),
  keyMessages:   z.array(z.string().max(200)).max(5).default([]),
});

// GD-POSTER ───────────────────────────────────────────────────────────────────
export const PosterBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:   z.literal("GD-POSTER"),
  paperSize:     z.enum(["A0", "A1", "A2", "A3", "A4", "B1", "B2", "custom"]).default("A3"),
  customWidthMm:  z.number().positive().max(3000).optional(),
  customHeightMm: z.number().positive().max(5000).optional(),
  orientation:   z.enum(["portrait", "landscape"]).default("portrait"),
  purposeType:   z.enum(["event", "advertising", "informational", "artistic", "movie", "music"]).default("event"),
  resolution:    z.enum(["150dpi", "300dpi", "600dpi"]).default("300dpi"),
  isMockupNeeded: z.boolean().default(false),
  displayContext: z.enum(["indoor", "outdoor", "both"]).default("indoor"),
});

// GD-BANNER ───────────────────────────────────────────────────────────────────
export const BannerBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:   z.literal("GD-BANNER"),
  bannerType:    z.enum(["rollup", "xbanner", "backdrop", "digital_web", "digital_social", "leaderboard", "billboard", "fascia"]).default("rollup"),
  widthMm:       z.number().positive().max(20_000).optional(),
  heightMm:      z.number().positive().max(20_000).optional(),
  /** Pre-defined standard banner sizes for digital (e.g. "728x90", "300x250") */
  digitalSize:   z.string().max(20).optional(),
  hasPolesPockets: z.boolean().default(true),
  hasBacking:    z.boolean().default(false),
  displayContext: z.enum(["indoor", "outdoor", "digital"]).default("indoor"),
  viewingDistance: z.enum(["close", "medium", "far"]).default("medium"),
  animationNeeded: z.boolean().default(false),
});

// GD-BROCHURE ─────────────────────────────────────────────────────────────────
export const BrochureBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:  z.literal("GD-BROCHURE"),
  foldType:     z.enum(["bifold", "trifold", "zfold", "gatefold", "accordion", "single_page"]).default("trifold"),
  pageCount:    z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(12), z.literal(16)]).default(6),
  pageSize:     z.enum(["A4", "A5", "DL", "letter", "square_21"]).default("A4"),
  orientation:  z.enum(["portrait", "landscape"]).default("portrait"),
  purposeType:  z.enum(["product_catalog", "company_profile", "event", "menu", "service_list", "annual_report"]).default("company_profile"),
  includesMap:  z.boolean().default(false),
  sections:     z.array(z.string().max(100)).max(12).default([]),
});

// GD-SOCIAL ───────────────────────────────────────────────────────────────────
export const SocialMediaBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:          z.literal("GD-SOCIAL"),
  platforms:            z.array(z.enum(["instagram", "facebook", "twitter_x", "linkedin", "tiktok", "youtube", "pinterest", "whatsapp"])).min(1),
  contentTypes:         z.array(z.enum(["post_square", "post_portrait", "story", "cover", "banner", "highlight_icon", "thumbnail", "carousel"])).min(1),
  variantsPerType:      z.number().int().min(1).max(10).default(3),
  includesTemplate:     z.boolean().default(true),
  includesAnimated:     z.boolean().default(false),
  contentTheme:         z.enum(["product", "promotion", "announcement", "motivational", "educational", "lifestyle"]).default("promotion"),
  hashtagsIncluded:     z.boolean().default(false),
  copywritingIncluded:  z.boolean().default(false),
});

// GD-CERT ─────────────────────────────────────────────────────────────────────
export const CertificateBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode:         z.literal("GD-CERT"),
  orientation:         z.enum(["portrait", "landscape"]).default("landscape"),
  pageSize:            z.enum(["A4", "A5", "A3", "letter"]).default("A4"),
  certificateType:     z.enum(["achievement", "completion", "participation", "appreciation", "membership", "award"]).default("achievement"),
  hasSignatureLine:    z.boolean().default(true),
  signatoryCount:      z.number().int().min(1).max(5).default(2),
  hasSeal:             z.boolean().default(true),
  hasSerialNumber:     z.boolean().default(false),
  hasQrCode:           z.boolean().default(false),
  securityFeatures:    z.array(z.enum(["watermark", "microprint", "guilloche", "hologram_area", "uv_reactive"])).default([]),
  isEditable:          z.boolean().default(false),
  recipientFields:     z.array(z.string().max(100)).max(10).default(["name", "date", "title"]),
});

// GD-STATIONERY ───────────────────────────────────────────────────────────────
export const StationeryBriefSchema = GraphicDesignBriefBaseSchema.extend({
  serviceCode: z.literal("GD-STATIONERY"),
  items: z.array(z.enum([
    "letterhead",
    "envelope_dl",
    "envelope_c5",
    "business_card",
    "notepad_a5",
    "notepad_a4",
    "presentation_folder",
    "stamp_design",
    "mug_wrap",
    "tshirt_print",
    "id_card",
    "lanyard",
    "sticker_sheet",
    "packaging_label",
  ])).min(1),
  consistencyLevel: z.enum(["loose", "strict", "pixel_perfect"]).default("strict"),
  brandGuidelineUrl: z.string().url().optional(),
});

// ── Discriminated union — the single schema to validate any brief ─────────────

export const GraphicDesignBriefSchema = z.discriminatedUnion("serviceCode", [
  LogoBriefSchema,
  BusinessCardBriefSchema,
  LetterheadBriefSchema,
  FlyerBriefSchema,
  PosterBriefSchema,
  BannerBriefSchema,
  BrochureBriefSchema,
  SocialMediaBriefSchema,
  CertificateBriefSchema,
  StationeryBriefSchema,
]);

export type GraphicDesignBrief       = z.infer<typeof GraphicDesignBriefSchema>;
export type LogoBrief                = z.infer<typeof LogoBriefSchema>;
export type BusinessCardBrief        = z.infer<typeof BusinessCardBriefSchema>;
export type LetterheadBrief          = z.infer<typeof LetterheadBriefSchema>;
export type FlyerBrief               = z.infer<typeof FlyerBriefSchema>;
export type PosterBrief              = z.infer<typeof PosterBriefSchema>;
export type BannerBrief              = z.infer<typeof BannerBriefSchema>;
export type BrochureBrief            = z.infer<typeof BrochureBriefSchema>;
export type SocialMediaBrief         = z.infer<typeof SocialMediaBriefSchema>;
export type CertificateBrief         = z.infer<typeof CertificateBriefSchema>;
export type StationeryBrief          = z.infer<typeof StationeryBriefSchema>;
export type PackageTier              = z.infer<typeof PackageTierEnum>;
export type OutputFormat             = z.infer<typeof OutputFormatEnum>;
export type UrgencyLevel             = z.infer<typeof UrgencyLevelEnum>;

// ── Status schema (shared with routes) ───────────────────────────────────────

export const GD_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "in_production",
  "qc_check",
  "qc_failed",
  "revision_requested",
  "completed",
  "cancelled",
] as const;

export type GdStatus = (typeof GD_STATUSES)[number];

export const GdStatusUpdateSchema = z.object({
  status: z.enum(GD_STATUSES),
  note:   z.string().max(500).optional(),
});
