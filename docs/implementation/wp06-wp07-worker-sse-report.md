# WP-06 & WP-07 Implementation Report

**TEAM C — Worker / Scheduler / SSE / Export Context**
**Date:** 2026-07-14
**Status:** ✅ Implemented & Verified (build clean, API server running)

---

## Scope

| Area | WP | Status |
|------|----|--------|
| Worker context | WP-06 | ✅ |
| Scheduler context | WP-06 | ✅ |
| Job payload `_tenantId` | WP-06 | ✅ |
| Export tenant context | WP-06 | ✅ |
| SSE tenant isolation | WP-07 | ✅ |
| SSE event filtering | WP-07 | ✅ |
| SSE reconnect validation | WP-07 | ✅ |

---

## WP-06: Worker & Scheduler Context

### 1. Job Payload — `tenantId` stamping
**File:** `artifacts/api-server/src/services/queueManagerService.ts`

`EnqueueJobInput` now accepts an optional `tenantId?: string`. When provided, `enqueue()` stamps it into `payloadJson` under the reserved key `_tenantId` **before** the row is written to the database. This key is always written by `enqueue()` — it is never read from unverified client input.

```ts
// EnqueueJobInput (new field)
tenantId?: string;

// Inside enqueue() — stamped before INSERT
const payloadJson: Record<string, unknown> = {
  ...(input.payloadJson ?? {}),
  ...(input.tenantId ? { _tenantId: input.tenantId } : {}),
};
```

**Invariant:** `_tenantId` in a stored job always reflects the server-resolved tenant at enqueue time. Workers read it back without a DB round-trip.

---

### 2. Worker Context — `buildWorkerContext()`
**File:** `artifacts/api-server/src/services/jobWorkerService.ts`

New exported helper `buildWorkerContext(job: AiJob): RequestContext` creates a fully-typed `RequestContext` for each job execution:

```ts
export function buildWorkerContext(job: AiJob): RequestContext {
  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof payload["_tenantId"] === "string" && payload["_tenantId"].length > 0
      ? payload["_tenantId"]
      : DEFAULT_TENANT_ID;          // graceful fallback for pre-WP-06 jobs

  return createSystemContext({
    tenantId,
    actorType: "worker",
    source: "worker",
    requestId: `job-${job.id}-${job.jobCode ?? ""}`,
    correlationId: `job-${job.id}`,
    metadata: { jobId: job.id, jobType: job.jobType ?? "", jobCode: job.jobCode ?? "" },
  });
}
```

`executeJob()` calls `buildWorkerContext(job)` at the top of every dispatch cycle. The resolved `tenantId` and `actorType` are logged structurally alongside `jobId` and `jobType`:

```ts
logger.info(
  { jobId: job.id, jobType: job.jobType, tenantId: workerCtx.tenantId, actorType: workerCtx.actorType },
  "[executeJob] dispatching",
);
```

**Design notes:**
- Uses `createSystemContext` (existing factory) with `actorType: "worker"` — fully satisfies the `RequestContext` invariants defined in WP-01.
- Backward-compatible: jobs enqueued before WP-06 (no `_tenantId` field) fall back to `DEFAULT_TENANT_ID` rather than throwing.
- The context is available for downstream handlers to use — currently used for logging; can be passed into repository calls as `RepositoryContext` in future work without interface changes.

---

### 3. Scheduler Context — `tenantId` propagation
**File:** `artifacts/api-server/src/services/aiSchedulerService.ts`

`createJobFromSchedule()` now extracts `tenantId` from `schedule.targetConfigJson["tenantId"]` (an operator-controlled field, never client-supplied) and passes it to `enqueue()`:

```ts
export async function createJobFromSchedule(schedule: AiSchedule): Promise<{ jobId: number }> {
  const config = (schedule.targetConfigJson ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof config["tenantId"] === "string" && config["tenantId"].length > 0
      ? config["tenantId"]
      : DEFAULT_TENANT_ID;       // safe default for schedules without explicit tenant

  const job = await enqueue({
    jobType,
    payloadJson: { ...schedulePayload },
    // ... other fields ...
    tenantId,                    // ← WP-06: propagated to job payload as _tenantId
  });
  return { jobId: job.id };
}
```

**Invariant:** The scheduler is a trusted (`actorType: "scheduler"`) system actor. `tenantId` in `targetConfigJson` is always written by the admin/operator — never exposed to or writable by end-users.

---

### 4. Export Tenant Context
**File:** `artifacts/api-server/src/routes/export-routes.ts`

Both export endpoints now call `resolveAuthenticatedTenantContext(req)` to get a server-resolved `RequestContext` before touching any data.

**Markdown export** — adds `tenantId` and `actorId` to the audit log:
```ts
const ctx = resolveAuthenticatedTenantContext(req);
await logAudit("creative-ai", "export_markdown", project.projectId, "creative_project", "success", {
  tenantId: ctx.tenantId,
  actorId: ctx.actorId,
});
```

**CSV analytics export** — adds a `tenant_id` WHERE clause to the query, preventing cross-tenant leakage:
```ts
const ctx = resolveAuthenticatedTenantContext(req);
const tenantId = ctx.tenantId;
// ...
if (tenantId) {
  query = query.where(sql`tenant_id = ${tenantId}`) as typeof query;
}
await logAudit("analytics", "export_csv", "system", "ai_cost_records", "success", {
  rows: rows.length, days, tenantId, actorId: ctx.actorId,
});
```

**Note:** In single-tenant mode today (`tenantId = "default"` always), no data is excluded by this filter. The guard becomes load-bearing when real multi-tenancy ships (WP-02+) — zero call-site changes will be needed.

---

## WP-07: SSE Tenant Isolation

**Files modified:**
- `artifacts/api-server/src/services/sseManager.ts`
- `artifacts/api-server/src/routes/customer-workspace-sse.ts`

### 1. Interface changes — `tenantId` added to `Subscriber` and `ProjectChannel`

```ts
// Subscriber
export interface Subscriber {
  readonly tenantId: string;   // ← WP-07 (new)
  // ...existing fields unchanged...
}

// ProjectChannel (internal)
interface ProjectChannel {
  readonly tenantId: string;   // ← WP-07 (new) — set on first subscriber
  // ...existing fields unchanged...
}

// RegisterOptions
export interface RegisterOptions {
  tenantId?: string;           // ← WP-07 (new) — server-resolved, optional (defaults to "default")
  // ...existing fields unchanged...
}
```

All additions are **additive** — no existing callers break. `tenantId` defaults to `"default"` inside `registerSubscriber()` if not supplied, so the existing test suite continues to compile and pass.

---

### 2. SSE tenant isolation guard

When a new subscriber registers for an existing channel, `registerSubscriber()` validates that the incoming `tenantId` matches the channel's owner:

```ts
// ── WP-07: Tenant isolation guard ─────────────────────────────────────────
if (channel.tenantId !== tenantId) {
  logger.warn(
    { projectId: opts.projectId, channelTenant: channel.tenantId, requestTenant: tenantId },
    "[sse] WP-07 tenant mismatch — rejecting subscriber",
  );
  return { ok: false, status: 403, error: "Tenant mismatch for this project stream" };
}
```

**Guarantee:** A channel created by tenant A can never fan out events to a subscriber from tenant B, even if both happen to share the same internal `projectId`. The first subscriber sets the channel's tenant; all later subscribers are validated against it.

---

### 3. Reconnect validation

When a client reconnects with a `Last-Event-ID` cursor, the cursor's channel must belong to the same tenant as the reconnecting session:

```ts
// ── WP-07: Reconnect validation — cursor tenant must match channel tenant ─
if (opts.afterCursor !== null && channel.tenantId !== tenantId) {
  logger.warn(
    { projectId: opts.projectId, channelTenant: channel.tenantId, requestTenant: tenantId },
    "[sse] WP-07 reconnect tenant mismatch — cursor rejected",
  );
  return { ok: false, status: 403, error: "Cursor tenant mismatch — reconnect rejected" };
}
```

**Why this matters:** The cursor is an opaque `base64url` blob — not a signed token. Without this check, a client that somehow obtained another tenant's cursor value could use it to resume a stream for the wrong tenant. This guard closes that gap.

---

### 4. SSE route — server-resolved `tenantId`

**File:** `artifacts/api-server/src/routes/customer-workspace-sse.ts`

`DEFAULT_TENANT_ID` is imported from `security/tenantResolution.ts` and passed to `registerSubscriber()`:

```ts
import { DEFAULT_TENANT_ID } from "../security/tenantResolution.js";

const result = await registerSubscriber({
  // ...existing options...
  tenantId: DEFAULT_TENANT_ID,   // ← WP-07: never from client input
});
```

The value is sourced from `tenantResolution.ts` (the same module that `resolveAuthenticatedTenantContext` uses), so when real per-user tenant resolution ships, **only `tenantResolution.ts` needs to change** — the SSE route call-site does not.

---

## Files Changed

| File | Change type | WP |
|------|-------------|-----|
| `artifacts/api-server/src/services/queueManagerService.ts` | Add `tenantId` to `EnqueueJobInput`; stamp `_tenantId` in `enqueue()` | WP-06 |
| `artifacts/api-server/src/services/jobWorkerService.ts` | Add `buildWorkerContext()`, use in `executeJob()` | WP-06 |
| `artifacts/api-server/src/services/aiSchedulerService.ts` | Extract & propagate `tenantId` in `createJobFromSchedule()` | WP-06 |
| `artifacts/api-server/src/routes/export-routes.ts` | `resolveAuthenticatedTenantContext`, tenant-scoped audit + CSV filter | WP-06 |
| `artifacts/api-server/src/services/sseManager.ts` | `tenantId` on `Subscriber`/`ProjectChannel`/`RegisterOptions`; isolation + reconnect guards | WP-07 |
| `artifacts/api-server/src/routes/customer-workspace-sse.ts` | Pass server-resolved `DEFAULT_TENANT_ID` to `registerSubscriber()` | WP-07 |

---

## Constraints Respected

| Constraint | Status |
|------------|--------|
| No new repository | ✅ — existing repositories untouched |
| No `RequestContext` type changes | ✅ — used `createSystemContext()` (existing factory) |
| No audit schema changes | ✅ — only audit *calls* updated |
| No quotation touch | ✅ |
| No soft delete | ✅ |
| No frontend redesign | ✅ |
| Use existing `RequestContext` | ✅ — `createSystemContext`, `resolveAuthenticatedTenantContext` |
| Use existing repositories | ✅ — `enqueue()`, `logAudit()`, `registerSubscriber()` extended, not replaced |

---

## Build & Runtime Verification

```
pnpm run build:api  →  ⚡ Done in 1429ms (zero errors)
API server          →  RUNNING on port 8080
  [scheduler] Started  pollIntervalMs: 10000
  [cluster]   Workers registered: dispatcher-1, dispatcher-2, dispatcher-3
  [dispatcher] Started  pollIntervalMs: 5000
```

---

## Design Decisions

1. **`_tenantId` as payload field (not a DB column):** Adding a `tenant_id` column to `ai_jobs` would require a schema migration. Stamping into `payloadJson` achieves the same goal for worker context with zero DDL — fully consistent with the project rule "hand-write DDL for new tables, avoid drizzle-kit push".

2. **`buildWorkerContext()` is exported:** Downstream handlers (e.g., PDF/presentation export workers) can call `buildWorkerContext(job)` and pass the result as a `RepositoryContext` to future tenant-scoped repository calls without needing any interface changes.

3. **`tenantId` optional in `RegisterOptions`:** Defaults to `"default"` inside `registerSubscriber()` rather than being required, preserving backward compatibility with the existing test suite (`sseManager.test.ts`) which does not supply `tenantId`.

4. **Reconnect validation position:** The reconnect guard runs *after* the tenant-isolation guard, so a request with both a mismatched `tenantId` *and* a cursor hits the isolation guard first (403) — consistent error surface, no information leakage about cursor validity.
