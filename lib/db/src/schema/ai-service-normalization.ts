import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { aiServicesTable } from "./ai-service-catalog";

/**
 * Team 04 — Service Normalization & Solution Collections (V4.2E)
 *
 * ADDITIVE ONLY — no existing table is modified.
 *
 * Architecture:
 *   Category → Service → NormalizationMapping → CanonicalConcept → SolutionCollection
 *
 * Historical service_requests and creative_projects continue pointing to ai_services.
 * Canonical concepts are an organizational/discovery abstraction only.
 *
 * FK deletion rules:
 *   - canonical_concept_id FK → RESTRICT  (deleting a concept that still has mappings/aliases is blocked)
 *   - service_id FK → RESTRICT            (deleting a service that is mapped is blocked)
 *   - collection_id FK → RESTRICT         (deleting a collection that has members is blocked)
 * Prefer RESTRICT over CASCADE to prevent accidental cascade deletion of review metadata.
 */

// ── service_canonical_concepts ────────────────────────────────────────────────

export const serviceCanonicalConceptsTable = appSchema.table(
  "service_canonical_concepts",
  {
    id: serial("id").primaryKey(),
    /** Stable, human-readable identifier. Never derived from mutable display name. e.g. "cc_branding_logo" */
    code: text("code").notNull().unique(),
    /** URL-safe slug. Stable after first publication. Must not replace existing ai_services slug. */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    /** active | draft | archived */
    status: text("status").notNull().default("active"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export const insertServiceCanonicalConceptSchema = createInsertSchema(serviceCanonicalConceptsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServiceCanonicalConcept = z.infer<typeof insertServiceCanonicalConceptSchema>;
export type ServiceCanonicalConcept = typeof serviceCanonicalConceptsTable.$inferSelect;

// ── service_normalization_mappings ────────────────────────────────────────────

export const serviceNormalizationMappingsTable = appSchema.table(
  "service_normalization_mappings",
  {
    id: serial("id").primaryKey(),
    /** FK → service_canonical_concepts.id RESTRICT (see module header for rationale) */
    canonicalConceptId: integer("canonical_concept_id")
      .notNull()
      .references(() => serviceCanonicalConceptsTable.id, { onDelete: "restrict" }),
    /** FK → ai_services.id RESTRICT — never cascade-delete a historical service */
    serviceId: integer("service_id")
      .notNull()
      .references(() => aiServicesTable.id, { onDelete: "restrict" }),
    /**
     * primary         — this service IS the canonical concept's authoritative representation
     * alias_variant   — different label, same underlying concept
     * format_variant  — same business outcome, different output format
     * tier_variant    — same service family, different complexity/scope
     * legacy          — old code retained for historical compatibility
     * related         — related but distinct; not an alias
     */
    relationshipType: text("relationship_type").notNull().default("related"),
    /**
     * true  — this service is the single primary representative of the concept.
     * At most ONE mapping per concept may be primary=true.
     * Enforced in the service layer (not DB UNIQUE) to allow richer error messages.
     */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Optional reviewer notes — never exposed in public API responses. */
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export const insertServiceNormalizationMappingSchema = createInsertSchema(serviceNormalizationMappingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertServiceNormalizationMapping = z.infer<typeof insertServiceNormalizationMappingSchema>;
export type ServiceNormalizationMapping = typeof serviceNormalizationMappingsTable.$inferSelect;

// ── service_aliases ───────────────────────────────────────────────────────────

export const serviceAliasesTable = appSchema.table(
  "service_aliases",
  {
    id: serial("id").primaryKey(),
    canonicalConceptId: integer("canonical_concept_id")
      .notNull()
      .references(() => serviceCanonicalConceptsTable.id, { onDelete: "restrict" }),
    /** Original alias as entered. */
    alias: text("alias").notNull(),
    /** Normalized form (trim + lowercase) — unique per concept. */
    normalizedAlias: text("normalized_alias").notNull(),
    /**
     * name             — alternative display name
     * legacy_code      — old service code no longer in active use
     * language_variant — translated/localized term
     * typo             — common misspelling mapped to the canonical form
     */
    aliasType: text("alias_type").notNull().default("name"),
    locale: text("locale"),
    /** active | archived */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertServiceAliasSchema = createInsertSchema(serviceAliasesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertServiceAlias = z.infer<typeof insertServiceAliasSchema>;
export type ServiceAlias = typeof serviceAliasesTable.$inferSelect;

// ── solution_collections ──────────────────────────────────────────────────────

export const solutionCollectionsTable = appSchema.table(
  "solution_collections",
  {
    id: serial("id").primaryKey(),
    /** Stable machine code — e.g. "sc_brand_launch". */
    code: text("code").notNull().unique(),
    /** URL-safe slug — e.g. "brand-launch-essentials". */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    /** active | draft | archived */
    status: text("status").notNull().default("active"),
    /** public | internal — public collections appear in the customer-facing discovery API */
    visibility: text("visibility").notNull().default("public"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
);

export const insertSolutionCollectionSchema = createInsertSchema(solutionCollectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSolutionCollection = z.infer<typeof insertSolutionCollectionSchema>;
export type SolutionCollection = typeof solutionCollectionsTable.$inferSelect;

// ── solution_collection_services ──────────────────────────────────────────────

export const solutionCollectionServicesTable = appSchema.table(
  "solution_collection_services",
  {
    id: serial("id").primaryKey(),
    /** FK → solution_collections.id RESTRICT */
    collectionId: integer("collection_id")
      .notNull()
      .references(() => solutionCollectionsTable.id, { onDelete: "restrict" }),
    /** FK → ai_services.id RESTRICT */
    serviceId: integer("service_id")
      .notNull()
      .references(() => aiServicesTable.id, { onDelete: "restrict" }),
    displayOrder: integer("display_order").notNull().default(0),
    /**
     * anchor        — primary/flagship service for this collection
     * complementary — strongly recommended alongside anchor
     * optional      — available as an add-on
     */
    role: text("role").notNull().default("complementary"),
    isOptional: boolean("is_optional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertSolutionCollectionServiceSchema = createInsertSchema(solutionCollectionServicesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSolutionCollectionService = z.infer<typeof insertSolutionCollectionServiceSchema>;
export type SolutionCollectionService = typeof solutionCollectionServicesTable.$inferSelect;
