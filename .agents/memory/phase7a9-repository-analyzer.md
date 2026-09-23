---
name: Phase 7A-9 Repository Analyzer
description: Repository Analyzer execution lifecycle through the existing ai_jobs dispatcher and coding workspace state.
---

The Repository Analyzer must run as an `ai_jobs` worker job, not inside the HTTP request. Its payload carries both UUIDs (`codingTaskId` and `codingRunId`) because generic job IDs are numeric. The worker persists structured output in the coding run logs, mirrors a concise summary to the task, changes successful tasks to `READY_REVIEW`, and changes failures to `FAILED`; it must never set `commitSha`.

**Why:** The coding workspace run is an asynchronous analysis step, and using the existing queue preserves retry, capability routing, terminal timestamps, duplicate-run protection, and frontend polling semantics without changing the completed Run Agent wiring.

**How to apply:** Add future coding execution types to the worker capability map, `executeJob()` dispatch, and terminal lifecycle persistence together. Keep the route limited to the transactional `RUNNING` row plus job enqueue.