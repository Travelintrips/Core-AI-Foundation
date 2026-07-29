/**
 * WP-03B — Collision Engine: Type Definitions
 *
 * All geometric types and the centralised COLLISION_EPSILON constant.
 * Import COLLISION_EPSILON from here — never hardcode it inline.
 */

// ── Epsilon ───────────────────────────────────────────────────────────────────

/** Minimum overlap depth (cm) to count as a physical collision. Edge-touch is NOT a collision. */
export const COLLISION_EPSILON = 1e-6;

// ── Primitives ────────────────────────────────────────────────────────────────

export interface Point2D {
  x: number;
  y: number;
}

export interface Vector2D {
  x: number;
  y: number;
}

/** Axis-Aligned Bounding Box. */
export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Oriented Bounding Box.
 * center: geometric center of the placement.
 * halfW: half-width along the local X axis.
 * halfD: half-depth along the local Y axis.
 * rotationDeg: rotation in degrees (already normalised to [0,360)).
 * corners: the four rotated corners in world space (pre-computed).
 * axes: the two face-normal axes of the OBB (pre-computed unit vectors).
 */
export interface OBB {
  center:      Point2D;
  halfW:       number;
  halfD:       number;
  rotationDeg: number;
  corners:     [Point2D, Point2D, Point2D, Point2D];  // TL, TR, BR, BL (after rotation)
  axes:        [Vector2D, Vector2D];                  // local X axis, local Y axis
}

/** Projection of an OBB onto an axis, as a 1D interval [min, max]. */
export interface ProjectionInterval {
  min: number;
  max: number;
}

/** A pair of placement IDs that were tested for collision. Ordered: idA < idB lexicographically. */
export interface CollisionPair {
  idA: string;
  idB: string;
}

/** Result of a single pairwise collision test. */
export interface PairCollisionResult extends CollisionPair {
  overlaps:     boolean;
  overlapDepth: number;   // 0 when overlaps = false
  separatingAxis?: Vector2D;  // axis that separates (only when overlaps = false)
}

/** Full collision result for a session or single placement. */
export interface CollisionResult {
  physicalCollisions: PairCollisionResult[];
  clearanceWarnings:  ClearanceWarning[];
  roomViolations:     RoomBoundaryViolation[];
  checkedPairs:       number;
  checkedPlacements:  number;
}

// ── Clearance warnings ────────────────────────────────────────────────────────

export type ClearanceSide = "front" | "side" | "back";
export type ClearanceViolationType = "CLEARANCE_OVERLAP" | "CLEARANCE_BOUNDARY";

export interface ClearanceWarning {
  type:          ClearanceViolationType;
  placementId:   string;
  otherPlacementId?: string;  // present for CLEARANCE_OVERLAP
  side:          ClearanceSide;
  overlapDepth:  number;
}

// ── Room boundary violations ──────────────────────────────────────────────────

export type RoomViolationCode =
  | "PLACEMENT_OUTSIDE_ROOM"
  | "PLACEMENT_DIMENSIONS_INVALID"
  | "PLACEMENT_GEOMETRY_INVALID";

export interface RoomBoundaryViolation {
  code:        RoomViolationCode;
  placementId: string;
  message:     string;
  corners?:    Point2D[];  // the corners that are outside the room
}

// ── Placement geometry input (subset of DB Placement for collision engine) ────

export interface PlacementGeometry {
  id:              string;
  xCm:             number;
  yCm:             number;
  widthCm:         number;
  depthCm:         number;
  rotationDeg:     number;
  anchorX:         number;
  anchorY:         number;
  clearanceFrontCm: number;
  clearanceSideCm:  number;
  clearanceBackCm:  number;
  isArchived:      boolean;
}

/** Room bounds used for boundary validation. */
export interface RoomBounds {
  widthCm: number;
  depthCm: number;
}
