/**
 * types.ts — Shared types for Asset Intelligence V2 (Team 06)
 *
 * These types are local to the v2 domain. They do NOT depend on
 * @workspace/api-zod or shared barrel exports.
 */

// ── Asset type taxonomy ───────────────────────────────────────────────────────

export const ASSET_TYPE_V2 = [
  "graphic",
  "photo",
  "illustration",
  "svg",
  "document",
  "interior_material",
  "furniture_image",
  "fashion_motif",
  "garment_mockup",
  "packaging_asset",
] as const;

export type AssetTypeV2 = (typeof ASSET_TYPE_V2)[number];

// ── Perceptual hash ───────────────────────────────────────────────────────────

export interface PHashResult {
  /** 64-char hex string representing the perceptual fingerprint */
  hash: string;
  /** Algorithm tier: "full" (real dhash) | "metadata" (derived from file info) */
  tier: "full" | "metadata";
  /** Hamming distance threshold below which two hashes are considered duplicates */
  duplicateThreshold: number;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < a.length; i += 2) {
    const byteA = parseInt(a.slice(i, i + 2), 16);
    const byteB = parseInt(b.slice(i, i + 2), 16);
    let xor = byteA ^ byteB;
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

// ── Version chain ─────────────────────────────────────────────────────────────

export interface VersionChainMember {
  assetId: number;
  assetSource: string;
  versionType: string;
  versionLabel: string;
  role: "primary" | "variant";
}

export interface VersionChainV2 {
  chainId: number;
  clientId: string;
  primaryAssetId: number | null;
  members: VersionChainMember[];
  totalVariants: number;
  createdAt: string;
  updatedAt: string;
}

// ── Knowledge tags ────────────────────────────────────────────────────────────

export interface KnowledgeTag {
  tag: string;
  normalizedTag: string;
  category: string;
  subcategory: string | null;
  assetTypes: AssetTypeV2[];
  weight: number; // 0–1 relevance weight
}

// ── Quality metadata ──────────────────────────────────────────────────────────

export interface QualityMetadataV2 {
  overallScore: number;       // 0–100
  resolutionScore: number;    // 0–100 (based on width/height if available)
  formatScore: number;        // 0–100 (SVG > PNG > JPG for graphics)
  completenessScore: number;  // 0–100 (has title, tags, preview)
  usabilityScore: number;     // 0–100 (format fits declared asset type)
  resolutionInfo: {
    width: number | null;
    height: number | null;
    dpi: number | null;
    aspectRatio: string | null;
    pixelCount: number | null;
  };
  hasTransparency: boolean;
  isVector: boolean;
  recommendation: string;
}

// ── Licensing ─────────────────────────────────────────────────────────────────

export const LICENSE_TYPES = [
  "proprietary",
  "cc_by",
  "cc_by_sa",
  "cc_by_nd",
  "cc_by_nc",
  "cc0",
  "royalty_free",
  "rights_managed",
  "ai_generated",
  "unknown",
] as const;

export type LicenseType = (typeof LICENSE_TYPES)[number];

export interface LicensingMetadata {
  assetId: number;
  assetSource: string;
  licenseType: LicenseType;
  licenseOwner: string | null;
  attribution: string | null;
  usageRights: string[];       // e.g. ["commercial", "print", "web", "social_media"]
  restrictions: string[];      // e.g. ["no_resale", "credit_required"]
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Asset safety ──────────────────────────────────────────────────────────────

export const SAFETY_LEVELS = ["safe", "review", "unsafe"] as const;
export type SafetyLevel = (typeof SAFETY_LEVELS)[number];

export interface AssetSafetyResult {
  assetId: number;
  assetSource: string;
  clientId: string;
  safetyLevel: SafetyLevel;
  brandSafetyScore: number;   // 0–100 (100 = perfectly brand-safe)
  flags: string[];             // e.g. ["competitor_mention", "offensive_content"]
  reviewRequired: boolean;
  autoApproved: boolean;
  notes: string | null;
  classifiedAt: string;
}

// ── Intelligence V2 view ──────────────────────────────────────────────────────

export interface AssetIntelligenceV2View {
  id: number;
  assetId: number;
  assetSource: string;
  clientId: string;
  assetTypeV2: AssetTypeV2 | null;

  // Tags
  autoTags: string[];
  normalizedTags: string[];
  knowledgeTags: string[];
  searchKeywords: string[];
  detectedSubjects: string[];

  // Perceptual hash
  perceptualHash: string | null;
  hashTier: "full" | "metadata" | null;
  isDuplicate: boolean;
  duplicateOfId: number | null;
  duplicateSimilarityScore: number | null;

  // Version
  versionType: string;
  versionChainId: number | null;

  // Quality
  quality: QualityMetadataV2 | null;

  // Suggested usage
  suggestedUsage: string[];
  colorPalette: string[];

  // Licensing & Safety (nullable — separate tables)
  licensing: LicensingMetadata | null;
  safety: AssetSafetyResult | null;

  // Analysis state
  analysisFailed: boolean;
  failureReason: string | null;
  confidenceScore: number;
  analyzedAt: string;
}

// ── Batch analyze request ─────────────────────────────────────────────────────

export interface BatchAnalyzeRequest {
  assets: Array<{
    assetId: number;
    assetSource: "brand_kit" | "library" | "creative_asset";
  }>;
  clientId: string;
  options?: {
    reanalyze?: boolean;   // overwrite existing analysis
    skipSafety?: boolean;
    skipLicensing?: boolean;
  };
}

export interface BatchAnalyzeResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{ assetId: number; assetSource: string; ok: boolean; error?: string }>;
}
