/**
 * packageRules.ts — Team 16: Presentation & Document Creative Services
 *
 * Deliverable and package rules for each service type in this domain.
 * Governs page/slide limits, included deliverables, and package tiers.
 */

import type { PresentationDocumentServiceType } from "./types.js";

// ── Package tier definition ───────────────────────────────────────────────────

export type PackageTier = "essential" | "professional" | "enterprise";

export interface PageLimits {
  min:     number;
  target:  number;
  max:     number;
}

export interface PackageRule {
  serviceType:    PresentationDocumentServiceType;
  packageTier:    PackageTier;
  pageLimits:     PageLimits;
  /** Deliverables included in this package tier. */
  deliverables:   string[];
  /** Whether Brand DNA application is required for this tier. */
  requiresBrandDna: boolean;
  /** Whether QC score gate (≥80) is enforced before delivery. */
  qcGated:        boolean;
}

// ── Package rules table ───────────────────────────────────────────────────────

export const PACKAGE_RULES: PackageRule[] = [
  // ── Proposal ────────────────────────────────────────────────────────────────
  {
    serviceType: "proposal", packageTier: "essential",
    pageLimits: { min: 4, target: 6, max: 10 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "proposal", packageTier: "professional",
    pageLimits: { min: 6, target: 10, max: 16 },
    deliverables: ["pdf", "editable_docx_stub"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "proposal", packageTier: "enterprise",
    pageLimits: { min: 8, target: 14, max: 20 },
    deliverables: ["pdf", "editable_docx_stub", "custom_cover"],
    requiresBrandDna: true, qcGated: true,
  },

  // ── Product Catalog ──────────────────────────────────────────────────────────
  {
    serviceType: "product_catalog", packageTier: "essential",
    pageLimits: { min: 4, target: 6, max: 12 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "product_catalog", packageTier: "professional",
    pageLimits: { min: 6, target: 10, max: 18 },
    deliverables: ["pdf"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "product_catalog", packageTier: "enterprise",
    pageLimits: { min: 10, target: 16, max: 30 },
    deliverables: ["pdf", "print_ready"],
    requiresBrandDna: true, qcGated: true,
  },

  // ── Annual Report ────────────────────────────────────────────────────────────
  {
    serviceType: "annual_report", packageTier: "essential",
    pageLimits: { min: 8, target: 12, max: 20 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "annual_report", packageTier: "professional",
    pageLimits: { min: 12, target: 20, max: 30 },
    deliverables: ["pdf"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "annual_report", packageTier: "enterprise",
    pageLimits: { min: 20, target: 32, max: 50 },
    deliverables: ["pdf", "print_ready", "digital_interactive"],
    requiresBrandDna: true, qcGated: true,
  },

  // ── Whitepaper ───────────────────────────────────────────────────────────────
  {
    serviceType: "whitepaper", packageTier: "essential",
    pageLimits: { min: 6, target: 10, max: 16 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "whitepaper", packageTier: "professional",
    pageLimits: { min: 10, target: 16, max: 24 },
    deliverables: ["pdf"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "whitepaper", packageTier: "enterprise",
    pageLimits: { min: 16, target: 24, max: 40 },
    deliverables: ["pdf", "gated_landing_page_brief"],
    requiresBrandDna: true, qcGated: true,
  },

  // ── Case Study ───────────────────────────────────────────────────────────────
  {
    serviceType: "case_study", packageTier: "essential",
    pageLimits: { min: 2, target: 4, max: 6 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "case_study", packageTier: "professional",
    pageLimits: { min: 4, target: 6, max: 10 },
    deliverables: ["pdf"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "case_study", packageTier: "enterprise",
    pageLimits: { min: 6, target: 8, max: 14 },
    deliverables: ["pdf", "social_cutdown"],
    requiresBrandDna: true, qcGated: true,
  },

  // ── Ebook ────────────────────────────────────────────────────────────────────
  {
    serviceType: "ebook", packageTier: "essential",
    pageLimits: { min: 8, target: 12, max: 20 },
    deliverables: ["pdf"],
    requiresBrandDna: false, qcGated: true,
  },
  {
    serviceType: "ebook", packageTier: "professional",
    pageLimits: { min: 12, target: 20, max: 32 },
    deliverables: ["pdf"],
    requiresBrandDna: true, qcGated: true,
  },
  {
    serviceType: "ebook", packageTier: "enterprise",
    pageLimits: { min: 20, target: 32, max: 50 },
    deliverables: ["pdf", "landing_page_brief", "social_cards"],
    requiresBrandDna: true, qcGated: true,
  },
];

// ── Lookups ────────────────────────────────────────────────────────────────────

export function getPackageRule(
  serviceType: PresentationDocumentServiceType,
  tier: PackageTier = "professional",
): PackageRule | undefined {
  return PACKAGE_RULES.find(
    (r) => r.serviceType === serviceType && r.packageTier === tier,
  );
}

export function getMinimumPageCount(
  serviceType: PresentationDocumentServiceType,
  tier: PackageTier = "professional",
): number {
  return getPackageRule(serviceType, tier)?.pageLimits.min ?? 2;
}

/**
 * Resolve the package tier from a brief's packageLevel string, defaulting to
 * "professional" for any unrecognised value (consistent with Company Profile).
 */
export function resolvePackageTier(packageLevel: string | undefined): PackageTier {
  if (packageLevel === "essential" || packageLevel === "enterprise") {
    return packageLevel;
  }
  return "professional";
}
