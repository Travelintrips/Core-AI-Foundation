---
name: Phase V4.1 execution summary layer
description: Deterministic customer-safe summary layer over CanonicalEvents (executionSummaryService); additive wiring pattern into SSE/REST/frontend; known scope gap.
---

## What it is
A pure, non-LLM `executionSummaryService.ts` derives customer-safe `ExecutionSummary`
objects (title/summary/whyItMatters/nextStep/status/customerAction/isDerived/sourceEventId)
from `CanonicalEvent`s via lookup tables + `SummaryContext`. Never exposes prompts,
reasoning, raw model output, stack traces, keys, or cost — enforced by `BANNED_SUMMARY_FIELDS`
and tested with simulated metadata-leak cases.

## Additive-wrapper pattern (reuse this shape for future "derived customer view" layers)
Never mutate the canonical event pipeline in place. Instead:
- Add a new function (`getEventsWithSummariesForProject`) that wraps the existing
  getter and returns `{ event, summary }` pairs, index-aligned with the original list.
- SSE/REST payloads gain new fields (`summary`, `summaries`) alongside old ones
  (`event`, `events`) — old consumers keep working unchanged.
- Frontend hooks merge the new field into existing state via a dedicated `merge*()`
  helper keyed by a stable id (here `sourceEventId`), returning the same object
  reference when there's nothing new to merge (avoids extra re-renders).

**Why:** the spec's do-not-touch list forbade touching `creativeWorkflowRunner`,
breaking `CanonicalEvent` shape, adding new tables, new SSE kinds, or touching
`ai_jobs`/dispatcher/pricing. An additive wrapper satisfies "strictly additive" API
change constraints exactly like this in future phases.

## Type-only import to avoid circular dependency
`executionSummaryService.ts` only does `import type { CanonicalEvent } from
"./canonicalEventService.js"` — never a runtime import. `canonicalEventService.ts`
does the runtime import the other way (calling into executionSummaryService).
**Why:** the two modules need each other's types/functions; a bidirectional runtime
import would deadlock ESM module init. Type-only imports are erased at compile time
so only one direction is a real runtime edge.

## Test gotcha: eventId vs sourceEventId string collision
`sseManager.test.ts` had a regex asserting `"eventId":"<id>"` appears once in
serialized output. Adding the additive `summary.sourceEventId` field (same id value)
duplicated the substring and broke a loose regex. Fix: anchor the regex to the key
name (`"eventId":"..."`), not just the id substring, whenever a derived layer
echoes back an id under a different key name.

## Known scope gap (flagged, not fixed)
The multi-project REST activity list (`listWorkspaceActivity`/`getEventsForProjects`
→ `GET /activity`) is NOT wired to summaries — only the per-project
`GET /projects/:projectNumber/events` endpoint is. Revisit if the multi-project
activity feed needs whyItMatters/nextStep context too.
