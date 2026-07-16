/**
 * graphic-design/packagePolicy.ts — Team 15
 *
 * Package policy: what each tier includes, its pricing multiplier,
 * delivery SLA, and revision entitlements per service.
 *
 * These policies feed the service catalog packages (ai_service_packages table)
 * and are also used by the QC gate to determine how many concept variants
 * to generate per job.
 */

import type { GdServiceCode, PackageTier } from "./schema.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PackagePolicy {
  tier:              PackageTier;
  label:             string;
  conceptVariants:   number;     // How many design concepts to generate
  revisionRounds:    number;     // -1 = unlimited
  includesSourceFiles: boolean;
  includesAllFormats:  boolean;
  rushEligible:      boolean;
  humanReviewIncluded: boolean;
  deliveryDays:      number;     // Standard delivery (calendar days)
  rushDeliveryDays?: number;     // Rush delivery (calendar days)
  priceMultiplier:   number;     // Relative to base price (1.0 = base)
  description:       string;
}

// ── Base policies (shared across most services) ───────────────────────────────

export const BASE_POLICIES: Record<PackageTier, PackagePolicy> = {
  basic: {
    tier:                "basic",
    label:               "Basic",
    conceptVariants:     1,
    revisionRounds:      2,
    includesSourceFiles: false,
    includesAllFormats:  false,
    rushEligible:        false,
    humanReviewIncluded: false,
    deliveryDays:        7,
    priceMultiplier:     0.6,
    description:         "1 concept, 2 revision rounds. Core file formats (PDF + PNG). Standard 7-day delivery.",
  },
  standard: {
    tier:                "standard",
    label:               "Standard",
    conceptVariants:     3,
    revisionRounds:      5,
    includesSourceFiles: false,
    includesAllFormats:  true,
    rushEligible:        true,
    humanReviewIncluded: false,
    deliveryDays:        5,
    rushDeliveryDays:    2,
    priceMultiplier:     1.0,
    description:         "3 concepts, 5 revision rounds. All digital formats + print-ready PDF. Rush delivery available.",
  },
  premium: {
    tier:                "premium",
    label:               "Premium",
    conceptVariants:     5,
    revisionRounds:      -1,    // unlimited
    includesSourceFiles: true,
    includesAllFormats:  true,
    rushEligible:        true,
    humanReviewIncluded: true,
    deliveryDays:        3,
    rushDeliveryDays:    1,
    priceMultiplier:     2.0,
    description:         "5 concepts, unlimited revisions, editable source files (AI/PSD), human design review. Priority 3-day delivery.",
  },
};

// ── Service-specific policy overrides ─────────────────────────────────────────
//
// Override only the fields that differ from the base.
// Unspecified fields inherit from BASE_POLICIES.

type PolicyOverride = Partial<Omit<PackagePolicy, "tier">>;

const SERVICE_OVERRIDES: Record<GdServiceCode, Partial<Record<PackageTier, PolicyOverride>>> = {
  "GD-LOGO": {
    basic:    { conceptVariants: 2, deliveryDays: 5, description: "2 logo concepts, 2 revision rounds. SVG + PDF + PNG (color/mono). 5-day delivery." },
    standard: { conceptVariants: 3, deliveryDays: 4, rushDeliveryDays: 2 },
    premium:  { conceptVariants: 5, deliveryDays: 3, rushDeliveryDays: 1, description: "5 logo concepts, unlimited revisions, AI source, mini brand guide, favicon set. Human review. Priority 3-day." },
  },
  "GD-BCARD": {
    basic:    { conceptVariants: 1, deliveryDays: 4 },
    standard: { conceptVariants: 2, deliveryDays: 3, rushDeliveryDays: 1 },
    premium:  { conceptVariants: 3, deliveryDays: 2, rushDeliveryDays: 1 },
  },
  "GD-LTRHEAD": {
    basic:    { conceptVariants: 1, deliveryDays: 4 },
    standard: { conceptVariants: 2, deliveryDays: 3 },
    premium:  { conceptVariants: 2, deliveryDays: 2, description: "2 concepts, unlimited revisions, AI source, envelope + complimentary slip. Human review." },
  },
  "GD-FLYER": {
    basic:    { conceptVariants: 1, deliveryDays: 3 },
    standard: { conceptVariants: 2, deliveryDays: 3, rushDeliveryDays: 1 },
    premium:  { conceptVariants: 3, deliveryDays: 2, rushDeliveryDays: 1 },
  },
  "GD-POSTER": {
    basic:    { conceptVariants: 1, deliveryDays: 5 },
    standard: { conceptVariants: 2, deliveryDays: 4, rushDeliveryDays: 2 },
    premium:  { conceptVariants: 3, deliveryDays: 3, rushDeliveryDays: 1 },
  },
  "GD-BANNER": {
    basic:    { conceptVariants: 1, deliveryDays: 4 },
    standard: { conceptVariants: 2, deliveryDays: 3, rushDeliveryDays: 1 },
    premium:  { conceptVariants: 3, deliveryDays: 2, rushDeliveryDays: 1 },
  },
  "GD-BROCHURE": {
    basic:    { conceptVariants: 1, deliveryDays: 7 },
    standard: { conceptVariants: 2, deliveryDays: 5, rushDeliveryDays: 3 },
    premium:  { conceptVariants: 3, deliveryDays: 4, rushDeliveryDays: 2 },
  },
  "GD-SOCIAL": {
    basic:    { conceptVariants: 1, deliveryDays: 4, description: "1 concept × core platforms. 3 post + 2 story variants. Standard formats." },
    standard: { conceptVariants: 3, deliveryDays: 3, description: "3 themed post variants × 6 platforms. All sizes. Template editable in Canva." },
    premium:  { conceptVariants: 5, deliveryDays: 2, rushDeliveryDays: 1, description: "5 variants × all platforms, animated stories, AI source templates. Monthly refresh option." },
  },
  "GD-CERT": {
    basic:    { conceptVariants: 1, deliveryDays: 3 },
    standard: { conceptVariants: 2, deliveryDays: 3, rushDeliveryDays: 1 },
    premium:  { conceptVariants: 2, deliveryDays: 2, rushDeliveryDays: 1, description: "2 concepts, unlimited revisions, editable AI template, security features, bulk blank PDF." },
  },
  "GD-STATIONERY": {
    basic:    { conceptVariants: 1, deliveryDays: 7, description: "1 concept — letterhead + envelope + business card. Print-ready PDFs." },
    standard: { conceptVariants: 1, deliveryDays: 5, description: "1 concept — full 7-item stationery suite. All formats. Rush available." },
    premium:  { conceptVariants: 2, deliveryDays: 4, rushDeliveryDays: 2, description: "2 concepts — complete suite incl. folder + notepad. AI source. Mockup. Human review." },
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the effective package policy for a (serviceCode, tier) combination,
 * merging base policy with any service-specific overrides.
 */
export function getPackagePolicy(serviceCode: GdServiceCode, tier: PackageTier): PackagePolicy {
  const base = { ...BASE_POLICIES[tier] };
  const override = SERVICE_OVERRIDES[serviceCode]?.[tier];
  if (override) {
    return { ...base, ...override, tier } as PackagePolicy;
  }
  return base;
}

/** Return all three tiers for a service (useful for catalog display). */
export function getAllPolicies(serviceCode: GdServiceCode): Record<PackageTier, PackagePolicy> {
  return {
    basic:    getPackagePolicy(serviceCode, "basic"),
    standard: getPackagePolicy(serviceCode, "standard"),
    premium:  getPackagePolicy(serviceCode, "premium"),
  };
}

// ── Pricing helpers ───────────────────────────────────────────────────────────

/** Base prices (IDR) per service for the Standard tier. Scale by priceMultiplier. */
export const BASE_PRICES_IDR: Record<GdServiceCode, number> = {
  "GD-LOGO":       2_500_000,
  "GD-BCARD":        500_000,
  "GD-LTRHEAD":      750_000,
  "GD-FLYER":        500_000,
  "GD-POSTER":       750_000,
  "GD-BANNER":     1_000_000,
  "GD-BROCHURE":   1_500_000,
  "GD-SOCIAL":     1_500_000,
  "GD-CERT":         500_000,
  "GD-STATIONERY": 3_000_000,
};

export function getEffectivePrice(serviceCode: GdServiceCode, tier: PackageTier): number {
  const policy = getPackagePolicy(serviceCode, tier);
  return Math.round(BASE_PRICES_IDR[serviceCode] * policy.priceMultiplier);
}

/** Rush delivery surcharge: 50% of effective price. */
export const RUSH_SURCHARGE_PCT = 50;

export function getRushSurcharge(serviceCode: GdServiceCode, tier: PackageTier): number {
  return Math.round(getEffectivePrice(serviceCode, tier) * (RUSH_SURCHARGE_PCT / 100));
}
