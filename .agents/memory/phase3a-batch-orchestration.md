---
name: Phase 3A Batch Orchestration
description: Design Template Engine Phase 3A — lifecycle state machine, dispatcher, stale recovery, startup resume; key invariants and rules
---

## State Machine (batchLifecycle.ts)

ALLOWED_TRANSITIONS map is the single source of truth. assertBatchTransition() throws BatchLifecycleError on illegal transitions. Key rules:
- `cancelling → cancelled` is the ONLY terminal transition from cancelling
- `partially_failed | failed → queued` are the ONLY retry transitions
- `completed` and `cancelled` have no outgoing transitions
- `cancelBatch()` is idempotent: status='cancelled' returns immediately, status='cancelling' also returns without re-entering machine

## Dispatcher (batchDispatcher.ts)

- Payload carries identifiers only: `{ tenantId, batchId, renderItemId }` — never template JSON or binary
- Atomic claim: UPDATE...WHERE status='queued' CAS prevents double-dispatch
- Failure window: crash between enqueue() and marker update leaves item in 'dispatching'. Safe because render worker is idempotent (skips already-completed items)
- Items eligible for re-dispatch: `dispatch_status IN ('pending', 'dispatching')` and `status='queued'`
- Tenant cap: maxActiveItemsPerTenant=200, maxActiveBatchesPerTenant=5, dispatchWindowSize=100
- Chunked: dispatchChunkSize=100, dispatchConcurrency=5

## Reconciliation (designRenderBatchService.ts)

`reconcileDesignRenderBatch()` is the canonical counter — always query actual item states, never trust denormalized batch counters alone. Status determination rules:
- Any queued|processing items → `processing` (or `cancelling` if batch is cancelling)
- All terminal + cancelling → `cancelled`
- All terminal, no failures → `completed`
- All terminal, no successes → `failed`
- Both successes + failures → `partially_failed`
Progress = min(100, round((completed+failed+cancelled)/total × 100))

## Stale Recovery (staleRecovery.ts)

- Only steal leases that are provably expired: `leaseExpiresAt IS NOT NULL AND leaseExpiresAt < now`
- Re-confirm in the WHERE of the UPDATE (atomic guard against concurrent heartbeat extending the lease)
- item.attemptCount < batchConfig.maxAttempts → requeue; else → terminal 'failed'
- processingLeaseMs=120000 (2min), staleScanIntervalMs=60000 (1min)

## Export Snapshot (Team 2 contract)

`getExportableBatchSnapshot()` always calls `reconcileDesignRenderBatch()` first to ensure accurate data. Returns `completedItems` with `outputAssetId` (= outputStoragePath), `failedItems`, and a `sourceFingerprint` SHA-256 (16 hex chars) of `batchId:status:itemCount:completedCount`.

## Route additions (Phase 3A)

- `GET /ai/design-render-batches/:id/progress` — live reconcile + returns `{status, counts, progressPercent}`
- `GET /ai/design-render-batches/:id/items` — cursor pagination (cursor=itemId), `status`, `errorCode`, `rowIndex` filters, limit max 200
- `POST /ai/design-render-batches/:id/cancel` — idempotent

## Build fix

Added `qrcode` and `zod` to esbuild externals in `build.mjs` (pre-existing failures, not Phase 3A regressions).

**Why:** qrcode is used by design-renderer/elementRenderer.ts; zod is imported directly in validators/designTemplateSchema.ts. Both are bundleable but were not in the externals list.

## Test counts

Phase 3A adds 3 test files:
- designBatchLifecycle.test.ts — valid/invalid transitions, helpers, config, computeNextRetryAt
- designBatchDispatcher.test.ts — payload contract, tenant fairness, chunking math, idempotency markers
- designBatchRecovery.test.ts — retry policy, reconciliation rules, lease logic, cancel idempotency, cross-tenant

2 pre-existing suites remain broken (qrcode / zod missing in vitest runtime — separate from esbuild fix): designRenderer.test.ts, designTemplate.test.ts.
