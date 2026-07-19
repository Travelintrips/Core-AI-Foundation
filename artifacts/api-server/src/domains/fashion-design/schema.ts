/**
 * Fashion & Apparel Design — Domain-local schema definition (Team 18)
 *
 * IMPORTANT: This file is intentionally NOT exported through lib/db/src/schema/index.ts.
 * The tables are defined here to keep Team 18's domain self-contained.
 * Team 24 integration task: add barrel export to lib/db/src/schema/index.ts
 * once the domain has been reviewed and approved for global registration.
 *
 * Uses appSchema (ai_platform Postgres schema) directly via pgSchema().
 */

import {
  pgSchema,
  serial,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

// ── Revision types ────────────────────────────────────────────────────────────
export const FASHION_REVISION_TYPES = [
  "customer_request",
  "designer_assignment",
  "designer_upload",
] as const;

export type FashionRevisionType = (typeof FASHION_REVISION_TYPES)[number];

export const FASHION_REVISION_STATUSES = [
  "pending",
  "in_progress",
  "completed",
] as const;

export type FashionRevisionStatus = (typeof FASHION_REVISION_STATUSES)[number];

// Mirror of lib/db/src/schema/_pg-schema.ts — same schema name, idempotent.
const appSchema = pgSchema("ai_platform");

// ── Service types ─────────────────────────────────────────────────────────────
export const FASHION_SERVICE_TYPES = [
  "t-shirt",
  "jersey",
  "hoodie",
  "uniform",
  "jacket",
  "dress",
  "batik-inspired",
  "merchandise",
] as const;

export type FashionServiceType = (typeof FASHION_SERVICE_TYPES)[number];

// ── Blueprint panel names ─────────────────────────────────────────────────────
export const BLUEPRINT_PANELS = [
  "front",
  "back",
  "sleeves",
  "collar",
  "pocket",
  "logo-area",
  "sponsor",
  "name",
  "number",
  "garment-panels",
] as const;

export type BlueprintPanel = (typeof BLUEPRINT_PANELS)[number];

// ── Output types ──────────────────────────────────────────────────────────────
export const FASHION_OUTPUT_TYPES = [
  "flat-design",
  "front-back-preview",
  "colorways",
  "motif-variants",
  "placement-spec",
  "composition-json",
] as const;

export type FashionOutputType = (typeof FASHION_OUTPUT_TYPES)[number];

// ── Status flow ───────────────────────────────────────────────────────────────
// draft → blueprint_ready → generating → review → approved → delivered
// revision path: review → revision_requested → revision_in_progress → review
// also: trademark_flagged, cancelled
export const FASHION_ORDER_STATUSES = [
  "draft",
  "blueprint_ready",
  "generating",
  "review",
  "revision_requested",
  "revision_in_progress",
  "approved",
  "delivered",
  "trademark_flagged",
  "cancelled",
] as const;

export type FashionOrderStatus = (typeof FASHION_ORDER_STATUSES)[number];

// ── fashion_design_orders ─────────────────────────────────────────────────────
export const fashionDesignOrdersTable = appSchema.table("fashion_design_orders", {
  id: serial("id").primaryKey(),

  // Identity
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  orderName: text("order_name").notNull(),
  description: text("description"),

  // Service
  serviceType: text("service_type").notNull(),
  quantity: integer("quantity").notNull().default(1),

  // Status & safety
  status: text("status").notNull().default("draft"),
  trademarkSafe: boolean("trademark_safe").notNull().default(true),
  trademarkNotes: text("trademark_notes"),

  // Colorways — array of hex strings e.g. ["#FF0000","#FFFFFF"]
  colorways: jsonb("colorways").notNull().default([]),

  // Motif config — { name, repeatPattern, scale, angle }
  motifConfig: jsonb("motif_config"),

  // Composition JSON for editable re-import
  compositionJson: jsonb("composition_json"),

  // Generated output URLs / blobs by output type
  outputs: jsonb("outputs").notNull().default({}),

  // Admin notes
  adminNotes: text("admin_notes"),

  // Assigned designer (set during revision flow)
  designerName: text("designer_name"),
  designerEmail: text("designer_email"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FashionDesignOrder = typeof fashionDesignOrdersTable.$inferSelect;
export type InsertFashionDesignOrder = typeof fashionDesignOrdersTable.$inferInsert;

// ── fashion_design_blueprints ─────────────────────────────────────────────────
export const fashionDesignBlueprintsTable = appSchema.table("fashion_design_blueprints", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => fashionDesignOrdersTable.id, { onDelete: "cascade" }),

  // Panel configurations — keyed by BlueprintPanel
  panels: jsonb("panels").notNull().default({}),

  // Placement specification document
  placementSpec: jsonb("placement_spec"),

  // Panel size constraints (min/max for each panel)
  panelConstraints: jsonb("panel_constraints"),

  // Logo placement — { logoUrl, panel, x, y, w, h, locked }
  logoPlacement: jsonb("logo_placement"),

  // Number/name fields
  numberValue: text("number_value"),
  nameValue: text("name_value"),
  numberFont: text("number_font"),
  numberColor: text("number_color"),

  // Sponsor list — [{ name, logoUrl, panel, position }]
  sponsors: jsonb("sponsors").notNull().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FashionDesignBlueprint = typeof fashionDesignBlueprintsTable.$inferSelect;
export type InsertFashionDesignBlueprint = typeof fashionDesignBlueprintsTable.$inferInsert;

// ── fashion_design_revisions ──────────────────────────────────────────────────
export const fashionDesignRevisionsTable = appSchema.table("fashion_design_revisions", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => fashionDesignOrdersTable.id, { onDelete: "cascade" }),

  // Type: customer_request | designer_assignment | designer_upload
  type: text("type").notNull(),

  // Status: pending | in_progress | completed
  status: text("status").notNull().default("pending"),

  // Customer revision request
  feedback: text("feedback"),
  referenceUrls: jsonb("reference_urls").notNull().default([]),

  // Designer assignment / upload
  designerName: text("designer_name"),
  designerEmail: text("designer_email"),
  revisedFileUrls: jsonb("revised_file_urls").notNull().default([]),
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type FashionDesignRevision = typeof fashionDesignRevisionsTable.$inferSelect;
export type InsertFashionDesignRevision = typeof fashionDesignRevisionsTable.$inferInsert;
