/**
 * Knowledge Library Service — Enterprise Template Knowledge Library V5.0
 *
 * Provides: style browsing, industry browsing, section library, knowledge hierarchy,
 * template knowledge CRUD, learning stats update.
 */

import { eq, ilike, sql, and, inArray } from "drizzle-orm";
import {
  db,
  aiStyleKnowledgeTable,
  aiIndustryKnowledgeTable,
  aiTemplateSectionsTable,
  aiTemplateKnowledgeTable,
  aiTemplatesTable,
  aiGeneratedTemplatesTable,
} from "@workspace/db";
import type {
  AiStyleKnowledge,
  AiIndustryKnowledge,
  AiTemplateSection,
  AiTemplateKnowledge,
  InsertAiStyleKnowledge,
  InsertAiIndustryKnowledge,
  InsertAiTemplateSection,
  InsertAiTemplateKnowledge,
  InsertAiGeneratedTemplate,
} from "@workspace/db";

// ─────────────────────────────────────────────────────────────────────────────
// Style Knowledge
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllStyles(): Promise<AiStyleKnowledge[]> {
  return db.select().from(aiStyleKnowledgeTable).orderBy(aiStyleKnowledgeTable.sortOrder);
}

export async function getStyleByKey(styleKey: string): Promise<AiStyleKnowledge | null> {
  const rows = await db
    .select()
    .from(aiStyleKnowledgeTable)
    .where(eq(aiStyleKnowledgeTable.styleKey, styleKey))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertStyle(data: InsertAiStyleKnowledge): Promise<AiStyleKnowledge> {
  const rows = await db
    .insert(aiStyleKnowledgeTable)
    .values(data)
    .onConflictDoUpdate({
      target: aiStyleKnowledgeTable.styleKey,
      set: {
        displayName: data.displayName,
        description: data.description,
        colorPalette: data.colorPalette,
        typographyPairings: data.typographyPairings,
        emotions: data.emotions,
        archetypes: data.archetypes,
        personalities: data.personalities,
        industrySuitability: data.industrySuitability,
        visualRules: data.visualRules,
        promptGuidance: data.promptGuidance,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}

export async function searchStylesByEmotion(emotions: string[]): Promise<AiStyleKnowledge[]> {
  // JSONB array contains any of the given emotions
  return db
    .select()
    .from(aiStyleKnowledgeTable)
    .where(
      sql`${aiStyleKnowledgeTable.emotions} ?| array[${sql.join(
        emotions.map((e) => sql`${e}`),
        sql`, `,
      )}]`,
    )
    .orderBy(aiStyleKnowledgeTable.sortOrder);
}

export async function getStylesForIndustry(industryKey: string): Promise<AiStyleKnowledge[]> {
  return db
    .select()
    .from(aiStyleKnowledgeTable)
    .where(
      sql`${aiStyleKnowledgeTable.industrySuitability}->'highFit' ? ${industryKey}`,
    )
    .orderBy(aiStyleKnowledgeTable.sortOrder);
}

// ─────────────────────────────────────────────────────────────────────────────
// Industry Knowledge
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllIndustries(): Promise<AiIndustryKnowledge[]> {
  return db.select().from(aiIndustryKnowledgeTable).orderBy(aiIndustryKnowledgeTable.sortOrder);
}

export async function getTopLevelIndustries(): Promise<AiIndustryKnowledge[]> {
  return db
    .select()
    .from(aiIndustryKnowledgeTable)
    .where(eq(aiIndustryKnowledgeTable.level, 1))
    .orderBy(aiIndustryKnowledgeTable.sortOrder);
}

export async function getSubIndustries(parentKey: string): Promise<AiIndustryKnowledge[]> {
  return db
    .select()
    .from(aiIndustryKnowledgeTable)
    .where(eq(aiIndustryKnowledgeTable.parentIndustry, parentKey))
    .orderBy(aiIndustryKnowledgeTable.sortOrder);
}

export async function getIndustryByKey(key: string): Promise<AiIndustryKnowledge | null> {
  const rows = await db
    .select()
    .from(aiIndustryKnowledgeTable)
    .where(eq(aiIndustryKnowledgeTable.industryKey, key))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertIndustry(data: InsertAiIndustryKnowledge): Promise<AiIndustryKnowledge> {
  const rows = await db
    .insert(aiIndustryKnowledgeTable)
    .values(data)
    .onConflictDoUpdate({
      target: aiIndustryKnowledgeTable.industryKey,
      set: {
        industryName: data.industryName,
        businessTypes: data.businessTypes,
        marketScope: data.marketScope,
        pricePositioning: data.pricePositioning,
        targetAudiences: data.targetAudiences,
        preferredStyles: data.preferredStyles,
        preferredPersonalities: data.preferredPersonalities,
        keywords: data.keywords,
      },
    })
    .returning();
  return rows[0]!;
}

/** Build a hierarchical tree: level-1 → sub-industries */
export async function getIndustryHierarchy(): Promise<Array<AiIndustryKnowledge & { children: AiIndustryKnowledge[] }>> {
  const all = await getAllIndustries();
  const top = all.filter((i) => i.level === 1);
  return top.map((parent) => ({
    ...parent,
    children: all.filter((c) => c.parentIndustry === parent.industryKey),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Section Library
// ─────────────────────────────────────────────────────────────────────────────

export async function getAllSections(): Promise<AiTemplateSection[]> {
  return db
    .select()
    .from(aiTemplateSectionsTable)
    .orderBy(aiTemplateSectionsTable.sortOrder);
}

export async function getSectionsByType(sectionType: string): Promise<AiTemplateSection[]> {
  return db
    .select()
    .from(aiTemplateSectionsTable)
    .where(eq(aiTemplateSectionsTable.sectionType, sectionType))
    .orderBy(aiTemplateSectionsTable.sortOrder);
}

export async function getSectionsForCategory(category: string): Promise<AiTemplateSection[]> {
  return db
    .select()
    .from(aiTemplateSectionsTable)
    .where(
      sql`${aiTemplateSectionsTable.suitableCategories} ? ${category}`,
    )
    .orderBy(aiTemplateSectionsTable.sortOrder);
}

export async function upsertSection(data: InsertAiTemplateSection): Promise<AiTemplateSection> {
  const rows = await db
    .insert(aiTemplateSectionsTable)
    .values(data)
    .onConflictDoUpdate({
      target: aiTemplateSectionsTable.sectionKey,
      set: {
        displayName: data.displayName,
        description: data.description,
        suitableCategories: data.suitableCategories,
        suitableStyles: data.suitableStyles,
        layoutSpec: data.layoutSpec,
        contentSlots: data.contentSlots,
        promptGuidance: data.promptGuidance,
      },
    })
    .returning();
  return rows[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Knowledge
// ─────────────────────────────────────────────────────────────────────────────

export interface TemplateWithKnowledge {
  template: typeof aiTemplatesTable.$inferSelect;
  knowledge: AiTemplateKnowledge | null;
}

export async function getTemplateWithKnowledge(templateCode: string): Promise<TemplateWithKnowledge | null> {
  const [template, knowledge] = await Promise.all([
    db
      .select()
      .from(aiTemplatesTable)
      .where(eq(aiTemplatesTable.templateCode, templateCode))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select()
      .from(aiTemplateKnowledgeTable)
      .where(eq(aiTemplateKnowledgeTable.templateCode, templateCode))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);
  if (!template) return null;
  return { template, knowledge };
}

export async function upsertTemplateKnowledge(data: InsertAiTemplateKnowledge): Promise<AiTemplateKnowledge> {
  const rows = await db
    .insert(aiTemplateKnowledgeTable)
    .values(data)
    .onConflictDoUpdate({
      target: aiTemplateKnowledgeTable.templateCode,
      set: {
        businessContext: data.businessContext,
        brandDna: data.brandDna,
        visualDna: data.visualDna,
        composition: data.composition,
        outputSupport: data.outputSupport,
        promptGuidance: data.promptGuidance,
        qualityRules: data.qualityRules,
        approvalStatus: data.approvalStatus,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}

export async function updateApprovalStatus(
  templateCode: string,
  status: string,
  reviewedBy: string,
  notes?: string,
): Promise<void> {
  await db
    .update(aiTemplateKnowledgeTable)
    .set({
      approvalStatus: status,
      approvedBy: reviewedBy,
      approvedAt: new Date(),
      approvalNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(aiTemplateKnowledgeTable.templateCode, templateCode));
}

export async function updateLearningStats(
  templateCode: string,
  event: "usage" | "success" | "revision" | "favorite" | "conversion",
): Promise<void> {
  // Read current stats, update in place
  const rows = await db
    .select({ learningStats: aiTemplateKnowledgeTable.learningStats })
    .from(aiTemplateKnowledgeTable)
    .where(eq(aiTemplateKnowledgeTable.templateCode, templateCode))
    .limit(1);
  if (!rows[0]) return;

  const stats = (rows[0].learningStats as Record<string, number | string | null>) ?? {
    rating: 0, usageCount: 0, successRate: 0, conversionRate: 0, revisionRate: 0, favoriteCount: 0, lastUsedAt: null,
  };

  const usageCount = (Number(stats.usageCount) || 0) + (event === "usage" ? 1 : 0);

  const updated: {
    rating: number;
    usageCount: number;
    successRate: number;
    conversionRate: number;
    revisionRate: number;
    favoriteCount: number;
    lastUsedAt: string | null;
  } = {
    rating: Number(stats.rating) || 0,
    usageCount,
    lastUsedAt: new Date().toISOString(),
    favoriteCount: (Number(stats.favoriteCount) || 0) + (event === "favorite" ? 1 : 0),
    // running averages — updated as events come in
    successRate: event === "success"
      ? Math.min(1, ((Number(stats.successRate) || 0) * 0.95 + 0.05))
      : Number(stats.successRate) || 0,
    revisionRate: event === "revision"
      ? Math.min(1, ((Number(stats.revisionRate) || 0) * 0.95 + 0.05))
      : Number(stats.revisionRate) || 0,
    conversionRate: event === "conversion"
      ? Math.min(1, ((Number(stats.conversionRate) || 0) * 0.95 + 0.05))
      : Number(stats.conversionRate) || 0,
  };

  await db
    .update(aiTemplateKnowledgeTable)
    .set({ learningStats: updated, updatedAt: new Date() })
    .where(eq(aiTemplateKnowledgeTable.templateCode, templateCode));
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Queue
// ─────────────────────────────────────────────────────────────────────────────

export async function getApprovalQueue(status = "pending_review") {
  return db
    .select()
    .from(aiGeneratedTemplatesTable)
    .where(eq(aiGeneratedTemplatesTable.status, status))
    .orderBy(aiGeneratedTemplatesTable.createdAt);
}

export async function reviewGeneratedTemplate(
  id: number,
  decision: "approved" | "rejected",
  reviewedBy: string,
  notes?: string,
): Promise<void> {
  await db
    .update(aiGeneratedTemplatesTable)
    .set({
      status: decision,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes,
      updatedAt: new Date(),
    })
    .where(eq(aiGeneratedTemplatesTable.id, id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics / Dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

export interface LibraryStats {
  totalTemplates: number;
  publishedTemplates: number;
  pendingReview: number;
  totalStyles: number;
  totalIndustries: number;
  totalSections: number;
  categoryCounts: Record<string, number>;
  styleDistribution: Record<string, number>;
}

export async function getLibraryStats(): Promise<LibraryStats> {
  const [
    totalTemplatesResult,
    publishedResult,
    pendingResult,
    stylesResult,
    industriesResult,
    sectionsResult,
    categoryCountResult,
    styleDistResult,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(aiTemplatesTable),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiTemplatesTable)
      .where(eq(aiTemplatesTable.status, "published")),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiGeneratedTemplatesTable)
      .where(eq(aiGeneratedTemplatesTable.status, "pending_review")),
    db.select({ count: sql<number>`count(*)::int` }).from(aiStyleKnowledgeTable),
    db.select({ count: sql<number>`count(*)::int` }).from(aiIndustryKnowledgeTable),
    db.select({ count: sql<number>`count(*)::int` }).from(aiTemplateSectionsTable),
    db
      .select({
        category: aiTemplatesTable.category,
        count: sql<number>`count(*)::int`,
      })
      .from(aiTemplatesTable)
      .groupBy(aiTemplatesTable.category),
    db
      .select({
        style: aiTemplatesTable.style,
        count: sql<number>`count(*)::int`,
      })
      .from(aiTemplatesTable)
      .groupBy(aiTemplatesTable.style),
  ]);

  return {
    totalTemplates: totalTemplatesResult[0]?.count ?? 0,
    publishedTemplates: publishedResult[0]?.count ?? 0,
    pendingReview: pendingResult[0]?.count ?? 0,
    totalStyles: stylesResult[0]?.count ?? 0,
    totalIndustries: industriesResult[0]?.count ?? 0,
    totalSections: sectionsResult[0]?.count ?? 0,
    categoryCounts: Object.fromEntries(categoryCountResult.map((r) => [r.category, r.count])),
    styleDistribution: Object.fromEntries(styleDistResult.map((r) => [r.style, r.count])),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-dimensional Search
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchParams {
  keyword?: string;
  industry?: string;
  style?: string;
  category?: string;
  personalities?: string[];
  audience?: string;
  approvalStatus?: string;
  limit?: number;
  offset?: number;
}

export async function searchTemplateKnowledge(params: SearchParams) {
  const {
    keyword, industry, style, category,
    personalities, approvalStatus = "published",
    limit = 20, offset = 0,
  } = params;

  const conditions = [eq(aiTemplatesTable.status, "published")];

  if (industry) conditions.push(eq(aiTemplatesTable.industry, industry));
  if (style) conditions.push(eq(aiTemplatesTable.style, style));
  if (category) conditions.push(eq(aiTemplatesTable.category, category));
  if (keyword) {
    conditions.push(
      sql`(${aiTemplatesTable.name} ILIKE ${"%" + keyword + "%"} OR ${aiTemplatesTable.description} ILIKE ${"%" + keyword + "%"})`,
    );
  }
  if (personalities && personalities.length > 0) {
    conditions.push(
      sql`${aiTemplatesTable.brandDnaTags}->'personalities' ?| array[${sql.join(
        personalities.map((p) => sql`${p}`),
        sql`, `,
      )}]`,
    );
  }

  const [results, totalResult] = await Promise.all([
    db
      .select()
      .from(aiTemplatesTable)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(aiTemplatesTable.sortOrder),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiTemplatesTable)
      .where(and(...conditions)),
  ]);

  return {
    results,
    total: totalResult[0]?.count ?? 0,
    limit,
    offset,
    hasMore: offset + results.length < (totalResult[0]?.count ?? 0),
  };
}
