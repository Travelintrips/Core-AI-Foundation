---
name: Phase 5.2 Distributed Worker Cluster
description: Architecture decisions, pitfalls, and fixes made during Phase 5.2 implementation
---

## Key decisions

- `lock_version + 1` in Drizzle's onConflictDoUpdate must be `ai_workers.lock_version + 1` (table-qualified); unqualified references are ambiguous in PostgreSQL UPSERT.
- Cluster routes are mounted via `app.use("/api", ...)` so route handlers must NOT include `/api/` prefix (e.g. `/ai/cluster/status`, not `/api/ai/cluster/status`).
- `employee_id` IS a real column on `ai_jobs` (FK to `ai_workers.id`). The stale-job recovery primary path using `employee_id IN (staleIds)` is correct.
- `rebalanceJobs` has a two-step recovery: (1) jobs where employee_id matches stale workers, (2) safety-net for orphaned running jobs via NOT EXISTS subquery on ai_workers.current_job.
- Cluster hooks not generated via orval — kept as manual file `lib/api-client-react/src/cluster-hooks.ts`, exported from index.ts.
- Deleting `lib/api-zod/src/generated/types/` was correct: those TypeScript interface files duplicated Zod schema names, causing workspace-check failures. The types dir should NOT be regenerated.
- `cancelJob` route must NOT pass a workerId (it's not in the request); worker capacity reconciles via later recovery/heartbeat.

**Why:** all of the above were actual bugs hit during implementation that required debug cycles.

## Audit events emitted by workerClusterService
- `lease_expired` — on each worker transitioning to stale (emitted first)
- `worker_stale` — on each worker transitioning to stale (emitted second, same worker)
- `stale_job_recovered` — per job recovered during rebalance
- `job_rebalanced` — aggregate summary after rebalance
- `worker_shutdown` — emitted by jobDispatcherService on graceful shutdown

## Schema additions (Phase 5.2)
- `ai_workers`: worker_type, cluster_id, node_id, region, capabilities (jsonb), max_concurrent_jobs, lease_owner, lease_expires_at, heartbeat_token, lock_version, stale (status enum)
- `ai_jobs`: required_capability (text, nullable)
