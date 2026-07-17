/**
 * generationGuard.ts — AI generation cost controls for Fashion Design (Team 18)
 *
 * Enforces before every generation call:
 *   1. Per-request token cap (input tokens ≤ FASHION_MAX_INPUT_TOKENS)
 *   2. Per-key/IP rate limit: max FASHION_MAX_GENS_PER_HOUR per hour (domain-level,
 *      layered on top of global aiGenerationLimiter)
 *   3. Budget preflight via existing costService (getProjectCosts)
 *   4. Idempotency key — same key within 1 hour returns the cached result
 *   5. Cancellation guard — aborts if order is already cancelled
 *
 * Uses EXISTING costService — does NOT create a second cost service.
 */

import { getProjectCosts } from "../../services/costService.js";
import { logger } from "../../lib/logger.js";

// ── Tunables (override via env vars) ─────────────────────────────────────────

const FASHION_MAX_INPUT_TOKENS   = Number(process.env["FASHION_MAX_INPUT_TOKENS"]   ?? 8_000);
const FASHION_MAX_BUDGET_USD     = Number(process.env["FASHION_MAX_BUDGET_USD"]     ?? 2.00);
const FASHION_MAX_GENS_PER_HOUR  = Number(process.env["FASHION_MAX_GENS_PER_HOUR"]  ?? 5);
const IDEMPOTENCY_TTL_MS         = 60 * 60 * 1_000; // 1 hour

// ── In-memory stores ──────────────────────────────────────────────────────────

/** Per-key generation counter within the current hour window */
const _rateBuckets = new Map<string, { count: number; windowStart: number }>();

/** Idempotency cache: key → serialized result */
const _idempotencyCache = new Map<string, { result: unknown; expiresAt: number }>();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GenerationGuardResult {
  allowed: boolean;
  reason?: "rate_limited" | "budget_exceeded" | "token_cap" | "duplicate" | "cancelled";
  cachedResult?: unknown;
  remainingGenerations?: number;
  currentBudgetUsd?: number;
  maxBudgetUsd?: number;
}

export interface GenerationGuardOptions {
  /** Unique caller identifier — use admin key hash or IP */
  callerId: string;
  /** Idempotency key from x-idempotency-key header */
  idempotencyKey?: string;
  /** Estimated input tokens for this request */
  estimatedInputTokens?: number;
  /** Project ID for budget check (optional) */
  projectId?: string;
  /** Current order status */
  orderStatus?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRateBucket(callerId: string): { count: number; windowStart: number } {
  const now = Date.now();
  const existing = _rateBuckets.get(callerId);

  // Reset if window has expired (1 hour)
  if (!existing || now - existing.windowStart > 60 * 60 * 1_000) {
    const fresh = { count: 0, windowStart: now };
    _rateBuckets.set(callerId, fresh);
    return fresh;
  }
  return existing;
}

function getCachedIdempotencyResult(key: string): unknown | undefined {
  const entry = _idempotencyCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _idempotencyCache.delete(key);
    return undefined;
  }
  return entry.result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * checkGenerationAllowed — call before every generation.
 * Returns immediately if blocked; otherwise caller should call
 * recordGenerationUsed() after success and cacheIdempotencyResult() to store.
 */
export async function checkGenerationAllowed(
  opts: GenerationGuardOptions,
): Promise<GenerationGuardResult> {
  const { callerId, idempotencyKey, estimatedInputTokens, projectId, orderStatus } = opts;

  // 1. Cancellation guard
  if (orderStatus === "cancelled") {
    return { allowed: false, reason: "cancelled" };
  }

  // 2. Idempotency — return cached result if duplicate key
  if (idempotencyKey) {
    const cached = getCachedIdempotencyResult(idempotencyKey);
    if (cached !== undefined) {
      logger.info({ idempotencyKey, callerId }, "[fashion-design] Idempotent generation hit — returning cached result");
      return { allowed: true, reason: "duplicate", cachedResult: cached };
    }
  }

  // 3. Per-request token cap
  if (estimatedInputTokens !== undefined && estimatedInputTokens > FASHION_MAX_INPUT_TOKENS) {
    logger.warn({ estimatedInputTokens, cap: FASHION_MAX_INPUT_TOKENS, callerId },
      "[fashion-design] Token cap exceeded");
    return { allowed: false, reason: "token_cap" };
  }

  // 4. Per-caller rate limit (domain-level, max per hour)
  const bucket = getRateBucket(callerId);
  if (bucket.count >= FASHION_MAX_GENS_PER_HOUR) {
    const resetInMs = 60 * 60 * 1_000 - (Date.now() - bucket.windowStart);
    logger.warn({ callerId, count: bucket.count, limit: FASHION_MAX_GENS_PER_HOUR, resetInMs },
      "[fashion-design] Domain rate limit exceeded");
    return {
      allowed: false,
      reason: "rate_limited",
      remainingGenerations: 0,
    };
  }

  // 5. Budget preflight via existing costService
  if (projectId) {
    try {
      const costs = await getProjectCosts(projectId);
      if (costs.totalEstimatedCostUsd >= FASHION_MAX_BUDGET_USD) {
        logger.warn({ projectId, currentUsd: costs.totalEstimatedCostUsd, maxUsd: FASHION_MAX_BUDGET_USD },
          "[fashion-design] Budget exceeded — blocking generation");
        return {
          allowed: false,
          reason: "budget_exceeded",
          currentBudgetUsd: costs.totalEstimatedCostUsd,
          maxBudgetUsd: FASHION_MAX_BUDGET_USD,
        };
      }
    } catch (err) {
      // Budget service unavailable — fail CLOSED (block)
      logger.error({ err, projectId }, "[fashion-design] Budget preflight failed — blocking generation (fail-closed)");
      return { allowed: false, reason: "budget_exceeded" };
    }
  }

  return {
    allowed: true,
    remainingGenerations: FASHION_MAX_GENS_PER_HOUR - bucket.count,
  };
}

/**
 * recordGenerationUsed — call AFTER a successful generation to consume the rate slot.
 */
export function recordGenerationUsed(callerId: string): void {
  const bucket = getRateBucket(callerId);
  bucket.count += 1;
  logger.info({ callerId, count: bucket.count, limit: FASHION_MAX_GENS_PER_HOUR },
    "[fashion-design] Generation slot consumed");
}

/**
 * cacheIdempotencyResult — store a generation result for idempotency.
 */
export function cacheIdempotencyResult(key: string, result: unknown): void {
  _idempotencyCache.set(key, { result, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

/** Export tunables for test access */
export const TUNABLES = {
  FASHION_MAX_INPUT_TOKENS,
  FASHION_MAX_BUDGET_USD,
  FASHION_MAX_GENS_PER_HOUR,
  IDEMPOTENCY_TTL_MS,
} as const;

/** Test helper: clear rate buckets and idempotency cache */
export function _resetGuardState(): void {
  _rateBuckets.clear();
  _idempotencyCache.clear();
}
