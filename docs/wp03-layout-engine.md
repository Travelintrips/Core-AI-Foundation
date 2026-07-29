# WP-03 — Layout Engine Overview

## Work package dependencies

```
WP-01 (Room Templates)
    └── WP-02 (Furniture Library)
            └── WP-03A (Placement Engine) ← current
                    └── WP-03B (Collision Engine) ← current
                            └── WP-03C (Layout Suggestions) ← future
```

## WP-03A: Placement Engine

Stores tenant-owned layout sessions and furniture placements. Provides:
- `layout_sessions` and `placements` tables
- CRUD API under `/ai/layout-sessions`
- Rotation normalisation, anchor point utilities

## WP-03B: Collision Engine

Detects physical overlaps and clearance violations between placements. Provides:
- Pure geometry engine (no DB writes for collision results)
- AABB broad phase + OBB SAT narrow phase
- Clearance zone warnings
- Room boundary validation
- API under `/ai/layout-sessions/:sessionId/collision-check`, `/collisions`, `/placements/:placementId/collision-check`
- Optional stateless geometry endpoint: `POST /ai/collision/check`

## WP-03C: Layout Suggestions (future)

AI-assisted placement recommendations. Not part of this sprint.
