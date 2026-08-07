# WP-06A Placement Rules

## Objective

WP-06A provides a deterministic, advisory-first foundation for suggesting furniture placements in a layout session. It has no LLM or provider dependency and does not persist preview changes.

## Architecture

The placement engine is a pure module. Shared runtime contracts and JSDoc wire shapes live in `lib/contracts.mjs`; it validates UUIDs, finite geometry, positive dimensions, limits, and deadlines before the service runs. The engine evaluates room-aware footprints, hard constraints, and soft scoring, then creates candidates using five bounded strategies: `WALL_LEFT`, `WALL_RIGHT`, `WALL_TOP`, `WALL_BOTTOM`, and `CENTER`. The server exposes admin-only JSON endpoints and keeps the example session in memory so the project can run without a migration.

## Hard rules

- HR-1 room bounds
- HR-2 positive dimensions and finite geometry
- HR-3 furniture footprint overlap
- HR-4 clearance-zone encroachment
- HR-5 minimum wall gap
- HR-6 minimum item spacing
- HR-7 clearance-zone overlap with the room boundary
- HR-8 maximum 50 items per session

Any hard-rule violation makes a candidate invalid. Apply re-runs hard rules instead of trusting preview output.

## Soft rules and scoring

SR-1 wall alignment, SR-2 symmetry, SR-3 25 cm grid snap, SR-4 open center, SR-5 balanced quadrants, and SR-6 clearance inside preferred zones contribute centralized weights totaling 100. Scores are clamped to 0–100, finite, and tie-broken by stable strategy order.

## Preview and apply

`POST /api/ai/layout-sessions/:sessionId/suggest-placement` returns at most three ranked alternatives and never mutates placements. `POST /api/ai/layout-sessions/:sessionId/apply-placement` requires an explicit preview `candidateId` (raw candidate payloads are rejected), revalidates the candidate, protects locked/manual items, and persists the complete placement set atomically in the in-memory session. Re-applying the same resulting placement is idempotent and does not create a new revision.

## Security and snapshot safety

Both endpoints require the admin role header in this standalone reference app. A mismatched tenant or session is not disclosed. An `approved_for_rendering` session returns 409 for apply. Preview never mutates an approved snapshot or active placements.

## Limits and known limitations

Requests are capped at 100 KB, alternatives at 3, and furniture at 50. This reference implementation uses AABB footprints for the demo geometry; production integration should call the repository's canonical OBB/SAT adapter rather than duplicating it. Persistent storage and the existing repository auth middleware are intentionally outside this empty repository.

## WP-06B boundary

The canvas is a review surface only. Drag-and-drop editing, lock/unlock controls, and a full placement editor belong to WP-06B.