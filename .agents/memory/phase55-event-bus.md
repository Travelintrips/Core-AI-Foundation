---
name: Phase 5.5 AI Event Bus
description: Design rules, collision fixes, and dispatch semantics for the AI Event Bus feature
---

## Key Design Rules

**Fire-and-forget**: All integration hooks (jobWorkerService, jobDispatcherService, creative-ai, public routes) must use `publishSafe()`, never `publish()`. `publishSafe` swallows errors so the main flow is never blocked.

**Dispatch outcome semantics**: Only mark an event `processed` when ALL handlers succeed. If any handler fails, call `markFailed()` instead. The `results` array from dispatch always captures per-handler outcomes.

**Idempotency for `create_job` handler**: Before enqueuing, check whether a job with the deterministic dedupe key `EVT-{eventId[:8]}-SUB{subId}` already exists. If it does, skip (return `ok: true, skipped: true`) to prevent duplicate jobs on replay.

**Wildcard subscriptions**: `eventType === "*"` matches all events in the dispatch query.

## Codegen Collision Fix (orval)

When adding new OpenAPI schemas that share names with existing manual files, the generated `api.ts` / `api.schemas.ts` will conflict with the manual re-exports. Resolution pattern:

1. `lib/api-zod/src/events.ts` — keep only schemas NOT generated (e.g. `CreateSubscriptionBody`, `UpdateSubscriptionBody`); remove duplicates (`ListEventsQueryParams`, `PublishEventBody` moved to generated).
2. `lib/api-zod/src/cluster.ts` — keep only `RenewLeaseBody` (generated uses `RenewWorkerLeaseBody`, different name); `RegisterClusterWorkerBody` is now generated.
3. `lib/api-client-react/src/index.ts` — change `export * from "./cluster-hooks"` to named exports of only what's unique: `export { getClusterStatusQueryKey, getClusterWorkersQueryKey } from "./cluster-hooks"`. The hook functions (`useGetClusterStatus` etc.) are now generated.

**Why:** orval generates all paths in the spec. Once cluster + event endpoints are in openapi.yaml, orval generates same-named exports — wildcard re-exports from manual files then collide.

## Static Route Ordering

In the events router, always register:
- `/ai/events/timeline/:correlationId` before `/ai/events/:id`
- `/ai/events/publish` before `/ai/events/:id`

Otherwise Express treats "timeline" and "publish" as the `:id` param.

## DB Tables Added
- `ai_events` — event store with eventId (UUID, unique), status, payloadJson, metadataJson, correlationId
- `ai_event_subscriptions` — subscription config with handlerType enum, retryPolicy, status

## Frontend

Events Center page at `/events` (events.tsx): event stream list with filters, detail panel with payload viewer + correlation timeline, replay button, subscription CRUD tab with toggle/delete.
