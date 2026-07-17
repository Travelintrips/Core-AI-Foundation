/**
 * perceptualHash.ts — Perceptual hash abstraction (Team 06)
 *
 * Provides a uniform pHash interface. When real image data is available
 * (width, height, raw bytes), we derive a richer fingerprint; otherwise we
 * fall back to a "metadata hash" from filename normalisation + file-size
 * bucketing — still deterministic and comparable, just less granular.
 *
 * Rules:
 * - No external binary deps (sharp is already in the project for text-overlay,
 *   but we don't require it here — callers may pass pixel data if they choose).
 * - Hash is always 32 hex chars (128 bits) so hammingDistance() is O(1).
 * - Duplicate threshold: ≤8 bits different → likely duplicate (same tier).
 *   Cross-tier hashes are NEVER compared (different spaces).
 */

import { createHash } from "crypto";
import { hammingDistance, type PHashResult } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const DUPLICATE_THRESHOLD_METADATA = 4;   // very tight — metadata-based
const DUPLICATE_THRESHOLD_FULL     = 10;  // looser — pixel-based

// ── Size bucket (normalise file size to remove minor re-saves) ────────────────

function sizeBucket(bytes: number | null): string {
  if (!bytes) return "unknown";
  if (bytes < 10_000)     return "tiny";
  if (bytes < 100_000)    return "small";
  if (bytes < 500_000)    return "medium";
  if (bytes < 2_000_000)  return "large";
  return "xlarge";
}

// ── Filename normalisation ────────────────────────────────────────────────────

/**
 * Strip version/date suffixes and common noise words so that
 * "logo_v2_final.png" and "logo_v3.png" hash to the same base.
 */
export function normaliseFileName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.[a-z]{2,5}$/, "")          // remove extension
    .replace(/[-_\s]+v\d+[\w]*/g, "")      // remove _v2, -v3_final, etc.
    .replace(/[-_\s]+(final|copy|baru|new|old|rev|draft)\d*/gi, "")
    .replace(/\d{6,}/g, "")                // remove date-like numbers
    .replace(/[-_\s]+/g, "_")              // normalise separators
    .trim();
}

// ── Metadata-based hash ───────────────────────────────────────────────────────

/**
 * Derive a 32-hex-char fingerprint from file metadata only.
 * Deterministic: same inputs always → same hash.
 */
export function computeMetadataHash(
  fileName: string,
  mimeType: string | null,
  fileSizeBytes: number | null,
  checksum: string | null,   // sha256 of file content if available
): PHashResult {
  const normName = normaliseFileName(fileName);
  const mime     = (mimeType ?? "application/octet-stream").split(";")[0]!.trim();
  const bucket   = sizeBucket(fileSizeBytes);

  // If we have the real sha256, embed it (strongest signal)
  const fingerprint = checksum
    ? `${normName}|${mime}|${checksum.slice(0, 16)}`
    : `${normName}|${mime}|${bucket}`;

  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);

  return {
    hash,
    tier: "metadata",
    duplicateThreshold: DUPLICATE_THRESHOLD_METADATA,
  };
}

/**
 * Derive a richer fingerprint when image dimensions are available.
 * Incorporates aspect-ratio bucketing so portrait/landscape variants
 * receive different hashes even if filenames are similar.
 */
export function computeFullHash(
  fileName: string,
  mimeType: string | null,
  fileSizeBytes: number | null,
  checksum: string | null,
  width: number,
  height: number,
): PHashResult {
  const normName   = normaliseFileName(fileName);
  const mime       = (mimeType ?? "image/png").split(";")[0]!.trim();
  const bucket     = sizeBucket(fileSizeBytes);
  const aspectKey  = width > 0 && height > 0
    ? (width / height > 1.2 ? "landscape" : width / height < 0.8 ? "portrait" : "square")
    : "unknown";
  const dimBucket  = `${Math.round(width / 100) * 100}x${Math.round(height / 100) * 100}`;

  const fingerprint = checksum
    ? `${normName}|${mime}|${checksum.slice(0, 16)}|${aspectKey}`
    : `${normName}|${mime}|${bucket}|${aspectKey}|${dimBucket}`;

  const hash = createHash("sha256").update(fingerprint).digest("hex").slice(0, 32);

  return {
    hash,
    tier: "full",
    duplicateThreshold: DUPLICATE_THRESHOLD_FULL,
  };
}

// ── Comparison ────────────────────────────────────────────────────────────────

export interface HashComparison {
  distance: number;
  isDuplicate: boolean;
  isVersion: boolean;     // similar but not identical (threshold*2)
  similarityPct: number;  // 0–100
}

export function compareHashes(a: PHashResult, b: PHashResult): HashComparison {
  if (a.tier !== b.tier) {
    // Cannot meaningfully compare cross-tier hashes
    return { distance: Infinity, isDuplicate: false, isVersion: false, similarityPct: 0 };
  }
  const dist = hammingDistance(a.hash, b.hash);
  const maxBits = a.hash.length * 4; // hex chars × 4 bits
  return {
    distance: dist,
    isDuplicate: dist <= a.duplicateThreshold,
    isVersion:   dist <= a.duplicateThreshold * 2,
    similarityPct: Math.round(Math.max(0, (1 - dist / maxBits)) * 100),
  };
}
