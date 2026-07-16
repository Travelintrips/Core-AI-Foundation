import { appSchema } from "./_pg-schema";
import { serial, text, boolean, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
// also: trademark_flagged, cancelled
export const FASHION_ORDER_STATUSES = [
  "draft",
  "blueprint_ready",
  "generating",
  "review",
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
  serviceType: text("service_type").notNull(), // FashionServiceType
  quantity: integer("quantity").notNull().default(1),

  // Status & safety
  status: text("status").notNull().default("draft"), // FashionOrderStatus
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

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFashionDesignOrderSchema = createInsertSchema(fashionDesignOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFashionDesignOrder = z.infer<typeof insertFashionDesignOrderSchema>;
export type FashionDesignOrder = typeof fashionDesignOrdersTable.$inferSelect;

// ── fashion_design_blueprints ─────────────────────────────────────────────────
// One blueprint per order; stores panel-by-panel placement spec
export const fashionDesignBlueprintsTable = appSchema.table("fashion_design_blueprints", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => fashionDesignOrdersTable.id, { onDelete: "cascade" }),

  // Panel configurations — keyed by BlueprintPanel
  // Each value: { enabled: boolean, content: string, position: {x,y}, size: {w,h}, color: string }
  panels: jsonb("panels").notNull().default({}),

  // Placement specification document
  placementSpec: jsonb("placement_spec"),

  // Panel size constraints (min/max for each panel)
  panelConstraints: jsonb("panel_constraints"),

  // Logo placement — { logoUrl, panel, x, y, w, h, locked }
  logoPlacement: jsonb("logo_placement"),

  // Number/name fields
  numberValue: text("number_value"),   // e.g. "10"
  nameValue: text("name_value"),       // e.g. "SURYANTO"
  numberFont: text("number_font"),
  numberColor: text("number_color"),

  // Sponsor list — [{ name, logoUrl, panel, position }]
  sponsors: jsonb("sponsors").notNull().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFashionDesignBlueprintSchema = createInsertSchema(fashionDesignBlueprintsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertFashionDesignBlueprint = z.infer<typeof insertFashionDesignBlueprintSchema>;
export type FashionDesignBlueprint = typeof fashionDesignBlueprintsTable.$inferSelect;
