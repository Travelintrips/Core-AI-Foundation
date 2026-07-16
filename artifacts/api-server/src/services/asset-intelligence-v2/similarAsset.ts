/**
 * similarAsset.ts — Find similar assets by hash + tag overlap (Team 06)
 *
 * Similarity is a weighted score:
 *   40% tag Jaccard overlap
 *   40% knowledge-tag overlap
 *   20% hash proximity (same tier only)
 *
 * Returns ranked list, capped at 10 results.
 */

import { pool } from "@workspace/db";
import { hammingDistance } from "./types.js";

export interface SimilarAssetResult {
  assetId: number;
  assetSource: string;
  similarityScore: number;    // 0–100
  tagOverlapScore: number;
  knowledgeTagScore: number;
  hashScore: number;
  sharedTags: string[];
  sharedKnowledgeTags: string[];
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export async function findSimilarAssets(
  assetId: number,
  assetSource: string,
  clientId: string,
  limit = 10,
): Promise<SimilarAssetResult[]> {
  // Load the anchor asset's intelligence record
  const anchorRes = await pool.query<{
    auto_tags: string[] | null;
    knowledge_tags: string[] | null;
    perceptual_hash: string | null;
    hash_tier: string | null;
    asset_type_v2: string | null;
  }>(
    `SELECT auto_tags, knowledge_tags, perceptual_hash, hash_tier, asset_type_v2
     FROM ai_platform.ai_asset_intelligence_v2
     WHERE asset_id = $1 AND asset_source = $2 AND client_id = $3
     LIMIT 1`,
    [assetId, assetSource, clientId],
  );

  if (!anchorRes.rows[0]) return [];
  const anchor = anchorRes.rows[0]!;

  const anchorTags   = anchor.auto_tags ?? [];
  const anchorKTags  = anchor.knowledge_tags ?? [];
  const anchorHash   = anchor.perceptual_hash;
  const anchorTier   = anchor.hash_tier;

  // Load all OTHER assets for this client
  const othersRes = await pool.query<{
    asset_id: number; asset_source: string;
    auto_tags: string[] | null;
    knowledge_tags: string[] | null;
    perceptual_hash: string | null;
    hash_tier: string | null;
  }>(
    `SELECT asset_id, asset_source, auto_tags, knowledge_tags, perceptual_hash, hash_tier
     FROM ai_platform.ai_asset_intelligence_v2
     WHERE client_id = $1
       AND NOT (asset_id = $2 AND asset_source = $3)
       AND analysis_failed = false`,
    [clientId, assetId, assetSource],
  );

  const scored: SimilarAssetResult[] = [];

  for (const row of othersRes.rows) {
    const tags  = row.auto_tags ?? [];
    const kTags = row.knowledge_tags ?? [];

    const tagSim  = jaccardSimilarity(anchorTags, tags);
    const kTagSim = jaccardSimilarity(anchorKTags, kTags);

    let hashScore = 0;
    if (anchorHash && row.perceptual_hash && anchorTier === row.hash_tier) {
      const dist = hammingDistance(anchorHash, row.perceptual_hash);
      const maxDist = anchorHash.length * 4;
      hashScore = Math.max(0, 1 - dist / maxDist);
    }

    const overallScore = Math.round((tagSim * 0.4 + kTagSim * 0.4 + hashScore * 0.2) * 100);
    if (overallScore < 10) continue; // Skip very dissimilar

    const setA = new Set(anchorTags);
    const setAK = new Set(anchorKTags);

    scored.push({
      assetId: row.asset_id,
      assetSource: row.asset_source,
      similarityScore: overallScore,
      tagOverlapScore: Math.round(tagSim * 100),
      knowledgeTagScore: Math.round(kTagSim * 100),
      hashScore: Math.round(hashScore * 100),
      sharedTags: tags.filter((t: string) => setA.has(t)),
      sharedKnowledgeTags: kTags.filter((t: string) => setAK.has(t)),
    });
  }

  return scored.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, limit);
}
