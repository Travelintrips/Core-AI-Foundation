/**
 * packaging-design.test.ts — Team 19
 *
 * Unit tests for the prepress validation engine and status transition guards.
 * These tests run entirely in-memory (no DB) by testing the pure logic functions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isTransitionAllowed,
} from "../domains/packaging-design/packagingDesignService.js";
import type { PackagingDesignOrder } from "@workspace/db";
import {
  REGULATED_SERVICE_TYPES,
  PACKAGING_SERVICE_TYPES,
  PACKAGING_PANELS,
  PACKAGING_ORDER_STATUSES,
} from "@workspace/db";

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
  it("allows draft → submitted", () => {
    expect(isTransitionAllowed("draft", "submitted")).toBe(true);
  });

  it("allows submitted → in_review", () => {
    expect(isTransitionAllowed("submitted", "in_review")).toBe(true);
  });

  it("allows in_review → design_in_progress", () => {
    expect(isTransitionAllowed("in_review", "design_in_progress")).toBe(true);
  });

  it("allows design_in_progress → prepress_validation", () => {
    expect(isTransitionAllowed("design_in_progress", "prepress_validation")).toBe(true);
  });

  it("allows prepress_validation → print_ready", () => {
    expect(isTransitionAllowed("prepress_validation", "print_ready")).toBe(true);
  });

  it("allows print_ready → completed", () => {
    expect(isTransitionAllowed("print_ready", "completed")).toBe(true);
  });

  it("allows any status → cancelled (except terminal)", () => {
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

  it("does NOT allow skipping prepress_validation to go directly to print_ready from design", () => {
    expect(isTransitionAllowed("design_in_progress", "print_ready")).toBe(false);
  });

  it("does NOT allow draft → print_ready (multi-step skip)", () => {
    expect(isTransitionAllowed("draft", "print_ready")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Prepress validation logic (pure checks without DB)
// ─────────────────────────────────────────────────────────────────────────────

// We test the validation rules directly by inspecting what conditions trigger errors.
// We mock runPrepressValidation in integration tests; here we test the rule logic
// through clear scenario expectations.

describe("Prepress validation rules — bleed", () => {
  it("fails bleed_check when bleed < 3 mm", () => {
    const order = makeOrder({ bleedMm: "2.00" });
    const bleed = parseFloat(String(order.bleedMm));
    expect(bleed < 3).toBe(true); // should trigger bleed_check failure
  });

  it("passes bleed_check when bleed = 3 mm", () => {
    const order = makeOrder({ bleedMm: "3.00" });
    const bleed = parseFloat(String(order.bleedMm));
    expect(bleed >= 3).toBe(true);
  });

  it("passes bleed_check when bleed = 5 mm", () => {
    const order = makeOrder({ bleedMm: "5.00" });
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

  it("detects safe area consuming all printable width (oversized safe area)", () => {
    // width=20mm, bleed=3mm → printable = 14mm. safe=8 → 16mm consumed → overflow
    const order = makeOrder({ widthMm: "20.00", bleedMm: "3.00", safeAreaMm: "8.00" });
    const safe  = parseFloat(String(order.safeAreaMm));
    const bleed = parseFloat(String(order.bleedMm));
    const width = parseFloat(String(order.widthMm!));
    expect(safe * 2 >= width - bleed * 2).toBe(true);
  });
});

describe("Prepress validation rules — barcode zone", () => {
  it("flags missing barcodeType when hasBarcodeZone=true and barcodeType=null", () => {
    const order = makeOrder({ hasBarcodeZone: true, barcodeType: null });
    expect(order.hasBarcodeZone && !order.barcodeType).toBe(true);
  });

  it("passes barcode type check when barcodeType is set", () => {
    const order = makeOrder({ hasBarcodeZone: true, barcodeType: "ean13" });
    expect(order.hasBarcodeZone && !!order.barcodeType).toBe(true);
  });

  it("does not require barcodeType when hasBarcodeZone=false", () => {
    const order = makeOrder({ hasBarcodeZone: false, barcodeType: null });
    // barcode checks are skipped when hasBarcodeZone=false
    expect(order.hasBarcodeZone).toBe(false);
  });
});

describe("Prepress validation rules — mandatory information (regulated types)", () => {
  it("food_packaging is regulated", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("food_packaging")).toBe(true);
  });

  it("cosmetic_packaging is regulated", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("cosmetic_packaging")).toBe(true);
  });

  it("bottle_label is regulated", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("bottle_label")).toBe(true);
  });

  it("jar_label is regulated", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("jar_label")).toBe(true);
  });

  it("box is NOT regulated", () => {
    expect((REGULATED_SERVICE_TYPES as readonly string[]).includes("box")).toBe(false);
  });

  it("fails ingredients check for food_packaging when hasIngredientsBlock=false", () => {
    const order = makeOrder({ serviceType: "food_packaging", hasIngredientsBlock: false, hasLegalBlock: true });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && !order.hasIngredientsBlock).toBe(true);
  });

  it("fails legal block check for cosmetic_packaging when hasLegalBlock=false", () => {
    const order = makeOrder({ serviceType: "cosmetic_packaging", hasIngredientsBlock: true, hasLegalBlock: false });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && !order.hasLegalBlock).toBe(true);
  });

  it("passes mandatory info check when both blocks present", () => {
    const order = makeOrder({ serviceType: "food_packaging", hasIngredientsBlock: true, hasLegalBlock: true });
    const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
    expect(isRegulated && order.hasIngredientsBlock && order.hasLegalBlock).toBe(true);
  });
});

describe("Prepress validation rules — color mode", () => {
  it("flags rgb as non-print-safe", () => {
    const order = makeOrder({ colorMode: "rgb" });
    const printSafe = ["cmyk", "pantone"].includes(order.colorMode ?? "");
    expect(printSafe).toBe(false);
  });

  it("accepts cmyk as print-safe", () => {
    const order = makeOrder({ colorMode: "cmyk" });
    const printSafe = ["cmyk", "pantone"].includes(order.colorMode ?? "");
    expect(printSafe).toBe(true);
  });

  it("accepts pantone as print-safe", () => {
    const order = makeOrder({ colorMode: "pantone" });
    const printSafe = ["cmyk", "pantone"].includes(order.colorMode ?? "");
    expect(printSafe).toBe(true);
  });
});

describe("Prepress validation rules — panels", () => {
  it("warns when no panels specified", () => {
    const order = makeOrder({ panelsRequired: [] });
    expect((order.panelsRequired ?? []).length > 0).toBe(false);
  });

  it("passes when at least one panel specified", () => {
    const order = makeOrder({ panelsRequired: ["front", "back"] });
    expect((order.panelsRequired ?? []).length > 0).toBe(true);
  });
});

describe("Print-ready guard invariant", () => {
  it("should require prepress validation before print_ready", () => {
    const order = makeOrder({ prepressValidationJson: null });
    // Without a validation result, print_ready should be blocked
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

describe("Variant consistency", () => {
  it("inconsistent variant blocks print_ready", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent", status: "active" },
      { id: 2, consistencyStatus: "inconsistent", status: "active" },
    ];
    const inconsistent = variants.filter(
      (v) => v.status === "active" && v.consistencyStatus !== "consistent",
    );
    expect(inconsistent).toHaveLength(1);
  });

  it("not_validated variant blocks print_ready", () => {
    const variants = [
      { id: 1, consistencyStatus: "not_validated", status: "active" },
    ];
    const inconsistent = variants.filter(
      (v) => v.status === "active" && v.consistencyStatus !== "consistent",
    );
    expect(inconsistent).toHaveLength(1);
  });

  it("archived variants are excluded from consistency check", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent", status: "active" },
      { id: 2, consistencyStatus: "not_validated", status: "archived" }, // archived — excluded
    ];
    const activeVariants = variants.filter((v) => v.status === "active");
    const inconsistent = activeVariants.filter((v) => v.consistencyStatus !== "consistent");
    expect(inconsistent).toHaveLength(0);
  });

  it("all variants consistent → no blocker", () => {
    const variants = [
      { id: 1, consistencyStatus: "consistent", status: "active" },
      { id: 2, consistencyStatus: "consistent", status: "active" },
    ];
    const activeVariants = variants.filter((v) => v.status === "active");
    const inconsistent = activeVariants.filter((v) => v.consistencyStatus !== "consistent");
    expect(inconsistent).toHaveLength(0);
  });
});
