/**
 * rateLimiter.ts — Express rate-limit configurations for P0-3 Rate Limiting.
 *
 * Applies per-IP limits at different tiers:
 *   global         — 200 req / 15 min  (all /api routes)
 *   payment        —  20 req / 60 min  (payment proof submit, checkout)
 *   aiGeneration   —  10 req / 10 min  (brief, image generation, preview)
 *   clientReview   —  30 req / 10 min  (review token access, comments)
 *   upload         —  10 req / 10 min  (file upload hooks)
 */
import rateLimit from "express-rate-limit";
import type { Request } from "express";

const JSON_RESPONSE = true;

function jsonHandler(message: string) {
  return (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(429).json({ error: message, code: "RATE_LIMIT_EXCEEDED" });
  };
}

/**
 * Returns true when the request carries a valid admin API key.
 * Admin panel requests are trusted and must never be rate-limited — they
 * would otherwise exhaust the 200 req/15 min global bucket just by navigating.
 * In development, if ADMIN_API_KEY is not configured, also skip (mirrors adminAuth logic).
 */
function isAdminRequest(req: Request): boolean {
  if (req.method === "OPTIONS") return true;
  // Session-authenticated admin portal requests are hydrated by
  // optionalSessionAuth before the global limiter runs. They should receive
  // the same trusted treatment as requests carrying the admin API key.
  if ((req as unknown as Record<string, unknown>).internalUser) return true;
  const configuredKey = process.env["ADMIN_API_KEY"];
  if (!configuredKey) {
    // Dev fallback: no key configured → allow everything (same as adminAuth behaviour)
    return process.env["NODE_ENV"] === "development";
  }
  const provided =
    (req.headers["x-admin-api-key"] as string | undefined) ??
    (req.headers["authorization"] ?? "").toString().replace(/^Bearer\s+/i, "");
  return provided === configuredKey;
}

/** 200 req per 15 min — applied globally to all /api routes */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak permintaan untuk sementara. Silakan coba lagi dalam beberapa menit."),
  skip: isAdminRequest,
});

/** 20 req per 60 min — payment proof submit, checkout */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak permintaan pembayaran untuk sementara. Silakan tunggu sebelum mencoba lagi."),
  skip: isAdminRequest,
});

/** 10 req per 10 min — AI brief, image generation, live preview */
export const aiGenerationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak permintaan AI untuk sementara. Silakan tunggu 10 menit sebelum mencoba lagi."),
  skip: isAdminRequest,
});

/** 30 req per 10 min — client review token access, comments */
export const clientReviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak permintaan review untuk sementara. Silakan coba lagi sesaat lagi."),
  skip: isAdminRequest,
});

/** 10 req per 10 min — file upload and signed-URL generation */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak permintaan unggah untuk sementara. Silakan tunggu sebelum mengunggah lagi."),
  skip: isAdminRequest,
});

/** 8 req per 15 min per IP — internal staff login (brute-force guard) */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Terlalu banyak percobaan login untuk sementara. Silakan tunggu sebelum mencoba lagi."),
});

// Satisfy eslint unused-var warning
void JSON_RESPONSE;
