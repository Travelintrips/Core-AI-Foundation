/**
 * schema.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Self-contained Drizzle schema for the creative-vendors domain.
 * Uses the shared pool from @workspace/db (correct search_path: ai_platform,public)
 * but defines tables locally so no shared files need to be modified.
 *
 * Team 24 integration task: add
 *   export * from "./creative-vendors";
 * to lib/db/src/schema/index.ts AND copy this file to lib/db/src/schema/creative-vendors.ts
 */
import {
  pgSchema,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { pool } from "@workspace/db";

const s = pgSchema("ai_platform");

// ─────────────────────────────────────────────────────────────────────────────
// Enums (enforced at app level, stored as text in Postgres)
// ─────────────────────────────────────────────────────────────────────────────

export const VENDOR_TYPES = [
  "graphic_designer",
  "printing",
  "interior_designer",
  "furniture",
  "lighting",
  "flooring",
  "curtain",
  "kitchen",
  "custom_furniture",
  "textile",
  "konveksi",
  "embroidery",
  "apparel_printing",
  "packaging",
  "product_mockup",
  "photographer",
  "videographer",
] as const;

export type VendorType = (typeof VENDOR_TYPES)[number];

export const VENDOR_STATUSES = ["active", "inactive", "suspended"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const PROFICIENCY_LEVELS = ["beginner", "intermediate", "expert"] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendors — main vendor profile
// ─────────────────────────────────────────────────────────────────────────────

export const vendorsTable = s.table("creative_vendors", {
  id: serial("id").primaryKey(),
  vendorCode: text("vendor_code").notNull().unique(),
  displayName: text("display_name").notNull(),
  brandName: text("brand_name"),
  vendorType: text("vendor_type").notNull(), // VendorType
  description: text("description"),
  shortBio: text("short_bio"),
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  galleryJson: jsonb("gallery_json")
    .$type<Array<{ url: string; caption?: string }>>()
    .default([]),

  // Contact info — redacted in public DTO
  whatsapp: text("whatsapp"),
  email: text("email"),
  websiteUrl: text("website_url"),
  instagramUrl: text("instagram_url"),

  // Location
  city: text("city"),
  province: text("province"),
  country: text("country").notNull().default("ID"),

  // Pricing (optional, display-only — NOT used for procurement/RAB)
  minPrice: integer("min_price"), // IDR, nullable
  maxPrice: integer("max_price"), // IDR, nullable
  priceCurrency: text("price_currency").default("IDR"),

  // Operations
  leadTimeDays: integer("lead_time_days").notNull().default(7),
  isAvailableNow: boolean("is_available_now").notNull().default(true),

  // Moderation + status
  status: text("status").notNull().default("active"), // VendorStatus
  moderationStatus: text("moderation_status").notNull().default("pending"), // ModerationStatus
  moderationNote: text("moderation_note"),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),

  // Stats
  isVerified: boolean("is_verified").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  totalRatings: integer("total_ratings").notNull().default(0),
  avgRating: numeric("avg_rating", { precision: 3, scale: 2 }).notNull().default("0"),
  totalContactRequests: integer("total_contact_requests").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Vendor = typeof vendorsTable.$inferSelect;
export type InsertVendor = typeof vendorsTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_service_areas — geographic coverage
// ─────────────────────────────────────────────────────────────────────────────

export const vendorServiceAreasTable = s.table("creative_vendor_service_areas", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  province: text("province").notNull(),
  city: text("city"),
  isRemote: boolean("is_remote").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorServiceArea = typeof vendorServiceAreasTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_capabilities — skills & tools
// ─────────────────────────────────────────────────────────────────────────────

export const vendorCapabilitiesTable = s.table("creative_vendor_capabilities", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  capabilityName: text("capability_name").notNull(),
  proficiencyLevel: text("proficiency_level").notNull().default("intermediate"), // ProficiencyLevel
  yearsExperience: integer("years_experience"),
  toolsJson: jsonb("tools_json").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorCapability = typeof vendorCapabilitiesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_certifications
// ─────────────────────────────────────────────────────────────────────────────

export const vendorCertificationsTable = s.table("creative_vendor_certifications", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  certificationName: text("certification_name").notNull(),
  issuer: text("issuer"),
  issuedAt: date("issued_at"),
  expiresAt: date("expires_at"),
  verificationUrl: text("verification_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorCertification = typeof vendorCertificationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_portfolio_items — vendor portfolio with moderation
// ─────────────────────────────────────────────────────────────────────────────

export const vendorPortfolioItemsTable = s.table("creative_vendor_portfolio_items", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"), // vendor type this portfolio belongs to
  coverImageUrl: text("cover_image_url"),
  galleryJson: jsonb("gallery_json")
    .$type<Array<{ url: string; caption?: string }>>()
    .default([]),
  clientIndustry: text("client_industry"),
  projectDurationDays: integer("project_duration_days"),
  tagsJson: jsonb("tags_json").$type<string[]>().default([]),

  // Moderation
  moderationStatus: text("moderation_status").notNull().default("pending"), // ModerationStatus
  moderationNote: text("moderation_note"),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),

  isFeatured: boolean("is_featured").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VendorPortfolioItem = typeof vendorPortfolioItemsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_ratings — client ratings
// ─────────────────────────────────────────────────────────────────────────────

export const vendorRatingsTable = s.table("creative_vendor_ratings", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  clientEmailHash: text("client_email_hash").notNull(), // SHA-256 of email
  rating: integer("rating").notNull(), // 1-5
  review: text("review"),
  projectContext: text("project_context"), // e.g. "Logo design for F&B"
  moderationStatus: text("moderation_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorRating = typeof vendorRatingsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_contact_requests — lead / contact requests
// ─────────────────────────────────────────────────────────────────────────────

export const vendorContactRequestsTable = s.table("creative_vendor_contact_requests", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  requesterEmailHash: text("requester_email_hash").notNull(),
  requesterName: text("requester_name"),
  projectDescription: text("project_description").notNull(),
  budgetRange: text("budget_range"), // optional display-only
  preferredStartDate: date("preferred_start_date"),
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  vendorResponse: text("vendor_response"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type VendorContactRequest = typeof vendorContactRequestsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Local Drizzle instance (self-contained — does not require lib/db changes)
// ─────────────────────────────────────────────────────────────────────────────

export const vendorDb = drizzle(pool, {
  schema: {
    vendorsTable,
    vendorServiceAreasTable,
    vendorCapabilitiesTable,
    vendorCertificationsTable,
    vendorPortfolioItemsTable,
    vendorRatingsTable,
    vendorContactRequestsTable,
  },
});
