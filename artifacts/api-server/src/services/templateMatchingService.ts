/**
 * templateMatchingService — Brand DNA → Top Template Recommendations (V4.3).
 *
 * Algorithm: score each published template against a client's Brand DNA.
 * Returns top 5. Rule-based, deterministic, no external AI calls.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db, aiTemplatesTable, aiBrandDnaTable } from "@workspace/db";
import type { AiTemplate } from "@workspace/db";

export interface TemplateMatchInput {
  clientId: string;
  category?: string;         // limit to a specific category
  packageLevel?: string;     // starter | standard | professional | enterprise
  serviceType?: string;      // for further filtering
  limit?: number;
}

export interface ScoredTemplate {
  template: AiTemplate;
  score: number;
  reasons: string[];
}

function scoreTemplate(
  template: AiTemplate,
  dna: {
    industry: string;
    brandPersonality: string[];
    brandVoice: string;
    writingStyle: string;
    detectedColors: { primary?: string | null };
    targetAudience: { primary: string };
    completenessScore: number;
  },
  packageLevel?: string,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 1. Industry match — strongest signal (+40)
  if (template.industry && template.industry.toLowerCase() === dna.industry.toLowerCase()) {
    score += 40;
    reasons.push(`Industry match: ${dna.industry}`);
  } else if (!template.industry) {
    score += 15; // cross-industry templates get a base bonus
    reasons.push("Cross-industry template");
  }

  // 2. Brand personality match (+25 max — 5 pts each)
  const templatePersonalities = (template.brandDnaTags?.personalities ?? []).map((p: string) => p.toLowerCase());
  const dnaPersonalities = dna.brandPersonality.map((p) => p.toLowerCase());
  const personalityHits = dnaPersonalities.filter((p) => templatePersonalities.includes(p));
  if (personalityHits.length > 0) {
    const bonus = Math.min(personalityHits.length * 5, 25);
    score += bonus;
    reasons.push(`Brand personality match: ${personalityHits.join(", ")}`);
  }

  // 3. Brand voice / writing style match (+15)
  const templateVoices = (template.brandDnaTags?.voices ?? []).map((v: string) => v.toLowerCase());
  if (templateVoices.includes(dna.brandVoice.toLowerCase()) || templateVoices.includes(dna.writingStyle.toLowerCase())) {
    score += 15;
    reasons.push(`Voice/style match: ${dna.brandVoice}`);
  }

  // 4. Color theme match (+10) — compare primary hue
  if (dna.detectedColors?.primary && template.colorTheme?.primary) {
    const dnaHex = dna.detectedColors.primary.replace("#", "").toLowerCase();
    const tplHex = template.colorTheme.primary.replace("#", "").toLowerCase();
    // Same hue family: compare first 2 chars of hex
    if (dnaHex.substring(0, 2) === tplHex.substring(0, 2)) {
      score += 10;
      reasons.push("Similar primary color family");
    }
  }

  // 5. Target audience match (+10)
  const templateAudiences = (template.brandDnaTags?.audiences ?? []).map((a: string) => a.toLowerCase());
  if (templateAudiences.some((a: string) => dna.targetAudience.primary.toLowerCase().includes(a))) {
    score += 10;
    reasons.push(`Audience match: ${dna.targetAudience.primary}`);
  }

  // 6. Package support (+8)
  if (packageLevel && template.supportedPackages) {
    if (template.supportedPackages.includes(packageLevel)) {
      score += 8;
      reasons.push(`Supported package: ${packageLevel}`);
    }
  }

  // 7. Featured bonus (+5)
  if (template.featured) {
    score += 5;
    reasons.push("Featured template");
  }

  // 8. Popularity bonus (views, capped at 7)
  score += Math.min(7, Math.floor((template.views ?? 0) / 10));

  // 9. Completeness bonus — reward clients with rich Brand DNA
  if (dna.completenessScore >= 80) score += 3;

  return { score, reasons };
}

export async function getTemplateRecommendations(input: TemplateMatchInput): Promise<ScoredTemplate[]> {
  const limit = Math.min(input.limit ?? 5, 10);

  // Fetch brand DNA
  const [dnaRow] = await db
    .select()
    .from(aiBrandDnaTable)
    .where(eq(aiBrandDnaTable.clientId, input.clientId))
    .limit(1);

  if (!dnaRow) {
    // No brand DNA — return top featured templates
    const fallback = await db
      .select()
      .from(aiTemplatesTable)
      .where(and(
        eq(aiTemplatesTable.status, "published"),
        ...(input.category ? [eq(aiTemplatesTable.category, input.category)] : []),
      ))
      .orderBy(desc(aiTemplatesTable.featured), desc(aiTemplatesTable.views))
      .limit(limit);

    return fallback.map((t) => ({ template: t, score: 0, reasons: ["No Brand DNA — showing featured templates"] }));
  }

  const dna = {
    industry: (dnaRow.industry ?? "General") as string,
    brandPersonality: (dnaRow.brandPersonality as string[]) ?? [],
    brandVoice: (dnaRow.brandVoice as string) ?? "Professional",
    writingStyle: (dnaRow.writingStyle as string) ?? "Formal",
    detectedColors: (dnaRow.detectedColors as { primary?: string | null }) ?? {},
    targetAudience: (dnaRow.targetAudience as { primary: string }) ?? { primary: "" },
    completenessScore: (dnaRow.completenessScore as number) ?? 0,
  };

  // Fetch candidate templates
  const conditions: ReturnType<typeof eq>[] = [eq(aiTemplatesTable.status, "published")];
  if (input.category) conditions.push(eq(aiTemplatesTable.category, input.category));

  const candidates = await db
    .select()
    .from(aiTemplatesTable)
    .where(and(...conditions))
    .orderBy(desc(aiTemplatesTable.views))
    .limit(100);

  // Score all candidates
  const scored: ScoredTemplate[] = candidates.map((template) => {
    const { score, reasons } = scoreTemplate(template, dna, input.packageLevel);
    return { template, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Quick recommendation without Brand DNA — based solely on industry + category.
 * Used for public gallery "AI Recommended" filter (anonymous visitors).
 */
export async function getPublicRecommendations(opts: {
  industry?: string;
  category?: string;
  limit?: number;
}) {
  const limit = Math.min(opts.limit ?? 6, 12);

  const conditions: ReturnType<typeof eq>[] = [eq(aiTemplatesTable.status, "published"), eq(aiTemplatesTable.featured, true)];
  if (opts.category) conditions.push(eq(aiTemplatesTable.category, opts.category));

  if (opts.industry) {
    // match industry or cross-industry
    const rows = await db
      .select()
      .from(aiTemplatesTable)
      .where(and(
        eq(aiTemplatesTable.status, "published"),
        ...(opts.category ? [eq(aiTemplatesTable.category, opts.category)] : []),
      ))
      .orderBy(desc(aiTemplatesTable.featured), desc(aiTemplatesTable.conversions), desc(aiTemplatesTable.views))
      .limit(50);

    // Prioritize industry match
    const industryMatch = rows.filter((r) => r.industry === opts.industry || !r.industry);
    return industryMatch.slice(0, limit);
  }

  return db
    .select()
    .from(aiTemplatesTable)
    .where(and(...conditions))
    .orderBy(desc(aiTemplatesTable.conversions), desc(aiTemplatesTable.views))
    .limit(limit);
}
