import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// packaging_design_orders
// Main order record — one per customer packaging job.
// ─────────────────────────────────────────────────────────────────────────────

export const packagingDesignOrdersTable = appSchema.table(
  "packaging_design_orders",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id").notNull().unique(), // UUID, customer-facing

    // ── Service type ──────────────────────────────────────────────────────
    serviceType: text("service_type").notNull(), // box | pouch | bottle_label | jar_label | cup | sleeve | food_packaging | cosmetic_packaging

    // ── Customer info ─────────────────────────────────────────────────────
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    companyName: text("company_name"),

    // ── Product / brand ───────────────────────────────────────────────────
    brandName: text("brand_name").notNull(),
    productName: text("product_name").notNull(),
    productCategory: text("product_category"), // food | beverage | cosmetic | pharma | industrial | other
    marketTarget: text("market_target"),
    quantity: integer("quantity").notNull().default(1),

    // ── Panel layout ──────────────────────────────────────────────────────
    // Array of panels needed: front | back | side | top | bottom
    panelsRequired: jsonb("panels_required")
      .$type<string[]>()
      .notNull()
      .default([]),

    // ── Technical spec (overview stored here, detail in specs table) ──────
    widthMm: numeric("width_mm", { precision: 8, scale: 2 }),
    heightMm: numeric("height_mm", { precision: 8, scale: 2 }),
    depthMm: numeric("depth_mm", { precision: 8, scale: 2 }), // for 3D packaging
    bleedMm: numeric("bleed_mm", { precision: 6, scale: 2 }).notNull().default("3"),
    safeAreaMm: numeric("safe_area_mm", { precision: 6, scale: 2 }).notNull().default("5"),

    // ── Design requirements ───────────────────────────────────────────────
    colorMode: text("color_mode").notNull().default("cmyk"), // cmyk | pantone | rgb
    finishType: text("finish_type"), // matte | gloss | soft_touch | uv_spot | foil | none
    materialType: text("material_type"), // kraft | plastic | glass | aluminium | cardboard | other
    printSides: integer("print_sides").notNull().default(1), // 1 | 2 | 4 (all sides)

    // ── Zones & mandatory blocks ──────────────────────────────────────────
    hasBarcodeZone: boolean("has_barcode_zone").notNull().default(false),
    barcodeType: text("barcode_type"), // ean13 | qr | code128 | upc | datamatrix
    hasIngredientsBlock: boolean("has_ingredients_block").notNull().default(false),
    hasLegalBlock: boolean("has_legal_block").notNull().default(false),
    hasLogoZone: boolean("has_logo_zone").notNull().default(true),
    hasProductImageZone: boolean("has_product_image_zone").notNull().default(false),
    hasNutritionFacts: boolean("has_nutrition_facts").notNull().default(false),
    hasHalalCertification: boolean("has_halal_certification").notNull().default(false),
    hasSniBadge: boolean("has_sni_badge").notNull().default(false),
    hasBpomNumber: boolean("has_bpom_number").notNull().default(false), // Indonesian BPOM

    // ── Design style brief ────────────────────────────────────────────────
    stylePreference: text("style_preference"),
    colorPrimary: text("color_primary"),
    colorSecondary: text("color_secondary"),
    referenceLinks: text("reference_links"),
    additionalNotes: text("additional_notes"),
    briefJson: jsonb("brief_json").$type<Record<string, unknown>>(),

    // ── Variants ──────────────────────────────────────────────────────────
    // Number of distinct flavor/size/scent variants needed
    variantCount: integer("variant_count").notNull().default(1),

    // ── Status flow ───────────────────────────────────────────────────────
    // draft → submitted → in_review → design_in_progress → prepress_validation
    //   → revision_requested → print_ready → completed | cancelled
    status: text("status").notNull().default("draft"),

    // ── Prepress validation ───────────────────────────────────────────────
    // Populated by the validate endpoint. null = not yet run.
    prepressValidationJson: jsonb("prepress_validation_json")
      .$type<PrepressValidationResult>(),
    prepressValidatedAt: timestamp("prepress_validated_at", {
      withTimezone: true,
    }),
    prepressValidatedBy: text("prepress_validated_by"), // admin ID or "system"

    // ── Print readiness guard ─────────────────────────────────────────────
    // MUST NOT be set true until prepress_validation passes with no blockers.
    printReadyAt: timestamp("print_ready_at", { withTimezone: true }),
    printReadyBy: text("print_ready_by"),

    // ── Pricing ───────────────────────────────────────────────────────────
    currency: text("currency").notNull().default("IDR"),
    quotedPrice: numeric("quoted_price", { precision: 14, scale: 2 }),
    finalPrice: numeric("final_price", { precision: 14, scale: 2 }),

    // ── Deliverables ──────────────────────────────────────────────────────
    deliverableLinks: jsonb("deliverable_links")
      .$type<Array<{ label: string; url: string }>>(),
    completionNotes: text("completion_notes"),

    // ── Audit ─────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// packaging_design_variants
// One row per flavor / size / scent variant within an order.
// ─────────────────────────────────────────────────────────────────────────────

export const packagingDesignVariantsTable = appSchema.table(
  "packaging_design_variants",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => packagingDesignOrdersTable.id, { onDelete: "cascade" }),
    variantName: text("variant_name").notNull(), // e.g. "Strawberry 250ml"
    variantLabel: text("variant_label"), // short label for dieline zone
    sku: text("sku"),
    barcodeValue: text("barcode_value"), // EAN/UPC/QR data string
    colorAccent: text("color_accent"), // variant-specific accent colour
    netWeight: text("net_weight"), // "250 ml", "500 g" etc.

    // ── Consistency validation ────────────────────────────────────────────
    // consistent = this variant's layout/zones match the master design
    consistencyStatus: text("consistency_status")
      .notNull()
      .default("not_validated"), // not_validated | consistent | inconsistent
    consistencyNotes: text("consistency_notes"),

    // ── File references ───────────────────────────────────────────────────
    dielineFileUrl: text("dieline_file_url"),
    artworkFileUrl: text("artwork_file_url"),
    mockupFileUrl: text("mockup_file_url"),

    status: text("status").notNull().default("active"), // active | archived
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// packaging_design_validation_log
// Immutable log of every prepress validation run per order.
// ─────────────────────────────────────────────────────────────────────────────

export const packagingDesignValidationLogTable = appSchema.table(
  "packaging_design_validation_log",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => packagingDesignOrdersTable.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    runBy: text("run_by").notNull().default("system"),
    // overall outcome: passed | failed | passed_with_warnings
    outcome: text("outcome").notNull(),
    checksJson: jsonb("checks_json").$type<PrepressCheck[]>().notNull(),
    warningsJson: jsonb("warnings_json").$type<PrintWarning[]>().notNull(),
    notes: text("notes"),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas & TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export const insertPackagingDesignOrderSchema = createInsertSchema(
  packagingDesignOrdersTable,
).omit({
  id: true,
  orderId: true,
  status: true,
  prepressValidationJson: true,
  prepressValidatedAt: true,
  prepressValidatedBy: true,
  printReadyAt: true,
  printReadyBy: true,
  deliverableLinks: true,
  completionNotes: true,
  quotedPrice: true,
  finalPrice: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export const insertPackagingDesignVariantSchema = createInsertSchema(
  packagingDesignVariantsTable,
).omit({
  id: true,
  consistencyStatus: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPackagingDesignOrder = z.infer<
  typeof insertPackagingDesignOrderSchema
>;
export type PackagingDesignOrder =
  typeof packagingDesignOrdersTable.$inferSelect;
export type PackagingDesignVariant =
  typeof packagingDesignVariantsTable.$inferSelect;
export type PackagingDesignValidationLog =
  typeof packagingDesignValidationLogTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Shared validation types (used by service + validation log)
// ─────────────────────────────────────────────────────────────────────────────

export type CheckSeverity = "error" | "warning" | "info";

export interface PrepressCheck {
  code: string;
  name: string;
  severity: CheckSeverity;
  passed: boolean;
  detail: string;
}

export interface PrintWarning {
  code: string;
  message: string;
  severity: CheckSeverity;
}

export interface PrepressValidationResult {
  outcome: "passed" | "failed" | "passed_with_warnings";
  checks: PrepressCheck[];
  warnings: PrintWarning[];
  blockerCount: number;
  warningCount: number;
  runAt: string;
  runBy: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain constants
// ─────────────────────────────────────────────────────────────────────────────

export const PACKAGING_SERVICE_TYPES = [
  "box",
  "pouch",
  "bottle_label",
  "jar_label",
  "cup",
  "sleeve",
  "food_packaging",
  "cosmetic_packaging",
] as const;

export type PackagingServiceType = (typeof PACKAGING_SERVICE_TYPES)[number];

export const PACKAGING_PANELS = [
  "front",
  "back",
  "side",
  "top",
  "bottom",
] as const;

export type PackagingPanel = (typeof PACKAGING_PANELS)[number];

export const PACKAGING_ORDER_STATUSES = [
  "draft",
  "submitted",
  "in_review",
  "design_in_progress",
  "prepress_validation",
  "revision_requested",
  "print_ready",
  "completed",
  "cancelled",
] as const;

export type PackagingOrderStatus = (typeof PACKAGING_ORDER_STATUSES)[number];

// Service types that REQUIRE mandatory information (ingredients / legal block)
export const REGULATED_SERVICE_TYPES: PackagingServiceType[] = [
  "food_packaging",
  "cosmetic_packaging",
  "bottle_label",
  "jar_label",
];
