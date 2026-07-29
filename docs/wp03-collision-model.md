# WP-03 — Collision Model

## Physical collision vs clearance warning

WP-03B produces two distinct result categories:

| Category | Meaning | Action |
|---|---|---|
| **Physical collision** | Two placements' rotated bounding boxes physically overlap | Hard block — furniture occupies the same space |
| **Clearance warning** | A placement's clearance zone overlaps another placement or the room boundary | Soft warning — recommended clearance not met |

These categories must never be conflated. Touching edges are NOT physical overlap.

## AABB (broad phase)

Axis-Aligned Bounding Boxes are used for fast candidate rejection. If two AABBs do not overlap, no SAT check is needed.

## OBB (narrow phase)

Oriented Bounding Boxes represent the actual rotated placement footprint. Two OBBs are tested for overlap using the Separating Axis Theorem (SAT).

## SAT (Separating Axis Theorem)

For two convex polygons A and B, they do NOT overlap if and only if there exists an axis (the separating axis) along which the projections of A and B do not overlap.

The candidate axes are: the 4 face normals of OBB A and the 4 face normals of OBB B (8 axes total for two rectangles, reduced to 4 unique axes for rectangles since opposite faces share the same normal direction).

## Epsilon

All comparisons use a centralised `COLLISION_EPSILON = 1e-6` (cm²) to handle floating-point noise. Touching edges test as non-overlapping.

## Room boundary

Each placement corner is tested against the room boundary. Out-of-bounds corners generate `PLACEMENT_OUTSIDE_ROOM` violations.
