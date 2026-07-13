---
name: Phase 1B — Stop False Completion and Production Safety
description: Guards that prevent stub workers from fake-completing jobs without real deliverables
---

## What was implemented

### New file: `artifacts/api-server/src/services/jobCompletionGuard.ts`
- `JOB_COMPLETION_REQUIREMENTS` registry — maps job types to `{ requiresAsset, requiredResultFields }`
- `WorkerNotImplementedError` (code: `WORKER_NOT_IMPLEMENTED`) — thrown by stub workers
- `DeliverableValidationError` (codes: `DELIVERABLE_NOT_CREATED`, `ASSET_VALIDATION_FAILED`) — thrown by guard
- `validateJobCompletion(jobType, result)` — pure function called in dispatcher before `completeJob()`
- `isFalseCompletionResult(result)` — used by audit script to detect past false completions
- `isFileProducingJob(jobType)` — predicate exported for use elsewhere

### Key rule: stub-dispatch detection
Result with `message.includes("dispatched") && fieldCount <= 2` is always rejected for file-producing jobs.
URL fields (`imageUrl`, `permanentUrl`) must start with `http://` or `https://`.

### Modified: `jobWorkerService.ts`
Stubs that previously returned `{ message: "... dispatched" }` now throw `WorkerNotImplementedError`:
- `image_qc`, `pdf_export`, `csv_export`, `analytics`, `cleanup`

### Modified: `jobDispatcherService.ts`
`dispatch()` now calls `validateJobCompletion(job.jobType, result)` BEFORE `completeJob()`.
A `DeliverableValidationError` is caught by the same catch block → `retryJob()` → eventually `failed`.

### New file: `artifacts/api-server/src/lib/supabaseStorage.ts`
Added `storageObjectExists(path): Promise<boolean>` — HEAD request, returns false on network error.

### Modified: `artifacts/api-server/src/routes/files.ts`
Before redirecting to the signed URL, does a HEAD check on the actual storage URL.
Returns structured errors: 404 FILE_NOT_FOUND, 409 PRODUCTION_INCOMPLETE, 410 FILE_EXPIRED, 503 STORAGE_UNAVAILABLE.

### New file: `artifacts/api-server/src/scripts/auditFalseCompletions.ts`
Script to find and (optionally) fix past false-completed jobs.
Run: `pnpm creative:audit-false-completions --dry-run` or `--apply`
`--apply` sets status=failed, nulls completedAt, writes audit log. Does NOT cascade to projects.

### Modified: `artifacts/customer-portal/src/pages/workspace/project-detail.tsx`
- Added `"danger"` variant to `InsightVariant` + `INSIGHT_STYLES`
- `getInsight()` now returns a red danger banner when `stage === "failed"`

### Tests: `artifacts/api-server/src/services/__tests__/jobCompletionGuard.test.ts`
16 tests covering all Phase 1B scenarios. All pass. Total test suite: 146 tests, all passing.

## Why
Stub workers were returning `{ message: "... dispatched" }` and the dispatcher immediately called
`completeJob()` with that value — silently marking jobs `completed` with zero files created.
Services `company-profile` and `pitch-deck` (which dispatch `pdf_export`) were producing no output
but appearing as completed to customers.

## How to apply
- Audit existing false completions: `pnpm creative:audit-false-completions --dry-run`
- Fix them: `pnpm creative:audit-false-completions --apply`
- After apply: review affected creative_projects and service_requests manually; their stage may
  need to be reset from `completed` back to `in_progress` or `failed` by an admin.
