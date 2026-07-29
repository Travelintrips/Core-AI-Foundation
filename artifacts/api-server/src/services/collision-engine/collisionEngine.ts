/**
 * WP-03B — Collision Engine: Main Orchestrator
 *
 * Runs broad phase (AABB) then narrow phase (OBB SAT) for all placement pairs
 * in a session. Also checks room boundaries and clearance zones.
 *
 * Design decisions:
 * - Placements loaded once per session (not per pair)
 * - Broad phase MUST run before SAT — non-overlapping AABBs skip SAT
 * - Pair ordering is deterministic: idA < idB (lexicographic UUID)
 * - Archived placements excluded
 * - Self-collision excluded
 * - Duplicate pairs suppressed via deterministic ordering
 */

import type {
  CollisionResult,
  PairCollisionResult,
  PlacementGeometry,
  RoomBounds,
} from "./types.js";
import { generateAABB, aabbOverlap } from "./aabb.js";
import { generateOBB } from "./obb.js";
import { satTest } from "./sat.js";
import { checkAllRoomBounds, checkRoomBounds } from "./roomBounds.js";
import { checkPlacementClearance } from "./clearance.js";

// ── Pair ordering ─────────────────────────────────────────────────────────────

/** Ensures pairs are always (smaller UUID, larger UUID) — no duplicates. */
function orderedPair(a: PlacementGeometry, b: PlacementGeometry): [PlacementGeometry, PlacementGeometry] {
  return a.id < b.id ? [a, b] : [b, a];
}

// ── Pairwise physical collision check ─────────────────────────────────────────

/**
 * Checks a single pair of placements for physical overlap.
 * Runs AABB broad phase then OBB SAT narrow phase.
 */
export function checkPair(a: PlacementGeometry, b: PlacementGeometry): PairCollisionResult {
  const [pa, pb] = orderedPair(a, b);

  // Broad phase: AABB
  const aabbA = generateAABB(pa.xCm, pa.yCm, pa.widthCm, pa.depthCm, pa.rotationDeg);
  const aabbB = generateAABB(pb.xCm, pb.yCm, pb.widthCm, pb.depthCm, pb.rotationDeg);

  if (!aabbOverlap(aabbA, aabbB)) {
    return { idA: pa.id, idB: pb.id, overlaps: false, overlapDepth: 0 };
  }

  // Narrow phase: OBB SAT
  const obbA = generateOBB(pa);
  const obbB = generateOBB(pb);
  const sat  = satTest(obbA, obbB);

  return {
    idA:             pa.id,
    idB:             pb.id,
    overlaps:        sat.overlaps,
    overlapDepth:    sat.overlapDepth,
    separatingAxis:  sat.separatingAxis,
  };
}

// ── Session-level check ───────────────────────────────────────────────────────

/**
 * Checks all active placement pairs in a session for physical collisions,
 * room boundary violations, and clearance warnings.
 *
 * @param placements  All placements for the session (archived ones are filtered internally)
 * @param room        Room geometry from the layout session
 */
export function checkSessionCollisions(
  placements: PlacementGeometry[],
  room:       RoomBounds,
): CollisionResult {
  const active = placements.filter(p => !p.isArchived);

  const physicalCollisions: PairCollisionResult[] = [];
  let checkedPairs = 0;

  // O(n²) pairwise — acceptable for normal session sizes (< 100 placements)
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      checkedPairs++;

      const result = checkPair(a, b);
      if (result.overlaps) {
        physicalCollisions.push(result);
      }
    }
  }

  // Room boundary violations
  const roomViolations = checkAllRoomBounds(placements, room);

  // Clearance warnings
  const clearanceWarnings = active.flatMap(p =>
    checkPlacementClearance(p, active, room),
  );

  return {
    physicalCollisions,
    clearanceWarnings,
    roomViolations,
    checkedPairs,
    checkedPlacements: active.length,
  };
}

/**
 * Checks a single placement against all other active placements in the session,
 * plus the room boundary.
 */
export function checkSinglePlacement(
  target:       PlacementGeometry,
  allInSession: PlacementGeometry[],
  room:         RoomBounds,
): CollisionResult {
  const others = allInSession.filter(p => p.id !== target.id && !p.isArchived);

  const physicalCollisions: PairCollisionResult[] = [];
  let checkedPairs = 0;

  for (const other of others) {
    checkedPairs++;
    const result = checkPair(target, other);
    if (result.overlaps) {
      physicalCollisions.push(result);
    }
  }

  const roomViolation = checkRoomBounds(target, room);
  const roomViolations = roomViolation ? [roomViolation] : [];

  const clearanceWarnings = checkPlacementClearance(target, others, room);

  return {
    physicalCollisions,
    clearanceWarnings,
    roomViolations,
    checkedPairs,
    checkedPlacements: others.length + 1,
  };
}
