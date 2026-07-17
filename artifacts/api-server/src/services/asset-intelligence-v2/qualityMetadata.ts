/**
 * qualityMetadata.ts — Expanded quality scoring (Team 06)
 *
 * Quality is scored across four dimensions:
 *   resolutionScore  — pixel density / dimensions for raster; always 100 for vector
 *   formatScore      — format suitability for declared asset type
 *   completenessScore— has title, tags, preview URL
 *   usabilityScore   — format fits asset type
 *
 * Overall = weighted average.
 */

import type { AssetTypeV2, QualityMetadataV2 } from "./types.js";

// ── Format preference per asset type ─────────────────────────────────────────

const FORMAT_PREFERENCE: Record<AssetTypeV2, Record<string, number>> = {
  graphic:           { svg: 100, eps: 95, pdf: 85, png: 80, webp: 70, jpg: 60, jpeg: 60 },
  photo:             { jpg: 100, jpeg: 100, webp: 95, png: 90, heic: 85, tiff: 85 },
  illustration:      { svg: 100, eps: 95, pdf: 85, png: 85, ai: 100 },
  svg:               { svg: 100, eps: 90 },
  document:          { pdf: 100, docx: 90, pptx: 85, doc: 80, xlsx: 80 },
  interior_material: { png: 100, jpg: 95, jpeg: 95, tiff: 90, webp: 85, svg: 80 },
  furniture_image:   { png: 100, jpg: 95, jpeg: 95, webp: 90, tiff: 85 },
  fashion_motif:     { svg: 100, png: 95, eps: 95, ai: 100, pdf: 85, tiff: 85 },
  garment_mockup:    { png: 100, jpg: 90, jpeg: 90, webp: 85, psd: 90 },
  packaging_asset:   { pdf: 100, ai: 95, svg: 90, eps: 90, png: 80 },
};

// ── Resolution scoring ────────────────────────────────────────────────────────

function scoreResolution(
  width: number | null,
  height: number | null,
  assetType: AssetTypeV2,
  isVector: boolean,
): number {
  if (isVector) return 100; // vectors are infinitely scalable
  if (!width || !height) return 30; // unknown resolution — penalise
  const pixels = width * height;

  // Thresholds per asset type
  const MIN_PIXELS: Record<AssetTypeV2, number> = {
    graphic:           500_000,   // 0.5 MP
    photo:           2_000_000,   // 2 MP
    illustration:    1_000_000,   // 1 MP
    svg:                     0,   // N/A (vector)
    document:                0,   // N/A
    interior_material: 500_000,
    furniture_image:   500_000,
    fashion_motif:     500_000,
    garment_mockup:  1_000_000,
    packaging_asset: 1_000_000,
  };

  const min = MIN_PIXELS[assetType] ?? 500_000;
  if (min === 0) return 100;
  if (pixels >= min * 4) return 100;
  if (pixels >= min * 2) return 90;
  if (pixels >= min)     return 75;
  if (pixels >= min / 2) return 50;
  return 25;
}

// ── Format scoring ────────────────────────────────────────────────────────────

function scoreFormat(ext: string, mimeType: string | null, assetType: AssetTypeV2): number {
  const prefs = FORMAT_PREFERENCE[assetType] ?? {};
  const lExt  = ext.toLowerCase().replace(".", "");
  const mime  = (mimeType ?? "").toLowerCase();

  if (prefs[lExt]) return prefs[lExt]!;
  // Fallback: infer from mime
  if (mime.includes("svg"))         return prefs["svg"] ?? 50;
  if (mime.includes("pdf"))         return prefs["pdf"] ?? 50;
  if (mime.includes("png"))         return prefs["png"] ?? 50;
  if (mime.includes("jpeg") || mime.includes("jpg")) return prefs["jpg"] ?? 50;
  return 40;
}

// ── Completeness scoring ──────────────────────────────────────────────────────

function scoreCompleteness(opts: {
  hasTitle: boolean;
  hasTags: boolean;
  hasPreviewUrl: boolean;
  hasChecksum: boolean;
}): number {
  let score = 0;
  if (opts.hasTitle)      score += 30;
  if (opts.hasTags)       score += 25;
  if (opts.hasPreviewUrl) score += 30;
  if (opts.hasChecksum)   score += 15;
  return score;
}

// ── Usability scoring ─────────────────────────────────────────────────────────

function scoreUsability(assetType: AssetTypeV2, ext: string, mimeType: string | null): number {
  const formatScore = scoreFormat(ext, mimeType, assetType);
  // Penalise mismatches: e.g., packaging_asset uploaded as JPG (loses editability)
  if (assetType === "packaging_asset" && !["pdf","ai","svg","eps"].includes(ext.toLowerCase())) return Math.min(formatScore, 60);
  if (assetType === "fashion_motif" && !["svg","eps","ai","png","tiff"].includes(ext.toLowerCase())) return Math.min(formatScore, 65);
  return formatScore;
}

// ── Aspect ratio ──────────────────────────────────────────────────────────────

function deriveAspectRatio(w: number | null, h: number | null): string | null {
  if (!w || !h) return null;
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const g = gcd(w, h);
  return `${w/g}:${h/g}`;
}

// ── Recommendation ────────────────────────────────────────────────────────────

function buildRecommendation(
  formatScore: number,
  resolutionScore: number,
  completenessScore: number,
  isVector: boolean,
  assetType: AssetTypeV2,
): string {
  const issues: string[] = [];
  if (formatScore < 70) issues.push(`consider exporting as a preferred format for ${assetType}`);
  if (!isVector && resolutionScore < 50) issues.push("resolution is below recommended minimum");
  if (completenessScore < 50) issues.push("add a title, tags, and preview URL for better discoverability");
  if (issues.length === 0) return "Asset meets quality standards.";
  return `To improve this asset: ${issues.join("; ")}.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeQualityMetadata(opts: {
  assetType: AssetTypeV2;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  width?: number | null;
  height?: number | null;
  dpi?: number | null;
  hasTransparency?: boolean;
  hasTitle: boolean;
  hasTags: boolean;
  hasPreviewUrl: boolean;
  hasChecksum: boolean;
}): QualityMetadataV2 {
  const ext = opts.fileName.split(".").pop() ?? "";
  const isVector = ["svg", "eps", "ai"].includes(ext.toLowerCase()) ||
    (opts.mimeType ?? "").includes("svg");

  const resolutionScore   = scoreResolution(opts.width ?? null, opts.height ?? null, opts.assetType, isVector);
  const formatScore       = scoreFormat(ext, opts.mimeType, opts.assetType);
  const completenessScore = scoreCompleteness({
    hasTitle: opts.hasTitle,
    hasTags: opts.hasTags,
    hasPreviewUrl: opts.hasPreviewUrl,
    hasChecksum: opts.hasChecksum,
  });
  const usabilityScore = scoreUsability(opts.assetType, ext, opts.mimeType);

  const overallScore = Math.round(
    resolutionScore * 0.30 +
    formatScore     * 0.25 +
    completenessScore * 0.25 +
    usabilityScore  * 0.20,
  );

  const w = opts.width ?? null;
  const h = opts.height ?? null;

  return {
    overallScore,
    resolutionScore,
    formatScore,
    completenessScore,
    usabilityScore,
    resolutionInfo: {
      width: w,
      height: h,
      dpi: opts.dpi ?? null,
      aspectRatio: deriveAspectRatio(w, h),
      pixelCount: w && h ? w * h : null,
    },
    hasTransparency: opts.hasTransparency ?? false,
    isVector,
    recommendation: buildRecommendation(formatScore, resolutionScore, completenessScore, isVector, opts.assetType),
  };
}
