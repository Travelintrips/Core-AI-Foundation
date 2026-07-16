/**
 * Design Batch Engine — Phase 3A Benchmark
 *
 * Measures performance of:
 *   - createBatch() with 100 items (chunked insert)
 *   - createBatch() with 1,000 items (chunked insert)
 *   - reconcileDesignRenderBatch() with 100 items
 *   - reconcileDesignRenderBatch() with 1,000 items
 *   - computeInputHash() throughput
 *
 * NOT run as part of the test suite — execute manually when needed:
 *   pnpm tsx src/tests/designBatchBenchmark.ts
 *
 * Does NOT run full renders or real dispatch (no external dependencies).
 */

import { performance } from "perf_hooks";
import { computeInputHash } from "../services/designTemplateVariableService.js";
import { batchConfig, computeNextRetryAt } from "../services/design-batch/config.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

function bench(label: string, fn: () => unknown, iterations = 1): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const end = performance.now();
  const totalMs = end - start;
  const perMs = totalMs / iterations;
  console.log(`[bench] ${label}: ${totalMs.toFixed(2)}ms total, ${perMs.toFixed(4)}ms/op (${iterations} iterations)`);
  return totalMs;
}

async function asyncBench(label: string, fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  const end = performance.now();
  const totalMs = end - start;
  console.log(`[bench] ${label}: ${totalMs.toFixed(2)}ms`);
  return totalMs;
}

// ── Hash benchmarks ───────────────────────────────────────────────────────────

function benchHash() {
  console.log("\n─── computeInputHash ────────────────────────────────────────────");

  const templateVersionId = 42;
  const row100 = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`field_${i}`, `value_${i}`]),
  );

  bench("computeInputHash × 100 iterations (small row)", () => {
    computeInputHash(templateVersionId, row100);
  }, 100);

  bench("computeInputHash × 1000 iterations (small row)", () => {
    computeInputHash(templateVersionId, row100);
  }, 1000);
}

// ── Chunked insert simulation ─────────────────────────────────────────────────

function simulateChunkedInsert(itemCount: number): { chunks: number; totalMs: number } {
  const chunkSize = batchConfig.insertChunkSize; // 250
  const chunks = Math.ceil(itemCount / chunkSize);
  const start = performance.now();

  // Simulate hash computation for all items (the expensive part of createBatch)
  for (let i = 0; i < itemCount; i++) {
    const row = { product_name: `Product ${i}`, price: i * 1.5, qty: i };
    computeInputHash(1, row);
  }

  const totalMs = performance.now() - start;
  return { chunks, totalMs };
}

function benchCreateBatch() {
  console.log("\n─── createBatch (hash computation simulation) ───────────────────");

  const result100 = simulateChunkedInsert(100);
  console.log(
    `[bench] createBatch 100 items: ${result100.totalMs.toFixed(2)}ms ` +
    `(${result100.chunks} chunk${result100.chunks > 1 ? "s" : ""} of ${batchConfig.insertChunkSize})`,
  );

  const result1000 = simulateChunkedInsert(1000);
  console.log(
    `[bench] createBatch 1000 items: ${result1000.totalMs.toFixed(2)}ms ` +
    `(${result1000.chunks} chunks of ${batchConfig.insertChunkSize})`,
  );
}

// ── Dispatch simulation ───────────────────────────────────────────────────────

function simulateDispatch(itemCount: number): { chunks: number; totalMs: number } {
  const chunkSize = batchConfig.dispatchChunkSize;    // 100
  const concurrency = batchConfig.dispatchConcurrency; // 5
  const chunks = Math.ceil(itemCount / chunkSize);
  const start = performance.now();

  // Simulate dispatch marker computation
  for (let i = 0; i < itemCount; i++) {
    const _ = computeNextRetryAt(0); // most items get attempt 0
  }

  const totalMs = performance.now() - start;
  return { chunks, totalMs };
}

function benchDispatch() {
  console.log("\n─── dispatch simulation ─────────────────────────────────────────");

  const result100 = simulateDispatch(100);
  console.log(
    `[bench] dispatch 100 items: ${result100.totalMs.toFixed(2)}ms ` +
    `(${result100.chunks} chunk${result100.chunks > 1 ? "s" : ""} of ${batchConfig.dispatchChunkSize})`,
  );

  const result1000 = simulateDispatch(1000);
  console.log(
    `[bench] dispatch 1000 items: ${result1000.totalMs.toFixed(2)}ms ` +
    `(${result1000.chunks} chunks of ${batchConfig.dispatchChunkSize})`,
  );
}

// ── Reconciliation simulation ─────────────────────────────────────────────────

function simulateReconcile(itemCount: number): { totalMs: number } {
  // Simulate the aggregation work (in real code this is a single GROUP BY query)
  const start = performance.now();

  // Simulate status bucketing
  const byStatus: Record<string, number> = {};
  for (let i = 0; i < itemCount; i++) {
    const status = i % 10 === 0 ? "failed" : "completed";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  const queued     = byStatus["queued"]     ?? 0;
  const processing = byStatus["processing"] ?? 0;
  const completed  = byStatus["completed"]  ?? 0;
  const failed     = byStatus["failed"]     ?? 0;
  const cancelled  = byStatus["cancelled"]  ?? 0;
  const total      = queued + processing + completed + failed + cancelled;

  const progressPercent = total > 0
    ? Math.min(100, Math.round(((completed + failed + cancelled) / total) * 100))
    : 0;

  const totalMs = performance.now() - start;
  return { totalMs };
}

function benchReconcile() {
  console.log("\n─── reconciliation simulation ───────────────────────────────────");

  const result100 = simulateReconcile(100);
  console.log(`[bench] reconcile 100 items (in-memory): ${result100.totalMs.toFixed(4)}ms`);

  const result1000 = simulateReconcile(1000);
  console.log(`[bench] reconcile 1000 items (in-memory): ${result1000.totalMs.toFixed(4)}ms`);
}

// ── Memory ────────────────────────────────────────────────────────────────────

function logMemory() {
  const mem = process.memoryUsage();
  console.log("\n─── Peak memory ─────────────────────────────────────────────────");
  console.log(
    `[bench] heapUsed: ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB  ` +
    `heapTotal: ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB  ` +
    `rss: ${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log("=== Design Batch Engine Phase 3A Benchmark ===");
  console.log(`Config: maxItems=${batchConfig.maxItems}, chunkSize=${batchConfig.insertChunkSize}, dispatchChunk=${batchConfig.dispatchChunkSize}`);

  benchHash();
  benchCreateBatch();
  benchDispatch();
  benchReconcile();
  logMemory();

  console.log("\n=== Benchmark complete ===");
})();
