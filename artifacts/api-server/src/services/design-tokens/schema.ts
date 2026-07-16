// Team 10 — Local Drizzle table definitions (NOT added to @workspace/db barrel)
// These tables are created via integration/migrations/team-10.sql.

import { pgSchema } from "drizzle-orm/pg-core";
import {
  serial,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";

const appSchema = pgSchema("ai_platform");

// ── Font Pairs ────────────────────────────────────────────────────────────────

export const dtFontPairsTable = appSchema.table("dt_font_pairs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  displayFont: text("display_font").notNull(),
  bodyFont: text("body_font").notNull(),
  accentFont: text("accent_font"),
  category: text("category").notNull().default("sans-serif"),
  mood: jsonb("mood").notNull().default([]),          // FontMood[]
  industries: jsonb("industries").notNull().default([]), // Industry[]
  displayFontWeight: text("display_font_weight").notNull().default("700"),
  bodyFontWeight: text("body_font_weight").notNull().default("400"),
  license: text("license").notNull().default("open"),
  pairingRationale: text("pairing_rationale"),
  sampleHeading: text("sample_heading").notNull().default("The quick brown fox"),
  sampleBody: text("sample_body").notNull().default("Typography is the art of arranging type to make written language legible, readable, and appealing."),
  googleFontsUrl: text("google_fonts_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Typography Roles ──────────────────────────────────────────────────────────

export const dtTypographyRolesTable = appSchema.table("dt_typography_roles", {
  id: serial("id").primaryKey(),
  pairId: integer("pair_id").notNull().references(() => dtFontPairsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                         // TypographyRoleName
  fontFamily: text("font_family").notNull(),
  fontSize: numeric("font_size", { precision: 6, scale: 2 }).notNull(),
  fontWeight: text("font_weight").notNull().default("400"),
  lineHeight: numeric("line_height", { precision: 5, scale: 2 }).notNull().default("1.5"),
  letterSpacing: numeric("letter_spacing", { precision: 6, scale: 3 }).notNull().default("0"),
  textTransform: text("text_transform"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Color Palettes ────────────────────────────────────────────────────────────

export const dtColorPalettesTable = appSchema.table("dt_color_palettes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  style: text("style").notNull().default("custom"),     // PaletteStyle
  mood: jsonb("mood").notNull().default([]),
  industries: jsonb("industries").notNull().default([]),
  colors: jsonb("colors").notNull().default([]),         // string[] hex codes
  printSafe: boolean("print_safe").notNull().default(false),
  accessible: boolean("accessible").notNull().default(false),
  wcagLevel: text("wcag_level").notNull().default("fail"), // WcagLevel
  tags: jsonb("tags").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Semantic Color Roles ──────────────────────────────────────────────────────

export const dtSemanticColorRolesTable = appSchema.table("dt_semantic_color_roles", {
  id: serial("id").primaryKey(),
  paletteId: integer("palette_id").notNull().references(() => dtColorPalettesTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),                          // SemanticColorRole
  hexColor: text("hex_color").notNull(),
  hslColor: text("hsl_color").notNull(),
  rgbColor: text("rgb_color").notNull(),
  cmykColor: text("cmyk_color"),
  printSafeHex: text("print_safe_hex"),
  contrastOnWhite: numeric("contrast_on_white", { precision: 5, scale: 2 }).notNull().default("1"),
  contrastOnBlack: numeric("contrast_on_black", { precision: 5, scale: 2 }).notNull().default("1"),
  wcagAAOnWhite: boolean("wcag_aa_on_white").notNull().default(false),
  wcagAAOnBlack: boolean("wcag_aa_on_black").notNull().default(false),
  wcagAAAOnWhite: boolean("wcag_aaa_on_white").notNull().default(false),
  wcagAAAOnBlack: boolean("wcag_aaa_on_black").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
