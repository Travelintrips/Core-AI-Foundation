/**
 * portfolioRecommendationService — rule-based recommendation engine.
 *
 * No ML. Scores candidates by industry match, style match, package match,
 * featured bonus, and popularity. Used by the public portfolio detail page
 * and the "Related" section.
 */
import { eq, and, ne, desc } from "drizzle-orm";
import {
  db,
  aiServicePortfoliosTable,
  aiServicesTable,
  type AiServicePortfolio,
} from "@workspace/db";

export interface RecommendationInput {
  viewedPortfolioId?: number;
  industry?: string;
  style?: string;
  packageLevel?: string;
  serviceId?: number;
  limit?: number;
}

function scoreCandidate(
  candidate: AiServicePortfolio,
  input: RecommendationInput,
  viewed?: AiServicePortfolio,
): number {
  let s = 0;

  // Industry match (strongest signal)
  const sourceIndustry = viewed?.industry ?? input.industry;
  if (sourceIndustry && candidate.industry === sourceIndustry) s += 40;

  // Style match
  const sourceStyle = viewed?.style ?? input.style;
  if (sourceStyle && candidate.style.toLowerCase() === sourceStyle.toLowerCase()) s += 25;

  // Same service
  if (input.serviceId && candidate.serviceId === input.serviceId) s += 10;

  // Featured bonus
  if (candidate.featured) s += 8;

  // Popularity (capped at 12 pts)
  s += Math.min(12, Math.floor(candidate.views / 5));

  // Rating bonus (0-5 pts)
  const rating = candidate.rating ? parseFloat(candidate.rating) : 0;
  s += Math.floor(rating);

  return s;
}

/**
 * Returns scored, ranked portfolio recommendations.
 * Excludes the viewed portfolio itself.
 */
export async function getPortfolioRecommendations(
  input: RecommendationInput,
): Promise<AiServicePortfolio[]> {
  const limit = Math.min(input.limit ?? 6, 12);

  let viewed: AiServicePortfolio | undefined;
  if (input.viewedPortfolioId) {
    const [row] = await db
      .select()
      .from(aiServicePortfoliosTable)
      .where(eq(aiServicePortfoliosTable.id, input.viewedPortfolioId))
      .limit(1);
    viewed = row;
  }

  const conditions = [eq(aiServicePortfoliosTable.status, "published")];
  if (input.viewedPortfolioId) {
    conditions.push(ne(aiServicePortfoliosTable.id, input.viewedPortfolioId));
  }

  // Fetch a pool to score from
  const candidates = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...conditions))
    .orderBy(desc(aiServicePortfoliosTable.views))
    .limit(80);

  const scored = candidates.map((c) => ({ portfolio: c, score: scoreCandidate(c, input, viewed) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.portfolio);
}

/**
 * Returns services related to the given service (same category).
 */
export async function getRelatedServices(serviceId: number, limit = 5) {
  const [service] = await db
    .select()
    .from(aiServicesTable)
    .where(eq(aiServicesTable.id, serviceId))
    .limit(1);

  if (!service?.categoryId) return [];

  return db
    .select()
    .from(aiServicesTable)
    .where(
      and(
        eq(aiServicesTable.categoryId, service.categoryId),
        eq(aiServicesTable.status, "active"),
        ne(aiServicesTable.id, serviceId),
      ),
    )
    .limit(limit);
}

/**
 * Conversion funnel analytics per portfolio.
 */
export async function getPortfolioConversionStats(portfolioId: number) {
  const [row] = await db
    .select({
      views: aiServicePortfoliosTable.views,
      rating: aiServicePortfoliosTable.rating,
    })
    .from(aiServicePortfoliosTable)
    .where(eq(aiServicePortfoliosTable.id, portfolioId))
    .limit(1);

  if (!row) return null;

  return {
    views: row.views ?? 0,
    rating: row.rating,
  };
}
