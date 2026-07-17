/**
 * schema.ts — Team 22 / Creative Vendor Ecosystem
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * Canonical source mapping:
 *   creative_vendors (REVERTED)            → marketplace_creators (existing master)
 *   creative_vendor_ratings (REVERTED)     → marketplace_ratings (itemType='creative_vendor')
 *   creative_vendor_portfolio_items (REVERTED) → ai_service_portfolios (existing)
 *   creative_vendor_contact_requests (REVERTED) → pending canonical contact/inquiry mapping
 *
 * Extension contract (KEPT — new concepts with no existing counterpart):
 *   creative_vendor_profiles               → extension of marketplace_creators
 *   creative_vendor_service_areas          → service/geographic coverage
 *   creative_vendor_capabilities           → creative capability tags
 *   creative_vendor_certifications         → vendor verification metadata
 *
 * Team 24 integration task:
 *   1. Run integration/migrations/team-22.sql
 *   2. Mount vendorRouter via app.use('/', vendorRouter)
 *   3. DO NOT add export to lib/db/src/schema/index.ts yet —
 *      pending architecture review of vendor canonical source
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
import { marketplaceCreatorsTable } from "@workspace/db";

const s = pgSchema("ai_platform");

// ─────────────────────────────────────────────────────────────────────────────
// Enums (enforced at app level, stored as text)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creative vendor types — physical/service vendors (distinct from
 * marketplace_creators which are digital content creators).
 */
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

export const MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const PROFICIENCY_LEVELS = ["beginner", "intermediate", "expert"] as const;
export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_profiles — EXTENSION of marketplace_creators
//
// ARCHITECTURE DECISION:
//   creative_vendors (master) was reverted. Creative vendor identity is anchored
//   to marketplace_creators (the platform canonical vendor entity).
//   This table adds physical-vendor-specific metadata only.
//
// FK: creator_id → marketplace_creators(id) UNIQUE (1:1 extension)
// ─────────────────────────────────────────────────────────────────────────────

export const creativeVendorProfilesTable = s.table("creative_vendor_profiles", {
  id: serial("id").primaryKey(),

  // Anchor — UNIQUE ensures 1:1 extension, not a separate master
  creatorId: integer("creator_id").notNull().unique(),
  // Note: FK to marketplace_creators(id) enforced in SQL migration;
  // Drizzle cross-schema FK declaration requires the table in the same schema
  // instance — enforced via migration DDL instead.

  // Creative-specific identity
  vendorType: text("vendor_type").notNull(), // VendorType

  // Contact augmentation (physical vendors — not in marketplace_creators)
  whatsapp: text("whatsapp"),
  instagramUrl: text("instagram_url"),

  // Location (physical vendor dimension — not in marketplace_creators)
  city: text("city"),
  province: text("province"),
  country: text("country").notNull().default("ID"),

  // Pricing — display-only; NOT connected to procurement, checkout, or RAB
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  priceCurrency: text("price_currency").default("IDR"),

  // Operations / lead time (creative service dimension)
  leadTimeDays: integer("lead_time_days").notNull().default(7),
  isAvailableNow: boolean("is_available_now").notNull().default(true),

  // Creative vendor moderation (separate from marketplace_creators.isActive)
  moderationStatus: text("moderation_status").notNull().default("pending"),
  moderationNote: text("moderation_note"),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  isFeatured: boolean("is_featured").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type CreativeVendorProfile = typeof creativeVendorProfilesTable.$inferSelect;
export type InsertCreativeVendorProfile = typeof creativeVendorProfilesTable.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_service_areas — geographic/remote coverage
// FK: profile_id → creative_vendor_profiles(id)
// NEW CONCEPT — no existing counterpart in platform
// ─────────────────────────────────────────────────────────────────────────────

export const vendorServiceAreasTable = s.table("creative_vendor_service_areas", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => creativeVendorProfilesTable.id, {
    onDelete: "cascade",
  }),
  province: text("province").notNull(),
  city: text("city"),
  isRemote: boolean("is_remote").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorServiceArea = typeof vendorServiceAreasTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_capabilities — creative capability tags
// Covers: material/fashion/interior capability, tools, proficiency
// FK: profile_id → creative_vendor_profiles(id)
// NEW CONCEPT — no existing counterpart in platform
// ─────────────────────────────────────────────────────────────────────────────

export const vendorCapabilitiesTable = s.table("creative_vendor_capabilities", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => creativeVendorProfilesTable.id, {
    onDelete: "cascade",
  }),
  capabilityName: text("capability_name").notNull(),
  proficiencyLevel: text("proficiency_level").notNull().default("intermediate"),
  yearsExperience: integer("years_experience"),
  toolsJson: jsonb("tools_json").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorCapability = typeof vendorCapabilitiesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// creative_vendor_certifications — vendor verification metadata
// FK: profile_id → creative_vendor_profiles(id)
// NEW CONCEPT — no existing counterpart in platform
// ─────────────────────────────────────────────────────────────────────────────

export const vendorCertificationsTable = s.table("creative_vendor_certifications", {
  id: serial("id").primaryKey(),
  profileId: integer("profile_id").notNull().references(() => creativeVendorProfilesTable.id, {
    onDelete: "cascade",
  }),
  certificationName: text("certification_name").notNull(),
  issuer: text("issuer"),
  issuedAt: date("issued_at"),
  expiresAt: date("expires_at"),
  verificationUrl: text("verification_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorCertification = typeof vendorCertificationsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// REVERTED TABLES — canonical mapping required
//
// creative_vendor_ratings      → marketplace_ratings (itemType='creative_vendor')
// creative_vendor_portfolio_items → ai_service_portfolios
// creative_vendor_contact_requests → pending canonical contact/inquiry mapping
//
// Services for these are stubbed with BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
// in vendorPortfolioService.ts and vendorContactService.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Local Drizzle instance
//
// marketplaceCreatorsTable imported from @workspace/db (read-only, no locked
// files touched) — needed for JOIN queries in vendorService.
// ─────────────────────────────────────────────────────────────────────────────

export const vendorDb = drizzle(pool, {
  schema: {
    marketplaceCreatorsTable,   // platform canonical — imported for JOIN
    creativeVendorProfilesTable,
    vendorServiceAreasTable,
    vendorCapabilitiesTable,
    vendorCertificationsTable,
  },
});
