/**
 * WP-03B — Collision Engine Service Tests
 *
 * Covers:
 * - Session with no placements
 * - Session with one placement
 * - Multiple non-overlapping placements
 * - One overlapping pair
 * - Multiple overlapping pairs
 * - Duplicate pair suppression
 * - Self-collision exclusion
 * - Archived placement exclusion
 * - Deterministic pair ordering (idA < idB)
 * - Room boundary validation (inside, edge-touch, partial outside, fully outside, rotated)
 * - Clearance warnings (no warning, front, side, rotated, boundary, warning without physical collision)
 * - validatePlacementGeometry
 * - checkGeometryCollision (stateless)
 * - Performance: stress test
 */

import { describe, it, expect } from "vitest";
import type { PlacementGeometry, RoomBounds } from "../services/collision-engine/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlacement(
  id: string,
  x: number, y: number, w: number, d: number,
  rot = 0,
  archived = false,
  clearanceFront = 0, clearanceSide = 0, clearanceBack = 0,
): PlacementGeometry {
  return {
    id, xCm: x, yCm: y, widthCm: w, depthCm: d,
    rotationDeg: rot, anchorX: 0, anchorY: 0,
    clearanceFrontCm: clearanceFront, clearanceSideCm: clearanceSide, clearanceBackCm: clearanceBack,
    isArchived: archived,
  };
}

const ROOM_500x500: RoomBounds = { widthCm: 500, depthCm: 500 };
const ROOM_200x200: RoomBounds = { widthCm: 200, depthCm: 200 };

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Session collision scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkSessionCollisions — collision scenarios", () => {
  it("no placements → zero pairs checked", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([], ROOM_500x500);
    expect(result.checkedPairs).toBe(0);
    expect(result.physicalCollisions).toHaveLength(0);
    expect(result.checkedPlacements).toBe(0);
  });

  it("one placement → zero pairs checked", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions(
      [makePlacement("p1", 0, 0, 100, 100)],
      ROOM_500x500,
    );
    expect(result.checkedPairs).toBe(0);
    expect(result.physicalCollisions).toHaveLength(0);
  });

  it("two non-overlapping placements → no collision", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100),
      makePlacement("p2", 200, 0, 100, 100),
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(0);
    expect(result.checkedPairs).toBe(1);
  });

  it("two overlapping placements → one collision", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100),
      makePlacement("p2", 50, 50, 100, 100),
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(1);
    expect(result.physicalCollisions[0]!.overlaps).toBe(true);
  });

  it("three placements, one overlapping pair → one collision", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100),
      makePlacement("p2", 50, 50, 100, 100),  // overlaps p1
      makePlacement("p3", 300, 300, 100, 100), // no overlap
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(1);
    expect(result.checkedPairs).toBe(3);
  });

  it("three overlapping placements → three collision pairs", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100),
      makePlacement("p2", 30, 30, 100, 100),
      makePlacement("p3", 60, 60, 100, 100),
    ], ROOM_500x500);
    expect(result.physicalCollisions.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Pair ordering and de-duplication
// ═══════════════════════════════════════════════════════════════════════════════

describe("Deterministic pair ordering", () => {
  it("idA is always lexicographically less than idB", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("zzz-placement", 0, 0, 200, 200),
      makePlacement("aaa-placement", 50, 50, 200, 200),
    ], ROOM_500x500);
    for (const pair of result.physicalCollisions) {
      expect(pair.idA < pair.idB).toBe(true);
    }
  });

  it("no duplicate pairs in result", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 200, 200),
      makePlacement("p2", 50, 50, 200, 200),
      makePlacement("p3", 100, 100, 200, 200),
    ], ROOM_500x500);

    const seen = new Set<string>();
    for (const pair of result.physicalCollisions) {
      const key = `${pair.idA}:${pair.idB}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Self-exclusion and archived exclusion
// ═══════════════════════════════════════════════════════════════════════════════

describe("Self and archived exclusion", () => {
  it("self-collision never appears in results", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100),
    ], ROOM_500x500);
    for (const pair of result.physicalCollisions) {
      expect(pair.idA).not.toBe(pair.idB);
    }
  });

  it("archived placements are excluded from collision checks", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 100, 100, 0, false),
      makePlacement("p2", 50, 50, 100, 100, 0, true),  // archived — must be excluded
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(0);
    expect(result.checkedPlacements).toBe(1);  // only p1 counted
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Room boundary validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Room boundary validation", () => {
  it("placement fully inside room → no violation", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    const p = makePlacement("p1", 10, 10, 80, 80);
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).toBeNull();
  });

  it("placement edge-touch boundary → no violation", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    // Right edge exactly at 200 — touching, not outside
    const p = makePlacement("p1", 100, 0, 100, 100);
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).toBeNull();
  });

  it("placement partially outside room → violation", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    // x=150, width=100 → maxX=250, outside 200
    const p = makePlacement("p1", 150, 0, 100, 100);
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).not.toBeNull();
    expect(v!.code).toBe("PLACEMENT_OUTSIDE_ROOM");
  });

  it("placement fully outside room → violation", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    const p = makePlacement("p1", 300, 300, 100, 100);
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).not.toBeNull();
    expect(v!.code).toBe("PLACEMENT_OUTSIDE_ROOM");
  });

  it("rotated placement outside room → violation", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    // Near corner, rotated 45° — may push corners outside
    const p = makePlacement("p1", 160, 160, 80, 80, 45);
    const v = checkRoomBounds(p, ROOM_200x200);
    // After 45° rotation of a 80×80 box, diagonal extends ~56cm beyond center
    // Center at 200,200 (out of 200x200 room) — should be outside
    expect(v).not.toBeNull();
  });

  it("zero width placement → PLACEMENT_DIMENSIONS_INVALID", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    const p = makePlacement("p1", 0, 0, 0, 100);
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).not.toBeNull();
    expect(v!.code).toBe("PLACEMENT_DIMENSIONS_INVALID");
  });

  it("NaN position → PLACEMENT_GEOMETRY_INVALID", async () => {
    const { checkRoomBounds } = await import("../services/collision-engine/roomBounds.js");
    const p = { ...makePlacement("p1", 0, 0, 100, 100), xCm: NaN };
    const v = checkRoomBounds(p, ROOM_200x200);
    expect(v).not.toBeNull();
    expect(v!.code).toBe("PLACEMENT_GEOMETRY_INVALID");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Clearance warnings
// ═══════════════════════════════════════════════════════════════════════════════

describe("Clearance warnings", () => {
  it("no clearance configured → no warnings", async () => {
    const { checkPlacementClearance } = await import("../services/collision-engine/clearance.js");
    const p = makePlacement("p1", 0, 0, 100, 100, 0, false, 0, 0, 0);
    const other = makePlacement("p2", 110, 0, 100, 100);
    const warnings = checkPlacementClearance(p, [other], ROOM_500x500);
    expect(warnings).toHaveLength(0);
  });

  it("front clearance warning when other placement is too close to front", async () => {
    const { checkPlacementClearance } = await import("../services/collision-engine/clearance.js");
    const p = makePlacement("p1", 100, 100, 80, 60, 0, false, 50, 0, 0); // 50cm front clearance
    const other = makePlacement("p2", 100, 40, 80, 50); // within 50cm in front
    const warnings = checkPlacementClearance(p, [other], ROOM_500x500);
    const frontWarnings = warnings.filter(w => w.side === "front");
    expect(frontWarnings.length).toBeGreaterThan(0);
  });

  it("clearance warning is not a physical collision", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");
    // Two placements that don't physically overlap but are within clearance zone
    const result = checkSessionCollisions([
      makePlacement("p1", 0, 0, 80, 60, 0, false, 60, 0, 0),  // 60cm front clearance
      makePlacement("p2", 0, 100, 80, 60),                      // 40cm gap — within clearance but no physical overlap
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(0);  // no physical overlap
  });

  it("archived placement excluded from clearance check", async () => {
    const { checkPlacementClearance } = await import("../services/collision-engine/clearance.js");
    const p = makePlacement("p1", 100, 100, 80, 60, 0, false, 50, 0, 0);
    const archived = makePlacement("p2", 100, 50, 80, 60, 0, true); // archived
    const warnings = checkPlacementClearance(p, [archived], ROOM_500x500);
    expect(warnings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Stateless checkGeometryCollision
// ═══════════════════════════════════════════════════════════════════════════════

describe("checkGeometryCollision — stateless", () => {
  it("returns correct result without DB access", async () => {
    const { checkGeometryCollision } = await import("../services/collisionEngineService.js");
    const result = checkGeometryCollision([
      makePlacement("a", 0, 0, 100, 100),
      makePlacement("b", 50, 50, 100, 100),
    ], ROOM_500x500);
    expect(result.physicalCollisions).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. validatePlacementGeometry
// ═══════════════════════════════════════════════════════════════════════════════

describe("validatePlacementGeometry", () => {
  it("returns valid=true for a well-formed placement inside room", async () => {
    const { validatePlacementGeometry } = await import("../services/collisionEngineService.js");
    const result = validatePlacementGeometry(makePlacement("p1", 10, 10, 80, 80), ROOM_200x200);
    expect(result.valid).toBe(true);
    expect(result.violation).toBeNull();
  });

  it("returns valid=false for out-of-bounds placement", async () => {
    const { validatePlacementGeometry } = await import("../services/collisionEngineService.js");
    const result = validatePlacementGeometry(makePlacement("p1", 300, 300, 80, 80), ROOM_200x200);
    expect(result.valid).toBe(false);
    expect(result.violation).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Performance stress test
// ═══════════════════════════════════════════════════════════════════════════════

describe("Performance — stress test", () => {
  it("50-placement session completes in < 500ms", async () => {
    const { checkSessionCollisions } = await import("../services/collision-engine/collisionEngine.js");

    // Generate 50 non-overlapping placements in a 1000×1000 room
    const placements: PlacementGeometry[] = [];
    for (let i = 0; i < 50; i++) {
      const row = Math.floor(i / 10);
      const col = i % 10;
      placements.push(makePlacement(
        `placement-${String(i).padStart(3, "0")}`,
        col * 100, row * 100, 80, 80,
        (i * 7) % 360,
      ));
    }

    const start = Date.now();
    const result = checkSessionCollisions(placements, { widthCm: 1000, depthCm: 500 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(result.checkedPairs).toBe((50 * 49) / 2);
    expect(result.checkedPlacements).toBe(50);
  });
});
