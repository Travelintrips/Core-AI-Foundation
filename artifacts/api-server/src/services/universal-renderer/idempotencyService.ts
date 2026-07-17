/**
 * idempotencyService.ts — Team 14  (P1)
 *
 * Canonical content hash + in-memory cache.
 *
 * Guarantees:
 *   • Same (svgContent + canvasWidth + canvasHeight + formats + previewMode)
 *     always produces the same hash — format order is normalised (sorted).
 *   • A completed result is served from cache for IDEMPOTENCY_TTL_MS.
 *   • No re-render, no duplicate storage writes, no duplicate audit logs.
 *
 * DB-level idempotency via ai_universal_renders.content_hash is declared
 * in integration/manifests/team-14.json and requires Team 24 migration.
 */

import { createHash } from "crypto";
import { UNIVERSAL_RENDER_LIMITS } from "./resourceLimits.js";
import type { UniversalRenderRequest, UniversalRenderResult } from "./universalRendererService.js";

// ── In-memory cache (FIFO eviction) ──────────────────────────────────────────

interface CacheEntry {
  result:    UniversalRenderResult;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (v.expiresAt <= now) _cache.delete(k);
  }
}

function evictOldest(): void {
  const first = _cache.keys().next().value as string | undefined;
  if (first !== undefined) _cache.delete(first);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 content hash for a render request.
 *
 * Canonical fields (format order is sorted so `["png","svg"]` ≡ `["svg","png"]`):
 *   svgContent + canvasWidth + canvasHeight + sorted(formats) + previewMode
 *
 * Metadata title/creator and storagePrefix are intentionally EXCLUDED —
 * they affect labelling, not pixel output.
 */
export function computeRenderHash(req: UniversalRenderRequest): string {
  const canonical = JSON.stringify({
    svgContent:   req.source.svgContent,
    canvasWidth:  req.source.canvasWidth,
    canvasHeight: req.source.canvasHeight,
    formats:      [...req.formats].sort(),
    previewMode:  req.previewMode ?? false,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Look up a cached result for the given content hash.
 * Returns null if the hash is unknown or the entry has expired.
 */
export function checkIdempotency(hash: string): UniversalRenderResult | null {
  evictExpired();
  const entry = _cache.get(hash);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    _cache.delete(hash);
    return null;
  }
  return entry.result;
}

/**
 * Store a completed render result keyed by its content hash.
 * Evicts the oldest entry if the cache is at capacity.
 */
export function recordIdempotencyResult(hash: string, result: UniversalRenderResult): void {
  evictExpired();
  if (_cache.size >= UNIVERSAL_RENDER_LIMITS.IDEMPOTENCY_MAX_ENTRIES) {
    evictOldest();
  }
  _cache.set(hash, {
    result,
    expiresAt: Date.now() + UNIVERSAL_RENDER_LIMITS.IDEMPOTENCY_TTL_MS,
  });
}

/** Expose cache size for health probe / tests. */
export function idempotencyCacheSize(): number {
  return _cache.size;
}

/** Flush the cache — test-only. */
export function _flushIdempotencyCache(): void {
  _cache.clear();
}
