/**
 * Team 17 — Interior Design Planning
 * Tables: id_projects, id_briefs, id_outputs
 */
import { appSchema } from "./_pg-schema";
import {
  serial, text, boolean, timestamp, jsonb, integer, numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Room types ────────────────────────────────────────────────────────────────

export const ROOM_TYPES = [
  "living_room",
  "bedroom",
  "kitchen",
  "office",
  "cafe",
  "restaurant",
  "hotel",
  "lobby",
  "booth",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

// ── Projects ──────────────────────────────────────────────────────────────────

export const idProjectsTable = appSchema.table("id_projects", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  roomType: text("room_type").notNull(),
  status: text("status").notNull().default("draft"),
  // draft | brief_submitted | analyzing | outputs_ready | revision_requested | completed
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIdProjectSchema = createInsertSchema(idProjectsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertIdProject = z.infer<typeof insertIdProjectSchema>;
export type IdProject = typeof idProjectsTable.$inferSelect;

// ── Briefs ────────────────────────────────────────────────────────────────────

export const idBriefsTable = appSchema.table("id_briefs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => idProjectsTable.id, { onDelete: "cascade" }),

  // Room geometry
  roomLengthM: numeric("room_length_m", { precision: 8, scale: 2 }).notNull(),
  roomWidthM: numeric("room_width_m", { precision: 8, scale: 2 }).notNull(),
  ceilingHeightM: numeric("ceiling_height_m", { precision: 6, scale: 2 }).notNull(),

  // Structural elements (jsonb arrays)
  doors: jsonb("doors").notNull().default([]),
  // [{ id, wall: "north"|"south"|"east"|"west", positionM: number, widthM: number, swingInward: boolean }]
  windows: jsonb("windows").notNull().default([]),
  // [{ id, wall, positionM, widthM, sillHeightM, headHeightM }]
  columns: jsonb("columns").notNull().default([]),
  // [{ id, xM, yM, widthM, depthM }]
  immutableZones: jsonb("immutable_zones").notNull().default([]),
  // [{ id, label, xM, yM, widthM, depthM, reason }]

  // Aesthetic preferences
  style: text("style").notNull(),
  // modern | minimalist | scandinavian | industrial | traditional | rustic | art_deco | japandi | tropical | mediterranean
  primaryColors: text("primary_colors").array().notNull().default([]),
  secondaryColors: text("secondary_colors").array().notNull().default([]),
  materialsPreference: jsonb("materials_preference").notNull().default({}),
  // { flooring?: string, walls?: string, ceiling?: string, cabinetry?: string, countertop?: string }

  // Functional needs
  lightingPreference: jsonb("lighting_preference").notNull().default({}),
  // { natural: "abundant"|"moderate"|"minimal", ambient: string, task: string, accent: string }
  furnitureNeeds: text("furniture_needs").array().notNull().default([]),
  budgetNotes: text("budget_notes"),   // optional — no price calculation

  // Media
  photoUrls: text("photo_urls").array().notNull().default([]),
  floorPlanUrl: text("floor_plan_url"),
  additionalNotes: text("additional_notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIdBriefSchema = createInsertSchema(idBriefsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertIdBrief = z.infer<typeof insertIdBriefSchema>;
export type IdBrief = typeof idBriefsTable.$inferSelect;

// ── Outputs ───────────────────────────────────────────────────────────────────

export const idOutputsTable = appSchema.table("id_outputs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => idProjectsTable.id, { onDelete: "cascade" }),

  // AI-generated deliverables
  moodboard: jsonb("moodboard"),
  // { palette: string[], moodWords: string[], styleDescription: string, textureDescriptions: string[], lightingMood: string }
  spacePlan: jsonb("space_plan"),
  // { zones: [{ id, label, xM, yM, widthM, depthM, purpose }], scale: string, notes: string }
  furniturePlacement: jsonb("furniture_placement"),
  // [{ item, widthM, depthM, heightM, xM, yM, rotation, clearanceFront, clearanceSide, note }]
  circulationAnalysis: text("circulation_analysis"),
  materialRecommendations: jsonb("material_recommendations"),
  // { flooring: {...}, walls: {...}, ceiling: {...}, accents: {...} }
  lightingRecommendations: jsonb("lighting_recommendations"),
  // { ambient: {...}, task: {...}, accent: {...}, natural: {...} }
  visualConcept: text("visual_concept"),
  vendorCategories: jsonb("vendor_categories"),
  // [{ category, examples, why }]

  // Validation + disclaimers
  validationResults: jsonb("validation_results"),
  // { dimensionWarnings: string[], clearanceWarnings: string[], circulationWarnings: string[], passedChecks: string[] }
  safetyDisclaimers: text("safety_disclaimers").array().notNull().default([]),

  // Meta
  aiModelUsed: text("ai_model_used"),
  generationDurationMs: integer("generation_duration_ms"),
  isLatest: boolean("is_latest").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertIdOutputSchema = createInsertSchema(idOutputsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertIdOutput = z.infer<typeof insertIdOutputSchema>;
export type IdOutput = typeof idOutputsTable.$inferSelect;
