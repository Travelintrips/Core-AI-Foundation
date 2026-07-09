---
name: Phase 6 AI Scheduler & Automation Engine
description: Design notes for the scheduler runtime, target-type dispatch, and a job-priority type pitfall discovered while seeding sample schedules.
---

## Overview
Phase 6 added `ai_schedules` + `ai_schedule_runs` tables, `aiSchedulerService` (cron/interval/one_time/event_followup/deadline_reminder triggers), a poll-based runtime (env: `AI_SCHEDULER_ENABLED`, `AI_SCHEDULER_POLL_INTERVAL_MS`, `AI_SCHEDULER_TIMEZONE`), REST routes under `/api/ai/schedules*` and `/api/ai/scheduler/*`, and a `/scheduler` frontend page. `target_type` supports `create_job`, `publish_event`, `webhook` (audit-log only, never actually dispatched), and `audit_log`.

## Concurrency guard must span the whole execution, not just the claim transaction
`FOR UPDATE SKIP LOCKED` inside a short claim transaction only prevents *simultaneous* claims. If the claim transaction commits and releases its lock before the actual execution (`executeDueSchedules`) finishes, a second `runNow()`/`tick()` call issued in that window sees the row as unlocked and `status='active'` and will execute it again — a real double-execution, reproduced live under concurrent load (two run rows, two jobs, same runNumber, from one nominally-guarded schedule).

**Why:** A transactional row lock is scoped to the transaction, not to "this schedule is mid-run." Any execution that continues after the claiming transaction commits needs its own persistent marker.

**How to apply:** Added a persistent `is_running` boolean column on `ai_schedules`. Every claim path (tick's `_tickInner`, `runNow`) must filter `WHERE is_running = false` in its `FOR UPDATE SKIP LOCKED` select and set `is_running = true` inside that same claim transaction; every completion path (success and failure) must clear it back to `false`. Wrap the whole execution in a `finally` that force-clears the flag as a defensive fallback, so an unexpected throw before the normal completion update can't leave a schedule permanently stuck as "running."

## Job priority must be numeric, not a label string
When a schedule's `targetType` is `create_job`, `targetConfigJson.priority` is passed straight through to `enqueue()` (queueManagerService), which requires a number — it flows into `computePriorityScore` and an integer DB column. Passing a string like `"low"` casts silently at the TS level (`as number` doesn't convert) and fails at insert time with a Postgres type error.

**Why:** The scheduler service does `(config["priority"] as number) ?? 50` — a type assertion, not a runtime conversion — so bad data isn't caught until the DB insert.

**How to apply:** Any `targetConfigJson` for a `create_job` schedule must use a numeric `priority` (e.g. `30`), never a string label. If ever accepting string priority labels from the UI, map them to numbers in the service before calling `enqueue()`.
