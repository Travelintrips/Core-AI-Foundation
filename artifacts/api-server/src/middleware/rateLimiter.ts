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

const JSON_RESPONSE = true;

function jsonHandler(message: string) {
  return (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(429).json({ error: message, code: "RATE_LIMIT_EXCEEDED" });
  };
}

/** 200 req per 15 min — applied globally to all /api routes */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many requests, please try again later."),
  skip: (req) => req.method === "OPTIONS",
});

/** 20 req per 60 min — payment proof submit, checkout */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many payment requests. Please wait before trying again."),
});

/** 10 req per 10 min — AI brief, image generation, live preview */
export const aiGenerationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many AI generation requests. Please wait 10 minutes."),
});

/** 30 req per 10 min — client review token access, comments */
export const clientReviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many review requests. Please try again shortly."),
});

/** 10 req per 10 min — file upload and signed-URL generation */
export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many upload requests. Please wait before uploading again."),
});

/** 8 req per 15 min per IP — internal staff login (brute-force guard) */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler("Too many login attempts. Please wait before trying again."),
});

// Satisfy eslint unused-var warning
void JSON_RESPONSE;
