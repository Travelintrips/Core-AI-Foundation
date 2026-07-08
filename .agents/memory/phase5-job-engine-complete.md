---
name: Phase 5 Job Engine — completion notes
description: What was broken and how it was fixed when finalizing Phase 5 AI Job Engine
---

# Phase 5 Job Engine — Completion Notes

## What was broken (and fixes)

### 1. Stale `dist/` in composite TS packages
`lib/api-zod`, `lib/db`, `lib/api-client-react` all use `composite: true` + `emitDeclarationOnly`.
TypeScript project references resolve from `dist/*.d.ts`, NOT from `src/`.
When new schema files (ai-jobs.ts, ai-workers.ts) or Zod schemas were added to source but the packages were not rebuilt, ALL imports from those packages broke with "no exported member" errors across the entire workspace.

**Fix:** `npx tsc -b --force` in each of the three lib packages in dependency order (db → api-zod → api-client-react).

### 2. `lib/api-zod/src/index.ts` exported a directory
`export * from "./generated/types"` — `types` is a directory, not a file.
Caused the entire `@workspace/api-zod` module to fail (cascading to all consumers).

**Fix:** Change to `export * from "./generated/types/index"`.

### 3. `tx.execute(sql\`...\`)` returns QueryResult, not an array
Drizzle node-postgres `PgTransaction.execute()` returns `QueryResult<Record<string, unknown>>`.
Destructuring `const [row] = await tx.execute(...)` fails with "must have [Symbol.iterator]".

**Fix:** `const { rows } = (rawResult as unknown as { rows: Record<string,unknown>[] })`.

### 4. claimJob() missed due `retrying` jobs
`SELECT ... FOR UPDATE SKIP LOCKED` only looked for `status = 'queued'`.
Jobs in `retrying` state with elapsed `next_retry_at` were never promoted — stalling indefinitely.

**Fix:** Extended WHERE clause to also select `status = 'retrying' AND next_retry_at <= NOW()`.

### 5. cancelJob() didn't release worker on running jobs
When a running job was cancelled, the assigned worker stayed `busy` with `current_job` set.

**Fix:** After cancel, if `job.status === 'running'`, update `aiWorkersTable` WHERE `current_job = jobId` to release it.

### 6. Body null-guard in several routes
`req.body` is undefined when no Content-Type header is sent. `const { x } = req.body` throws.
Affected: cancel route, worker status route, pause/resume routes.

**Fix:** `(req.body ?? {})` everywhere.

## Pre-existing TS errors (NOT fixed — pre-Phase 5)
- `workforce.ts:210` — QueryResult iterator (same pattern, different context)
- `creativeWorkflowRunner.ts:172,373` — null assignability, unknown property
- `imageDesignerService.ts:421+` — RecordCostParams missing stepId/clientId

**Why:** User explicitly said not to refactor outside Phase 5 scope.
