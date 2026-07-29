# WP-03 Collision Model — Future Design (WP-03B)

> **Status: Design Only — Not Implemented**
>
> This document describes the approved future architecture for WP-03B.
> No collision detection code exists in WP-03A. Do not implement any of
> the following in WP-03A scope.

---

## Overview

WP-03B will add spatial collision detection on top of the placement data layer
established in WP-03A. The collision model uses a two-phase approach:

1. **Broad phase** — Axis-Aligned Bounding Box (AABB) filtering
2. **Narrow phase** — Oriented Bounding Box (OBB) / Separating Axis Theorem (SAT) for precise overlap detection

---

## Phase 1 — AABB Broad Phase

Each placement is projected into an AABB from its `(xCm, yCm, widthCm, depthCm)`.

For a placement with no rotation:
```
xMin = xCm
yMin = yCm
xMax = xCm + widthCm
yMax = yCm + depthCm
```

For rotated placements, the AABB is the axis-aligned envelope of the rotated OBB corners.

Two AABBs overlap iff:
```
NOT (a.xMax <= b.xMin OR b.xMax <= a.xMin OR a.yMax <= b.yMin OR b.yMax <= a.yMin)
```

The broad phase eliminates non-overlapping pairs before the expensive narrow phase.

---

## Phase 2 — OBB/SAT Narrow Phase

For each pair that passes the AABB test, apply the Separating Axis Theorem (SAT):

1. Project both OBBs onto each potential separating axis (4 axes: 2 from each box)
2. If any axis produces a gap between the projections, the objects do not collide
3. If no separating axis exists, the objects overlap

### Result

- `CLEAR` — no overlap
- `COLLISION` — hard overlap (objects intersect)

---

## Clearance (Soft Warning)

Clearance checking is separate from collision. An item may be `CLEAR` (no overlap)
but still within the minimum clearance distance of another item or wall.

Clearance violations produce warnings, not hard rejections. Minimum clearance
values are defined per furniture category in WP-03E (Constraint Validator).

---

## Integration Points (WP-03B)

- `checkCollisions(sessionId): CollisionReport` — scan all active placements in a session
- `checkSinglePlacement(sessionId, placementId): CollisionResult` — check one placement against all others
- `checkProposed(sessionId, proposedPlacement): CollisionResult` — check a proposed position before committing

These functions will read placement data from WP-03A tables and return results without modifying any rows.

---

## Data Contract

WP-03B reads directly from `ai_platform.placements` and `ai_platform.layout_sessions`.
No new tables are required for basic collision detection.

The following fields are consumed:
- `x_cm`, `y_cm` — position
- `width_cm`, `depth_cm` — footprint
- `rotation_deg` — orientation
- `session_id` — scope
- `archived_at` — exclude archived placements from collision checks
