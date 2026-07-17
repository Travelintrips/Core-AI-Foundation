/**
 * creativeAssetListingAdapter.ts — Team 21 Category Extension Adapter
 *
 * PURPOSE: Extend V4.7 creativeMarketplaceService with:
 *   1. Additional item-type vocabulary (blueprint, pattern, typography_pairing, etc.)
 *   2. Structured license metadata contract (standard / extended / exclusive)
 *   3. Compatibility metadata extension (use-context, material suitability)
 *
 * BOUNDARY:
 *   - This adapter NEVER persists data directly.
 *   - All persistence goes through the existing V4.7 creativeMarketplaceService.
 *   - No new tables, no new routes, no payment/payout/wallet logic.
 *   - Status: BLOCKED_PENDING_MARKETPLACE_CONSOLIDATION
 *             (pending architecture review with Teams 04, 06, 07-14)
 *
 * INTEGRATION:
 *   - Team 24 decides whether to mount these extensions alongside V4.7
 *     or wait for the unified marketplace architecture review.
 */

// ── Item type vocabulary extension ───────────────────────────────────────────
// V4.7 native types: illustration | icon | cover | layout | background | photo | brand_pack
// Team 21 proposes these additional types for Teams 07-14 design asset categories:

export const CM2_EXTENDED_ITEM_TYPES = [
  "blueprint",           // Team 07 Blueprint Library
  "template",            // Teams 08-13 component/layout templates
  "pattern",             // Team 09 Pattern & Motif Library
  "typography_pairing",  // Team 10 Typography & Palette
  "palette",             // Team 10 Color Palette
  "interior_material",   // interior/surface design categories
  "furniture_reference", // 3D / product reference assets
  "fashion_motif",       // fashion & textile design assets
] as const;

export type CM2ExtendedItemType = (typeof CM2_EXTENDED_ITEM_TYPES)[number];

/** Full combined vocabulary (V4.7 types + Team 21 extensions) */
export const ALL_ITEM_TYPES = [
  // V4.7 native
  "illustration",
  "icon",
  "cover",
  "layout",
  "background",
  "photo",
  "brand_pack",
  // Team 21 extensions
  ...CM2_EXTENDED_ITEM_TYPES,
] as const;

export type AllItemType = (typeof ALL_ITEM_TYPES)[number];

/** Returns true if the given string is a Team 21 extended type (not in V4.7 core). */
export function isExtendedItemType(t: string): t is CM2ExtendedItemType {
  return (CM2_EXTENDED_ITEM_TYPES as readonly string[]).includes(t);
}

// ── License metadata contract ─────────────────────────────────────────────────

export const CM2_LICENSE_TYPES = ["standard", "extended", "exclusive"] as const;
export type CM2LicenseType = (typeof CM2_LICENSE_TYPES)[number];

export const CM2_PRICE_TYPES = ["free", "premium"] as const;
export type CM2PriceType = (typeof CM2_PRICE_TYPES)[number];

/**
 * Structured license metadata. Stored as JSONB in the existing
 * marketplace_assets.metadata column — no new columns required.
 */
export interface CM2LicenseMetadata {
  allowedUses: string[];
  requiresAttribution: boolean;
  commercialUse: boolean;
  editorialUse: boolean;
  printUse: boolean;
  digitalUse: boolean;
  resellAllowed: boolean;
  modificationAllowed: boolean;
  numberOfSeats: number | null;
  geographicRestrictions: string[];
  notes: string | null;
}

/** Default license metadata per license type. Pure function — no side effects. */
export function defaultLicenseMeta(type: CM2LicenseType): CM2LicenseMetadata {
  switch (type) {
    case "standard":
      return {
        allowedUses: ["personal", "editorial"],
        requiresAttribution: true,
        commercialUse: false,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: false,
        modificationAllowed: true,
        numberOfSeats: 1,
        geographicRestrictions: [],
        notes: null,
      };
    case "extended":
      return {
        allowedUses: ["personal", "editorial", "commercial"],
        requiresAttribution: false,
        commercialUse: true,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: false,
        modificationAllowed: true,
        numberOfSeats: null,
        geographicRestrictions: [],
        notes: null,
      };
    case "exclusive":
      return {
        allowedUses: ["personal", "editorial", "commercial", "resell"],
        requiresAttribution: false,
        commercialUse: true,
        editorialUse: true,
        printUse: true,
        digitalUse: true,
        resellAllowed: true,
        modificationAllowed: true,
        numberOfSeats: null,
        geographicRestrictions: [],
        notes: null,
      };
  }
}

/** Human-readable one-line summary of a license type. */
export function licenseSummary(type: CM2LicenseType): string {
  switch (type) {
    case "standard":
      return "Personal & editorial use. Attribution required. No commercial use.";
    case "extended":
      return "Commercial use included. No resell. No attribution needed.";
    case "exclusive":
      return "Full commercial rights including resell. No attribution needed.";
  }
}

/**
 * Extract and validate license metadata from an asset's metadata JSONB blob.
 * Falls back to defaultLicenseMeta("standard") if missing or malformed.
 */
export function extractLicenseMeta(
  metadataBlob: Record<string, unknown>,
  licenseType: string,
): CM2LicenseMetadata {
  const type: CM2LicenseType = (CM2_LICENSE_TYPES as readonly string[]).includes(licenseType)
    ? (licenseType as CM2LicenseType)
    : "standard";

  const raw = metadataBlob?.licenseMetadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...defaultLicenseMeta(type), ...(raw as Partial<CM2LicenseMetadata>) };
  }
  return defaultLicenseMeta(type);
}

// ── Compatibility metadata extension ─────────────────────────────────────────

/** Use contexts where this asset is suitable (for pattern/material/motif types). */
export const COMPAT_USE_CONTEXTS = [
  "print",
  "digital",
  "textile",
  "packaging",
  "interior",
  "web",
  "branding",
  "motion",
] as const;
export type CompatUseContext = (typeof COMPAT_USE_CONTEXTS)[number];

/** Minimum recommended output resolution by use context. */
export const MIN_DPI_BY_CONTEXT: Record<CompatUseContext, number> = {
  print: 300,
  digital: 72,
  textile: 150,
  packaging: 300,
  interior: 150,
  web: 72,
  branding: 150,
  motion: 72,
};

/**
 * Compatibility metadata for a design asset.
 * Stored as JSONB in marketplace_assets.metadata — no new columns required.
 */
export interface CM2CompatMetadata {
  compatibleContexts: CompatUseContext[];
  minDpi: number;
  maxScaleFactor: number | null;
  colorModes: Array<"RGB" | "CMYK" | "Grayscale">;
  supportsSeamlessTiling: boolean;
  notes: string | null;
}

/** Default compat metadata for a given item type. */
export function defaultCompatMeta(itemType: string): CM2CompatMetadata {
  if (itemType === "pattern" || itemType === "interior_material" || itemType === "fashion_motif") {
    return {
      compatibleContexts: ["print", "textile", "digital", "interior"],
      minDpi: 150,
      maxScaleFactor: 4,
      colorModes: ["RGB", "CMYK"],
      supportsSeamlessTiling: true,
      notes: null,
    };
  }
  if (itemType === "typography_pairing" || itemType === "palette") {
    return {
      compatibleContexts: ["print", "digital", "web", "branding"],
      minDpi: 72,
      maxScaleFactor: null,
      colorModes: ["RGB", "CMYK"],
      supportsSeamlessTiling: false,
      notes: null,
    };
  }
  // Default for blueprint, template, icon, illustration, layout, etc.
  return {
    compatibleContexts: ["digital", "web", "branding"],
    minDpi: 72,
    maxScaleFactor: null,
    colorModes: ["RGB"],
    supportsSeamlessTiling: false,
    notes: null,
  };
}

/**
 * Validate whether an asset is compatible with a requested use context.
 * Returns { compatible: true } or { compatible: false, reason: string }.
 */
export function checkCompatibility(
  meta: CM2CompatMetadata,
  requestedContext: string,
  requestedDpi?: number,
): { compatible: boolean; reason?: string } {
  if (!(COMPAT_USE_CONTEXTS as readonly string[]).includes(requestedContext)) {
    return { compatible: false, reason: `Unknown context: ${requestedContext}` };
  }
  const ctx = requestedContext as CompatUseContext;

  if (!meta.compatibleContexts.includes(ctx)) {
    return {
      compatible: false,
      reason: `Asset not rated for "${ctx}" use. Compatible contexts: ${meta.compatibleContexts.join(", ")}.`,
    };
  }

  if (requestedDpi !== undefined && requestedDpi < meta.minDpi) {
    return {
      compatible: false,
      reason: `Requested DPI (${requestedDpi}) is below minimum (${meta.minDpi}) for this asset.`,
    };
  }

  return { compatible: true };
}

/**
 * Extract and validate compat metadata from an asset's metadata JSONB blob.
 * Falls back to defaultCompatMeta(itemType) if missing or malformed.
 */
export function extractCompatMeta(
  metadataBlob: Record<string, unknown>,
  itemType: string,
): CM2CompatMetadata {
  const raw = metadataBlob?.compatMetadata;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...defaultCompatMeta(itemType), ...(raw as Partial<CM2CompatMetadata>) };
  }
  return defaultCompatMeta(itemType);
}

// ── Marketplace category extension contract ───────────────────────────────────

/**
 * Category extension contract for Teams 07-14.
 *
 * When Team 24 integrates the unified marketplace, categories from these teams
 * must be registered here so listing filters remain consistent across all item types.
 *
 * This is a PURE DATA CONTRACT — no DB writes. Source of truth for Team 24.
 */
export const MARKETPLACE_CATEGORY_EXTENSION: Record<CM2ExtendedItemType, string[]> = {
  blueprint:           ["UI/UX", "Web", "Mobile", "Print", "Branding", "Architecture", "Product"],
  template:            ["Social Media", "Presentation", "Email", "Web", "Print", "Marketing"],
  pattern:             ["Geometric", "Floral", "Abstract", "Cultural", "Textile", "Surface"],
  typography_pairing:  ["Serif", "Sans-serif", "Display", "Monospace", "Handwritten"],
  palette:             ["Monochromatic", "Complementary", "Analogous", "Triadic", "Neutral", "Vibrant"],
  interior_material:   ["Wood", "Stone", "Fabric", "Metal", "Ceramic", "Glass", "Concrete"],
  furniture_reference: ["Chair", "Table", "Sofa", "Bed", "Storage", "Outdoor", "Lighting"],
  fashion_motif:       ["Geometric", "Floral", "Abstract", "Cultural", "Stripe", "Check", "Animal"],
};

/** Returns all valid categories for a given item type. Returns [] for unknown types. */
export function categoriesForItemType(itemType: string): string[] {
  if (itemType in MARKETPLACE_CATEGORY_EXTENSION) {
    return MARKETPLACE_CATEGORY_EXTENSION[itemType as CM2ExtendedItemType];
  }
  return [];
}
