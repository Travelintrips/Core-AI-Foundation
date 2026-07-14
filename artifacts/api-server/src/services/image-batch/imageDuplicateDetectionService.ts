/**
 * imageDuplicateDetectionService.ts — Phase 5 Creative Asset Batch Engine
 *
 * Perceptual similarity duplicate detection (difference hash / dHash), not a
 * raw byte checksum — two re-encodes of the same generation, or two visually
 * near-identical draws, must still be caught even if their bytes differ.
 *
 * dHash: downsample to 9x8 grayscale, compare each pixel to its right
 * neighbour -> 64-bit fingerprint. Hamming distance between fingerprints,
 * normalized to a 0..1 similarity score.
 */

import sharp from "sharp";

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/** >= this similarity: reject as a true duplicate, must be regenerated. */
export const DUPLICATE_THRESHOLD = 0.92;
/** >= this similarity (but below DUPLICATE_THRESHOLD): keep, but flag as a near-duplicate warning. */
export const NEAR_DUPLICATE_THRESHOLD = 0.85;

export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(HASH_WIDTH, HASH_HEIGHT, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = "";
  for (let y = 0; y < HASH_HEIGHT; y++) {
    for (let x = 0; x < HASH_WIDTH - 1; x++) {
      const idx = y * HASH_WIDTH + x;
      hash += data[idx]! < data[idx + 1]! ? "1" : "0";
    }
  }
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - hammingDistance(a, b) / maxLen;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  isNearDuplicate: boolean;
  maxSimilarity: number;
  matchedItemKey: string | null;
}

/** Compare a new hash against previously accepted hashes in the same batch. */
export function checkAgainstExisting(
  newHash: string,
  existing: Array<{ itemKey: string; hash: string }>,
): DuplicateCheckResult {
  let maxSimilarity = 0;
  let matchedItemKey: string | null = null;
  for (const e of existing) {
    const s = similarity(newHash, e.hash);
    if (s > maxSimilarity) {
      maxSimilarity = s;
      matchedItemKey = e.itemKey;
    }
  }
  return {
    isDuplicate: maxSimilarity >= DUPLICATE_THRESHOLD,
    isNearDuplicate: maxSimilarity >= NEAR_DUPLICATE_THRESHOLD && maxSimilarity < DUPLICATE_THRESHOLD,
    maxSimilarity,
    matchedItemKey: maxSimilarity >= NEAR_DUPLICATE_THRESHOLD ? matchedItemKey : null,
  };
}
