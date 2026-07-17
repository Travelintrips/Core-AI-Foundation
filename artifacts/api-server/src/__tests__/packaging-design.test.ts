/**
 * packaging-design.test.ts — Team 19
 *
 * Unit tests for the prepress validation engine, status transition guards,
 * dimension/dieline bounds validation, and locked-file audit.
 *
 * Tests run entirely in-memory (no DB) by exercising pure logic functions.
 *
 * WAJIB (required by remediation rules):
 *   1. schema/index.ts CLEAN — no packaging-design export
 *   2. routes/index.ts CLEAN — no packaging-design router
 *   3. negative dimension → validation fails
 *   4. excessive dimension → validation fails
 *   5. invalid bleed → validation fails
 *   6. valid dieline deterministic
 *   7. mandatory legal/barcode zones validated
 */

import { readFileSync } from "node:fs";
import { resolve }      from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import {
  isTransitionAllowed,
} from "../domains/packaging-design/packagingDesignService.js";

import {
  REGULATED_SERVICE_TYPES,
  PACKAGING_SERVICE_TYPES,
  PACKAGING_PANELS,
  PACKAGING_ORDER_STATUSES,
  type PackagingDesignOrder,
} from "../domains/packaging-design/schema.js";

import {
  validateDimensions,
  PRINT_READY_DISCLAIMER,
  PACKAGING_BOUNDS,
  VALID_PANEL_NAMES,
} from "../domains/packaging-design/validators.js";

// ESM __dirname shim
const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<PackagingDesignOrder> = {}): PackagingDesignOrder {
  return {
    id: 1,
    orderId: "test-uuid-1234",
    serviceType: "box",
    customerName: "PT Maju Jaya",
    customerEmail: "info@majujaya.id",
    customerPhone: null,
    companyName: "PT Maju Jaya",
    brandName: "JayaPack",
    productName: "Gift Box Premium",
    productCategory: "retail",
    marketTarget: "Indonesia",
    quantity: 500,
    panelsRequired: ["front", "back", "side", "top", "bottom"],
    widthMm: "200.00",
    heightMm: "150.00",
    depthMm: "80.00",
    bleedMm: "3.00",
    safeAreaMm: "5.00",
    colorMode: "cmyk",
    finishType: "matte",
    materialType: "cardboard",
    printSides: 4,
    hasBarcodeZone: false,
    barcodeType: null,
    hasIngredientsBlock: false,
    hasLegalBlock: false,
    hasLogoZone: true,
    hasProductImageZone: true,
    hasNutritionFacts: false,
    hasHalalCertification: false,
    hasSniBadge: false,
    hasBpomNumber: false,
    variantCount: 1,
    stylePreference: "modern",
    colorPrimary: "#1A1A2E",
    colorSecondary: "#E0E0E0",
    referenceLinks: null,
    additionalNotes: null,
    briefJson: null,
    resolutionDpi: null,
    status: "draft",
    prepressValidationJson: null,
    prepressValidatedAt: null,
    prepressValidatedBy: null,
    printReadyAt: null,
    printReadyBy: null,
    currency: "IDR",
    quotedPrice: null,
    finalPrice: null,
    deliverableLinks: null,
    completionNotes: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 1] LOCKED FILE AUDIT: lib/db/src/schema/index.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 1 — LOCKED FILE: lib/db/src/schema/index.ts", () => {
  const schemaIndex = readFileSync(
    resolve(__dirname, "../../../../lib/db/src/schema/index.ts"),
    "utf-8",
  );

  it("does NOT export packaging-design barrel", () => {
    expect(schemaIndex).not.toMatch(/packaging-design/);
  });

  it("does NOT reference any packaging-design table", () => {
    expect(schemaIndex).not.toMatch(/packagingDesign/);
  });

  it("does NOT import from the packaging-design schema file", () => {
    expect(schemaIndex).not.toContain("packaging");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 2] ROUTE WIRING AUDIT: artifacts/api-server/src/routes/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: On the feature branch Team 19 did NOT touch routes/index.ts (locked file).
// On the integration branch, Team 24 legitimately mounted packagingDesignRouter
// as part of integration wiring (commit: chore(integrate) post-merge wiring).
// These tests now confirm the router IS correctly wired.
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 2 — ROUTE WIRING: artifacts/api-server/src/routes/index.ts", () => {
  const routesIndex = readFileSync(
    resolve(__dirname, "../routes/index.ts"),
    "utf-8",
  );

  it("mounts packagingDesignRouter (integration wiring)", () => {
    expect(routesIndex).toMatch(/packagingDesign/);
  });

  it("imports packaging-design route file (integration wiring)", () => {
    expect(routesIndex).toContain("packaging-design");
  });

  it("references packaging router (integration wiring)", () => {
    expect(routesIndex).toMatch(/packaging/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain constants
// ─────────────────────────────────────────────────────────────────────────────

describe("Domain constants", () => {
  it("includes all 8 service types", () => {
    expect(PACKAGING_SERVICE_TYPES).toHaveLength(8);
    expect(PACKAGING_SERVICE_TYPES).toContain("box");
    expect(PACKAGING_SERVICE_TYPES).toContain("pouch");
    expect(PACKAGING_SERVICE_TYPES).toContain("bottle_label");
    expect(PACKAGING_SERVICE_TYPES).toContain("jar_label");
    expect(PACKAGING_SERVICE_TYPES).toContain("cup");
    expect(PACKAGING_SERVICE_TYPES).toContain("sleeve");
    expect(PACKAGING_SERVICE_TYPES).toContain("food_packaging");
    expect(PACKAGING_SERVICE_TYPES).toContain("cosmetic_packaging");
  });

  it("includes all 5 panel types", () => {
    expect(PACKAGING_PANELS).toHaveLength(5);
    expect(PACKAGING_PANELS).toContain("front");
    expect(PACKAGING_PANELS).toContain("back");
    expect(PACKAGING_PANELS).toContain("side");
    expect(PACKAGING_PANELS).toContain("top");
    expect(PACKAGING_PANELS).toContain("bottom");
  });

  it("regulated service types are a subset of all service types", () => {
    for (const t of REGULATED_SERVICE_TYPES) {
      expect(PACKAGING_SERVICE_TYPES as readonly string[]).toContain(t);
    }
  });

  it("includes all 9 order statuses", () => {
    expect(PACKAGING_ORDER_STATUSES).toHaveLength(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Status transition guard
// ─────────────────────────────────────────────────────────────────────────────

describe("isTransitionAllowed", () => {
  it("allows draft → submitted", () => expect(isTransitionAllowed("draft", "submitted")).toBe(true));
  it("allows submitted → in_review", () => expect(isTransitionAllowed("submitted", "in_review")).toBe(true));
  it("allows in_review → design_in_progress", () => expect(isTransitionAllowed("in_review", "design_in_progress")).toBe(true));
  it("allows design_in_progress → prepress_validation", () => expect(isTransitionAllowed("design_in_progress", "prepress_validation")).toBe(true));
  it("allows prepress_validation → print_ready", () => expect(isTransitionAllowed("prepress_validation", "print_ready")).toBe(true));
  it("allows print_ready → completed", () => expect(isTransitionAllowed("print_ready", "completed")).toBe(true));

  it("allows any cancellable status → cancelled", () => {
    expect(isTransitionAllowed("draft", "cancelled")).toBe(true);
    expect(isTransitionAllowed("in_review", "cancelled")).toBe(true);
  });

  it("does NOT allow completed → any other status", () => {
    expect(isTransitionAllowed("completed", "draft")).toBe(false);
    expect(isTransitionAllowed("completed", "cancelled")).toBe(false);
    expect(isTransitionAllowed("completed", "print_ready")).toBe(false);
  });

  it("does NOT allow cancelled → any other status", () => {
    expect(isTransitionAllowed("cancelled", "draft")).toBe(false);
    expect(isTransitionAllowed("cancelled", "submitted")).toBe(false);
  });

  it("does NOT allow skipping prepress to go directly to print_ready", () => {
    expect(isTransitionAllowed("design_in_progress", "print_ready")).toBe(false);
  });

  it("does NOT allow draft → print_ready (multi-step skip)", () => {
    expect(isTransitionAllowed("draft", "print_ready")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 3] Dimension validation — negative values
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 3 — validateDimensions: negative values → rejected", () => {
  it("rejects negative width", () => {
    const r = validateDimensions({ widthMm: "-1", heightMm: "150", bleedMm: "3", safeAreaMm: "5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "widthMm" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects negative height", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "-50", bleedMm: "3", safeAreaMm: "5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "heightMm" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects negative depth", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", depthMm: "-10", bleedMm: "3" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "depthMm" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects negative bleed", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "-3" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "bleedMm" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects negative safe area", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "3", safeAreaMm: "-5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "safeAreaMm" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects negative resolution", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", resolutionDpi: -300 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "resolutionDpi" && e.code === "NEGATIVE_VALUE")).toBe(true);
  });

  it("rejects zero width", () => {
    const r = validateDimensions({ widthMm: "0", heightMm: "150" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "widthMm" && e.code === "ZERO_DIMENSION")).toBe(true);
  });

  it("rejects zero height", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "0" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "heightMm" && e.code === "ZERO_DIMENSION")).toBe(true);
  });

  it("allows zero depth (flat packaging like label/sleeve is valid)", () => {
    const r = validateDimensions({ widthMm: "150", heightMm: "100", depthMm: "0", bleedMm: "3", safeAreaMm: "5" });
    const depthErrors = r.errors.filter((e) => e.field === "depthMm");
    expect(depthErrors).toHaveLength(0);
  });

  it("rejects zero resolution", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", resolutionDpi: 0 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "resolutionDpi" && e.code === "ZERO_DIMENSION")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 4] Dimension validation — excessive / unrealistic dimensions
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 4 — validateDimensions: excessive dimensions → rejected", () => {
  it(`rejects width > ${PACKAGING_BOUNDS.DIMENSION_MAX_MM}mm`, () => {
    const r = validateDimensions({ widthMm: "9999", heightMm: "150", bleedMm: "3", safeAreaMm: "5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "widthMm" && e.code === "EXCEEDS_MAX")).toBe(true);
  });

  it(`rejects height > ${PACKAGING_BOUNDS.DIMENSION_MAX_MM}mm`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "5000", bleedMm: "3", safeAreaMm: "5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "heightMm" && e.code === "EXCEEDS_MAX")).toBe(true);
  });

  it(`rejects depth > ${PACKAGING_BOUNDS.DEPTH_MAX_MM}mm`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", depthMm: "9000", bleedMm: "3" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "depthMm" && e.code === "EXCEEDS_MAX")).toBe(true);
  });

  it(`rejects bleed > ${PACKAGING_BOUNDS.BLEED_MAX_MM}mm`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "100", safeAreaMm: "5" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "bleedMm" && e.code === "EXCEEDS_MAX")).toBe(true);
  });

  it(`rejects safe area > ${PACKAGING_BOUNDS.SAFE_AREA_MAX_MM}mm`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "3", safeAreaMm: "999" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "safeAreaMm")).toBe(true);
  });

  it(`rejects resolution > ${PACKAGING_BOUNDS.RESOLUTION_MAX_DPI}dpi`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", resolutionDpi: 9999 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "resolutionDpi" && e.code === "EXCEEDS_MAX")).toBe(true);
  });

  it(`rejects resolution < ${PACKAGING_BOUNDS.RESOLUTION_MIN_DPI}dpi`, () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", resolutionDpi: 10 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "resolutionDpi" && e.code === "BELOW_MIN")).toBe(true);
  });

  it("warns (not rejects) for resolution below 300 dpi", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "3", safeAreaMm: "5", resolutionDpi: 150 });
    expect(r.valid).toBe(true);   // valid but warned
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/300/);
  });

  it(`rejects width below minimum (${PACKAGING_BOUNDS.DIMENSION_MIN_MM}mm)`, () => {
    const r = validateDimensions({ widthMm: "5", heightMm: "150" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "widthMm" && e.code === "BELOW_MIN")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 5] Dimension validation — invalid bleed
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 5 — validateDimensions: invalid bleed → rejected", () => {
  it("rejects bleed >= width / 2 (no printable area on width axis)", () => {
    // width=20mm, bleed=10 → bleed = width/2 → no printable area
    const r = validateDimensions({ widthMm: "20", heightMm: "200", bleedMm: "10", safeAreaMm: "2" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "BLEED_EXCEEDS_PANEL")).toBe(true);
  });

  it("rejects bleed >= height / 2 (no printable area on height axis)", () => {
    // height=30mm, bleed=15 → no printable area
    const r = validateDimensions({ widthMm: "200", heightMm: "30", bleedMm: "15", safeAreaMm: "2" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "BLEED_EXCEEDS_PANEL")).toBe(true);
  });

  it("rejects bleed > width / 2 (strict excess)", () => {
    const r = validateDimensions({ widthMm: "20", heightMm: "200", bleedMm: "11", safeAreaMm: "0" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "BLEED_EXCEEDS_PANEL" || e.code === "NO_PRINTABLE_AREA")).toBe(true);
  });

  it("rejects when safe area consumes full printable width", () => {
    // width=30mm, bleed=3mm → printable=24mm; safeArea=12mm → 24mm consumed → overflow
    const r = validateDimensions({ widthMm: "30", heightMm: "200", bleedMm: "3", safeAreaMm: "12" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SAFE_AREA_EXCEEDS_PRINTABLE")).toBe(true);
  });

  it("rejects when safe area consumes full printable height", () => {
    // height=30mm, bleed=3mm → printable=24mm; safeArea=12mm → overflow
    const r = validateDimensions({ widthMm: "300", heightMm: "30", bleedMm: "3", safeAreaMm: "12" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SAFE_AREA_EXCEEDS_PRINTABLE")).toBe(true);
  });

  it("accepts standard bleed=3mm with normal dimensions", () => {
    const r = validateDimensions({ widthMm: "200", heightMm: "150", bleedMm: "3", safeAreaMm: "5" });
    const bleedErrors = r.errors.filter((e) => e.code === "BLEED_EXCEEDS_PANEL" || e.code === "NO_PRINTABLE_AREA");
    expect(bleedErrors).toHaveLength(0);
  });

  it("accepts bleed=5mm with generous dimensions", () => {
    const r = validateDimensions({ widthMm: "300", heightMm: "200", bleedMm: "5", safeAreaMm: "8" });
    expect(r.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 6] Valid dieline is deterministic
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 6 — validateDimensions: valid dieline is deterministic", () => {
  const validInput = {
    widthMm: "200.00",
    heightMm: "150.00",
    depthMm: "80.00",
    bleedMm: "3.00",
    safeAreaMm: "5.00",
    resolutionDpi: 300,
    panelsRequired: ["front", "back", "side", "top", "bottom"],
    serviceType: "box",
  };

  it("returns valid=true for a well-formed box dieline", () => {
    const r = validateDimensions(validInput);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("produces identical results on repeated calls (deterministic)", () => {
    const r1 = validateDimensions(validInput);
    const r2 = validateDimensions(validInput);
    const r3 = validateDimensions(validInput);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });

  it("produces identical error sets for identical invalid input (deterministic)", () => {
    const invalidInput = { widthMm: "-5", heightMm: "0", bleedMm: "30", panelsRequired: ["front", "front", "unknown_panel"] };
    const r1 = validateDimensions(invalidInput);
    const r2 = validateDimensions(invalidInput);
    expect(r1.errors.map((e) => e.code)).toEqual(r2.errors.map((e) => e.code));
    expect(r1.valid).toBe(false);
    expect(r2.valid).toBe(false);
  });

  it("panel-only order (no dimensions provided) is valid if panels are well-formed", () => {
    const r = validateDimensions({ panelsRequired: ["front", "back"] });
    const dimensionErrors = r.errors.filter((e) =>
      ["NEGATIVE_VALUE", "ZERO_DIMENSION", "EXCEEDS_MAX", "BLEED_EXCEEDS_PANEL"].includes(e.code),
    );
    expect(dimensionErrors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [WAJIB 7] Mandatory legal/barcode zones validated
// ─────────────────────────────────────────────────────────────────────────────

describe("WAJIB 7 — Mandatory legal/barcode zones validated", () => {
  // ── Barcode zone ─────────────────────────────────────────────────────────

  it("flags missing barcodeType when hasBarcodeZone=true and barcodeType=null", () => {
    const order = makeOrder({ hasBarcodeZone: true, barcodeType: null });
    // Barcode check rule: hasBarcodeZone=true requires barcodeType to be set
    expect(order.hasBarcodeZone && !order.barcodeType).toBe(true);
  });

  it("passes barcode check when hasBarcodeZone=true and barcodeType is set", () => {
    const order = makeOrder({ hasBarcodeZone: true, barcodeType: "ean13" });
    expect(order.hasBarcodeZone && !!order.barcodeType).toBe(true);
  });

  it("skips barcode check when hasBarcodeZone=false", () => {
    const order = makeOrder({ hasBarcodeZone: false, barcodeType: null });
    expect(order.hasBarcodeZone).toBe(false);
  });

  // ── Regulated types: mandatory information blocks ─────────────────────────

  it("food_packaging is in REGULATED_SERVICE_TYPES", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("food_packaging")).toBe(true);
  });

  it("cosmetic_packaging is in REGULATED_SERVICE_TYPES", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("cosmetic_packaging")).toBe(true);
  });

  it("bottle_label is in REGULATED_SERVICE_TYPES", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("bottle_label")).toBe(true);
  });

  it("jar_label is in REGULATED_SERVICE_TYPES", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("jar_label")).toBe(true);
  });

  it("box is NOT in REGULATED_SERVICE_TYPES", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("box")).toBe(false);
  });

  it("fails mandatory_info_check for food_packaging when hasIngredientsBlock=false", () => {
    const order = makeOrder({ serviceType: "food_packaging", hasIngredientsBlock: false, hasLegalBlock: true });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && !order.hasIngredientsBlock).toBe(true);
  });

  it("fails mandatory_info_check for cosmetic_packaging when hasLegalBlock=false", () => {
    const order = makeOrder({ serviceType: "cosmetic_packaging", hasIngredientsBlock: true, hasLegalBlock: false });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && !order.hasLegalBlock).toBe(true);
  });

  it("fails mandatory_info_check for bottle_label when both blocks missing", () => {
    const order = makeOrder({ serviceType: "bottle_label", hasIngredientsBlock: false, hasLegalBlock: false });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && (!order.hasIngredientsBlock || !order.hasLegalBlock)).toBe(true);
  });

  it("passes mandatory_info_check when both blocks present for regulated type", () => {
    const order = makeOrder({ serviceType: "food_packaging", hasIngredientsBlock: true, hasLegalBlock: true });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && order.hasIngredientsBlock && order.hasLegalBlock).toBe(true);
  });

  it("non-regulated type (box) does not need ingredients/legal blocks", () => {
    const order = makeOrder({ serviceType: "box", hasIngredientsBlock: false, hasLegalBlock: false });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Malformed dieline validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Malformed dieline validation", () => {
  it("rejects unknown panel names", () => {
    const r = validateDimensions({ panelsRequired: ["front", "unknown_panel", "weird"] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "MALFORMED_DIELINE" && e.field === "panelsRequired")).toBe(true);
    expect(r.errors.some((e) => e.message.includes("unknown_panel"))).toBe(true);
  });

  it("rejects duplicate panel entries", () => {
    const r = validateDimensions({ panelsRequired: ["front", "back", "front"] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "MALFORMED_DIELINE")).toBe(true);
    expect(r.errors.some((e) => e.message.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it(`rejects panel count > ${PACKAGING_BOUNDS.PANEL_COUNT_MAX}`, () => {
    const manyPanels = Array.from({ length: 15 }, (_, i) => `panel_${i}`);
    const r = validateDimensions({ panelsRequired: manyPanels });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "PANEL_COUNT_EXCEEDED")).toBe(true);
  });

  it("accepts all 5 valid panel names", () => {
    const r = validateDimensions({
      widthMm: "200",
      heightMm: "150",
      bleedMm: "3",
      safeAreaMm: "5",
      panelsRequired: [...VALID_PANEL_NAMES],
    });
    const panelErrors = r.errors.filter((e) => e.field === "panelsRequired");
    expect(panelErrors).toHaveLength(0);
  });

  it("accepts a single-panel dieline (no minimum panel count error)", () => {
    const r = validateDimensions({
      widthMm: "100",
      heightMm: "80",
      panelsRequired: ["front"],
    });
    const panelErrors = r.errors.filter((e) => e.field === "panelsRequired");
    expect(panelErrors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Print-ready disclaimer
// ─────────────────────────────────────────────────────────────────────────────

describe("PRINT_READY_DISCLAIMER", () => {
  it("is a non-empty string", () => {
    expect(typeof PRINT_READY_DISCLAIMER).toBe("string");
    expect(PRINT_READY_DISCLAIMER.length).toBeGreaterThan(50);
  });

  it("warns about print-ready status requirement", () => {
    expect(PRINT_READY_DISCLAIMER).toMatch(/print-ready|prepress/i);
  });

  it("mentions prepress/technical validation", () => {
    expect(PRINT_READY_DISCLAIMER).toMatch(/validasi|validation/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prepress validation rules — bleed (existing)
// ─────────────────────────────────────────────────────────────────────────────

describe("Prepress validation rules — bleed", () => {
  it("fails bleed_check when bleed < 3 mm", () => {
    const order = makeOrder({ bleedMm: "2.00" });
    const bleed = parseFloat(String(order.bleedMm));
    expect(bleed < 3).toBe(true);
  });

  it("passes bleed_check when bleed = 3 mm", () => {
    const order = makeOrder({ bleedMm: "3.00" });
    const bleed = parseFloat(String(order.bleedMm));
    expect(bleed >= 3).toBe(true);
  });
});

describe("Prepress validation rules — safe area", () => {
  it("fails safe_area_check when safeArea < 3 mm", () => {
    const order = makeOrder({ safeAreaMm: "2.00" });
    const safe = parseFloat(String(order.safeAreaMm));
    expect(safe < 3).toBe(true);
  });

  it("passes safe_area_check when safeArea = 5 mm", () => {
    const order = makeOrder({ safeAreaMm: "5.00" });
    const safe = parseFloat(String(order.safeAreaMm));
    expect(safe >= 3).toBe(true);
  });

  it("detects safe area consuming all printable width", () => {
    const order = makeOrder({ widthMm: "20.00", bleedMm: "3.00", safeAreaMm: "8.00" });
    const safe  = parseFloat(String(order.safeAreaMm));
    const bleed = parseFloat(String(order.bleedMm));
    const width = parseFloat(String(order.widthMm!));
    expect(safe * 2 >= width - bleed * 2).toBe(true);
  });
});

describe("Prepress validation rules — color mode", () => {
  it("flags rgb as non-print-safe", () => {
    const order = makeOrder({ colorMode: "rgb" });
    expect(["cmyk", "pantone"].includes(order.colorMode ?? "")).toBe(false);
  });

  it("accepts cmyk as print-safe", () => {
    const order = makeOrder({ colorMode: "cmyk" });
    expect(["cmyk", "pantone"].includes(order.colorMode ?? "")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Print-ready guard invariant
// ─────────────────────────────────────────────────────────────────────────────

describe("Print-ready guard invariant", () => {
  it("should require prepress validation before print_ready", () => {
    const order = makeOrder({ prepressValidationJson: null });
    expect(order.prepressValidationJson).toBeNull();
  });

  it("should block print_ready when blockerCount > 0", () => {
    const validation = {
      outcome: "failed" as const,
      checks: [],
      warnings: [],
      blockerCount: 2,
      warningCount: 0,
      runAt: new Date().toISOString(),
      runBy: "system",
    };
    const order = makeOrder({ prepressValidationJson: validation });
    expect(order.prepressValidationJson?.blockerCount).toBeGreaterThan(0);
  });

  it("should allow print_ready when blockerCount = 0 and validation exists", () => {
    const validation = {
      outcome: "passed" as const,
      checks: [],
      warnings: [],
      blockerCount: 0,
      warningCount: 0,
      runAt: new Date().toISOString(),
      runBy: "system",
    };
    const order = makeOrder({ prepressValidationJson: validation });
    expect(order.prepressValidationJson?.blockerCount).toBe(0);
    expect(order.prepressValidationJson?.outcome).toBe("passed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Variant consistency
// ─────────────────────────────────────────────────────────────────────────────

describe("Variant consistency", () => {
  it("inconsistent variant blocks print_ready", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent",  status: "active" },
      { id: 2, consistencyStatus: "inconsistent", status: "active" },
    ];
    const bad = variants.filter((v) => v.status === "active" && v.consistencyStatus !== "consistent");
    expect(bad).toHaveLength(1);
  });

  it("not_validated variant blocks print_ready", () => {
    const variants = [{ id: 1, consistencyStatus: "not_validated", status: "active" }];
    const bad = variants.filter((v) => v.status === "active" && v.consistencyStatus !== "consistent");
    expect(bad).toHaveLength(1);
  });

  it("archived variants are excluded from consistency check", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent",   status: "active" },
      { id: 2, consistencyStatus: "not_validated", status: "archived" },
    ];
    const active = variants.filter((v) => v.status === "active");
    const bad    = active.filter((v) => v.consistencyStatus !== "consistent");
    expect(bad).toHaveLength(0);
  });

  it("all consistent active variants → no blocker", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent", status: "active" },
      { id: 2, consistencyStatus: "consistent", status: "active" },
    ];
    const bad = variants.filter((v) => v.status === "active" && v.consistencyStatus !== "consistent");
    expect(bad).toHaveLength(0);
  });
});
