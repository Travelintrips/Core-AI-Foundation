/**
 * fashionDesignService.ts — Business logic for Fashion & Apparel Design (Team 18)
 *
 * Rules:
 * - Never produce final production-ready garment patterns without size + technical review.
 * - Never copy or reference well-known brand jerseys/motifs.
 * - Validate panel constraints, numbering, logo placement, motif repeat, trademark safety.
 */

import { db } from "@workspace/db";
import {
  fashionDesignOrdersTable,
  fashionDesignBlueprintsTable,
  FASHION_ORDER_STATUSES,
  FASHION_SERVICE_TYPES,
  BLUEPRINT_PANELS,
  type FashionDesignOrder,
  type FashionDesignBlueprint,
  type FashionOrderStatus,
} from "../domains/fashion-design/schema.js";
import { eq, desc, and, like, SQL } from "drizzle-orm";
import { logger } from "../lib/logger.js";

// ── Trademark keyword blocklist ────────────────────────────────────────────────
// Prevents copying well-known brand marks. Add more as needed.
const TRADEMARK_BLOCKLIST = [
  "nike", "adidas", "puma", "reebok", "under armour", "underarmour",
  "jordan", "air jordan", "gucci", "louis vuitton", "lv", "supreme",
  "balenciaga", "off-white", "bape", "champion", "fila", "new balance",
  "vans", "converse", "lacoste", "polo ralph lauren", "tommy hilfiger",
  "burberry", "versace", "armani", "calvin klein", "diesel",
  "manchester united", "barcelona", "real madrid", "liverpool",
  "chelsea", "arsenal", "juventus", "psg", "inter milan",
  "bayern munich", "milan", "liverpool fc",
];

// ── Panel size constraints by service type ────────────────────────────────────
const PANEL_CONSTRAINTS: Record<string, { minW: number; maxW: number; minH: number; maxH: number }> = {
  "logo-area":    { minW: 50,  maxW: 300, minH: 50,  maxH: 300 },
  "sponsor":      { minW: 30,  maxW: 200, minH: 20,  maxH: 80  },
  "number":       { minW: 60,  maxW: 200, minH: 80,  maxH: 300 },
  "name":         { minW: 80,  maxW: 400, minH: 30,  maxH: 80  },
  "front":        { minW: 300, maxW: 600, minH: 400, maxH: 900 },
  "back":         { minW: 300, maxW: 600, minH: 400, maxH: 900 },
  "sleeves":      { minW: 80,  maxW: 200, minH: 200, maxH: 600 },
  "collar":       { minW: 100, maxW: 250, minH: 40,  maxH: 100 },
  "pocket":       { minW: 60,  maxW: 180, minH: 60,  maxH: 180 },
  "garment-panels": { minW: 100, maxW: 600, minH: 100, maxH: 900 },
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  customerName: string;
  customerEmail: string;
  orderName: string;
  description?: string;
  serviceType: string;
  quantity?: number;
  colorways?: string[];
  motifConfig?: Record<string, unknown>;
}

export interface UpdateOrderStatusInput {
  status: FashionOrderStatus;
  adminNotes?: string;
}

export interface SaveBlueprintInput {
  panels?: Record<string, unknown>;
  placementSpec?: Record<string, unknown>;
  panelConstraints?: Record<string, unknown>;
  logoPlacement?: Record<string, unknown>;
  numberValue?: string;
  nameValue?: string;
  numberFont?: string;
  numberColor?: string;
  sponsors?: Array<Record<string, unknown>>;
}

export interface TrademarkCheckResult {
  safe: boolean;
  flags: string[];
  checkedFields: string[];
}

export interface GenerationResult {
  outputs: Record<string, unknown>;
  warnings: string[];
}

export interface ListOrdersOptions {
  page?: number;
  pageSize?: number;
  status?: string;
  serviceType?: string;
  search?: string;
}

// ── Validation helpers ────────────────────────────────────────────────────────

export function validateServiceType(serviceType: string): void {
  if (!FASHION_SERVICE_TYPES.includes(serviceType as typeof FASHION_SERVICE_TYPES[number])) {
    throw new Error(`Invalid service type: "${serviceType}". Allowed: ${FASHION_SERVICE_TYPES.join(", ")}`);
  }
}

export function validateStatus(status: string): asserts status is FashionOrderStatus {
  if (!FASHION_ORDER_STATUSES.includes(status as FashionOrderStatus)) {
    throw new Error(`Invalid status: "${status}". Allowed: ${FASHION_ORDER_STATUSES.join(", ")}`);
  }
}

export function validatePanelConstraints(
  panels: Record<string, { size?: { w: number; h: number } }>,
): { violations: string[] } {
  const violations: string[] = [];
  for (const [panel, config] of Object.entries(panels)) {
    const constraint = PANEL_CONSTRAINTS[panel];
    if (!constraint || !config?.size) continue;
    const { w, h } = config.size;
    if (w < constraint.minW || w > constraint.maxW) {
      violations.push(`Panel "${panel}" width ${w}px is outside allowed range ${constraint.minW}–${constraint.maxW}px`);
    }
    if (h < constraint.minH || h > constraint.maxH) {
      violations.push(`Panel "${panel}" height ${h}px is outside allowed range ${constraint.minH}–${constraint.maxH}px`);
    }
  }
  return { violations };
}

export function validateNumbering(numberValue?: string | null): { valid: boolean; error?: string } {
  if (!numberValue) return { valid: true };
  const n = parseInt(numberValue, 10);
  if (isNaN(n)) return { valid: false, error: "Number must be numeric" };
  if (n < 0 || n > 99) return { valid: false, error: "Jersey number must be between 0 and 99" };
  return { valid: true };
}

export function validateMotifRepeat(motifConfig?: Record<string, unknown> | null): { valid: boolean; error?: string } {
  if (!motifConfig) return { valid: true };
  const scale = Number(motifConfig["scale"] ?? 1);
  if (scale <= 0 || scale > 10) return { valid: false, error: "Motif scale must be between 0 and 10" };
  return { valid: true };
}

// ── Trademark check ───────────────────────────────────────────────────────────

export function checkTrademark(fields: Record<string, string>): TrademarkCheckResult {
  const flags: string[] = [];
  const checkedFields = Object.keys(fields);

  for (const [fieldName, value] of Object.entries(fields)) {
    const lower = value.toLowerCase();
    for (const mark of TRADEMARK_BLOCKLIST) {
      if (lower.includes(mark)) {
        flags.push(`Field "${fieldName}" contains potentially trademarked term: "${mark}"`);
      }
    }
  }

  return { safe: flags.length === 0, flags, checkedFields };
}

// ── Service functions ─────────────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput): Promise<FashionDesignOrder> {
  validateServiceType(input.serviceType);

  // Trademark check on initial fields
  const tmCheck = checkTrademark({
    orderName: input.orderName,
    description: input.description ?? "",
  });

  const [order] = await db
    .insert(fashionDesignOrdersTable)
    .values({
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      orderName: input.orderName,
      description: input.description ?? null,
      serviceType: input.serviceType,
      quantity: input.quantity ?? 1,
      colorways: input.colorways ?? [],
      motifConfig: input.motifConfig ?? null,
      status: "draft",
      trademarkSafe: tmCheck.safe,
      trademarkNotes: tmCheck.flags.length > 0 ? tmCheck.flags.join("; ") : null,
    })
    .returning();

  logger.info({ orderId: order!.id, serviceType: input.serviceType }, "[fashion-design] Order created");
  return order!;
}

export async function listOrders(opts: ListOrdersOptions = {}): Promise<{
  items: FashionDesignOrder[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, opts.pageSize ?? 20);
  const offset = (page - 1) * pageSize;

  // Build where conditions
  const conditions: SQL[] = [];
  if (opts.status) {
    validateStatus(opts.status);
    conditions.push(eq(fashionDesignOrdersTable.status, opts.status));
  }
  if (opts.serviceType) {
    conditions.push(eq(fashionDesignOrdersTable.serviceType, opts.serviceType));
  }
  if (opts.search) {
    conditions.push(like(fashionDesignOrdersTable.orderName, `%${opts.search}%`));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, countRows] = await Promise.all([
    db
      .select()
      .from(fashionDesignOrdersTable)
      .where(where)
      .orderBy(desc(fashionDesignOrdersTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ id: fashionDesignOrdersTable.id }).from(fashionDesignOrdersTable).where(where),
  ]);

  return { items, total: countRows.length, page, pageSize };
}

export async function getOrder(id: number): Promise<FashionDesignOrder | null> {
  const [order] = await db
    .select()
    .from(fashionDesignOrdersTable)
    .where(eq(fashionDesignOrdersTable.id, id))
    .limit(1);
  return order ?? null;
}

export async function updateOrderStatus(
  id: number,
  input: UpdateOrderStatusInput,
): Promise<FashionDesignOrder | null> {
  validateStatus(input.status);

  const existing = await getOrder(id);
  if (!existing) return null;

  // Guard: cannot move to approved/delivered without trademark safety
  if (["approved", "delivered"].includes(input.status) && !existing.trademarkSafe) {
    throw new Error("Cannot approve or deliver an order flagged for trademark issues");
  }

  // Guard: cannot skip blueprint_ready → generating — must have a blueprint
  if (input.status === "generating") {
    const bp = await getBlueprint(id);
    if (!bp) throw new Error("Cannot start generation: no blueprint saved for this order");
  }

  const [updated] = await db
    .update(fashionDesignOrdersTable)
    .set({
      status: input.status,
      adminNotes: input.adminNotes ?? existing.adminNotes,
    })
    .where(eq(fashionDesignOrdersTable.id, id))
    .returning();

  logger.info({ orderId: id, status: input.status }, "[fashion-design] Order status updated");
  return updated ?? null;
}

export async function updateOrderColorways(
  id: number,
  colorways: string[],
  motifConfig?: Record<string, unknown>,
): Promise<FashionDesignOrder | null> {
  const [updated] = await db
    .update(fashionDesignOrdersTable)
    .set({
      colorways,
      ...(motifConfig !== undefined ? { motifConfig } : {}),
    })
    .where(eq(fashionDesignOrdersTable.id, id))
    .returning();
  return updated ?? null;
}

export async function deleteOrder(id: number): Promise<boolean> {
  const existing = await getOrder(id);
  if (!existing) return false;
  if (["approved", "delivered"].includes(existing.status)) {
    throw new Error("Cannot delete an approved or delivered order");
  }
  await db.delete(fashionDesignOrdersTable).where(eq(fashionDesignOrdersTable.id, id));
  logger.info({ orderId: id }, "[fashion-design] Order deleted");
  return true;
}

// ── Blueprint ─────────────────────────────────────────────────────────────────

export async function getBlueprint(orderId: number): Promise<FashionDesignBlueprint | null> {
  const [bp] = await db
    .select()
    .from(fashionDesignBlueprintsTable)
    .where(eq(fashionDesignBlueprintsTable.orderId, orderId))
    .limit(1);
  return bp ?? null;
}

export async function saveBlueprint(
  orderId: number,
  input: SaveBlueprintInput,
): Promise<{ blueprint: FashionDesignBlueprint; violations: string[]; numberingError?: string }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");

  // Validate panel constraints
  const panels = (input.panels ?? {}) as Record<string, { size?: { w: number; h: number } }>;
  const { violations } = validatePanelConstraints(panels);

  // Validate numbering
  const numResult = validateNumbering(input.numberValue);
  const numberingError = numResult.valid ? undefined : numResult.error;

  // Validate motif repeat
  const motifResult = validateMotifRepeat(order.motifConfig as Record<string, unknown> | null);
  if (!motifResult.valid && motifResult.error) {
    violations.push(motifResult.error);
  }

  // Trademark check on name/number fields
  const tmFields: Record<string, string> = {};
  if (input.nameValue) tmFields["nameValue"] = input.nameValue;
  if (input.sponsors) {
    for (const [i, s] of (input.sponsors as Array<{ name?: string }>).entries()) {
      if (s.name) tmFields[`sponsor[${i}]`] = s.name;
    }
  }
  if (Object.keys(tmFields).length > 0) {
    const tmCheck = checkTrademark(tmFields);
    if (!tmCheck.safe) {
      // Update order trademark flag
      await db
        .update(fashionDesignOrdersTable)
        .set({ trademarkSafe: false, trademarkNotes: tmCheck.flags.join("; ") })
        .where(eq(fashionDesignOrdersTable.id, orderId));
    }
  }

  // Upsert blueprint
  const existing = await getBlueprint(orderId);
  let blueprint: FashionDesignBlueprint;

  if (existing) {
    const [updated] = await db
      .update(fashionDesignBlueprintsTable)
      .set({
        panels: input.panels ?? existing.panels,
        placementSpec: input.placementSpec ?? existing.placementSpec,
        panelConstraints: input.panelConstraints ?? existing.panelConstraints,
        logoPlacement: input.logoPlacement ?? existing.logoPlacement,
        numberValue: input.numberValue ?? existing.numberValue,
        nameValue: input.nameValue ?? existing.nameValue,
        numberFont: input.numberFont ?? existing.numberFont,
        numberColor: input.numberColor ?? existing.numberColor,
        sponsors: input.sponsors ?? existing.sponsors,
      })
      .where(eq(fashionDesignBlueprintsTable.orderId, orderId))
      .returning();
    blueprint = updated!;
  } else {
    const [created] = await db
      .insert(fashionDesignBlueprintsTable)
      .values({
        orderId,
        panels: input.panels ?? {},
        placementSpec: input.placementSpec ?? null,
        panelConstraints: input.panelConstraints ?? null,
        logoPlacement: input.logoPlacement ?? null,
        numberValue: input.numberValue ?? null,
        nameValue: input.nameValue ?? null,
        numberFont: input.numberFont ?? null,
        numberColor: input.numberColor ?? null,
        sponsors: input.sponsors ?? [],
      })
      .returning();
    blueprint = created!;
  }

  // Advance order to blueprint_ready if still in draft
  if (order.status === "draft" && violations.length === 0 && !numberingError) {
    await db
      .update(fashionDesignOrdersTable)
      .set({ status: "blueprint_ready" })
      .where(eq(fashionDesignOrdersTable.id, orderId));
  }

  logger.info({ orderId, violations, numberingError }, "[fashion-design] Blueprint saved");
  return { blueprint, violations, numberingError };
}

// ── Trademark explicit check ───────────────────────────────────────────────────

export async function runTrademarkCheck(
  orderId: number,
): Promise<{ order: FashionDesignOrder; result: TrademarkCheckResult }> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");

  const bp = await getBlueprint(orderId);
  const fieldsToCheck: Record<string, string> = {
    orderName: order.orderName,
    description: order.description ?? "",
  };
  if (bp?.nameValue) fieldsToCheck["name"] = bp.nameValue;
  if (bp?.sponsors) {
    for (const [i, s] of (bp.sponsors as Array<{ name?: string }>).entries()) {
      if (s.name) fieldsToCheck[`sponsor_${i}`] = s.name;
    }
  }

  const result = checkTrademark(fieldsToCheck);

  const [updated] = await db
    .update(fashionDesignOrdersTable)
    .set({
      trademarkSafe: result.safe,
      trademarkNotes: result.flags.join("; ") || null,
      status: !result.safe ? "trademark_flagged" : order.status,
    })
    .where(eq(fashionDesignOrdersTable.id, orderId))
    .returning();

  return { order: updated!, result };
}

// ── Output generation (mock — production requires AI pipeline integration) ────

export async function generateOutputs(orderId: number): Promise<GenerationResult> {
  const order = await getOrder(orderId);
  if (!order) throw new Error("Order not found");
  if (!["blueprint_ready", "review"].includes(order.status)) {
    throw new Error(`Cannot generate: order status is "${order.status}". Must be "blueprint_ready".`);
  }
  if (!order.trademarkSafe) {
    throw new Error("Cannot generate outputs for an order with trademark flags. Resolve trademark issues first.");
  }

  const bp = await getBlueprint(orderId);
  if (!bp) throw new Error("No blueprint found. Save a blueprint before generating.");

  // Validate motif before generation
  const motifResult = validateMotifRepeat(order.motifConfig as Record<string, unknown> | null);
  const warnings: string[] = [];
  if (!motifResult.valid && motifResult.error) warnings.push(motifResult.error);

  // Build the composition JSON output (editable re-import format)
  const compositionJson = {
    version: "1.0",
    serviceType: order.serviceType,
    orderName: order.orderName,
    colorways: order.colorways,
    motifConfig: order.motifConfig,
    blueprint: {
      panels: bp.panels,
      placementSpec: bp.placementSpec,
      logoPlacement: bp.logoPlacement,
      name: bp.nameValue,
      number: bp.numberValue,
      numberFont: bp.numberFont,
      numberColor: bp.numberColor,
      sponsors: bp.sponsors,
    },
    outputs: {
      "flat-design": { status: "pending", note: "Requires AI image generation pipeline" },
      "front-back-preview": { status: "pending", note: "Requires rendering service" },
      "colorways": { generated: order.colorways, count: (order.colorways as string[]).length },
      "motif-variants": { config: order.motifConfig, status: "pending" },
      "placement-spec": bp.placementSpec ?? {},
      "composition-json": "self",
    },
    generatedAt: new Date().toISOString(),
    warnings: [
      "Final production patterns require size specification and technical review before manufacturing.",
      ...warnings,
    ],
  };

  const outputs = {
    "flat-design": null, // requires AI pipeline
    "front-back-preview": null, // requires rendering
    "colorways": order.colorways,
    "motif-variants": order.motifConfig ? { config: order.motifConfig } : null,
    "placement-spec": bp.placementSpec ?? {},
    "composition-json": compositionJson,
  };

  await db
    .update(fashionDesignOrdersTable)
    .set({ status: "review", outputs, compositionJson })
    .where(eq(fashionDesignOrdersTable.id, orderId));

  logger.info({ orderId }, "[fashion-design] Outputs generated");

  return {
    outputs,
    warnings: [
      "Flat design and front/back preview require AI image generation pipeline connection.",
      "This output is a structural composition only — not a production-ready pattern.",
      ...warnings,
    ],
  };
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

export function getAvailableServices() {
  return FASHION_SERVICE_TYPES.map((type) => ({
    type,
    blueprintPanels: BLUEPRINT_PANELS,
    outputTypes: ["flat-design", "front-back-preview", "colorways", "motif-variants", "placement-spec", "composition-json"],
    panelConstraints: PANEL_CONSTRAINTS,
    notes: type === "batik-inspired"
      ? "Batik-inspired designs use traditional motif patterns. Ensure motif repeat scale ≤ 10."
      : undefined,
  }));
}
