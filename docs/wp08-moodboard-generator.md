# WP-08 — Moodboard Generator

## Scope

WP-08 composes a structured, deterministic moodboard for an Interior Design
creative project. It is admin-only in the first release and does not generate
new provider images.

## API

- `POST /api/ai/interior-design/projects/:projectUuid/moodboard/generate`
  - Body: `{ "force": boolean }`
  - Reuses the persisted result unless `force=true`.
- `GET /api/ai/interior-design/projects/:projectUuid/moodboard`
  - Returns `{ moodboard: null, available: false }` before generation.

Both routes require the global authenticated admin middleware and validate the
project UUID. Tenant context is resolved from the authenticated request; a
client-supplied tenant ID is never accepted.

## Persistence and immutability

The result is stored under `creative_projects.result.moodboard`, so no new
table or migration is needed. The service reads approved concept snapshot
fields when the draft is `approved_for_rendering`; it never changes the draft
or its approved snapshot.

## Structured-first rules

- Palette and sections are generated from brief/draft data with stable sorting.
- Materials and furniture are matched to canonical active/published libraries
  in bulk, with concept-draft fallback and warnings for missing references.
- Existing interior asset images and completed creative AI assets are reused.
- Resource caps are 24 items/images and 12 sections.
- A SHA-256 source fingerprint and algorithm version make the result auditable.
- The response exposes `moodboardId`, `style`, `colorPalette`, `referenceImages`,
  and `status` as canonical aliases while retaining the structured `palette` and
  `images` fields for compatibility.

## WP-09 boundary

WP-09 is the downstream Rendering Pipeline: render payload construction,
render jobs, concept selection, and render gallery. It is intentionally not
implemented in WP-08.