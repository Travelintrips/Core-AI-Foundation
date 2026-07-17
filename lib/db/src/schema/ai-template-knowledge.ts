import { appSchema } from "./_pg-schema";
import {
  serial, text, integer, boolean, timestamp, jsonb, real, index
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Enterprise Template Knowledge Library — V5.0
//
// New tables that extend the existing ai_templates system.
// All tables are ADDITIVE — no existing tables are modified here.
// The ai_templates table gains knowledge_json / learning_stats columns via DDL.
// ─────────────────────────────────────────────────────────────────────────────

// ── Style Knowledge ───────────────────────────────────────────────────────────
// Per-style color, typography, emotion, and industry-fit knowledge.
// Used by the semantic matching engine and admin browsers.

export const aiStyleKnowledgeTable = appSchema.table(
  "ai_style_knowledge",
  {
    id: serial("id").primaryKey(),
    styleKey: text("style_key").notNull().unique(),   // e.g. "luxury", "minimalist"
    displayName: text("display_name").notNull(),
    description: text("description"),

    // Color knowledge
    colorPalette: jsonb("color_palette").$type<{
      recommended: Array<{ name: string; hex: string; role: string }>;
      forbidden: string[];             // hex values or color family names
      contrastRatio: string;           // e.g. "4.5:1 minimum"
      dominantMood: string;
    }>(),

    // Typography knowledge
    typographyPairings: jsonb("typography_pairings").$type<Array<{
      headingFont: string;
      bodyFont: string;
      accentFont?: string;
      fontMood: string;
      hierarchyRules: string;
      useCase: string;
    }>>(),

    // Brand & emotion profile
    emotions: jsonb("emotions").$type<string[]>(),
    archetypes: jsonb("archetypes").$type<string[]>(),
    personalities: jsonb("personalities").$type<string[]>(),

    // Industry suitability
    industrySuitability: jsonb("industry_suitability").$type<{
      highFit: string[];
      mediumFit: string[];
      poorFit: string[];
    }>(),

    // Visual rules
    visualRules: jsonb("visual_rules").$type<{
      spacingStyle: "compact" | "balanced" | "airy" | "generous";
      illustrationStyle: string;
      photographyStyle: string;
      iconStyle: string;
      layoutPreferences: string[];
      prohibitedPatterns: string[];
    }>(),

    // AI prompt guidance for this style
    promptGuidance: jsonb("prompt_guidance").$type<{
      artDirectionPrompt: string;
      imagePrompt: string;
      negativePrompt: string;
    }>(),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index("idx_ai_style_knowledge_key").on(t.styleKey)],
);

export type AiStyleKnowledge = typeof aiStyleKnowledgeTable.$inferSelect;
export type InsertAiStyleKnowledge = typeof aiStyleKnowledgeTable.$inferInsert;

// ── Industry Knowledge ────────────────────────────────────────────────────────
// Industry taxonomy with business types, audience personas, and design signals.

export const aiIndustryKnowledgeTable = appSchema.table(
  "ai_industry_knowledge",
  {
    id: serial("id").primaryKey(),
    industryKey: text("industry_key").notNull().unique(),  // e.g. "luxury_fashion"
    industryName: text("industry_name").notNull(),
    parentIndustry: text("parent_industry"),               // e.g. "fashion" for "luxury_fashion"
    level: integer("level").notNull().default(1),          // 1=top, 2=sub

    // Business context
    businessTypes: jsonb("business_types").$type<string[]>(),    // B2B, B2C, D2C, etc.
    marketScope: jsonb("market_scope").$type<string[]>(),         // local, national, global
    pricePositioning: jsonb("price_positioning").$type<string[]>(), // budget, premium, luxury

    // Audience
    targetAudiences: jsonb("target_audiences").$type<Array<{
      name: string;
      ageRange: string;
      gender?: string;
      income?: string;
      psychographics: string[];
    }>>(),

    // Brand signals
    preferredStyles: jsonb("preferred_styles").$type<string[]>(),
    preferredPersonalities: jsonb("preferred_personalities").$type<string[]>(),
    keywords: jsonb("keywords").$type<string[]>(),

    // Regulatory / compliance notes
    notes: text("notes"),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_ai_industry_knowledge_key").on(t.industryKey),
    index("idx_ai_industry_knowledge_parent").on(t.parentIndustry),
  ],
);

export type AiIndustryKnowledge = typeof aiIndustryKnowledgeTable.$inferSelect;
export type InsertAiIndustryKnowledge = typeof aiIndustryKnowledgeTable.$inferInsert;

// ── Section Library ───────────────────────────────────────────────────────────
// Reusable design section definitions usable across all template categories.

export const aiTemplateSectionsTable = appSchema.table(
  "ai_template_sections",
  {
    id: serial("id").primaryKey(),
    sectionKey: text("section_key").notNull().unique(), // e.g. "hero_full_bleed"
    sectionType: text("section_type").notNull(),         // hero | about | cta | etc.
    displayName: text("display_name").notNull(),
    description: text("description"),

    // What categories and styles this section suits
    suitableCategories: jsonb("suitable_categories").$type<string[]>(),
    suitableStyles: jsonb("suitable_styles").$type<string[]>(),

    // Layout specification
    layoutSpec: jsonb("layout_spec").$type<{
      gridColumns: number;
      span: string;              // full | half | two-thirds | one-third
      minHeight?: string;
      hasMedia: boolean;
      mediaPosition?: "left" | "right" | "background" | "top" | "bottom";
      textAlignment: "left" | "center" | "right";
    }>(),

    // Content slots
    contentSlots: jsonb("content_slots").$type<Array<{
      slotId: string;
      label: string;
      type: "heading" | "subheading" | "body" | "cta" | "image" | "list" | "stats" | "icon";
      required: boolean;
      maxLength?: number;
    }>>(),

    // Prompt guidance for filling this section
    promptGuidance: jsonb("prompt_guidance").$type<{
      copyPrompt: string;
      imagePrompt?: string;
      toneGuidance: string;
    }>(),

    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_ai_template_sections_type").on(t.sectionType),
    index("idx_ai_template_sections_key").on(t.sectionKey),
  ],
);

export type AiTemplateSection = typeof aiTemplateSectionsTable.$inferSelect;
export type InsertAiTemplateSection = typeof aiTemplateSectionsTable.$inferInsert;

// ── Template Knowledge Extension ──────────────────────────────────────────────
// Stores the rich knowledge payload for each ai_templates entry.
// Separate table to keep ai_templates lean; joined on demand.

export const aiTemplateKnowledgeTable = appSchema.table(
  "ai_template_knowledge",
  {
    id: serial("id").primaryKey(),
    templateCode: text("template_code").notNull().unique(), // FK-equivalent to ai_templates.template_code
    slug: text("slug").notNull().unique(),

    // Business context
    businessContext: jsonb("business_context").$type<{
      businessType: string;
      market: string;
      targetAudience: string;
      customerPersona: string;
      pricePositioning: string;
    }>(),

    // Embedded Brand DNA knowledge
    brandDna: jsonb("brand_dna").$type<{
      personalities: string[];
      emotions: string[];
      archetypes: string[];
      voice: string;
      tone: string;
      keywords: string[];
    }>(),

    // Visual DNA
    visualDna: jsonb("visual_dna").$type<{
      designStyle: string;
      layoutStyle: string;
      spacingStyle: string;
      illustrationStyle: string;
      photographyStyle: string;
      iconStyle: string;
    }>(),

    // Composition
    composition: jsonb("composition").$type<{
      heroLayout: string;
      sectionOrder: string[];
      gridSystem: string;
      whitespaceRules: string;
    }>(),

    // Output format support
    outputSupport: jsonb("output_support").$type<{
      pdf: boolean;
      pptx: boolean;
      png: boolean;
      svg: boolean;
      html: boolean;
      socialMedia: boolean;
    }>(),

    // AI prompt guidance
    promptGuidance: jsonb("prompt_guidance").$type<{
      systemPrompt: string;
      designerPrompt: string;
      artDirectionPrompt: string;
      imagePrompt: string;
      negativePrompt: string;
    }>(),

    // Quality rules
    qualityRules: jsonb("quality_rules").$type<{
      checklist: string[];
      designRules: string[];
      prohibitedPatterns: string[];
    }>(),

    // Learning / feedback stats
    learningStats: jsonb("learning_stats").$type<{
      rating: number;
      usageCount: number;
      successRate: number;
      conversionRate: number;
      revisionRate: number;
      favoriteCount: number;
      lastUsedAt: string | null;
    }>().default({
      rating: 0, usageCount: 0, successRate: 0,
      conversionRate: 0, revisionRate: 0, favoriteCount: 0, lastUsedAt: null,
    }),

    // Approval workflow
    approvalStatus: text("approval_status").notNull().default("published"),
    // draft | pending_review | approved | published | archived
    approvalNotes: text("approval_notes"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    generatedByAi: boolean("generated_by_ai").notNull().default(false),

    // Match score cache (updated when nearest match is found)
    matchScoreCache: jsonb("match_score_cache").$type<Record<string, number>>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_ai_template_knowledge_code").on(t.templateCode),
    index("idx_ai_template_knowledge_slug").on(t.slug),
    index("idx_ai_template_knowledge_status").on(t.approvalStatus),
  ],
);

export type AiTemplateKnowledge = typeof aiTemplateKnowledgeTable.$inferSelect;
export type InsertAiTemplateKnowledge = typeof aiTemplateKnowledgeTable.$inferInsert;

// ── Generated Template Queue ───────────────────────────────────────────────────
// AI-generated hybrid templates awaiting admin review.

export const aiGeneratedTemplatesTable = appSchema.table(
  "ai_generated_templates",
  {
    id: serial("id").primaryKey(),

    // Trigger context
    requestedForClientId: text("requested_for_client_id"),
    triggerMatchScore: real("trigger_match_score"),
    triggerInput: jsonb("trigger_input").$type<Record<string, unknown>>(),
    gapExplanation: text("gap_explanation"),

    // Generated knowledge
    generatedTemplateCode: text("generated_template_code").notNull().unique(),
    generatedKnowledge: jsonb("generated_knowledge").$type<Record<string, unknown>>().notNull(),

    // Approval workflow
    status: text("status").notNull().default("pending_review"),
    // pending_review | approved | rejected | published
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),

    // After approval, template_code from ai_templates
    publishedTemplateCode: text("published_template_code"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_ai_generated_templates_status").on(t.status),
    index("idx_ai_generated_templates_code").on(t.generatedTemplateCode),
  ],
);

export type AiGeneratedTemplate = typeof aiGeneratedTemplatesTable.$inferSelect;
export type InsertAiGeneratedTemplate = typeof aiGeneratedTemplatesTable.$inferInsert;
