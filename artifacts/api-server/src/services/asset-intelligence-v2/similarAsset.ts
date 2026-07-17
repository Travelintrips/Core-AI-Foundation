/**
 * similarAsset.ts — Find similar assets by DB-level candidate selection (Team 06)
 *
 * P0 PERFORMANCE FIX: No longer loads the full library into memory.
 * Uses indexed DB queries with hard candidate limits:
 *   1. First-pass: SQL array overlap (&&) on auto_tags + knowledge_tags +
 *      exact hash match + same asset_type_v2 — filtered to CANDIDATE_LIMIT rows.
 *      This benefits from GIN indexes on the array columns.
 *   2. Second-pass (in JS): compute weighted Jaccard scores on bounded set.
 *   3. Return top-N ranked results with pagination support.
 *
 * Similarity weights:
 *   40% tag Jaccard overlap
 *   40% knowledge-tag overlap
 *   20% hash proximity (same tier only)
 *
 * Hard limits:
 *   CANDIDATE_LIMIT = 200  (max rows fetched from DB)
 *   Default result limit  = 10, max = 50
 */

import { pool } from "@workspace/db";
import { hammingDistance } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum rows pulled from DB before in-memory scoring. */
const CANDIDATE_LIMIT = 200;

/** Default and maximum result page sizes. */
export const SIMILAR_ASSET_MAX_LIMIT = 50;
export const SIMILAR_ASSET_DEFAULT_LIMIT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

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

export interface SimilarAssetPage {
  items: SimilarAssetResult[];
  total: number;              // total candidates above threshold
  page: number;
  limit: number;
  hasMore: boolean;
}

// ── Jaccard similarity (in-memory, bounded set) ───────────────────────────────

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── DB candidate fetch (O(log N) via GIN index) ───────────────────────────────

interface CandidateRow {
  asset_id: number;
  asset_source: string;
  auto_tags: string[] | null;
  knowledge_tags: string[] | null;
  perceptual_hash: string | null;
  hash_tier: string | null;
}

/**
 * Fetch candidate rows from DB using indexed array overlap + hash match.
 *
 * Filter predicate (OR):
 *   - auto_tags && anchorTags          (GIN index hit)
 *   - knowledge_tags && anchorKTags    (GIN index hit)
 *   - perceptual_hash = anchorHash     (btree index hit)
 *   - asset_type_v2 = anchorType       (btree index hit)
 *
 * When the anchor has no tags/hash, falls back to same-type assets.
 * Hard LIMIT prevents full-scan semantics even without index.
 */
async function fetchCandidates(
  anchorId: number,
  anchorSource: string,
  clientId: string,
  anchorTags: string[],
  anchorKTags: string[],
  anchorHash: string | null,
  anchorTier: string | null,
  anchorType: string | null,
): Promise<CandidateRow[]> {
  // Build overlap arrays — empty arrays in && would match nothing useful
  const tagParam   = anchorTags.length  > 0 ? anchorTags  : null;
  const kTagParam  = anchorKTags.length > 0 ? anchorKTags : null;

  // When we have real signals, use array overlap; otherwise fall back to type match
  const hasSignals = tagParam !== null || kTagParam !== null || anchorHash !== null;

  if (hasSignals) {
    const res = await pool.query<CandidateRow>(
      `SELECT asset_id, asset_source, auto_tags, knowledge_tags, perceptual_hash, hash_tier
       FROM ai_platform.ai_asset_intelligence_v2
       WHERE client_id = $1
         AND NOT (asset_id = $2 AND asset_source = $3)
         AND analysis_failed = false
         AND (
               ($4::text[] IS NOT NULL AND auto_tags     && $4::text[])
            OR ($5::text[] IS NOT NULL AND knowledge_tags && $5::text[])
            OR ($6::text  IS NOT NULL AND perceptual_hash = $6 AND hash_tier = $7)
            OR (asset_type_v2 IS NOT NULL AND asset_type_v2 = $8)
         )
       LIMIT $9`,
      [clientId, anchorId, anchorSource,
       tagParam, kTagParam,
       anchorHash, anchorTier,
       anchorType,
       CANDIDATE_LIMIT],
    );
    return res.rows;
  }

  // Absolute fallback: same client, ordered by recency, hard-capped
  const res = await pool.query<CandidateRow>(
    `SELECT asset_id, asset_source, auto_tags, knowledge_tags, perceptual_hash, hash_tier
     FROM ai_platform.ai_asset_intelligence_v2
     WHERE client_id = $1
       AND NOT (asset_id = $2 AND asset_source = $3)
       AND analysis_failed = false
     ORDER BY analyzed_at DESC
     LIMIT $4`,
    [clientId, anchorId, anchorSource, CANDIDATE_LIMIT],
  );
  return res.rows;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find assets similar to the given anchor within the client's library.
 *
 * @param assetId      Anchor asset ID
 * @param assetSource  Anchor asset source table
 * @param clientId     Owner client — all results are scoped to this client
 * @param limit        Max results to return (capped at SIMILAR_ASSET_MAX_LIMIT)
 * @param page         1-based page number (default 1)
 */
export async function findSimilarAssets(
  assetId: number,
  assetSource: string,
  clientId: string,
  limit  = SIMILAR_ASSET_DEFAULT_LIMIT,
  page   = 1,
): Promise<SimilarAssetPage> {
  // Clamp to safe bounds
  const safeLimit = Math.min(Math.max(1, limit), SIMILAR_ASSET_MAX_LIMIT);
  const safePage  = Math.max(1, page);
  const offset    = (safePage - 1) * safeLimit;

  // Load anchor's intelligence record
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

  if (!anchorRes.rows[0]) {
    return { items: [], total: 0, page: safePage, limit: safeLimit, hasMore: false };
  }

  const anchor = anchorRes.rows[0]!;
  const anchorTags  = anchor.auto_tags  ?? [];
  const anchorKTags = anchor.knowledge_tags ?? [];
  const anchorHash  = anchor.perceptual_hash;
  const anchorTier  = anchor.hash_tier;
  const anchorType  = anchor.asset_type_v2;

  // Fetch bounded candidates from DB
  const candidates = await fetchCandidates(
    assetId, assetSource, clientId,
    anchorTags, anchorKTags, anchorHash, anchorTier, anchorType,
  );

  // Precompute anchor sets for shared-tag calculation
  const setA  = new Set(anchorTags);
  const setAK = new Set(anchorKTags);

  // Score candidates in-memory (bounded by CANDIDATE_LIMIT ≤ 200)
  const scored: SimilarAssetResult[] = [];

  for (const row of candidates) {
    const tags  = row.auto_tags  ?? [];
    const kTags = row.knowledge_tags ?? [];

    const tagSim  = jaccardSimilarity(anchorTags, tags);
    const kTagSim = jaccardSimilarity(anchorKTags, kTags);

    let hashScore = 0;
    if (anchorHash && row.perceptual_hash && anchorTier === row.hash_tier) {
      const dist   = hammingDistance(anchorHash, row.perceptual_hash);
      const maxDist = anchorHash.length * 4;
      hashScore    = Math.max(0, 1 - dist / maxDist);
    }

    const overallScore = Math.round((tagSim * 0.4 + kTagSim * 0.4 + hashScore * 0.2) * 100);
    if (overallScore < 10) continue; // Skip very dissimilar

    scored.push({
      assetId:           row.asset_id,
      assetSource:       row.asset_source,
      similarityScore:   overallScore,
      tagOverlapScore:   Math.round(tagSim * 100),
      knowledgeTagScore: Math.round(kTagSim * 100),
      hashScore:         Math.round(hashScore * 100),
      sharedTags:        tags.filter((t: string) => setA.has(t)),
      sharedKnowledgeTags: kTags.filter((t: string) => setAK.has(t)),
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.similarityScore - a.similarityScore);

  const total = scored.length;
  const items = scored.slice(offset, offset + safeLimit);

  return {
    items,
    total,
    page:    safePage,
    limit:   safeLimit,
    hasMore: offset + safeLimit < total,
  };
}
