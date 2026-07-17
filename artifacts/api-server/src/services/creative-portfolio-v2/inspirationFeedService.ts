/**
 * inspirationFeedService.ts — Team 4 / creative-portfolio-v2
 *
 * Curated inspiration feed grouped by mood/theme. Purely computed from
 * existing `ai_service_portfolios` data — no new table required.
 * Reuses the PUBLIC_GUARD visibility rules.
 */
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db, aiServicePortfoliosTable } from "@workspace/db";
import { toPublicDto, type PublicPortfolioCard } from "./galleryV2Service.js";

// ── Mood → Style mapping ───────────────────────────────────────────────────────

export type Mood = "minimal" | "luxury" | "bold" | "corporate" | "playful" | "natural";

export const MOODS: Record<Mood, { label: string; description: string; emoji: string; styles: string[] }> = {
  minimal: {
    label: "Minimal & Clean",
    description: "Simple, uncluttered, focused on whitespace and typography.",
    emoji: "◻️",
    styles: ["Minimalist", "Clean", "Simple", "Modern"],
  },
  luxury: {
    label: "Luxury & Premium",
    description: "Elegant, sophisticated, high-end aesthetics.",
    emoji: "✨",
    styles: ["Luxury", "Elegant", "Premium", "Classic", "Sophisticated"],
  },
  bold: {
    label: "Bold & Creative",
    description: "Eye-catching, expressive, energetic designs.",
    emoji: "⚡",
    styles: ["Bold", "Creative", "Industrial", "Expressive", "Dynamic"],
  },
  corporate: {
    label: "Corporate & Professional",
    description: "Trustworthy, structured, business-first visuals.",
    emoji: "🏢",
    styles: ["Corporate", "Professional", "Formal", "Classic"],
  },
  playful: {
    label: "Playful & Fun",
    description: "Colorful, lively, approachable brand identities.",
    emoji: "🎨",
    styles: ["Creative", "Playful", "Fun", "Colorful", "Vibrant"],
  },
  natural: {
    label: "Natural & Organic",
    description: "Earthy tones, organic shapes, nature-inspired.",
    emoji: "🌿",
    styles: ["Natural", "Organic", "Earthy", "Rustic", "Artisan"],
  },
};

const PUBLIC_GUARD = [
  eq(aiServicePortfoliosTable.status, "published"),
  sql`${aiServicePortfoliosTable.coverImage} IS NOT NULL`,
  sql`${aiServicePortfoliosTable.coverImage} NOT LIKE '%replicate.delivery%'`,
  sql`(NOT COALESCE(${aiServicePortfoliosTable.isDemo}, false) OR (COALESCE(${aiServicePortfoliosTable.qcScore}::numeric, 0) >= 80 AND ${aiServicePortfoliosTable.trademarkRisk} = 'low'))`,
];

// ── Feed by Mood ───────────────────────────────────────────────────────────────

export interface MoodFeedItem {
  mood: Mood;
  label: string;
  description: string;
  emoji: string;
  portfolios: PublicPortfolioCard[];
  totalAvailable: number;
}

export async function getFeedByMood(mood: Mood, limit = 8): Promise<MoodFeedItem> {
  const config = MOODS[mood];
  const styles = config.styles;

  // Build OR condition for style matching (case-insensitive)
  const styleCondition = sql`LOWER(${aiServicePortfoliosTable.style}) = ANY(ARRAY[${sql.join(styles.map(s => sql`LOWER(${s})`), sql`, `)}])`;

  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(...PUBLIC_GUARD, styleCondition))
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(sql`${aiServicePortfoliosTable.rating}::numeric`), desc(aiServicePortfoliosTable.views))
    .limit(limit + 4); // fetch a few extra to allow dedup

  // Deduplicate by coverImage
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    if (!r.coverImage || seen.has(r.coverImage)) return false;
    seen.add(r.coverImage);
    return true;
  }).slice(0, limit);

  return {
    mood,
    label: config.label,
    description: config.description,
    emoji: config.emoji,
    portfolios: deduped.map(toPublicDto),
    totalAvailable: rows.length,
  };
}

// ── Full Inspiration Feed (all moods) ─────────────────────────────────────────

export async function getInspirationFeed(moods?: Mood[], perMood = 6): Promise<MoodFeedItem[]> {
  const targetMoods = moods ?? (Object.keys(MOODS) as Mood[]);
  const results = await Promise.all(targetMoods.map((m) => getFeedByMood(m, perMood)));
  // Only return moods that have at least 1 result
  return results.filter((r) => r.portfolios.length > 0);
}

// ── Before/After Feed ─────────────────────────────────────────────────────────

export async function getBeforeAfterFeed(limit = 12): Promise<PublicPortfolioCard[]> {
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(
      ...PUBLIC_GUARD,
      sql`${aiServicePortfoliosTable.beforeImage} IS NOT NULL`,
      sql`${aiServicePortfoliosTable.afterImage} IS NOT NULL`,
    ))
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(aiServicePortfoliosTable.views))
    .limit(limit);

  return rows.map(toPublicDto);
}

// ── Color-grouped Feed ─────────────────────────────────────────────────────────

export async function getFeedByColorTag(colorTag: string, limit = 8): Promise<PublicPortfolioCard[]> {
  const rows = await db
    .select()
    .from(aiServicePortfoliosTable)
    .where(and(
      ...PUBLIC_GUARD,
      sql`${aiServicePortfoliosTable.colorTags}::jsonb @> ${JSON.stringify([colorTag])}::jsonb`,
    ))
    .orderBy(desc(aiServicePortfoliosTable.featured), desc(aiServicePortfoliosTable.views))
    .limit(limit);

  return rows.map(toPublicDto);
}
