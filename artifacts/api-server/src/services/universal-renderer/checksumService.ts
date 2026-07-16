/**
 * checksumService — Universal Renderer Team 14
 *
 * SHA-256 checksum utilities for render output validation.
 * All file-producing render paths must compute and store a checksum.
 */

import { createHash } from "crypto";
import { RenderError } from "./errors.js";

/** Compute SHA-256 hex digest of a buffer. */
export function computeChecksum(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Verify a buffer matches an expected checksum.
 * Throws CHECKSUM_MISMATCH if they differ.
 */
export function verifyChecksum(buf: Buffer, expected: string): void {
  const actual = computeChecksum(buf);
  if (actual !== expected) {
    throw new RenderError(
      "CHECKSUM_MISMATCH",
      `Checksum mismatch — expected ${expected}, got ${actual}`,
    );
  }
}
