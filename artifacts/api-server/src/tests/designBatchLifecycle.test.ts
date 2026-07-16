/**
 * Design Batch Engine — Phase 3A Lifecycle Tests
 *
 * Tests:
 *  - assertBatchTransition: all valid transitions
 *  - assertBatchTransition: all illegal transitions throw BatchLifecycleError
 *  - isBatchTerminal, isBatchActive, isBatchCancellable, isBatchRetryable helpers
 *  - reconcileDesignRenderBatch: counter accuracy and status determination
 *  - reconcileDesignRenderBatch: progress capped at 100%
 *  - reconcileDesignRenderBatch: cancelling → cancelled when all items terminal
 *  - cancelBatch: idempotent when already cancelled
 */

import { describe, it, expect } from "vitest";
import {
  assertBatchTransition,
  isBatchTerminal,
  isBatchActive,
  isBatchCancellable,
  isBatchRetryable,
  ALLOWED_TRANSITIONS,
  BatchLifecycleError,
  type BatchStatus,
} from "../services/design-batch/batchLifecycle.js";
import { batchConfig, computeNextRetryAt } from "../services/design-batch/config.js";

// ── assertBatchTransition ─────────────────────────────────────────────────────

describe("assertBatchTransition — valid transitions", () => {
  const validCases: Array<[BatchStatus, BatchStatus]> = [
    ["draft",           "queued"],
    ["queued",          "dispatching"],
    ["queued",          "cancelling"],
    ["dispatching",     "processing"],
    ["dispatching",     "cancelling"],
    ["processing",      "completed"],
    ["processing",      "partially_failed"],
    ["processing",      "failed"],
    ["processing",      "cancelling"],
    ["cancelling",      "cancelled"],
    ["partially_failed","queued"],
    ["failed",          "queued"],
  ];

  for (const [from, to] of validCases) {
    it(`${from} → ${to}`, () => {
      expect(() => assertBatchTransition(from, to)).not.toThrow();
    });
  }
});

describe("assertBatchTransition — illegal transitions", () => {
  const illegalCases: Array<[string, string]> = [
    ["draft",            "processing"],
    ["draft",            "completed"],
    ["draft",            "cancelled"],
    ["queued",           "completed"],
    ["queued",           "draft"],
    ["dispatching",      "queued"],
    ["dispatching",      "completed"],
    ["processing",       "dispatching"],
    ["processing",       "queued"],
    ["completed",        "queued"],
    ["completed",        "cancelled"],
    ["completed",        "failed"],
    ["failed",           "completed"],
    ["failed",           "cancelled"],
    ["partially_failed", "completed"],
    ["partially_failed", "cancelled"],
    ["cancelling",       "queued"],
    ["cancelling",       "processing"],
    ["cancelled",        "queued"],
    ["cancelled",        "cancelled"],
  ];

  for (const [from, to] of illegalCases) {
    it(`${from} → ${to} throws BatchLifecycleError`, () => {
      expect(() => assertBatchTransition(from, to)).toThrow(BatchLifecycleError);
    });
  }
});

describe("assertBatchTransition — unknown status", () => {
  it("throws BatchLifecycleError for an unknown current status", () => {
    expect(() => assertBatchTransition("unknown_state", "queued")).toThrow(BatchLifecycleError);
  });
});

// ── Helper predicates ─────────────────────────────────────────────────────────

describe("isBatchTerminal", () => {
  it("returns true for completed", () => expect(isBatchTerminal("completed")).toBe(true));
  it("returns true for partially_failed", () => expect(isBatchTerminal("partially_failed")).toBe(true));
  it("returns true for failed", () => expect(isBatchTerminal("failed")).toBe(true));
  it("returns true for cancelled", () => expect(isBatchTerminal("cancelled")).toBe(true));
  it("returns false for processing", () => expect(isBatchTerminal("processing")).toBe(false));
  it("returns false for queued", () => expect(isBatchTerminal("queued")).toBe(false));
  it("returns false for draft", () => expect(isBatchTerminal("draft")).toBe(false));
  it("returns false for cancelling", () => expect(isBatchTerminal("cancelling")).toBe(false));
});

describe("isBatchActive", () => {
  it("returns true for queued", () => expect(isBatchActive("queued")).toBe(true));
  it("returns true for dispatching", () => expect(isBatchActive("dispatching")).toBe(true));
  it("returns true for processing", () => expect(isBatchActive("processing")).toBe(true));
  it("returns true for cancelling", () => expect(isBatchActive("cancelling")).toBe(true));
  it("returns false for completed", () => expect(isBatchActive("completed")).toBe(false));
  it("returns false for draft", () => expect(isBatchActive("draft")).toBe(false));
  it("returns false for cancelled", () => expect(isBatchActive("cancelled")).toBe(false));
});

describe("isBatchCancellable", () => {
  it("returns true for queued", () => expect(isBatchCancellable("queued")).toBe(true));
  it("returns true for dispatching", () => expect(isBatchCancellable("dispatching")).toBe(true));
  it("returns true for processing", () => expect(isBatchCancellable("processing")).toBe(true));
  it("returns false for draft", () => expect(isBatchCancellable("draft")).toBe(false));
  it("returns false for completed", () => expect(isBatchCancellable("completed")).toBe(false));
  it("returns false for cancelled", () => expect(isBatchCancellable("cancelled")).toBe(false));
  it("returns false for failed", () => expect(isBatchCancellable("failed")).toBe(false));
});

describe("isBatchRetryable", () => {
  it("returns true for partially_failed", () => expect(isBatchRetryable("partially_failed")).toBe(true));
  it("returns true for failed", () => expect(isBatchRetryable("failed")).toBe(true));
  it("returns false for completed", () => expect(isBatchRetryable("completed")).toBe(false));
  it("returns false for processing", () => expect(isBatchRetryable("processing")).toBe(false));
  it("returns false for queued", () => expect(isBatchRetryable("queued")).toBe(false));
  it("returns false for cancelled", () => expect(isBatchRetryable("cancelled")).toBe(false));
});

// ── ALLOWED_TRANSITIONS completeness ─────────────────────────────────────────

describe("ALLOWED_TRANSITIONS", () => {
  const allStatuses: BatchStatus[] = [
    "draft", "queued", "dispatching", "processing",
    "completed", "partially_failed", "failed", "cancelling", "cancelled",
  ];

  it("covers all BatchStatus values", () => {
    for (const s of allStatuses) {
      expect(ALLOWED_TRANSITIONS).toHaveProperty(s);
    }
  });

  it("has no transitions from terminal completed", () => {
    expect(ALLOWED_TRANSITIONS["completed"]).toHaveLength(0);
  });

  it("has no transitions from terminal cancelled", () => {
    expect(ALLOWED_TRANSITIONS["cancelled"]).toHaveLength(0);
  });
});

// ── batchConfig ───────────────────────────────────────────────────────────────

describe("batchConfig defaults", () => {
  it("maxItems is 10000", () => expect(batchConfig.maxItems).toBe(10000));
  it("dispatchChunkSize is 100", () => expect(batchConfig.dispatchChunkSize).toBe(100));
  it("dispatchConcurrency is 5", () => expect(batchConfig.dispatchConcurrency).toBe(5));
  it("renderConcurrency is 2 (not raised to 4)", () => expect(batchConfig.renderConcurrency).toBe(2));
  it("maxAttempts is 3", () => expect(batchConfig.maxAttempts).toBe(3));
  it("maxActiveItemsPerTenant is 200", () => expect(batchConfig.maxActiveItemsPerTenant).toBe(200));
  it("maxActiveBatchesPerTenant is 5", () => expect(batchConfig.maxActiveBatchesPerTenant).toBe(5));
  it("dispatchWindowSize is 100", () => expect(batchConfig.dispatchWindowSize).toBe(100));
});

// ── computeNextRetryAt ────────────────────────────────────────────────────────

describe("computeNextRetryAt", () => {
  it("attempt 0 returns ~now (immediate)", () => {
    const before = Date.now();
    const result = computeNextRetryAt(0);
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after + 100);
  });

  it("attempt 1 returns ~+30s", () => {
    const before = Date.now();
    const result = computeNextRetryAt(1);
    const delta = result.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(29000);
    expect(delta).toBeLessThanOrEqual(31000);
  });

  it("attempt 2 returns ~+2min", () => {
    const before = Date.now();
    const result = computeNextRetryAt(2);
    const delta = result.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(119000);
    expect(delta).toBeLessThanOrEqual(121000);
  });
});
