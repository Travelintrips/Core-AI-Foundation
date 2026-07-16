/**
 * briefSchema.ts — Graphic Design Domain (Team 15)
 *
 * Deterministic brief-completeness scoring for all 10 Graphic Design services.
 * Pure functions — no I/O, no LLM calls. Same input → same output.
 *
 * Pattern follows companyProfileBriefIntelligence.ts.
 */

import type {
  GraphicDesignServiceCode,
  GdPackageTier,
  GdCommonBriefFields,
} from "./types.js";

// ── Required fields per service ──────────────────────────────────────────────

const COMMON_REQUIRED: (keyof GdCommonBriefFields)[] = [
  "gdCompanyName",
  "gdIndustry",
  "gdTargetAudience",
  "gdStyle",
];

const SERVICE_REQUIRED_FIELDS: Record<GraphicDesignServiceCode, string[]> = {
  "logo": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdLogoSymbolIdea",
  ],
  "business-card": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdBcFrontName",
    "gdBcFrontTitle",
    "gdBcFrontEmail",
    "gdBcFrontPhone",
  ],
  "letterhead": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdLhAddress",
    "gdLhEmail",
    "gdLhPhone",
  ],
  "flyer": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdFlyerHeadline",
    "gdFlyerCallToAction",
  ],
  "poster": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdPosterHeadline",
    "gdPosterSize",
  ],
  "banner": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdBannerHeadline",
    "gdBannerType",
  ],
  "brochure": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdBrochureFoldType",
    "gdBrochureHeadline",
  ],
  "social-media": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdSmPlatforms",
    "gdSmContentTheme",
  ],
  "certificate": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdCertTitle",
    "gdCertIssuingOrg",
    "gdCertBodyText",
  ],
  "stationery": [
    ...COMMON_REQUIRED,
    "gdPrimaryColor",
    "gdStItems",
    "gdStAddress",
    "gdStEmail",
  ],
};

// ── Optional / enrichment fields (improve score but don't block production) ──

const SERVICE_OPTIONAL_FIELDS: Record<GraphicDesignServiceCode, string[]> = {
  "logo": ["gdSecondaryColor", "gdAccentColor", "gdFontPreference", "gdTagline", "gdLogoVariants", "gdLogoColorCount", "gdUploadedLogo", "gdLogoUsageContext"],
  "business-card": ["gdBcBackContent", "gdBcFinish", "gdBcCorners", "gdTagline", "gdSecondaryColor", "gdUploadedLogo"],
  "letterhead": ["gdLhWebsite", "gdLhFooterText", "gdLhHeaderLayout", "gdLhIncludeWatermark", "gdTagline", "gdUploadedLogo"],
  "flyer": ["gdFlyerSubheadline", "gdFlyerBodyText", "gdFlyerEventDate", "gdFlyerEventVenue", "gdFlyerSize", "gdFlyerSides", "gdUploadedLogo"],
  "poster": ["gdPosterSubheadline", "gdPosterBodyText", "gdPosterCallToAction", "gdPosterOrientation", "gdPosterImageStyle", "gdUploadedLogo"],
  "banner": ["gdBannerSubheadline", "gdBannerWidthMm", "gdBannerHeightMm", "gdBannerCallToAction", "gdBannerVenueContext", "gdUploadedLogo"],
  "brochure": ["gdBrochurePageCount", "gdBrochureSections", "gdBrochureCallToAction", "gdBrochureContactInfo", "gdUploadedLogo"],
  "social-media": ["gdSmPostCaption", "gdSmHashtags", "gdSmPostCount", "gdSmIncludeStory", "gdSmIncludeCover", "gdUploadedLogo"],
  "certificate": ["gdCertRecipientLabel", "gdCertSignatoryName", "gdCertSignatoryTitle", "gdCertSignature2Name", "gdCertBorderStyle", "gdCertOrientation", "gdCertSeal", "gdUploadedLogo"],
  "stationery": ["gdStPhone", "gdStWebsite", "gdStEnvelopeSize", "gdStConsistencyLevel", "gdTagline", "gdUploadedLogo"],
};

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface GdBriefReadinessResult {
  overallScore: number;          // 0–100
  readinessStatus: "ready" | "needs_work" | "incomplete";
  requiredScore: number;         // 0–100 — required fields coverage
  optionalScore: number;         // 0–100 — optional enrichment coverage
  missingRequired: string[];
  missingOptional: string[];
  warnings: string[];
  serviceCode: GraphicDesignServiceCode;
}

/** Minimum brief readiness score to allow production dispatch. */
export const GD_BRIEF_READINESS_THRESHOLD = 60;

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pct(present: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((present / total) * 100);
}

/**
 * Score a Graphic Design brief.
 * Input is the raw brief_json Record from ai_service_requests.
 */
export function scoreGraphicDesignBrief(
  briefJson: Record<string, unknown>,
  serviceCode: GraphicDesignServiceCode,
): GdBriefReadinessResult {
  const required = SERVICE_REQUIRED_FIELDS[serviceCode] ?? [];
  const optional = SERVICE_OPTIONAL_FIELDS[serviceCode] ?? [];

  const missingRequired = required.filter((k) => !isPresent(briefJson[k]));
  const missingOptional = optional.filter((k) => !isPresent(briefJson[k]));

  const requiredScore = pct(required.length - missingRequired.length, required.length);
  const optionalScore = pct(optional.length - missingOptional.length, optional.length);

  // Weighted: required 70%, optional 30%
  const overallScore = Math.round(requiredScore * 0.7 + optionalScore * 0.3);

  const warnings: string[] = [];
  if (!isPresent(briefJson["gdPrimaryColor"])) {
    warnings.push("No primary brand colour specified — AI will choose a default palette.");
  }
  if (!isPresent(briefJson["gdUploadedLogo"]) && serviceCode !== "logo") {
    warnings.push("No existing logo uploaded — design will use text-based branding.");
  }
  if (serviceCode === "banner" && !isPresent(briefJson["gdBannerWidthMm"])) {
    warnings.push("Banner custom dimensions not set — standard roll-up (850×2000 mm) will be used.");
  }
  if (serviceCode === "social-media" && !isPresent(briefJson["gdSmPlatforms"])) {
    warnings.push("No platforms selected — defaulting to Instagram, Facebook, LinkedIn.");
  }

  const readinessStatus: GdBriefReadinessResult["readinessStatus"] =
    missingRequired.length > 0 ? "incomplete"
    : overallScore >= GD_BRIEF_READINESS_THRESHOLD ? "ready"
    : "needs_work";

  return {
    overallScore,
    readinessStatus,
    requiredScore,
    optionalScore,
    missingRequired,
    missingOptional,
    warnings,
    serviceCode,
  };
}

/**
 * Production guard — throws if brief is not ready for generation.
 * Call this before dispatching any graphic-design job.
 */
export function assertGdBriefReady(
  briefJson: Record<string, unknown>,
  serviceCode: GraphicDesignServiceCode,
): void {
  const result = scoreGraphicDesignBrief(briefJson, serviceCode);

  if (result.missingRequired.length > 0) {
    throw new Error(
      `Graphic design brief is incomplete for service '${serviceCode}'. ` +
        `Missing required fields: ${result.missingRequired.join(", ")}.`,
    );
  }
  if (result.overallScore < GD_BRIEF_READINESS_THRESHOLD) {
    throw new Error(
      `Graphic design brief readiness score (${result.overallScore}) is below threshold ` +
        `(${GD_BRIEF_READINESS_THRESHOLD}) for service '${serviceCode}'. ` +
        `Please complete more fields before dispatching.`,
    );
  }
}

/**
 * Extract the service-code from brief_json (written by wizard as `gdServiceCode`).
 * Falls back to the serviceCode arg.
 */
export function extractServiceCode(
  briefJson: Record<string, unknown>,
  fallback: GraphicDesignServiceCode,
): GraphicDesignServiceCode {
  const raw = briefJson["gdServiceCode"];
  if (typeof raw === "string" && (GRAPHIC_DESIGN_SERVICES_SET.has(raw as GraphicDesignServiceCode))) {
    return raw as GraphicDesignServiceCode;
  }
  return fallback;
}

const GRAPHIC_DESIGN_SERVICES_SET = new Set<string>([
  "logo", "business-card", "letterhead", "flyer", "poster",
  "banner", "brochure", "social-media", "certificate", "stationery",
]);

/**
 * Infer package tier from brief_json field `gdPackageTier`.
 */
export function extractPackageTier(briefJson: Record<string, unknown>): GdPackageTier {
  const raw = briefJson["gdPackageTier"];
  if (raw === "starter" || raw === "professional" || raw === "business" || raw === "enterprise") {
    return raw;
  }
  return "starter";
}
