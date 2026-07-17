/**
 * schema.ts — Team 19: Packaging Design — domain-local schema
 *
 * Defines all three tables, TypeScript types, and domain constants.
 * Intentionally kept inside the domain folder per Team 24 locked-file rules:
 * feature teams MUST NOT add files to lib/db/src/schema/.
 *
 * The `db` pool is imported from @workspace/db as usual.
 * pgSchema("ai_platform") is defined locally — same physical schema name.
 *
 * Integration with the global schema barrel is requested via:
 *   integration/manifests/team-19.json → schemaExportsRequested
 */

import {
  pgSchema,
  serial,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// Mirror of lib/db/src/schema/_pg-schema.ts — same schema name.
const appSchema = pgSchema("ai_platform");

// ─────────────────────────────────────────────────────────────────────────────
// Type stubs (referenced before table declarations)
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
// packaging_design_orders
// ─────────────────────────────────────────────────────────────────────────────

export const packagingDesignOrdersTable = appSchema.table(
  "packaging_design_orders",
  {
    id: serial("id").primaryKey(),
    orderId: text("order_id").notNull().unique(),

    serviceType: text("service_type").notNull(),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone"),
    companyName: text("company_name"),

    brandName: text("brand_name").notNull(),
    productName: text("product_name").notNull(),
    productCategory: text("product_category"),
    marketTarget: text("market_target"),
    quantity: integer("quantity").notNull().default(1),

    panelsRequired: jsonb("panels_required")
      .$type<string[]>()
      .notNull()
      .default([]),

    widthMm: numeric("width_mm", { precision: 8, scale: 2 }),
    heightMm: numeric("height_mm", { precision: 8, scale: 2 }),
    depthMm: numeric("depth_mm", { precision: 8, scale: 2 }),
    bleedMm: numeric("bleed_mm", { precision: 6, scale: 2 }).notNull().default("3"),
    safeAreaMm: numeric("safe_area_mm", { precision: 6, scale: 2 }).notNull().default("5"),

    colorMode: text("color_mode").notNull().default("cmyk"),
    finishType: text("finish_type"),
    materialType: text("material_type"),
    printSides: integer("print_sides").notNull().default(1),

    hasBarcodeZone: boolean("has_barcode_zone").notNull().default(false),
    barcodeType: text("barcode_type"),
    hasIngredientsBlock: boolean("has_ingredients_block").notNull().default(false),
    hasLegalBlock: boolean("has_legal_block").notNull().default(false),
    hasLogoZone: boolean("has_logo_zone").notNull().default(true),
    hasProductImageZone: boolean("has_product_image_zone").notNull().default(false),
    hasNutritionFacts: boolean("has_nutrition_facts").notNull().default(false),
    hasHalalCertification: boolean("has_halal_certification").notNull().default(false),
    hasSniBadge: boolean("has_sni_badge").notNull().default(false),
    hasBpomNumber: boolean("has_bpom_number").notNull().default(false),

    stylePreference: text("style_preference"),
    colorPrimary: text("color_primary"),
    colorSecondary: text("color_secondary"),
    referenceLinks: text("reference_links"),
    additionalNotes: text("additional_notes"),
    briefJson: jsonb("brief_json").$type<Record<string, unknown>>(),

    variantCount: integer("variant_count").notNull().default(1),

    status: text("status").notNull().default("draft"),

    prepressValidationJson: jsonb("prepress_validation_json")
      .$type<PrepressValidationResult>(),
    prepressValidatedAt: timestamp("prepress_validated_at", { withTimezone: true }),
    prepressValidatedBy: text("prepress_validated_by"),

    printReadyAt: timestamp("print_ready_at", { withTimezone: true }),
    printReadyBy: text("print_ready_by"),

    // ── Artwork resolution ────────────────────────────────────────────────────
    // Optional target resolution in DPI (e.g. 300 for print, 72 for digital preview).
    // Validated against PACKAGING_BOUNDS at creation time.
    resolutionDpi: integer("resolution_dpi"),

    currency: text("currency").notNull().default("IDR"),
    quotedPrice: numeric("quoted_price", { precision: 14, scale: 2 }),
    finalPrice: numeric("final_price", { precision: 14, scale: 2 }),

    deliverableLinks: jsonb("deliverable_links")
      .$type<Array<{ label: string; url: string }>>(),
    completionNotes: text("completion_notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// packaging_design_variants
// ─────────────────────────────────────────────────────────────────────────────

export const packagingDesignVariantsTable = appSchema.table(
  "packaging_design_variants",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => packagingDesignOrdersTable.id, { onDelete: "cascade" }),
    variantName: text("variant_name").notNull(),
    variantLabel: text("variant_label"),
    sku: text("sku"),
    barcodeValue: text("barcode_value"),
    colorAccent: text("color_accent"),
    netWeight: text("net_weight"),

    consistencyStatus: text("consistency_status").notNull().default("not_validated"),
    consistencyNotes: text("consistency_notes"),

    dielineFileUrl: text("dieline_file_url"),
    artworkFileUrl: text("artwork_file_url"),
    mockupFileUrl: text("mockup_file_url"),

    status: text("status").notNull().default("active"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// packaging_design_validation_log
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
    outcome: text("outcome").notNull(),
    checksJson: jsonb("checks_json").$type<PrepressCheck[]>().notNull(),
    warningsJson: jsonb("warnings_json").$type<PrintWarning[]>().notNull(),
    notes: text("notes"),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export type PackagingDesignOrder = typeof packagingDesignOrdersTable.$inferSelect;
export type PackagingDesignVariant = typeof packagingDesignVariantsTable.$inferSelect;
export type PackagingDesignValidationLog = typeof packagingDesignValidationLogTable.$inferSelect;

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

export const REGULATED_SERVICE_TYPES: PackagingServiceType[] = [
  "food_packaging",
  "cosmetic_packaging",
  "bottle_label",
  "jar_label",
];
