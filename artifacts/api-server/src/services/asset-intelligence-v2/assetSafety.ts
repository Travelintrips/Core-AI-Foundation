/**
 * assetSafety.ts — Brand safety classification (Team 06)
 *
 * Rule-based safety scoring (no external AI call).
 * Checks for:
 *   - Brand safety flags (competitor names, offensive patterns)
 *   - Content category appropriateness
 *   - Format-based safety (executable files are always unsafe)
 *
 * Writes to ai_asset_safety table.
 */

import { pool } from "@workspace/db";
import type { AssetSafetyResult, SafetyLevel } from "./types.js";

// ── Flag dictionaries ─────────────────────────────────────────────────────────

const COMPETITOR_TERMS: string[] = [
  // generic patterns — project-specific list would go here
  "competitor", "rival", "enemy_brand",
];

const OFFENSIVE_PATTERNS: string[] = [
  "nsfw", "adult", "explicit", "nude", "gore",
  "violence", "hate", "discrimination",
];

const DANGEROUS_EXTENSIONS = new Set(["exe", "sh", "bat", "ps1", "cmd", "vbs", "js", "py"]);

const SAFE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/svg+xml", "image/gif",
  "application/pdf", "image/tiff",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// ── Classification logic ──────────────────────────────────────────────────────

interface SafetyInput {
  assetId: number;
  assetSource: string;
  clientId: string;
  fileName: string;
  mimeType: string | null;
  tags: string[];
  title: string;
  detectedSubjects: string[];
}

function classifyAsset(input: SafetyInput): Omit<AssetSafetyResult, "classifiedAt"> {
  const flags: string[] = [];
  let brandSafetyScore = 100;

  const searchText = [
    input.fileName,
    input.title,
    ...input.tags,
    ...input.detectedSubjects,
  ].join(" ").toLowerCase();

  // 1. Dangerous file format
  const ext = input.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    flags.push("dangerous_file_format");
    brandSafetyScore -= 100; // hard block
  }

  // 2. Unsafe MIME type (if specified)
  const mime = (input.mimeType ?? "").toLowerCase();
  if (mime && !SAFE_MIME_TYPES.has(mime) && !mime.startsWith("image/")) {
    flags.push("unrecognized_mime_type");
    brandSafetyScore -= 10;
  }

  // 3. Offensive content patterns
  for (const pattern of OFFENSIVE_PATTERNS) {
    if (searchText.includes(pattern)) {
      flags.push(`offensive_content:${pattern}`);
      brandSafetyScore -= 40;
    }
  }

  // 4. Competitor mentions
  for (const term of COMPETITOR_TERMS) {
    if (searchText.includes(term)) {
      flags.push("competitor_mention");
      brandSafetyScore -= 20;
      break;
    }
  }

  const finalScore = Math.max(0, Math.min(100, brandSafetyScore));
  const safetyLevel: SafetyLevel =
    finalScore >= 80 ? "safe" :
    finalScore >= 40 ? "review" :
    "unsafe";

  return {
    assetId:      input.assetId,
    assetSource:  input.assetSource,
    clientId:     input.clientId,
    safetyLevel,
    brandSafetyScore: finalScore,
    flags,
    reviewRequired: safetyLevel === "review",
    autoApproved:  safetyLevel === "safe",
    notes: flags.length > 0
      ? `Flagged for: ${flags.join(", ")}`
      : null,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function classifyAndSaveAssetSafety(input: SafetyInput): Promise<AssetSafetyResult> {
  const result = classifyAsset(input);

  await pool.query(
    `INSERT INTO ai_platform.ai_asset_safety
       (asset_id, asset_source, client_id, safety_level, brand_safety_score,
        flags, review_required, auto_approved, notes, classified_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),NOW())
     ON CONFLICT (asset_id, asset_source) DO UPDATE SET
       safety_level        = EXCLUDED.safety_level,
       brand_safety_score  = EXCLUDED.brand_safety_score,
       flags               = EXCLUDED.flags,
       review_required     = EXCLUDED.review_required,
       auto_approved       = EXCLUDED.auto_approved,
       notes               = EXCLUDED.notes,
       classified_at       = NOW(),
       updated_at          = NOW()`,
    [
      result.assetId,
      result.assetSource,
      result.clientId,
      result.safetyLevel,
      result.brandSafetyScore,
      result.flags,
      result.reviewRequired,
      result.autoApproved,
      result.notes,
    ],
  );

  return { ...result, classifiedAt: new Date().toISOString() };
}

export async function getAssetSafety(assetId: number, assetSource: string): Promise<AssetSafetyResult | null> {
  const res = await pool.query<{
    asset_id: number; asset_source: string; client_id: string;
    safety_level: string; brand_safety_score: number;
    flags: string[]; review_required: boolean; auto_approved: boolean;
    notes: string | null; classified_at: Date;
  }>(
    `SELECT * FROM ai_platform.ai_asset_safety WHERE asset_id = $1 AND asset_source = $2 LIMIT 1`,
    [assetId, assetSource],
  );
  if (!res.rows[0]) return null;
  const r = res.rows[0]!;
  return {
    assetId: r.asset_id,
    assetSource: r.asset_source,
    clientId: r.client_id,
    safetyLevel: r.safety_level as SafetyLevel,
    brandSafetyScore: r.brand_safety_score,
    flags: Array.isArray(r.flags) ? r.flags : [],
    reviewRequired: r.review_required,
    autoApproved: r.auto_approved,
    notes: r.notes,
    classifiedAt: r.classified_at.toISOString(),
  };
}

// Hard cap for listUnsafeAssetsForClient — prevents full-table scans on large clients.
// Regression guard: do not remove or raise without updating tests.
export const UNSAFE_ASSETS_MAX_LIMIT     = 100;
export const UNSAFE_ASSETS_DEFAULT_LIMIT =  50;

export async function listUnsafeAssetsForClient(
  clientId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: AssetSafetyResult[]; total: number; limit: number; offset: number }> {
  const limit  = Math.min(Math.max(opts.limit  ?? UNSAFE_ASSETS_DEFAULT_LIMIT, 1), UNSAFE_ASSETS_MAX_LIMIT);
  const offset = Math.max(opts.offset ?? 0, 0);

  type SafetyRow = {
    asset_id: number; asset_source: string; client_id: string;
    safety_level: string; brand_safety_score: number;
    flags: string[]; review_required: boolean; auto_approved: boolean;
    notes: string | null; classified_at: Date;
  };

  const [res, countRes] = await Promise.all([
    pool.query<SafetyRow>(
      `SELECT * FROM ai_platform.ai_asset_safety
       WHERE client_id = $1 AND safety_level != 'safe'
       ORDER BY brand_safety_score ASC
       LIMIT $2 OFFSET $3`,
      [clientId, limit, offset],
    ),
    pool.query<{ total: string }>(
      `SELECT count(*)::int AS total FROM ai_platform.ai_asset_safety
       WHERE client_id = $1 AND safety_level != 'safe'`,
      [clientId],
    ),
  ]);

  const items = res.rows.map((r) => ({
    assetId: r.asset_id,
    assetSource: r.asset_source,
    clientId: r.client_id,
    safetyLevel: r.safety_level as SafetyLevel,
    brandSafetyScore: r.brand_safety_score,
    flags: Array.isArray(r.flags) ? r.flags : [],
    reviewRequired: r.review_required,
    autoApproved: r.auto_approved,
    notes: r.notes,
    classifiedAt: r.classified_at.toISOString(),
  }));

  const total = Number(countRes.rows[0]?.total ?? 0);
  return { items, total, limit, offset };
}
