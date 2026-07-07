import { randomBytes, createHash } from "crypto";
import type { CreativeAiClientReview } from "@workspace/db";

const TOKEN_BYTES = 32;

/** Generate a cryptographically secure URL-safe token.
 *  Returns both the plaintext (show once) and its SHA-256 hash (store in DB). */
export function generateReviewToken(): { plaintext: string; hash: string } {
  const buf = randomBytes(TOKEN_BYTES);
  const plaintext = buf.toString("base64url"); // URL-safe, no padding
  const hash = hashToken(plaintext);
  return { plaintext, hash };
}

/** Hash a token received from a client request for DB lookup. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Check if a review record is valid (not expired, not revoked). */
export function isReviewValid(review: Pick<CreativeAiClientReview, "status" | "tokenExpiresAt">): boolean {
  if (review.status === "revoked") return false;
  if (new Date() > review.tokenExpiresAt) return false;
  return true;
}

/** Default expiry duration in days when not specified. */
export const DEFAULT_EXPIRY_DAYS = 7;
