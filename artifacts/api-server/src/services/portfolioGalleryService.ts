/**
 * portfolioGalleryService.ts — V4.3 Portfolio Gallery & Live Preview (Team 1)
 *
 * Purely additive. Reuses the existing Portfolio Generator
 * (`ai_service_portfolios`), Brand DNA (`creativeBrandIntelligenceService`),
 * and AI Event Bus. Adds only: free-text search, industry showcase,
 * compare, favorites, and gallery-specific analytics.
 *
 * Never touches: Queue, Dispatcher, Payment, Commercial Layer, Review
 * Engine, Asset Library, Brand Kit, Creative Runtime, Design Studio,
 * Marketplace, or any existing portfolio/template route or table.
 */
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  aiServicePortfoliosTable,
  aiPortfolioFavoritesTable,
  aiEventsTable,
  type AiServicePortfolio,
} from "@workspace/db";
import { getPortfolioRecommendations } from "./portfolioRecommendationService.js";
import { getBrandDNA } from "./creativeBrandIntelligenceService.js";
import { publishSafe } from "./aiEventBusService.js";

const PUBLIC_GUARD = [
  eq(aiServicePortfoliosTable.status, "published"),
  sql`${aiServicePortfoliosTable.coverImage} IS NOT NULL`,
  sql`${aiServicePortfoliosTable.coverImage} NOT LIKE '%replicate.delivery%'`,
  sql`(NOT COALESCE(${aiServicePortfoliosTable.isDemo}, false) OR (COALESCE(${aiServicePortfoliosTable.qcScore}::numeric, 0) >= 80 AND ${aiServicePortfoliosTable.trademarkRisk} = 'low'))`,
];

function toGalleryCard(p: AiServicePortfolio) {
  const ext = p as Record<string, unknown>;
  return {
    id: p.id,
    serviceId: p.serviceId,
    slug: ext["slug"] ?? null,
    title: p.title,
    shortDescription: ext["shortDescription"] ?? p.description ?? null,
    industry: p.industry,
    style: p.style,
    coverImage: p.coverImage,
    rating: p.rating,
    views: p.views,
    featured: p.featured,
    packageLabel: p.packageLabel,
    deliveryTime: p.deliveryTime,
  };
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface PortfolioSearchInput {
  q?: string;
  industry?: string;
  style?: string;
  page?: number;
  pageSize?: number;
}

export async function searchPortfolios(input: PortfolioSearchInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions = [...PUBLIC_GUARD];
  if (input.industry) conditions.push(eq(aiServicePortfoliosTable.industry, input.industry));
  if (input.style) conditions.push(eq(aiServicePortfoliosTable.style, input.style));

  const q = (input.q ?? "").trim();
  if (q) {
    const like = `%${q.toLowerCase()}%`;
    conditions.push(sql`(
      LOWER(${aiServicePortfoliosTable.title}) LIKE ${like}
      OR LOWER(COALESCE(${aiServicePortfoliosTable.shortDescription}, '')) LIKE ${like}
      OR LOWER(COALESCE(${aiServicePortfoliosTable.description}, '')) LIKE ${like}
      OR LOWER(${aiServicePortfoliosTable.industry}) LIKE ${like}
      OR LOWER(${aiServicePortfoliosTable.style}) LIKE ${like}
      OR LOWER(COALESCE(${aiServicePortfoliosTable.businessType}, '')) LIKE ${like}
    )`);
  }

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiServicePortfoliosTable)
    .where(whereClause);
  const total = countRow?.n ?? 0;

  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(whereClause)
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(aiServicePortfoliosTable.views))
    .limit(pageSize)
    .offset(offset);

  if (q) {
    publishSafe({
      eventType: "portfolio_gallery.searched",
      sourceModule: "portfolio-gallery",
      sourceId: q,
      payload: { q, industry: input.industry ?? null, style: input.style ?? null, resultCount: total },
    });
  }

  return {
    items: rows.map(toGalleryCard),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

// ── Industry Showcase ─────────────────────────────────────────────────────────

export interface IndustryShowcaseItem {
  industry: string;
  totalPortfolios: number;
  topPortfolio: ReturnType<typeof toGalleryCard> | null;
}

export async function getIndustryShowcase(): Promise<{ items: IndustryShowcaseItem[] }> {
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD))
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(aiServicePortfoliosTable.views));

  const byIndustry = new Map<string, AiServicePortfolio[]>();
  for (const row of rows) {
    const list = byIndustry.get(row.industry) ?? [];
    list.push(row);
    byIndustry.set(row.industry, list);
  }

  const items: IndustryShowcaseItem[] = [...byIndustry.entries()]
    .map(([industry, list]) => ({
      industry,
      totalPortfolios: list.length,
      topPortfolio: list[0] ? toGalleryCard(list[0]) : null,
    }))
    .sort((a, b) => b.totalPortfolios - a.totalPortfolios);

  return { items };
}

// ── Public Showcase bundle ─────────────────────────────────────────────────────

export async function getPublicShowcase() {
  const [featuredRows, industries] = await Promise.all([
    db
      .select()
      .from(aiServicePortfoliosTable)
      .where(and(...PUBLIC_GUARD, eq(aiServicePortfoliosTable.featured, true)))
      .orderBy(desc(aiServicePortfoliosTable.views))
      .limit(8),
    getIndustryShowcase(),
  ]);

  return {
    featured: featuredRows.map(toGalleryCard),
    industries: industries.items.slice(0, 8),
  };
}

// ── Compare ───────────────────────────────────────────────────────────────────

export async function comparePortfolios(ids: number[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 4); // cap at 4 for a readable comparison
  if (uniqueIds.length < 2) {
    throw new Error("At least 2 distinct portfolio ids are required to compare");
  }

  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, inArray(aiServicePortfoliosTable.id, uniqueIds)));

  publishSafe({
    eventType: "portfolio_gallery.compared",
    sourceModule: "portfolio-gallery",
    sourceId: uniqueIds.join(","),
    payload: { portfolioIds: uniqueIds },
  });

  return {
    items: rows.map((p) => ({
      ...toGalleryCard(p),
      businessSize: p.businessSize,
      deliveryDays: (p as Record<string, unknown>)["deliveryDays"] ?? null,
      deliverables: p.deliverablesJson ?? [],
      tools: p.toolsUsedJson ?? [],
      completedProjects: p.completedProjects,
    })),
  };
}

// ── Brand-DNA-aware recommendation ("AI Template Recommendation") ────────────

export async function getBrandDnaRecommendations(clientId: string, limit = 6) {
  const dna = await getBrandDNA(clientId);
  const industry = dna?.industry || undefined;

  const recs = await getPortfolioRecommendations({ industry, limit });
  return { basedOnBrandDna: Boolean(dna), items: recs.map(toGalleryCard) };
}

// ── Favorites ─────────────────────────────────────────────────────────────────

export async function listFavorites(clientId: string) {
  const favRows = await db
    .select()
    .from(aiPortfolioFavoritesTable)
    .where(eq(aiPortfolioFavoritesTable.clientId, clientId))
    .orderBy(desc(aiPortfolioFavoritesTable.createdAt));

  const portfolioIds = favRows.map((f) => f.portfolioId);
  const portfolios = portfolioIds.length
    ? await db.select().from(aiServicePortfoliosTable).where(inArray(aiServicePortfoliosTable.id, portfolioIds))
    : [];
  const byId = new Map(portfolios.map((p) => [p.id, p]));

  return favRows
    .map((f) => byId.get(f.portfolioId))
    .filter((p): p is AiServicePortfolio => Boolean(p))
    .map(toGalleryCard);
}

export async function addFavorite(clientId: string, portfolioId: number) {
  const [portfolio] = await db.select().from(aiServicePortfoliosTable).where(eq(aiServicePortfoliosTable.id, portfolioId)).limit(1);
  if (!portfolio) throw new Error("Portfolio not found");

  await db
    .insert(aiPortfolioFavoritesTable)
    .values({ clientId, portfolioId })
    .onConflictDoNothing();

  publishSafe({
    eventType: "portfolio_gallery.favorited",
    sourceModule: "portfolio-gallery",
    sourceId: String(portfolioId),
    payload: { clientId, portfolioId },
  });

  return { ok: true };
}

export async function removeFavorite(clientId: string, portfolioId: number) {
  await db
    .delete(aiPortfolioFavoritesTable)
    .where(and(eq(aiPortfolioFavoritesTable.clientId, clientId), eq(aiPortfolioFavoritesTable.portfolioId, portfolioId)));
  return { ok: true };
}

// ── Analytics (admin) ─────────────────────────────────────────────────────────

export async function getGalleryAnalytics() {
  const [searchCountRow, favoriteCountRow, compareCountRow, favoritesRows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_gallery.searched")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_gallery.favorited")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_gallery.compared")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiPortfolioFavoritesTable),
  ]);

  const topSearchEvents = await db
    .select({ payload: aiEventsTable.payloadJson })
    .from(aiEventsTable)
    .where(eq(aiEventsTable.eventType, "portfolio_gallery.searched"))
    .orderBy(desc(aiEventsTable.publishedAt))
    .limit(50);

  const termCounts = new Map<string, number>();
  for (const row of topSearchEvents) {
    const q = (row.payload as Record<string, unknown> | null)?.["q"];
    if (typeof q === "string" && q.trim()) {
      termCounts.set(q.toLowerCase(), (termCounts.get(q.toLowerCase()) ?? 0) + 1);
    }
  }
  const topSearchTerms = [...termCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));

  return {
    totalSearches: searchCountRow[0]?.n ?? 0,
    totalFavoriteEvents: favoriteCountRow[0]?.n ?? 0,
    totalCompareEvents: compareCountRow[0]?.n ?? 0,
    activeFavorites: favoritesRows[0]?.n ?? 0,
    topSearchTerms,
  };
}
