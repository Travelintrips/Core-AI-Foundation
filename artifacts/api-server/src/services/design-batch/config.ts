/**
 * Design Batch Orchestration — Configuration
 *
 * All process.env reads for the batch subsystem are centralised here.
 * Mirrors the pattern in design-renderer/config.ts.
 */

export const batchConfig = {
  // ── Batch creation limits ──────────────────────────────────────────────────
  /** Maximum number of items allowed per batch */
  maxItems: parseInt(process.env["DESIGN_BATCH_MAX_ITEMS"] ?? "10000", 10),
  /** Number of render items inserted per DB round-trip during batch creation */
  insertChunkSize: parseInt(process.env["DESIGN_BATCH_INSERT_CHUNK_SIZE"] ?? "250", 10),

  // ── Dispatcher ──────────────────────────────────────────────────────────────
  /** How many items to enqueue per dispatcher iteration pass */
  dispatchChunkSize: parseInt(process.env["DESIGN_BATCH_DISPATCH_CHUNK_SIZE"] ?? "100", 10),
  /** Max simultaneous enqueue() calls during a single dispatch pass */
  dispatchConcurrency: parseInt(process.env["DESIGN_BATCH_DISPATCH_CONCURRENCY"] ?? "5", 10),
  /** Maximum outstanding render jobs per batch window */
  dispatchWindowSize: parseInt(process.env["DESIGN_BATCH_DISPATCH_WINDOW_SIZE"] ?? "100", 10),

  // ── Tenant fairness / backpressure ─────────────────────────────────────────
  /** Max concurrently-processing render items across all batches for one tenant */
  maxActiveItemsPerTenant: parseInt(process.env["DESIGN_BATCH_MAX_ACTIVE_ITEMS_PER_TENANT"] ?? "200", 10),
  /** Max batches per tenant that may be in a non-terminal state at once */
  maxActiveBatchesPerTenant: parseInt(process.env["DESIGN_BATCH_MAX_ACTIVE_BATCHES_PER_TENANT"] ?? "5", 10),

  // ── Render worker lease ────────────────────────────────────────────────────
  /** How long a render worker may hold an item before the lease is considered stale (ms) */
  processingLeaseMs: parseInt(process.env["DESIGN_RENDER_PROCESSING_LEASE_MS"] ?? "120000", 10),
  /** How often the stale-item recovery scanner runs (ms) */
  staleScanIntervalMs: parseInt(process.env["DESIGN_RENDER_STALE_SCAN_INTERVAL_MS"] ?? "60000", 10),

  // ── Retry policy ───────────────────────────────────────────────────────────
  /** Maximum render attempts per item (1 initial + retries) */
  maxAttempts: parseInt(process.env["DESIGN_RENDER_MAX_ATTEMPTS"] ?? "3", 10),
  /** Base delay for exponential backoff between render retries (ms) */
  retryBaseDelayMs: parseInt(process.env["DESIGN_RENDER_RETRY_BASE_DELAY_MS"] ?? "30000", 10),

  // ── Render concurrency ─────────────────────────────────────────────────────
  /** Worker-level render concurrency (default kept intentionally low) */
  renderConcurrency: parseInt(process.env["DESIGN_RENDER_CONCURRENCY"] ?? "2", 10),
} as const;

/** Compute next_retry_at for a given attempt number (0-based). */
export function computeNextRetryAt(attemptNumber: number): Date {
  const cfg = batchConfig;
  let delayMs: number;
  if (attemptNumber === 0) {
    delayMs = 0; // immediate
  } else if (attemptNumber === 1) {
    delayMs = cfg.retryBaseDelayMs; // +30s
  } else {
    delayMs = cfg.retryBaseDelayMs * 4; // +2m (30s × 4)
  }
  return new Date(Date.now() + delayMs);
}
