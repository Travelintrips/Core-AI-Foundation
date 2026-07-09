---
name: Phase 6 AI Scheduler & Automation Engine
description: Design notes for the scheduler runtime, target-type dispatch, and a job-priority type pitfall discovered while seeding sample schedules.
---

## Overview
Phase 6 added `ai_schedules` + `ai_schedule_runs` tables, `aiSchedulerService` (cron/interval/one_time/event_followup/deadline_reminder triggers), a poll-based runtime (env: `AI_SCHEDULER_ENABLED`, `AI_SCHEDULER_POLL_INTERVAL_MS`, `AI_SCHEDULER_TIMEZONE`), REST routes under `/api/ai/schedules*` and `/api/ai/scheduler/*`, and a `/scheduler` frontend page. `target_type` supports `create_job`, `publish_event`, `webhook` (audit-log only, never actually dispatched), and `audit_log`.

## Job priority must be numeric, not a label string
When a schedule's `targetType` is `create_job`, `targetConfigJson.priority` is passed straight through to `enqueue()` (queueManagerService), which requires a number — it flows into `computePriorityScore` and an integer DB column. Passing a string like `"low"` casts silently at the TS level (`as number` doesn't convert) and fails at insert time with a Postgres type error.

**Why:** The scheduler service does `(config["priority"] as number) ?? 50` — a type assertion, not a runtime conversion — so bad data isn't caught until the DB insert.

**How to apply:** Any `targetConfigJson` for a `create_job` schedule must use a numeric `priority` (e.g. `30`), never a string label. If ever accepting string priority labels from the UI, map them to numbers in the service before calling `enqueue()`.
