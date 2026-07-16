/**
 * packagePolicy.ts — Graphic Design Domain (Team 15)
 *
 * Package tier policies: revision counts, file format access, source file
 * inclusion, turnaround SLA, and AI generation budgets per tier.
 *
 * Pure configuration — no I/O, no side effects.
 */

import type { GraphicDesignServiceCode, GdPackageTier } from "./types.js";

// ── Policy definition ─────────────────────────────────────────────────────────

export interface GdPackagePolicy {
  tier: GdPackageTier;
  label: string;
  /** Number of revision rounds included. */
  revisionsIncluded: number;
  /** Source/editable files (AI, EPS, SVG) included? */
  sourceFilesIncluded: boolean;
  /** Whether client may download print-ready files directly. */
  printReadyDownload: boolean;
  /** Max AI image generation attempts per job. */
  maxImageGenerationAttempts: number;
  /** Turnaround SLA in business days. */
  slaDays: number;
  /** Human QC review required before delivery. */
  humanQcRequired: boolean;
  /** Whether brand DNA (Team 7) integration is active. */
  brandDnaEnabled: boolean;
  /** Whether asset library (Team 8) retrieval is active. */
  assetLibraryEnabled: boolean;
  /** Priority level for job dispatch (higher = faster queue). */
  dispatchPriority: 1 | 2 | 3 | 4;
  /** Per-service overrides (null = use global policy). */
  serviceOverrides?: Partial<Record<GraphicDesignServiceCode, Partial<GdPackagePolicy>>>;
}

// ── Tier policies ─────────────────────────────────────────────────────────────

export const GD_PACKAGE_POLICIES: Record<GdPackageTier, GdPackagePolicy> = {
  starter: {
    tier: "starter",
    label: "Starter",
    revisionsIncluded: 1,
    sourceFilesIncluded: false,
    printReadyDownload: true,
    maxImageGenerationAttempts: 2,
    slaDays: 5,
    humanQcRequired: false,
    brandDnaEnabled: false,
    assetLibraryEnabled: false,
    dispatchPriority: 1,
    serviceOverrides: {
      "logo": { revisionsIncluded: 2 },  // logo always gets extra revision
    },
  },
  professional: {
    tier: "professional",
    label: "Professional",
    revisionsIncluded: 3,
    sourceFilesIncluded: false,
    printReadyDownload: true,
    maxImageGenerationAttempts: 4,
    slaDays: 3,
    humanQcRequired: false,
    brandDnaEnabled: true,
    assetLibraryEnabled: true,
    dispatchPriority: 2,
    serviceOverrides: {
      "logo": { revisionsIncluded: 5, sourceFilesIncluded: false },
      "stationery": { revisionsIncluded: 4 },
    },
  },
  business: {
    tier: "business",
    label: "Business",
    revisionsIncluded: 5,
    sourceFilesIncluded: true,
    printReadyDownload: true,
    maxImageGenerationAttempts: 6,
    slaDays: 2,
    humanQcRequired: true,
    brandDnaEnabled: true,
    assetLibraryEnabled: true,
    dispatchPriority: 3,
    serviceOverrides: {
      "logo": { revisionsIncluded: 8 },
      "stationery": { revisionsIncluded: 6 },
    },
  },
  enterprise: {
    tier: "enterprise",
    label: "Enterprise",
    revisionsIncluded: 999,  // unlimited
    sourceFilesIncluded: true,
    printReadyDownload: true,
    maxImageGenerationAttempts: 10,
    slaDays: 1,
    humanQcRequired: true,
    brandDnaEnabled: true,
    assetLibraryEnabled: true,
    dispatchPriority: 4,
  },
};

// ── Policy resolver ───────────────────────────────────────────────────────────

/**
 * Resolve the effective policy for a service at a given tier,
 * applying any service-specific overrides.
 */
export function resolveGdPolicy(
  tier: GdPackageTier,
  serviceCode: GraphicDesignServiceCode,
): GdPackagePolicy {
  const base = GD_PACKAGE_POLICIES[tier];
  const override = base.serviceOverrides?.[serviceCode];
  if (!override) return base;

  return {
    ...base,
    ...override,
    tier: base.tier,           // never override tier or label
    label: base.label,
  };
}

// ── Policy guards ─────────────────────────────────────────────────────────────

/**
 * Throw if the requested action is not permitted for this tier.
 */
export function assertSourceFileAccess(
  tier: GdPackageTier,
  serviceCode: GraphicDesignServiceCode,
): void {
  const policy = resolveGdPolicy(tier, serviceCode);
  if (!policy.sourceFilesIncluded) {
    throw new Error(
      `Source files (.ai, .eps) are not included in the '${tier}' package. ` +
        `Upgrade to Business or Enterprise to access editable source files.`,
    );
  }
}

/**
 * Check whether a further revision request is within the revision limit.
 * Returns remaining revisions after approval (0 = last revision consumed).
 * Throws if limit is already exhausted.
 */
export function assertRevisionAllowed(
  tier: GdPackageTier,
  serviceCode: GraphicDesignServiceCode,
  revisionsUsed: number,
): number {
  const policy = resolveGdPolicy(tier, serviceCode);
  if (revisionsUsed >= policy.revisionsIncluded) {
    throw new Error(
      `Revision limit reached (${policy.revisionsIncluded} included in '${tier}' package). ` +
        `Purchase additional revisions or upgrade your package to continue.`,
    );
  }
  return policy.revisionsIncluded - revisionsUsed - 1;
}

/**
 * Check whether human QC is required before delivery for this tier.
 */
export function isHumanQcRequired(
  tier: GdPackageTier,
  serviceCode: GraphicDesignServiceCode,
): boolean {
  return resolveGdPolicy(tier, serviceCode).humanQcRequired;
}

/**
 * Get the SLA deadline date from a given start date.
 */
export function computeSlaDueDate(
  tier: GdPackageTier,
  serviceCode: GraphicDesignServiceCode,
  startDate: Date,
): Date {
  const policy = resolveGdPolicy(tier, serviceCode);
  const due = new Date(startDate);
  due.setDate(due.getDate() + policy.slaDays);
  return due;
}

// ── Upgrade path ──────────────────────────────────────────────────────────────

export const GD_TIER_UPGRADE_PATH: Record<GdPackageTier, GdPackageTier | null> = {
  starter:      "professional",
  professional: "business",
  business:     "enterprise",
  enterprise:   null,
};

/**
 * Return the next tier up, or null if already at the top.
 */
export function getUpgradeTier(tier: GdPackageTier): GdPackageTier | null {
  return GD_TIER_UPGRADE_PATH[tier];
}
