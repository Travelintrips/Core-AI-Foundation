import { appSchema } from "./_pg-schema";
import { serial, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

/**
 * material_categories — canonical categories for the Interior Design Material Library.
 */
export const materialCategoriesTable = appSchema.table("material_categories", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull().unique(),
  icon:         text("icon").notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MaterialCategory = typeof materialCategoriesTable.$inferSelect;
export type InsertMaterialCategory = typeof materialCategoriesTable.$inferInsert;

/**
 * materials — canonical interior design material records.
 *
 * priceTier: Budget | Standard | Premium | Luxury
 * status:    active | inactive
 */
export const materialsTable = appSchema.table("materials", {
  id:             serial("id").primaryKey(),
  materialCode:   text("material_code").notNull().unique(),
  name:           text("name").notNull(),
  slug:           text("slug").notNull().unique(),
  category:       text("category").notNull(),
  subcategory:    text("subcategory"),
  brand:          text("brand"),
  materialType:   text("material_type"),
  color:          text("color"),
  finish:         text("finish"),
  texture:        text("texture"),
  pattern:        text("pattern"),
  description:    text("description"),
  priceTier:      text("price_tier").notNull().default("Standard"),
  thumbnailUrl:   text("thumbnail_url"),
  previewImages:  jsonb("preview_images").$type<string[]>(),
  technicalData:  jsonb("technical_data").$type<Record<string, string>>(),
  searchKeywords: jsonb("search_keywords").$type<string[]>(),
  status:         text("status").notNull().default("active"),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Material = typeof materialsTable.$inferSelect;
export type InsertMaterial = typeof materialsTable.$inferInsert;

export const MATERIAL_PRICE_TIERS = ["Budget", "Standard", "Premium", "Luxury"] as const;
export type MaterialPriceTier = (typeof MATERIAL_PRICE_TIERS)[number];

export const MATERIAL_STATUSES = ["active", "inactive"] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export const DEFAULT_CATEGORIES = [
  { name: "Wall",       icon: "square",         displayOrder: 1  },
  { name: "Floor",      icon: "grid",           displayOrder: 2  },
  { name: "Ceiling",    icon: "layers",         displayOrder: 3  },
  { name: "Furniture",  icon: "sofa",           displayOrder: 4  },
  { name: "Lighting",   icon: "lightbulb",      displayOrder: 5  },
  { name: "Fabric",     icon: "shirt",          displayOrder: 6  },
  { name: "Kitchen",    icon: "utensils",       displayOrder: 7  },
  { name: "Bathroom",   icon: "bath",           displayOrder: 8  },
  { name: "Outdoor",    icon: "trees",          displayOrder: 9  },
  { name: "Decorative", icon: "sparkles",       displayOrder: 10 },
  { name: "Doors",      icon: "door-open",      displayOrder: 11 },
  { name: "Windows",    icon: "frame",          displayOrder: 12 },
  { name: "Landscape",  icon: "mountain",       displayOrder: 13 },
] as const;
