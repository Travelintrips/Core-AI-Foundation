---
name: V4.0C Canonical Runtime Event Model
description: Architecture decisions, source-of-truth tables, and event inventory for the canonical event layer.
---

# V4.0C Canonical Runtime Event Model

## Decision: No new runtime_events table
`creative_project_steps` + `creative_ai_assets` + `creative_ai_client_reviews` are sufficient as event sources. An adapter layer (`canonicalEventService.ts`) projects them into `CanonicalEvent[]`. No new DB table created.

**Why:** All lifecycle data (status, timestamps, role) already exists in these tables. Adding a mirror table would require a write path and risk divergence from the source of truth.

## Source-of-Truth Chain
```
creative_projects          → project.created / workflow_started / completed / failed
creative_project_steps     → step.* and worker.* events (primary execution source)
creative_ai_assets         → artifact.* events
creative_ai_client_reviews → review.* events (history from timestamp columns)
```

## EventId Determinism
- Step events: `step:{stepId}:start` and `step:{stepId}:final`
- Worker events: `worker:{stepId}:start` and `worker:{stepId}:final`
- Asset events: `asset:{assetId}:{status}`
- Review events: `review:{reviewId}:{action}` (shared/viewed/approved/revision/rejected/revoked)
- Project events: `project:{id}:created`, `project:{id}:{status}`

## Security Rules (enforced in canonicalEventService.ts)
- `metadata` NEVER contains: prompt, systemPrompt, output, errorMessage, error, apiKey, input, reasoning, stackTrace
- `publicMessage` always customer-safe — no model names, error text, or internal identifiers
- All queries MUST be scoped by projectId validated at route level before calling service

## Files Changed
- `artifacts/api-server/src/services/canonicalEventService.ts` (NEW)
- `artifacts/api-server/src/services/customerWorkspaceService.ts` — added `events: CanonicalEvent[]` to ProjectDetail, updated listWorkspaceActivity() to use canonical events
- `artifacts/api-server/src/routes/customer-workspace.ts` — added GET /public/customer/workspace/:token/projects/:projectNumber/events

## Activity Feed Source Change
`listWorkspaceActivity()` now reads canonical events (not `ai_audit_logs`). Same response shape (`ActivityItem[]`) — no API break. Filtered to user-facing event types only.

## How to apply
- Adding a new event: add type to `CANONICAL_EVENT_TYPES`, add message to relevant messages map, handle in the appropriate `project*()` function
- Never emit the same eventType from two different sources
- Worker events are derived from step rows (same source, different eventType perspective)
- V4.0D will add SSE on top of this model — no model changes needed

## Pre-existing typecheck errors (not introduced by V4.0C)
- workerClusterService.ts, packageManagerService.ts, observabilityService.ts etc. have TS errors pre-dating this phase
- TS6305 (lib/db/dist not built) is expected — project uses esbuild, not tsc for production
