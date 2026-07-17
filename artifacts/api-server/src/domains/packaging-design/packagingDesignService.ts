/**
 * packagingDesignService.ts — Team 19: Packaging Design Domain
 *
 * Business logic for packaging design orders, variants, and prepress validation.
 *
 * KEY INVARIANTS enforced here:
 *   1. print_ready status MUST NOT be set unless last validation passed with zero blockers.
 *   2. Regulated service types MUST have ingredients + legal block.
 *   3. Barcode zone check is always run for orders with hasBarcodeZone = true.
 *   4. All active variants must be consistency-validated before print_ready.
 */

import { randomUUID } from "crypto";
import { eq, desc, and, isNull, count, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  packagingDesignOrdersTable,
  packagingDesignVariantsTable,
  packagingDesignValidationLogTable,
  REGULATED_SERVICE_TYPES,
  PACKAGING_ORDER_STATUSES,
  type PackagingOrderStatus,
  type PackagingServiceType,
  type PrepressCheck,
  type PrintWarning,
  type PrepressValidationResult,
  type PackagingDesignOrder,
  type PackagingDesignVariant,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status transition guard
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<PackagingOrderStatus, PackagingOrderStatus[]> = {
  draft:               ["submitted", "cancelled"],
  submitted:           ["in_review", "cancelled"],
  in_review:           ["design_in_progress", "revision_requested", "cancelled"],
  design_in_progress:  ["prepress_validation", "revision_requested"],
  prepress_validation: ["print_ready", "revision_requested"],
  revision_requested:  ["design_in_progress", "cancelled"],
  print_ready:         ["completed"],
  completed:           [],
  cancelled:           [],
};

export function isTransitionAllowed(
  from: PackagingOrderStatus,
  to: PackagingOrderStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Order CRUD
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  serviceType: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  companyName?: string | null;
  brandName: string;
  productName: string;
  productCategory?: string | null;
  marketTarget?: string | null;
  quantity?: number;
  panelsRequired?: string[];
  widthMm?: string | null;
  heightMm?: string | null;
  depthMm?: string | null;
  bleedMm?: string;
  safeAreaMm?: string;
  colorMode?: string;
  finishType?: string | null;
  materialType?: string | null;
  printSides?: number;
  hasBarcodeZone?: boolean;
  barcodeType?: string | null;
  hasIngredientsBlock?: boolean;
  hasLegalBlock?: boolean;
  hasLogoZone?: boolean;
  hasProductImageZone?: boolean;
  hasNutritionFacts?: boolean;
  hasHalalCertification?: boolean;
  hasSniBadge?: boolean;
  hasBpomNumber?: boolean;
  variantCount?: number;
  stylePreference?: string | null;
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  referenceLinks?: string | null;
  additionalNotes?: string | null;
  briefJson?: Record<string, unknown> | null;
}

export async function createOrder(input: CreateOrderInput): Promise<PackagingDesignOrder> {
  const orderId = randomUUID();
  const [order] = await db
    .insert(packagingDesignOrdersTable)
    .values({
      orderId,
      serviceType: input.serviceType,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone ?? null,
      companyName: input.companyName ?? null,
      brandName: input.brandName,
      productName: input.productName,
      productCategory: input.productCategory ?? null,
      marketTarget: input.marketTarget ?? null,
      quantity: input.quantity ?? 1,
      panelsRequired: input.panelsRequired ?? [],
      widthMm: input.widthMm ?? null,
      heightMm: input.heightMm ?? null,
      depthMm: input.depthMm ?? null,
      bleedMm: input.bleedMm ?? "3",
      safeAreaMm: input.safeAreaMm ?? "5",
      colorMode: input.colorMode ?? "cmyk",
      finishType: input.finishType ?? null,
      materialType: input.materialType ?? null,
      printSides: input.printSides ?? 1,
      hasBarcodeZone: input.hasBarcodeZone ?? false,
      barcodeType: input.barcodeType ?? null,
      hasIngredientsBlock: input.hasIngredientsBlock ?? false,
      hasLegalBlock: input.hasLegalBlock ?? false,
      hasLogoZone: input.hasLogoZone ?? true,
      hasProductImageZone: input.hasProductImageZone ?? false,
      hasNutritionFacts: input.hasNutritionFacts ?? false,
      hasHalalCertification: input.hasHalalCertification ?? false,
      hasSniBadge: input.hasSniBadge ?? false,
      hasBpomNumber: input.hasBpomNumber ?? false,
      variantCount: input.variantCount ?? 1,
      stylePreference: input.stylePreference ?? null,
      colorPrimary: input.colorPrimary ?? null,
      colorSecondary: input.colorSecondary ?? null,
      referenceLinks: input.referenceLinks ?? null,
      additionalNotes: input.additionalNotes ?? null,
      briefJson: input.briefJson ?? null,
      status: "draft",
    })
    .returning();
  return order!;
}

export async function listOrders(opts: {
  status?: string;
  serviceType?: string;
  email?: string;
  limit?: number;
  offset?: number;
}) {
  const conditions = [isNull(packagingDesignOrdersTable.deletedAt)];
  if (opts.status) conditions.push(eq(packagingDesignOrdersTable.status, opts.status));
  if (opts.serviceType) conditions.push(eq(packagingDesignOrdersTable.serviceType, opts.serviceType));
  if (opts.email) conditions.push(eq(packagingDesignOrdersTable.customerEmail, opts.email));

  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const [orders, [totalRow]] = await Promise.all([
    db
      .select()
      .from(packagingDesignOrdersTable)
      .where(and(...conditions))
      .orderBy(desc(packagingDesignOrdersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(packagingDesignOrdersTable)
      .where(and(...conditions)),
  ]);

  return { orders, total: totalRow?.total ?? 0 };
}

export async function getOrderById(id: number): Promise<PackagingDesignOrder | null> {
  const [order] = await db
    .select()
    .from(packagingDesignOrdersTable)
    .where(
      and(
        eq(packagingDesignOrdersTable.id, id),
        isNull(packagingDesignOrdersTable.deletedAt),
      ),
    );
  return order ?? null;
}

export async function getOrderByOrderId(orderId: string): Promise<PackagingDesignOrder | null> {
  const [order] = await db
    .select()
    .from(packagingDesignOrdersTable)
    .where(
      and(
        eq(packagingDesignOrdersTable.orderId, orderId),
        isNull(packagingDesignOrdersTable.deletedAt),
      ),
    );
  return order ?? null;
}

export async function updateOrder(
  id: number,
  patch: Partial<Omit<PackagingDesignOrder, "id" | "orderId" | "createdAt">>,
): Promise<PackagingDesignOrder | null> {
  const [updated] = await db
    .update(packagingDesignOrdersTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(packagingDesignOrdersTable.id, id),
        isNull(packagingDesignOrdersTable.deletedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function softDeleteOrder(id: number): Promise<boolean> {
  const result = await db
    .update(packagingDesignOrdersTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(packagingDesignOrdersTable.id, id),
        isNull(packagingDesignOrdersTable.deletedAt),
      ),
    )
    .returning({ id: packagingDesignOrdersTable.id });
  return result.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status transitions
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusUpdateResult {
  ok: boolean;
  order?: PackagingDesignOrder;
  error?: string;
}

export async function updateOrderStatus(
  id: number,
  newStatus: string,
  notes?: string,
): Promise<StatusUpdateResult> {
  const order = await getOrderById(id);
  if (!order) return { ok: false, error: "Order not found" };

  const from = order.status as PackagingOrderStatus;
  const to = newStatus as PackagingOrderStatus;

  if (!PACKAGING_ORDER_STATUSES.includes(to)) {
    return { ok: false, error: `Invalid status: ${to}` };
  }

  if (!isTransitionAllowed(from, to)) {
    return {
      ok: false,
      error: `Transition from '${from}' to '${to}' is not allowed`,
    };
  }

  // ── INVARIANT: print_ready guard ──────────────────────────────────────────
  if (to === "print_ready") {
    const validation = order.prepressValidationJson;
    if (!validation) {
      return {
        ok: false,
        error:
          "Prepress validation has not been run. Run POST /validate before marking print_ready.",
      };
    }
    if (validation.blockerCount > 0) {
      return {
        ok: false,
        error: `Cannot mark print_ready: ${validation.blockerCount} blocking prepress error(s) remain. Re-run validation after corrections.`,
      };
    }

    // ── Variant consistency guard ─────────────────────────────────────────
    const variants = await listVariants(id);
    const activeVariants = variants.filter((v) => v.status === "active");
    const inconsistent = activeVariants.filter(
      (v) => v.consistencyStatus !== "consistent",
    );
    if (inconsistent.length > 0) {
      return {
        ok: false,
        error: `${inconsistent.length} active variant(s) have not passed consistency validation. Validate all variants before marking print_ready.`,
      };
    }

    const patch: Partial<PackagingDesignOrder> = {
      status: to,
      printReadyAt: new Date(),
      printReadyBy: "admin",
    };
    if (notes) patch.completionNotes = notes;
    const updated = await updateOrder(id, patch);
    return { ok: true, order: updated ?? undefined };
  }

  const patch: Partial<PackagingDesignOrder> = { status: to };
  if (notes) patch.completionNotes = notes;
  const updated = await updateOrder(id, patch);
  return { ok: true, order: updated ?? undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function listVariants(orderId: number): Promise<PackagingDesignVariant[]> {
  return db
    .select()
    .from(packagingDesignVariantsTable)
    .where(eq(packagingDesignVariantsTable.orderId, orderId))
    .orderBy(packagingDesignVariantsTable.displayOrder, packagingDesignVariantsTable.id);
}

export async function addVariant(
  orderId: number,
  input: {
    variantName: string;
    variantLabel?: string | null;
    sku?: string | null;
    barcodeValue?: string | null;
    colorAccent?: string | null;
    netWeight?: string | null;
    displayOrder?: number;
  },
): Promise<PackagingDesignVariant> {
  const [variant] = await db
    .insert(packagingDesignVariantsTable)
    .values({
      orderId,
      variantName: input.variantName,
      variantLabel: input.variantLabel ?? null,
      sku: input.sku ?? null,
      barcodeValue: input.barcodeValue ?? null,
      colorAccent: input.colorAccent ?? null,
      netWeight: input.netWeight ?? null,
      displayOrder: input.displayOrder ?? 0,
    })
    .returning();
  return variant!;
}

export async function updateVariant(
  variantId: number,
  patch: Partial<Omit<PackagingDesignVariant, "id" | "orderId" | "createdAt">>,
): Promise<PackagingDesignVariant | null> {
  const [updated] = await db
    .update(packagingDesignVariantsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(packagingDesignVariantsTable.id, variantId))
    .returning();
  return updated ?? null;
}

export async function archiveVariant(variantId: number): Promise<boolean> {
  const result = await db
    .update(packagingDesignVariantsTable)
    .set({ status: "archived" })
    .where(eq(packagingDesignVariantsTable.id, variantId))
    .returning({ id: packagingDesignVariantsTable.id });
  return result.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prepress Validation Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runPrepressValidation
 *
 * Runs all technical / prepress checks against the order and its variants.
 * This is deterministic given the order data — it never calls external services.
 *
 * Checks:
 *   1. bleed_check          — bleed value ≥ 3 mm (industry minimum)
 *   2. safe_area_check      — safe area ≥ 3 mm; must be < (width/2 − bleed) to leave printable space
 *   3. barcode_zone_check   — when hasBarcodeZone=true: barcodeType set; variants have barcodeValue
 *   4. mandatory_info_check — regulated service types must have ingredients+legal block
 *   5. variant_count_check  — at least 1 active variant; variant count matches order.variantCount
 *   6. color_mode_check     — colorMode is set to cmyk or pantone (not rgb for print)
 *   7. dimension_check      — at least width+height supplied for label/flat packaging types
 *   8. panels_check         — panelsRequired is non-empty
 */
export async function runPrepressValidation(
  order: PackagingDesignOrder,
  runBy = "system",
  notes?: string,
): Promise<PrepressValidationResult> {
  const variants = await listVariants(order.id);
  const activeVariants = variants.filter((v) => v.status === "active");

  const checks: PrepressCheck[] = [];
  const warnings: PrintWarning[] = [];

  const bleed = parseFloat(String(order.bleedMm ?? "3"));
  const safe  = parseFloat(String(order.safeAreaMm ?? "5"));
  const width  = order.widthMm ? parseFloat(String(order.widthMm)) : null;
  const height = order.heightMm ? parseFloat(String(order.heightMm)) : null;

  // ── 1. Bleed check ─────────────────────────────────────────────────────────
  const BLEED_MIN = 3;
  checks.push({
    code: "bleed_check",
    name: "Bleed Minimum (3 mm)",
    severity: "error",
    passed: bleed >= BLEED_MIN,
    detail:
      bleed >= BLEED_MIN
        ? `Bleed is ${bleed} mm — meets minimum of ${BLEED_MIN} mm.`
        : `Bleed is ${bleed} mm — below the industry minimum of ${BLEED_MIN} mm. Artwork will be cut short at the trim edge.`,
  });

  if (bleed < 5) {
    warnings.push({
      code: "bleed_warning_5mm",
      message: `Bleed of ${bleed} mm is below the recommended 5 mm for commercial packaging. Consider increasing to 5 mm.`,
      severity: "warning",
    });
  }

  // ── 2. Safe area check ─────────────────────────────────────────────────────
  const safeOk = safe >= 3;
  checks.push({
    code: "safe_area_check",
    name: "Safe Area Minimum (3 mm)",
    severity: "error",
    passed: safeOk,
    detail: safeOk
      ? `Safe area is ${safe} mm — sufficient.`
      : `Safe area is ${safe} mm — below the minimum of 3 mm. Critical text/logos may be cut.`,
  });

  // Check safe area doesn't consume entire printable width
  if (width !== null && safe * 2 >= width - bleed * 2) {
    checks.push({
      code: "safe_area_layout_check",
      name: "Safe Area vs Printable Width",
      severity: "error",
      passed: false,
      detail: `Safe area (${safe} mm × 2) consumes all or more of the printable width (${width} mm − ${bleed * 2} mm bleed). No printable space remains.`,
    });
  } else {
    checks.push({
      code: "safe_area_layout_check",
      name: "Safe Area vs Printable Width",
      severity: "info",
      passed: true,
      detail: "Safe area and bleed are within printable dimensions.",
    });
  }

  // ── 3. Barcode zone check ──────────────────────────────────────────────────
  if (order.hasBarcodeZone) {
    const barcodeTypeOk = !!order.barcodeType;
    checks.push({
      code: "barcode_type_check",
      name: "Barcode Type Specified",
      severity: "error",
      passed: barcodeTypeOk,
      detail: barcodeTypeOk
        ? `Barcode type: ${order.barcodeType}.`
        : "Barcode zone is enabled but no barcode type is specified (ean13/qr/code128/upc/datamatrix).",
    });

    const variantsWithBarcode = activeVariants.filter((v) => !!v.barcodeValue);
    const barcodeVariantOk = activeVariants.length === 0 || variantsWithBarcode.length === activeVariants.length;
    checks.push({
      code: "barcode_variant_check",
      name: "Barcode Value on All Variants",
      severity: "error",
      passed: barcodeVariantOk,
      detail: barcodeVariantOk
        ? `All ${activeVariants.length} active variant(s) have a barcode value.`
        : `${activeVariants.length - variantsWithBarcode.length} active variant(s) are missing barcode values.`,
    });

    // Barcode must not overlap bleed zone (structural check — we warn if bleed is small)
    if (bleed < BLEED_MIN + 2) {
      warnings.push({
        code: "barcode_bleed_overlap_risk",
        message:
          "Bleed margin is small — ensure the barcode zone is positioned at least 5 mm from the cut edge to avoid barcode crop.",
        severity: "warning",
      });
    }
  }

  // ── 4. Mandatory information check (regulated service types) ───────────────
  const isRegulated = (REGULATED_SERVICE_TYPES as readonly string[]).includes(order.serviceType);
  if (isRegulated) {
    checks.push({
      code: "ingredients_block_check",
      name: "Ingredients Block (Regulated)",
      severity: "error",
      passed: order.hasIngredientsBlock,
      detail: order.hasIngredientsBlock
        ? "Ingredients block zone is present."
        : `Service type '${order.serviceType}' is regulated — an ingredients block is mandatory.`,
    });

    checks.push({
      code: "legal_block_check",
      name: "Legal Block (Regulated)",
      severity: "error",
      passed: order.hasLegalBlock,
      detail: order.hasLegalBlock
        ? "Legal block zone is present."
        : `Service type '${order.serviceType}' is regulated — a legal block (legal name, address, certifications) is mandatory.`,
    });

    if (order.serviceType === "food_packaging" || order.serviceType === "cosmetic_packaging") {
      if (!order.hasBpomNumber) {
        warnings.push({
          code: "bpom_number_missing",
          message: `BPOM registration number is not flagged for this ${order.serviceType} — required for commercial sale in Indonesia.`,
          severity: "warning",
        });
      }
    }
  }

  // ── 5. Variant count check ─────────────────────────────────────────────────
  const hasActiveVariants = activeVariants.length > 0;
  checks.push({
    code: "variant_exists_check",
    name: "At Least One Active Variant",
    severity: "error",
    passed: hasActiveVariants,
    detail: hasActiveVariants
      ? `${activeVariants.length} active variant(s) found.`
      : "No active variants found. At least one variant is required.",
  });

  if (order.variantCount > 1 && activeVariants.length < order.variantCount) {
    warnings.push({
      code: "variant_count_mismatch",
      message: `Order specifies ${order.variantCount} variants but only ${activeVariants.length} active variant record(s) exist.`,
      severity: "warning",
    });
  }

  // ── 6. Color mode check ────────────────────────────────────────────────────
  const printSafeColorModes = ["cmyk", "pantone"];
  const colorModeOk = printSafeColorModes.includes(order.colorMode ?? "");
  checks.push({
    code: "color_mode_check",
    name: "Print-Safe Color Mode (CMYK / Pantone)",
    severity: "error",
    passed: colorModeOk,
    detail: colorModeOk
      ? `Color mode '${order.colorMode}' is print-safe.`
      : `Color mode '${order.colorMode}' (RGB) is screen-only — colors will shift unpredictably when printed. Convert to CMYK.`,
  });

  // ── 7. Dimension check ─────────────────────────────────────────────────────
  const flatTypes = ["bottle_label", "jar_label", "sleeve"];
  const needsDimensions = (flatTypes as string[]).includes(order.serviceType);
  if (needsDimensions) {
    const dimOk = width !== null && height !== null;
    checks.push({
      code: "dimension_check",
      name: "Width & Height Required",
      severity: "error",
      passed: dimOk,
      detail: dimOk
        ? `Dimensions: ${width} × ${height} mm.`
        : `Service type '${order.serviceType}' requires width and height to be specified for accurate dieline generation.`,
    });
  }

  // ── 8. Panels check ────────────────────────────────────────────────────────
  const panelsOk = (order.panelsRequired ?? []).length > 0;
  checks.push({
    code: "panels_check",
    name: "At Least One Panel Specified",
    severity: "warning",
    passed: panelsOk,
    detail: panelsOk
      ? `Panels: ${(order.panelsRequired ?? []).join(", ")}.`
      : "No panels are specified. At least a front panel is expected.",
  });

  // ── 9. Logo zone check ────────────────────────────────────────────────────
  if (!order.hasLogoZone) {
    warnings.push({
      code: "no_logo_zone",
      message: "No logo zone is marked. Confirm whether a logo is not required for this packaging.",
      severity: "info",
    });
  }

  // ── Aggregate result ───────────────────────────────────────────────────────
  const blockers = checks.filter((c) => !c.passed && c.severity === "error");
  const warningChecks = checks.filter((c) => !c.passed && c.severity === "warning");
  const blockerCount = blockers.length;
  const warningCount = warnings.length + warningChecks.length;

  let outcome: PrepressValidationResult["outcome"];
  if (blockerCount > 0) {
    outcome = "failed";
  } else if (warningCount > 0) {
    outcome = "passed_with_warnings";
  } else {
    outcome = "passed";
  }

  const result: PrepressValidationResult = {
    outcome,
    checks,
    warnings,
    blockerCount,
    warningCount,
    runAt: new Date().toISOString(),
    runBy,
  };

  // ── Persist: update order + append to log ──────────────────────────────────
  await Promise.all([
    db
      .update(packagingDesignOrdersTable)
      .set({
        prepressValidationJson: result,
        prepressValidatedAt: new Date(),
        prepressValidatedBy: runBy,
        updatedAt: new Date(),
      })
      .where(eq(packagingDesignOrdersTable.id, order.id)),
    db.insert(packagingDesignValidationLogTable).values({
      orderId: order.id,
      runBy,
      outcome,
      checksJson: checks,
      warningsJson: warnings,
      notes: notes ?? null,
    }),
  ]);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export async function getAnalytics() {
  const [allOrders, recentOrders] = await Promise.all([
    db
      .select({
        status:      packagingDesignOrdersTable.status,
        serviceType: packagingDesignOrdersTable.serviceType,
        printReadyAt: packagingDesignOrdersTable.printReadyAt,
        prepressValidationJson: packagingDesignOrdersTable.prepressValidationJson,
      })
      .from(packagingDesignOrdersTable)
      .where(isNull(packagingDesignOrdersTable.deletedAt)),
    db
      .select()
      .from(packagingDesignOrdersTable)
      .where(isNull(packagingDesignOrdersTable.deletedAt))
      .orderBy(desc(packagingDesignOrdersTable.createdAt))
      .limit(10),
  ]);

  const byStatus: Record<string, number> = {};
  const byServiceType: Record<string, number> = {};
  let printReadyCount = 0;
  let validatedCount = 0;
  let passedCount = 0;

  for (const o of allOrders) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    byServiceType[o.serviceType] = (byServiceType[o.serviceType] ?? 0) + 1;
    if (o.printReadyAt) printReadyCount++;
    if (o.prepressValidationJson) {
      validatedCount++;
      const v = o.prepressValidationJson as PrepressValidationResult;
      if (v.outcome === "passed" || v.outcome === "passed_with_warnings") passedCount++;
    }
  }

  return {
    totalOrders: allOrders.length,
    byStatus,
    byServiceType,
    printReadyCount,
    validationPassRate: validatedCount > 0 ? passedCount / validatedCount : 0,
    recentOrders,
  };
}
