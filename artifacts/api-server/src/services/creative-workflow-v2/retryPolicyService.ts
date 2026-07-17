/**
 * retryPolicyService — Retry and failover logic for execution nodes.
 *
 * All functions are PURE (no side effects, no DB access).
 * They return new objects; callers are responsible for persistence.
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import type { ExecutionNode, RetryState } from "../../types/creative-workflow-v2/index.js";
import type { RetryPolicy } from "../../types/creative-workflow-v2/index.js";

/** Default policy applied when neither the node nor the workflow defines one. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetry: 3,
  strategy: "exponential",
  backoffMs: 1_000,
  maxBackoffMs: 60_000,
};

// ── Delay calculation ─────────────────────────────────────────────────────────

/**
 * Compute the delay in ms before the next retry attempt.
 *
 * @returns
 *   ≥ 0  — number of ms to wait
 *  -1    — "manual" strategy: do not schedule; operator must intervene
 */
export function computeNextRetryDelayMs(
  policy: RetryPolicy,
  retryCount: number,
): number {
  switch (policy.strategy) {
    case "immediate":
      return 0;
    case "manual":
      return -1;
    case "exponential": {
      const base = policy.backoffMs ?? 1_000;
      const cap  = policy.maxBackoffMs ?? 60_000;
      // Standard exponential: base × 2^retryCount, capped.
      return Math.min(base * Math.pow(2, retryCount), cap);
    }
  }
}

// ── Eligibility ───────────────────────────────────────────────────────────────

/**
 * Returns true when the node may be retried without operator intervention.
 */
export function canAutoRetry(state: RetryState): boolean {
  if (state.strategy === "manual") return false;
  return state.retryCount < state.maxRetry;
}

/**
 * Returns true when all retry budget has been exhausted (regardless of strategy).
 */
export function isRetryExhausted(state: RetryState): boolean {
  return state.retryCount >= state.maxRetry;
}

// ── State transitions (pure) ──────────────────────────────────────────────────

/**
 * Apply a retry to a failed node.
 *
 * If retries are available: resets status to "pending" and increments retryCount.
 * If exhausted:             transitions status to "failed" (permanent).
 *
 * Does NOT check for failover — the caller (executionPlanBuilder / planControlService)
 * is responsible for routing to the failover node when status becomes "failed".
 */
export function applyRetry(
  node: ExecutionNode,
  errorMessage?: string,
): ExecutionNode {
  const retry = node.retry;

  if (!canAutoRetry(retry)) {
    return {
      ...node,
      status: "failed",
      failedAt: new Date(),
      errorMessage: errorMessage ?? node.errorMessage,
      retry: { ...retry, lastError: errorMessage ?? retry.lastError },
    };
  }

  const newCount = retry.retryCount + 1;
  const delayMs  = computeNextRetryDelayMs(
    { maxRetry: retry.maxRetry, strategy: retry.strategy, backoffMs: 1_000, maxBackoffMs: 60_000 },
    retry.retryCount,
  );
  const nextRetryAt = delayMs >= 0 ? new Date(Date.now() + delayMs) : undefined;

  return {
    ...node,
    status: "pending",
    jobId: undefined,
    startedAt: undefined,
    errorMessage: errorMessage ?? node.errorMessage,
    retry: {
      ...retry,
      retryCount: newCount,
      nextRetryAt,
      lastError: errorMessage ?? retry.lastError,
    },
  };
}

/**
 * Build the initial RetryState for a node from a policy.
 */
export function buildRetryState(policy: RetryPolicy): RetryState {
  return {
    retryCount: 0,
    maxRetry: policy.maxRetry,
    strategy: policy.strategy,
  };
}

/**
 * Merge a node-level policy with the workflow default.
 * Node-level takes precedence; falls back to the default for missing fields.
 */
export function mergeRetryPolicy(
  nodePolicy: RetryPolicy | undefined,
  workflowDefault: RetryPolicy | undefined,
): RetryPolicy {
  const base = workflowDefault ?? DEFAULT_RETRY_POLICY;
  if (!nodePolicy) return base;
  return {
    maxRetry:    nodePolicy.maxRetry,
    strategy:    nodePolicy.strategy,
    backoffMs:   nodePolicy.backoffMs   ?? base.backoffMs,
    maxBackoffMs: nodePolicy.maxBackoffMs ?? base.maxBackoffMs,
  };
}
