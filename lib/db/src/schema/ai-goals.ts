import { appSchema } from "./_pg-schema";
import {
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * AI Goal Taxonomy — V4.2C
 *
 * Adds a new "Goal" abstraction layer ABOVE the existing Category → Service
 * hierarchy. Customers describe what they want to achieve (a Goal); the system
 * maps that Goal to the relevant services automatically.
 *
 * Architecture:
 *   Customer → Goal → Category → Service   (new path)
 *   Customer → Category → Service          (existing path, unchanged)
 *
 * This module is purely ADDITIVE. It does NOT modify ai_service_categories,
 * ai_services, or any existing table.
 */

// ── ai_goals ──────────────────────────────────────────────────────────────────

export const aiGoalsTable = appSchema.table("ai_goals", {
  id: serial("id").primaryKey(),

  /** URL-safe identifier — unique across all goals. */
  slug: text("slug").notNull().unique(),

  /** Human-readable name shown to customers. */
  name: text("name").notNull(),

  /** Short description of what this goal covers (1–2 sentences). */
  description: text("description"),

  /** Emoji or icon identifier for UI consumption. */
  icon: text("icon"),

  /**
   * Optional parent goal id — enables a two-level hierarchy.
   * e.g. "Launch my brand" (parent) → "Build a logo" (child)
   * A null parent_goal_id means this is a top-level goal.
   */
  parentGoalId: integer("parent_goal_id"),
  // NOTE: self-reference added via SQL migration (Drizzle can't express
  // self-referential FK in the same table definition without a circular dep).

  /**
   * Arbitrary extensible metadata: tags, search keywords, customer-facing
   * copy, AB test variants, etc.
   * Shape: { keywords?: string[]; tags?: string[]; [key: string]: unknown }
   */
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),

  /** Controls ordering in customer-facing lists. Lower = first. */
  displayOrder: integer("display_order").notNull().default(0),

  /** active | draft | archived */
  status: text("status").notNull().default("active"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiGoalSchema = createInsertSchema(aiGoalsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiGoal = z.infer<typeof insertAiGoalSchema>;
export type AiGoal = typeof aiGoalsTable.$inferSelect;

// ── ai_goal_service_mappings ──────────────────────────────────────────────────

export const aiGoalServiceMappingsTable = appSchema.table("ai_goal_service_mappings", {
  id: serial("id").primaryKey(),

  /** The goal this mapping belongs to. */
  goalId: integer("goal_id")
    .notNull()
    .references(() => aiGoalsTable.id, { onDelete: "cascade" }),

  /**
   * The service this goal recommends.
   * References ai_services.id — FK declared in SQL migration to avoid
   * circular import between schema files at Drizzle layer.
   */
  serviceId: integer("service_id").notNull(),

  /**
   * 0–100 relevance score. Used to rank services within a goal.
   * Higher = more relevant. Deterministic — set by admin, not AI.
   */
  relevanceScore: integer("relevance_score").notNull().default(50),

  /** Controls display order within the goal's service list. */
  displayOrder: integer("display_order").notNull().default(0),

  /**
   * Whether this is the PRIMARY service for the goal.
   * At most one mapping per goal should have isPrimary = true.
   * Used by UI to highlight the recommended entry point.
   */
  isPrimary: boolean("is_primary").notNull().default(false),

  /** active | disabled */
  status: text("status").notNull().default("active"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiGoalServiceMappingSchema = createInsertSchema(aiGoalServiceMappingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAiGoalServiceMapping = z.infer<typeof insertAiGoalServiceMappingSchema>;
export type AiGoalServiceMapping = typeof aiGoalServiceMappingsTable.$inferSelect;
