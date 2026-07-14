/**
 * templateService — Template Library management for V4.3.
 *
 * Handles: CRUD, gallery filtering, marketplace operations, seeding,
 * live customization preview generation, and template evolution stats.
 * Rule-based — no external AI calls.
 */

import { eq, and, or, desc, asc, ilike, sql, inArray } from "drizzle-orm";
import { db, aiTemplatesTable, aiTemplateAnalyticsTable } from "@workspace/db";
import type { AiTemplate } from "@workspace/db";

// ── Template Gallery / Filtering ──────────────────────────────────────────────

export interface GalleryFilter {
  category?: string;
  industry?: string;
  style?: string;
  status?: string;
  isPremium?: boolean;
  featured?: boolean;
  sortBy?: "popular" | "newest" | "conversions" | "selections";
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listTemplates(filter: GalleryFilter = {}) {
  const {
    category, industry, style, status = "published", isPremium,
    featured, sortBy = "popular", search, limit = 24, offset = 0,
  } = filter;

  const conditions: ReturnType<typeof eq>[] = [
    eq(aiTemplatesTable.status, status),
  ];

  if (category) conditions.push(eq(aiTemplatesTable.category, category));
  if (industry) {
    // null industry = cross-industry (matches all)
    conditions.push(
      or(
        eq(aiTemplatesTable.industry, industry),
        sql`${aiTemplatesTable.industry} IS NULL`,
      ) as ReturnType<typeof eq>,
    );
  }
  if (style) conditions.push(eq(aiTemplatesTable.style, style));
  if (typeof isPremium === "boolean") conditions.push(eq(aiTemplatesTable.isPremium, isPremium));
  if (featured) conditions.push(eq(aiTemplatesTable.featured, featured));
  if (search) {
    conditions.push(
      or(
        ilike(aiTemplatesTable.name, `%${search}%`),
        ilike(aiTemplatesTable.description, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const orderCol =
    sortBy === "newest" ? desc(aiTemplatesTable.createdAt) :
    sortBy === "conversions" ? desc(aiTemplatesTable.conversions) :
    sortBy === "selections" ? desc(aiTemplatesTable.selections) :
    desc(aiTemplatesTable.views);

  const items = await db
    .select()
    .from(aiTemplatesTable)
    .where(and(...conditions))
    .orderBy(orderCol)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiTemplatesTable)
    .where(and(...conditions));

  return { items, total: count ?? 0 };
}

export async function getTemplate(id: number): Promise<AiTemplate | null> {
  const [row] = await db.select().from(aiTemplatesTable).where(eq(aiTemplatesTable.id, id)).limit(1);
  return row ?? null;
}

export async function getTemplateByCode(code: string): Promise<AiTemplate | null> {
  const [row] = await db.select().from(aiTemplatesTable).where(eq(aiTemplatesTable.templateCode, code)).limit(1);
  return row ?? null;
}

// ── Admin CRUD ────────────────────────────────────────────────────────────────

export async function createTemplate(data: typeof aiTemplatesTable.$inferInsert): Promise<AiTemplate> {
  const [row] = await db.insert(aiTemplatesTable).values(data).returning();
  return row;
}

export async function updateTemplate(id: number, data: Partial<typeof aiTemplatesTable.$inferInsert>): Promise<AiTemplate | null> {
  const [row] = await db
    .update(aiTemplatesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiTemplatesTable.id, id))
    .returning();
  return row ?? null;
}

export async function archiveTemplate(id: number): Promise<void> {
  await db.update(aiTemplatesTable).set({ status: "archived", updatedAt: new Date() }).where(eq(aiTemplatesTable.id, id));
}

export async function publishTemplate(id: number): Promise<void> {
  await db.update(aiTemplatesTable).set({ status: "published", updatedAt: new Date() }).where(eq(aiTemplatesTable.id, id));
}

// ── View / Event tracking ─────────────────────────────────────────────────────

export type TemplateEventType = "view" | "selected" | "preview_generated" | "portfolio_viewed" | "conversion" | "favorited";

export async function recordTemplateEvent(
  templateId: number,
  eventType: TemplateEventType,
  opts: { clientId?: string; sessionId?: string; metadata?: Record<string, unknown> } = {},
) {
  // Fire-and-forget insert into analytics log
  await db.insert(aiTemplateAnalyticsTable).values({
    templateId,
    eventType,
    clientId: opts.clientId,
    sessionId: opts.sessionId,
    metadata: opts.metadata ?? {},
  });

  // Update denormalized counter on template row
  if (eventType === "view") {
    await db
      .update(aiTemplatesTable)
      .set({ views: sql`${aiTemplatesTable.views} + 1` })
      .where(eq(aiTemplatesTable.id, templateId));
  } else if (eventType === "selected") {
    await db
      .update(aiTemplatesTable)
      .set({ selections: sql`${aiTemplatesTable.selections} + 1` })
      .where(eq(aiTemplatesTable.id, templateId));
  } else if (eventType === "preview_generated") {
    await db
      .update(aiTemplatesTable)
      .set({ previewsGenerated: sql`${aiTemplatesTable.previewsGenerated} + 1` })
      .where(eq(aiTemplatesTable.id, templateId));
  } else if (eventType === "conversion") {
    await db
      .update(aiTemplatesTable)
      .set({ conversions: sql`${aiTemplatesTable.conversions} + 1` })
      .where(eq(aiTemplatesTable.id, templateId));
  }
}

// ── Live Customization Preview ────────────────────────────────────────────────

export interface LivePreviewInput {
  templateId: number;
  companyName: string;
  brandColor: string;
  logoUrl?: string;
  industry?: string;
}

export interface LivePreviewResult {
  templateId: number;
  templateName: string;
  companyName: string;
  brandColor: string;
  logoUrl: string | null;
  // SVG-based instant preview concept
  previewConcept: {
    headerBg: string;
    headerText: string;
    accentColor: string;
    fontPairing: string;
    layoutType: string;
    mockSections: Array<{ type: string; content: string; color: string }>;
  };
  generatedAt: string;
}

function deriveAccentColor(primary: string): string {
  // Simple luminance inversion for contrast
  const hex = primary.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1A1A2E" : "#F8F9FA";
}

function getLayoutMockSections(category: string, companyName: string, color: string) {
  const sections: Array<{ type: string; content: string; color: string }> = [];
  switch (category) {
    case "Company Profile":
    case "Corporate Profile":
      sections.push(
        { type: "hero", content: `${companyName} — Excellence in Every Detail`, color },
        { type: "about", content: "About Us", color: "#64748B" },
        { type: "services", content: "Our Services", color: "#64748B" },
        { type: "contact", content: "Get in Touch", color },
      );
      break;
    case "Pitch Deck":
      sections.push(
        { type: "cover", content: `${companyName} — Investor Presentation`, color },
        { type: "problem", content: "The Problem We Solve", color: "#64748B" },
        { type: "solution", content: "Our Solution", color },
        { type: "traction", content: "Traction & Metrics", color: "#64748B" },
      );
      break;
    case "Social Media":
      sections.push(
        { type: "post", content: `${companyName}`, color },
        { type: "story", content: "Story Format", color: "#64748B" },
        { type: "banner", content: "Promotional Banner", color },
      );
      break;
    default:
      sections.push(
        { type: "header", content: companyName, color },
        { type: "body", content: "Professional Content Section", color: "#64748B" },
        { type: "footer", content: "Contact & CTA", color },
      );
  }
  return sections;
}

export async function generateLivePreview(input: LivePreviewInput): Promise<LivePreviewResult> {
  const template = await getTemplate(input.templateId);
  if (!template) throw new Error(`Template ${input.templateId} not found`);

  const brandColor = input.brandColor.startsWith("#") ? input.brandColor : `#${input.brandColor}`;
  const accentColor = deriveAccentColor(brandColor);

  const fontPairing =
    template.typography?.heading && template.typography?.body
      ? `${template.typography.heading} / ${template.typography.body}`
      : template.style === "Modern" ? "Plus Jakarta Sans / Inter"
      : template.style === "Classic" ? "Georgia / Times New Roman"
      : template.style === "Minimalist" ? "DM Sans / DM Sans"
      : template.style === "Bold" ? "Bebas Neue / Roboto"
      : "Poppins / Open Sans";

  await recordTemplateEvent(input.templateId, "preview_generated");

  return {
    templateId: input.templateId,
    templateName: template.name,
    companyName: input.companyName,
    brandColor,
    logoUrl: input.logoUrl ?? null,
    previewConcept: {
      headerBg: brandColor,
      headerText: accentColor,
      accentColor,
      fontPairing,
      layoutType: template.layout ?? "single-column",
      mockSections: getLayoutMockSections(template.category, input.companyName, brandColor),
    },
    generatedAt: new Date().toISOString(),
  };
}

// ── Analytics & Evolution ─────────────────────────────────────────────────────

export async function getTemplateAnalyticsStats() {
  const [viewStats] = await db
    .select({
      totalViews: sql<number>`sum(views)::int`,
      totalSelections: sql<number>`sum(selections)::int`,
      totalPreviews: sql<number>`sum(previews_generated)::int`,
      totalConversions: sql<number>`sum(conversions)::int`,
      templateCount: sql<number>`count(*)::int`,
    })
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"));

  const topByViews = await db
    .select({ id: aiTemplatesTable.id, name: aiTemplatesTable.name, views: aiTemplatesTable.views, category: aiTemplatesTable.category })
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"))
    .orderBy(desc(aiTemplatesTable.views))
    .limit(5);

  const topByConversions = await db
    .select({ id: aiTemplatesTable.id, name: aiTemplatesTable.name, conversions: aiTemplatesTable.conversions, category: aiTemplatesTable.category })
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"))
    .orderBy(desc(aiTemplatesTable.conversions))
    .limit(5);

  // Category distribution
  const byCategory = await db
    .select({
      category: aiTemplatesTable.category,
      count: sql<number>`count(*)::int`,
      totalViews: sql<number>`sum(views)::int`,
    })
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"))
    .groupBy(aiTemplatesTable.category)
    .orderBy(desc(sql`sum(views)`));

  // Style popularity
  const byStyle = await db
    .select({
      style: aiTemplatesTable.style,
      count: sql<number>`count(*)::int`,
      totalSelections: sql<number>`sum(selections)::int`,
    })
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"))
    .groupBy(aiTemplatesTable.style)
    .orderBy(desc(sql`sum(selections)`));

  return {
    summary: viewStats,
    topByViews,
    topByConversions,
    byCategory,
    byStyle,
  };
}

export async function getTemplateEvolutionRecommendations() {
  // Find templates with high views but low conversions (need improvement)
  const underperforming = await db
    .select()
    .from(aiTemplatesTable)
    .where(and(
      eq(aiTemplatesTable.status, "published"),
      sql`${aiTemplatesTable.views} > 20`,
      sql`${aiTemplatesTable.conversions} = 0`,
    ))
    .orderBy(desc(aiTemplatesTable.views))
    .limit(5);

  // Find high-revision templates (frequent preview generation but low conversion)
  const needsRevision = await db
    .select()
    .from(aiTemplatesTable)
    .where(and(
      eq(aiTemplatesTable.status, "published"),
      sql`${aiTemplatesTable.previewsGenerated} > 5`,
      sql`${aiTemplatesTable.conversions} < 2`,
    ))
    .orderBy(desc(aiTemplatesTable.previewsGenerated))
    .limit(5);

  // Find top converters (replicate their traits)
  const topConverters = await db
    .select()
    .from(aiTemplatesTable)
    .where(eq(aiTemplatesTable.status, "published"))
    .orderBy(desc(aiTemplatesTable.conversions))
    .limit(5);

  return {
    underperforming: underperforming.map((t) => ({
      id: t.id, name: t.name, category: t.category, style: t.style,
      views: t.views, conversions: t.conversions,
      recommendation: "High views but zero conversions — consider updating preview images or description",
    })),
    needsRevision: needsRevision.map((t) => ({
      id: t.id, name: t.name, category: t.category, style: t.style,
      previewsGenerated: t.previewsGenerated, conversions: t.conversions,
      recommendation: "Many previews generated but low conversion — investigate pricing or CTA clarity",
    })),
    topConverters: topConverters.map((t) => ({
      id: t.id, name: t.name, category: t.category, style: t.style,
      conversions: t.conversions, views: t.views,
      recommendation: "High converter — consider creating variants in similar style",
    })),
  };
}

// ── Industry Showcase ─────────────────────────────────────────────────────────

export async function getIndustryShowcase() {
  const INDUSTRIES = [
    "Trading", "Healthcare", "Manufacturing", "Export", "Construction",
    "Technology", "Logistics", "F&B", "Education", "Property",
    "Legal", "Finance", "Retail",
  ];

  const results: Array<{ industry: string; topTemplate: AiTemplate | null; totalTemplates: number }> = [];

  for (const industry of INDUSTRIES) {
    const [top] = await db
      .select()
      .from(aiTemplatesTable)
      .where(and(
        eq(aiTemplatesTable.status, "published"),
        or(
          eq(aiTemplatesTable.industry, industry),
          sql`${aiTemplatesTable.industry} IS NULL`,
        ) as ReturnType<typeof eq>,
      ))
      .orderBy(desc(aiTemplatesTable.views), desc(aiTemplatesTable.featured))
      .limit(1);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiTemplatesTable)
      .where(and(
        eq(aiTemplatesTable.status, "published"),
        or(
          eq(aiTemplatesTable.industry, industry),
          sql`${aiTemplatesTable.industry} IS NULL`,
        ) as ReturnType<typeof eq>,
      ));

    results.push({ industry, topTemplate: top ?? null, totalTemplates: count ?? 0 });
  }

  return results;
}
