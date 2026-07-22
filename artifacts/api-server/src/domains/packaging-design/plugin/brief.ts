/**
 * packaging-design/plugin/brief.ts — Team 26
 *
 * Zod brief schema for the Packaging Design Domain Plugin.
 *
 * Covers all mandatory brief fields defined in the Team 26 spec:
 *   product type, packaging type, dimensions, quantity, target market,
 *   brand, regulatory requirements, printing method, material,
 *   sustainability, logistics constraints, barcode/label requirements.
 *
 * PURE module — no DB calls, no side effects.
 * Do NOT import zod/v4. Use plain zod only.
 */

import { z } from "zod";
import { PACKAGING_SERVICE_TYPES } from "../schema.js";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const PrintingMethodEnum = z.enum([
  "offset",
  "digital",
  "flexo",
  "gravure",
  "screen",
  "letterpress",
  "inkjet",
  "laser",
]);

export const BarcodeTypeEnum = z.enum([
  "ean13",
  "ean8",
  "upc_a",
  "upc_e",
  "code128",
  "code39",
  "qr",
  "datamatrix",
  "gs1_128",
]);

export const SustainabilityCertEnum = z.enum([
  "fsc_certified",
  "recycled_content",
  "biodegradable",
  "compostable",
  "reusable",
  "reduced_plastic",
  "water_based_ink",
  "carbon_neutral",
  "none",
]);

export const RegulatoryBodyEnum = z.enum([
  "bpom",       // Badan Pengawas Obat dan Makanan (Indonesia)
  "sni",        // Standar Nasional Indonesia
  "halal_mui",  // Majelis Ulama Indonesia
  "fda",        // US Food and Drug Administration
  "ce",         // Conformité Européenne
  "iso_9001",
  "iso_22000",
  "haccp",
  "other",
]);

export const LogisticsConstraintEnum = z.enum([
  "stackable",
  "fragile",
  "temperature_controlled",
  "humidity_controlled",
  "hazmat",
  "refrigerated",
  "flammable",
  "moisture_proof",
  "tamper_evident",
  "child_resistant",
]);

// ── Barcode sub-schema ────────────────────────────────────────────────────────

export const BarcodeLabelRequirementsSchema = z.object({
  required:         z.boolean().default(false),
  barcodeType:      BarcodeTypeEnum.optional(),
  /** Numeric/alphanumeric barcode value to encode. */
  value:            z.string().max(100).optional(),
  /** Number of barcode zones on the packaging. */
  zoneCount:        z.number().int().min(1).max(4).default(1),
  /** Whether a QR code for product URL is also required alongside the primary barcode. */
  includesQrCode:   z.boolean().default(false),
  qrTargetUrl:      z.string().url().optional(),
  /** GS1-compliant GTIN for retail distribution. */
  gtin:             z.string().max(14).optional(),
});

export type BarcodeLabelRequirements = z.infer<typeof BarcodeLabelRequirementsSchema>;

// ── Dimension sub-schema ──────────────────────────────────────────────────────

export const PackagingDimensionsSchema = z.object({
  widthMm:    z.number().positive().max(3000).optional(),
  heightMm:   z.number().positive().max(3000).optional(),
  depthMm:    z.number().nonnegative().max(2000).optional(),
  bleedMm:    z.number().nonnegative().max(25).default(3),
  safeAreaMm: z.number().nonnegative().max(50).default(5),
  /** Artwork resolution target. 300 dpi recommended for commercial print. */
  resolutionDpi: z.number().int().min(72).max(1200).default(300),
});

export type PackagingDimensions = z.infer<typeof PackagingDimensionsSchema>;

// ── Main brief schema ─────────────────────────────────────────────────────────

export const PackagingBriefSchema = z.object({
  // ── 1. Product ──────────────────────────────────────────────────────────────
  /** Free-text description of the product being packaged. */
  productType:     z.string().min(1).max(500),
  /** Specific product name or SKU. */
  productName:     z.string().min(1).max(200),
  /** Category for regulatory and compliance routing. */
  productCategory: z.string().max(200).optional(),

  // ── 2. Packaging type ───────────────────────────────────────────────────────
  packagingType: z.enum(PACKAGING_SERVICE_TYPES),

  // ── 3. Dimensions ───────────────────────────────────────────────────────────
  dimensions: PackagingDimensionsSchema.optional(),

  // ── 4. Quantity ─────────────────────────────────────────────────────────────
  quantity:      z.number().int().min(1).max(10_000_000),
  variantCount:  z.number().int().min(1).max(50).default(1),

  // ── 5. Target market ────────────────────────────────────────────────────────
  targetMarket:       z.string().min(1).max(500),
  distributionRegions: z.array(z.string().max(100)).max(20).default([]),

  // ── 6. Brand ────────────────────────────────────────────────────────────────
  brandName:          z.string().min(1).max(200),
  customerName:       z.string().min(1).max(200),
  customerEmail:      z.string().email(),
  companyName:        z.string().max(200).optional(),
  brandGuidelineUrl:  z.string().url().optional(),
  logoUrl:            z.string().url().optional(),
  primaryColor:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondaryColor:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),

  // ── 7. Regulatory requirements ──────────────────────────────────────────────
  regulatoryRequirements: z.array(RegulatoryBodyEnum).default([]),
  /** Free-text additional regulatory notes (e.g. "BPOM MD xxxxx", "SNI 01-xxxx"). */
  regulatoryNotes:        z.string().max(1000).optional(),
  hasHalalCertification:  z.boolean().default(false),
  hasSniBadge:            z.boolean().default(false),
  hasBpomNumber:          z.boolean().default(false),
  bpomRegistrationNumber: z.string().max(50).optional(),

  // ── 8. Printing method ──────────────────────────────────────────────────────
  printingMethod: PrintingMethodEnum.optional(),
  /** Number of ink colors (e.g. 4 for CMYK, 6 for extended gamut). */
  colorCount:     z.number().int().min(1).max(12).optional(),
  colorMode:      z.enum(["cmyk", "pantone", "rgb"]).default("cmyk"),
  finishType:     z.enum(["none", "matte", "glossy", "soft_touch", "emboss", "foil", "spot_uv", "aqueous"]).default("none"),
  printSides:     z.number().int().min(1).max(6).default(1),

  // ── 9. Material ─────────────────────────────────────────────────────────────
  material:       z.string().max(500).optional(),
  materialWeight: z.string().max(100).optional(),    // e.g. "350 gsm", "0.3 mm PET"
  materialSource: z.string().max(200).optional(),    // e.g. supplier name or ISO cert
  requiresFoodSafeInk:  z.boolean().default(false),
  requiresMigrationTest: z.boolean().default(false),

  // ── 10. Sustainability ──────────────────────────────────────────────────────
  sustainabilityRequirements: z.array(SustainabilityCertEnum).default([]),
  recyclabilityTarget:        z.enum(["not_required", "partially_recyclable", "fully_recyclable", "biodegradable"]).default("not_required"),

  // ── 11. Logistics constraints ───────────────────────────────────────────────
  logisticsConstraints: z.array(LogisticsConstraintEnum).default([]),
  maxStackHeight:       z.number().positive().optional(),
  dropTestRequired:     z.boolean().default(false),
  vibrationTestRequired: z.boolean().default(false),

  // ── 12. Barcode / label requirements ────────────────────────────────────────
  barcodeRequirements: BarcodeLabelRequirementsSchema.default({ required: false }),

  // ── Reference & context ─────────────────────────────────────────────────────
  referenceUrls:       z.array(z.string().url()).max(10).default([]),
  competitorPackaging: z.array(z.string().url()).max(5).default([]),
  additionalNotes:     z.string().max(2000).optional(),

  /** Links the brief to an existing Team 19 order UUID (optional integration). */
  linkedOrderId: z.string().uuid().optional(),
});

export type PackagingBrief = z.infer<typeof PackagingBriefSchema>;

// ── Brief validation helper ───────────────────────────────────────────────────

export interface BriefValidationResult {
  valid:    boolean;
  errors:   Array<{ path: string; message: string }>;
  warnings: string[];
}

/**
 * validateBrief
 *
 * Run all Zod rules plus cross-field business rules against a raw brief payload.
 * Returns { valid, errors, warnings } — never throws.
 */
export function validateBrief(raw: unknown): BriefValidationResult {
  const result = PackagingBriefSchema.safeParse(raw);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((i) => ({
        path:    i.path.join(".") || "root",
        message: i.message,
      })),
      warnings: [],
    };
  }

  const brief = result.data;
  const warnings: string[] = [];

  // Cross-field: regulated types should declare regulatory requirements
  const regulatedTypes: string[] = ["food_packaging", "cosmetic_packaging", "bottle_label", "jar_label"];
  if (regulatedTypes.includes(brief.packagingType) && brief.regulatoryRequirements.length === 0) {
    warnings.push(
      `packagingType '${brief.packagingType}' is regulated — consider listing regulatoryRequirements (bpom, sni, halal_mui, etc.).`,
    );
  }

  // Cross-field: barcode required but type not set
  if (brief.barcodeRequirements.required && !brief.barcodeRequirements.barcodeType) {
    warnings.push("barcodeRequirements.required is true but barcodeType is not specified.");
  }

  // Cross-field: quantity > 10 000 but drop test not marked
  if (brief.quantity > 10_000 && !brief.dropTestRequired) {
    warnings.push("High-volume run (>10,000 units) — consider enabling dropTestRequired for transit risk assessment.");
  }

  // Cross-field: colorMode rgb but intending print
  if (brief.colorMode === "rgb" && brief.printingMethod && brief.printingMethod !== "inkjet") {
    warnings.push(
      `colorMode 'rgb' is screen-only — the selected printing method '${brief.printingMethod}' requires CMYK or Pantone.`,
    );
  }

  return { valid: true, errors: [], warnings };
}
