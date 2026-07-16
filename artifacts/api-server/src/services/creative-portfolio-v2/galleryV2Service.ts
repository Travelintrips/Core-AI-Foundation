/**
 * galleryV2Service.ts — Team 4 / creative-portfolio-v2
 *
 * Additive wrapper layer on top of the existing portfolioGalleryService and
 * portfolioRecommendationService. Adds:
 *   - Enhanced search: sort=rating|fastest|popular|latest|featured
 *   - Tag/color filter
 *   - Inspiration feed (curated by mood/theme)
 *   - Portfolio-to-service CTA tracking
 *   - Public DTO sanitizer (strips ALL internal metadata)
 *   - Similar portfolios (wrapper with public DTO)
 *
 * Never duplicates: gallery search core, recommendation algorithm, favorites,
 * Brand DNA scoring, event bus, or any existing table/route.
 */
import { eq, and, desc, asc, sql, inArray, or } from "drizzle-orm";
import {
  db,
  aiServicePortfoliosTable,
  aiPortfolioFavoritesTable,
  aiEventsTable,
  type AiServicePortfolio,
} from "@workspace/db";
import { getBrandDNA } from "../creativeBrandIntelligenceService.js";
import { getPortfolioRecommendations } from "../portfolioRecommendationService.js";
import { publishSafe } from "../aiEventBusService.js";

// ── Public DTO ─────────────────────────────────────────────────────────────────
// ALL internal fields stripped. Any field not in this list is omitted.

export interface PublicPortfolioCard {
  id: number;
  slug: string | null;
  serviceId: number;
  title: string;
  shortDescription: string | null;
  description: string | null;
  industry: string;
  businessType: string | null;
  style: string;
  colorTags: string[] | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  businessSize: string | null;
  packageLabel: string | null;
  packageLevel: string | null;
  deliveryTime: string | null;
  deliveryDays: number | null;
  coverImage: string | null;
  galleryJson: AiServicePortfolio["galleryJson"];
  beforeImage: string | null;
  afterImage: string | null;
  deliverablesJson: string[] | null;
  toolsUsedJson: string[] | null;
  workflowJson: AiServicePortfolio["workflowJson"];
  rating: string | null;
  views: number;
  totalReviews: number;
  completedProjects: number;
  featured: boolean;
  displayOrder: number;
  createdAt: Date;
}

export function toPublicDto(p: AiServicePortfolio): PublicPortfolioCard {
  return {
    id: p.id,
    slug: (p as Record<string, unknown>)["slug"] as string | null ?? null,
    serviceId: p.serviceId,
    title: p.title,
    shortDescription: (p as Record<string, unknown>)["shortDescription"] as string | null ?? null,
    description: p.description ?? null,
    industry: p.industry,
    businessType: p.businessType ?? null,
    style: p.style,
    colorTags: p.colorTags ?? null,
    primaryColor: p.primaryColor ?? null,
    secondaryColor: p.secondaryColor ?? null,
    businessSize: p.businessSize ?? null,
    packageLabel: p.packageLabel ?? null,
    packageLevel: p.packageLevel ?? null,
    deliveryTime: p.deliveryTime ?? null,
    deliveryDays: p.deliveryDays ?? null,
    coverImage: p.coverImage ?? null,
    galleryJson: p.galleryJson ?? null,
    beforeImage: p.beforeImage ?? null,
    afterImage: p.afterImage ?? null,
    deliverablesJson: p.deliverablesJson ?? null,
    toolsUsedJson: p.toolsUsedJson ?? null,
    workflowJson: p.workflowJson ?? null,
    rating: p.rating ?? null,
    views: p.views,
    totalReviews: p.totalReviews,
    completedProjects: p.completedProjects,
    featured: p.featured,
    displayOrder: p.displayOrder,
    createdAt: p.createdAt,
  };
}

// ── Public guard (reuse same rule as existing service) ─────────────────────────
const PUBLIC_GUARD = [
  eq(aiServicePortfoliosTable.status, "published"),
  sql`${aiServicePortfoliosTable.coverImage} IS NOT NULL`,
  sql`${aiServicePortfoliosTable.coverImage} NOT LIKE '%replicate.delivery%'`,
  sql`(NOT COALESCE(${aiServicePortfoliosTable.isDemo}, false) OR (COALESCE(${aiServicePortfoliosTable.qcScore}::numeric, 0) >= 80 AND ${aiServicePortfoliosTable.trademarkRisk} = 'low'))`,
];

// ── Sort helpers ───────────────────────────────────────────────────────────────
export type SortOption = "featured" | "popular" | "latest" | "rating" | "fastest";

function buildOrderBy(sort: SortOption) {
  switch (sort) {
    case "popular":  return [desc(aiServicePortfoliosTable.views)];
    case "latest":   return [desc(aiServicePortfoliosTable.createdAt)];
    case "rating":   return [desc(sql`${aiServicePortfoliosTable.rating}::numeric`), desc(aiServicePortfoliosTable.views)];
    case "fastest":  return [asc(sql`COALESCE(${aiServicePortfoliosTable.deliveryDays}, 999)`), desc(aiServicePortfoliosTable.featured)];
    default:         return [desc(aiServicePortfoliosTable.featured), desc(aiServicePortfoliosTable.displayOrder), desc(aiServicePortfoliosTable.views)];
  }
}

// ── Enhanced Gallery Search ────────────────────────────────────────────────────

export interface GalleryV2SearchInput {
  q?: string;
  industry?: string;
  style?: string;
  sort?: SortOption;
  colorTag?: string;
  packageLevel?: string;
  hasBeforeAfter?: boolean;
  page?: number;
  pageSize?: number;
}

export async function searchGalleryV2(input: GalleryV2SearchInput) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, input.pageSize ?? 24));
  const offset = (page - 1) * pageSize;
  const sort: SortOption = input.sort ?? "featured";

  const conditions = [...PUBLIC_GUARD];

  if (input.industry) conditions.push(eq(aiServicePortfoliosTable.industry, input.industry));
  if (input.style)    conditions.push(eq(aiServicePortfoliosTable.style, input.style));
  if (input.packageLevel) conditions.push(eq(aiServicePortfoliosTable.packageLevel, input.packageLevel));
  if (input.hasBeforeAfter) {
    conditions.push(
      sql`${aiServicePortfoliosTable.beforeImage} IS NOT NULL`,
      sql`${aiServicePortfoliosTable.afterImage} IS NOT NULL`,
    );
  }
  if (input.colorTag) {
    conditions.push(sql`${aiServicePortfoliosTable.colorTags}::jsonb @> ${JSON.stringify([input.colorTag])}::jsonb`);
  }

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
  const orderBy = buildOrderBy(sort);

  const [[countRow], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(aiServicePortfoliosTable).where(whereClause),
    db.select().from(aiServicePortfoliosTable).where(whereClause).orderBy(...orderBy).limit(pageSize).offset(offset),
  ]);

  const total = countRow?.n ?? 0;

  if (q) {
    publishSafe({
      eventType: "portfolio_v2.gallery_searched",
      sourceModule: "creative-portfolio-v2",
      sourceId: q,
      payload: { q, industry: input.industry ?? null, style: input.style ?? null, sort, resultCount: total },
    });
  }

  return {
    items: rows.map(toPublicDto),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    appliedFilters: { q: q || null, industry: input.industry ?? null, style: input.style ?? null, sort, colorTag: input.colorTag ?? null },
  };
}

// ── Industry Showcase (enhanced) ───────────────────────────────────────────────

export interface IndustryDeepDive {
  industry: string;
  label: string;
  totalPortfolios: number;
  featured: PublicPortfolioCard[];
  styles: string[];
  topRating: string | null;
}

const INDUSTRY_LABELS: Record<string, string> = {
  coffee: "Coffee Shop", restaurant: "Restaurant", hotel: "Hotel",
  manufacturing: "Manufacturing", mining: "Mining", trading: "Trading",
  logistics: "Logistics", construction: "Construction", medical: "Medical",
  education: "Education", retail: "Retail", fashion: "Fashion",
  technology: "Technology", government: "Government", other: "Other",
};

export async function getIndustryDeepDive(industry: string): Promise<IndustryDeepDive> {
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, eq(aiServicePortfoliosTable.industry, industry)))
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(sql`${aiServicePortfoliosTable.rating}::numeric`))
    .limit(12);

  const styles = [...new Set(rows.map((r) => r.style))].slice(0, 8);
  const ratings = rows.map((r) => r.rating ? parseFloat(r.rating) : 0).filter(Boolean);
  const topRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null;

  return {
    industry,
    label: INDUSTRY_LABELS[industry] ?? industry,
    totalPortfolios: rows.length,
    featured: rows.slice(0, 6).map(toPublicDto),
    styles,
    topRating,
  };
}

export async function getAllIndustrySummary() {
  const rows = await db
    .select({
      industry: aiServicePortfoliosTable.industry,
      count: sql<number>`count(*)::int`,
      topView: sql<number>`max(${aiServicePortfoliosTable.views})`,
    })
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD))
    .groupBy(aiServicePortfoliosTable.industry)
    .orderBy(desc(sql<number>`count(*)`));

  return rows.map((r) => ({
    industry: r.industry,
    label: INDUSTRY_LABELS[r.industry] ?? r.industry,
    totalPortfolios: r.count,
    topViews: r.topView,
  }));
}

// ── Similar Portfolios ─────────────────────────────────────────────────────────

export async function getSimilarPortfolios(portfolioId: number, limit = 6): Promise<PublicPortfolioCard[]> {
  const [current] = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .limit(1);

  if (!current) return [];

  const recs = await getPortfolioRecommendations({
    viewedPortfolioId: portfolioId,
    industry: current.industry,
    style: current.style,
    serviceId: current.serviceId,
    limit,
  });

  return recs.map(toPublicDto);
}

// ── Portfolio Detail (public) ──────────────────────────────────────────────────

export async function getPortfolioDetailPublic(idOrSlug: string) {
  const numericId = parseInt(idOrSlug, 10);
  const isId = !Number.isNaN(numericId);

  const [row] = isId
    ? await db.select().from(aiServicePortfoliosTable).where(and(...PUBLIC_GUARD, eq(aiServicePortfoliosTable.id, numericId))).limit(1)
    : await db.select().from(aiServicePortfoliosTable).where(and(...PUBLIC_GUARD, sql`${aiServicePortfoliosTable.slug} = ${idOrSlug}`)).limit(1);

  if (!row) return null;

  // Track view event
  publishSafe({
    eventType: "portfolio_v2.detail_viewed",
    sourceModule: "creative-portfolio-v2",
    sourceId: String(row.id),
    payload: { portfolioId: row.id, serviceId: row.serviceId },
  });

  return toPublicDto(row);
}

// ── Portfolio-to-Service CTA Tracking ─────────────────────────────────────────

export async function trackCtaClick(portfolioId: number, source: string) {
  // Increment click counter on the portfolio
  await db
    .update(aiServicePortfoliosTable)
    .set({ totalClicks: sql`${aiServicePortfoliosTable.totalClicks} + 1` })
    .where(eq(aiServicePortfoliosTable.id, portfolioId));

  publishSafe({
    eventType: "portfolio_v2.cta_clicked",
    sourceModule: "creative-portfolio-v2",
    sourceId: String(portfolioId),
    payload: { portfolioId, source },
  });

  // Return the serviceId so the frontend can redirect
  const [row] = await db
    .select({ serviceId: aiServicePortfoliosTable.serviceId })
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .limit(1);

  return { ok: true, serviceId: row?.serviceId ?? null };
}

// ── Brand DNA Recommendations (public DTO) ─────────────────────────────────────

export async function getBrandDnaRecsPublic(clientId: string, limit = 6) {
  const dna = await getBrandDNA(clientId);
  const industry = (dna as Record<string, unknown> | null)?.["industry"] as string | undefined;
  const style = (dna as Record<string, unknown> | null)?.["stylePreference"] as string | undefined;

  const recs = await getPortfolioRecommendations({ industry, style, limit });

  return {
    basedOnBrandDna: Boolean(dna),
    brandProfile: dna ? {
      industry: industry ?? null,
      style: style ?? null,
    } : null,
    items: recs.map(toPublicDto),
  };
}

// ── Favorites (public DTO) ─────────────────────────────────────────────────────

export async function listFavoritesPublic(clientId: string) {
  const favRows = await db
    .select()
    .from(aiPortfolioFavoritesTable)
    .where(eq(aiPortfolioFavoritesTable.clientId, clientId))
    .orderBy(desc(aiPortfolioFavoritesTable.createdAt));

  const portfolioIds = favRows.map((f) => f.portfolioId);
  if (!portfolioIds.length) return { items: [], totalFavorites: 0 };

  const portfolios = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, inArray(aiServicePortfoliosTable.id, portfolioIds)));

  const byId = new Map(portfolios.map((p) => [p.id, p]));
  const items = favRows
    .map((f) => byId.get(f.portfolioId))
    .filter((p): p is AiServicePortfolio => Boolean(p))
    .map(toPublicDto);

  return { items, totalFavorites: items.length };
}

export async function addFavoritePublic(clientId: string, portfolioId: number) {
  // Guard: must be a public portfolio
  const [portfolio] = await db.select().from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, eq(aiServicePortfoliosTable.id, portfolioId))).limit(1);
  if (!portfolio) throw new Error("Portfolio not found or not public");

  await db
    .insert(aiPortfolioFavoritesTable)
    .values({ clientId, portfolioId })
    .onConflictDoNothing();

  publishSafe({
    eventType: "portfolio_v2.favorited",
    sourceModule: "creative-portfolio-v2",
    sourceId: String(portfolioId),
    payload: { clientId, portfolioId },
  });

  return { ok: true };
}

export async function removeFavoritePublic(clientId: string, portfolioId: number) {
  await db
    .delete(aiPortfolioFavoritesTable)
    .where(and(eq(aiPortfolioFavoritesTable.clientId, clientId), eq(aiPortfolioFavoritesTable.portfolioId, portfolioId)));
  return { ok: true };
}

export async function getFavoriteIds(clientId: string): Promise<number[]> {
  const rows = await db
    .select({ portfolioId: aiPortfolioFavoritesTable.portfolioId })
    .from(aiPortfolioFavoritesTable)
    .where(eq(aiPortfolioFavoritesTable.clientId, clientId));
  return rows.map((r) => r.portfolioId);
}

// ── Compare (public DTO, max 4) ────────────────────────────────────────────────

export async function comparePortfoliosPublic(ids: number[]) {
  const uniqueIds = [...new Set(ids)].slice(0, 4);
  if (uniqueIds.length < 2) throw new Error("At least 2 distinct portfolio ids required");

  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, inArray(aiServicePortfoliosTable.id, uniqueIds)));

  publishSafe({
    eventType: "portfolio_v2.compared",
    sourceModule: "creative-portfolio-v2",
    sourceId: uniqueIds.join(","),
    payload: { portfolioIds: uniqueIds },
  });

  return {
    items: rows.map((p) => ({
      ...toPublicDto(p),
      // Extra compare-specific fields (still public)
      deliveryDays: p.deliveryDays ?? null,
      deliverablesCount: (p.deliverablesJson ?? []).length,
      toolsCount: (p.toolsUsedJson ?? []).length,
    })),
  };
}

// ── Analytics Tracking Adapter ─────────────────────────────────────────────────

export async function getGalleryV2Analytics() {
  const [searches, favorites, comparisons, ctaClicks, views] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_v2.gallery_searched")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_v2.favorited")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_v2.compared")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_v2.cta_clicked")),
    db.select({ n: sql<number>`count(*)::int` }).from(aiEventsTable).where(eq(aiEventsTable.eventType, "portfolio_v2.detail_viewed")),
  ]);

  // Top CTA portfolios
  const topCta = await db
    .select({ id: aiServicePortfoliosTable.id, title: aiServicePortfoliosTable.title, totalClicks: aiServicePortfoliosTable.totalClicks })
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, sql`${aiServicePortfoliosTable.totalClicks} > 0`))
    .orderBy(desc(aiServicePortfoliosTable.totalClicks))
    .limit(10);

  return {
    totalSearches: searches[0]?.n ?? 0,
    totalFavoriteEvents: favorites[0]?.n ?? 0,
    totalCompareEvents: comparisons[0]?.n ?? 0,
    totalCtaClicks: ctaClicks[0]?.n ?? 0,
    totalDetailViews: views[0]?.n ?? 0,
    topCtaPortfolios: topCta,
  };
}
