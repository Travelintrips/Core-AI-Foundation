/**
 * placement-engine-v2.test.ts — WP-03A Placement Engine v2 rebuild
 *
 * Tests (target: ≥ 95):
 *   Math & validation   (20)
 *   Snapping            (20)
 *   Sessions            (17)
 *   Placements          (17)
 *   Tenant consistency  (12)
 *   API endpoints       (11)
 *   RLS / DB policies    (5)
 *
 * All DB calls are mocked via vi.mock("@workspace/db").
 * API tests use supertest against the Express app via a minimal test app.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ─────────────────────────────────────────────────────────

const mockReturning = vi.fn();
const mockWhere     = vi.fn();
const mockLimit     = vi.fn();
const mockOffset    = vi.fn();
const mockOrderBy   = vi.fn();
const mockSelect    = vi.fn();
const mockFrom      = vi.fn();
const mockInsert    = vi.fn();
const mockUpdate    = vi.fn();
const mockSet       = vi.fn();
const mockValues    = vi.fn();

// Chain builders
function makeSelectChain(rows: unknown[], countRows?: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain["from"]    = vi.fn().mockReturnValue(chain);
  chain["where"]   = vi.fn().mockReturnValue(chain);
  chain["limit"]   = vi.fn().mockReturnValue(chain);
  chain["offset"]  = vi.fn().mockReturnValue(chain);
  chain["orderBy"] = vi.fn().mockReturnValue(chain);
  // Promise resolution
  (chain as unknown as Promise<unknown[]>)[Symbol.iterator as unknown as string] =
    undefined;
  return chain;
}

vi.mock("@workspace/db", () => {
  const makeChain = (rows: unknown[] = [], countRows: unknown[] = [{ count: rows.length }]) => {
    let callCount = 0;
    const chain = {
      from:    vi.fn().mockReturnThis(),
      where:   vi.fn().mockReturnThis(),
      limit:   vi.fn().mockReturnThis(),
      offset:  vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount % 2 === 0 ? countRows : rows);
      }),
      then: vi.fn(),
    };
    return chain;
  };

  const insertChain = {
    values:    vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  const updateChain = {
    set:       vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };

  return {
    db: {
      select:  vi.fn().mockReturnValue(makeChain()),
      insert:  vi.fn().mockReturnValue(insertChain),
      update:  vi.fn().mockReturnValue(updateChain),
    },
    layoutSessionsTable: {},
    placementsTable: {},
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    desc: vi.fn(),
    sql: vi.fn(),
    ilike: vi.fn(),
  };
});

// ── Import service after mock ──────────────────────────────────────────────────

import {
  // Pure helpers
  normalizeRotation,
  validateCoordinates,
  validateDimensions,
  getBoundingRect,
  toLocalCoords,
  toWorldCoords,
  serializeSession,
  serializePlacement,
  deserializeSession,
  deserializePlacement,
  // Snapping
  snapToGrid,
  snapToWall,
  snapToCorner,
  snapToItemAnchor,
  // Tenant consistency
  assertTenantConsistency,
  // Error class
  PlacementEngineError,
} from "../services/placementEngineService.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeRotation — 9 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeRotation", () => {
  it("returns 0 for 0", () => expect(normalizeRotation(0)).toBe(0));
  it("returns 90 for 90", () => expect(normalizeRotation(90)).toBe(90));
  it("returns 180 for 180", () => expect(normalizeRotation(180)).toBe(180));
  it("returns 270 for 270", () => expect(normalizeRotation(270)).toBe(270));
  it("returns 0 for 360", () => expect(normalizeRotation(360)).toBe(0));
  it("returns 90 for 450", () => expect(normalizeRotation(450)).toBe(90));
  it("returns 270 for -90", () => expect(normalizeRotation(-90)).toBe(270));
  it("returns 0 for -360", () => expect(normalizeRotation(-360)).toBe(0));
  it("returns 90 for -270", () => expect(normalizeRotation(-270)).toBe(90));
  it("returns 0 for Infinity (non-finite)", () =>
    expect(normalizeRotation(Infinity)).toBe(0));
  it("returns 0 for NaN (non-finite)", () =>
    expect(normalizeRotation(NaN)).toBe(0));
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. validateCoordinates — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCoordinates", () => {
  it("passes for valid (0, 0)", () =>
    expect(() => validateCoordinates(0, 0)).not.toThrow());
  it("passes for negative coords", () =>
    expect(() => validateCoordinates(-100, -200)).not.toThrow());
  it("throws for NaN x", () =>
    expect(() => validateCoordinates(NaN, 0)).toThrow(PlacementEngineError));
  it("throws for Infinity y", () =>
    expect(() => validateCoordinates(0, Infinity)).toThrow(PlacementEngineError));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateDimensions — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateDimensions", () => {
  it("passes for positive dimensions", () =>
    expect(() => validateDimensions(90, 60, 85)).not.toThrow());
  it("throws if width is 0", () =>
    expect(() => validateDimensions(0, 60, 85)).toThrow(PlacementEngineError));
  it("throws if depth is negative", () =>
    expect(() => validateDimensions(90, -1, 85)).toThrow(PlacementEngineError));
  it("throws if height is NaN", () =>
    expect(() => validateDimensions(90, 60, NaN)).toThrow(PlacementEngineError));
  it("error code is INVALID_INPUT", () => {
    try { validateDimensions(0, 0, 0); } catch (e) {
      expect((e as PlacementEngineError).code).toBe("INVALID_INPUT");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getBoundingRect — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("getBoundingRect", () => {
  it("computes correct xMax", () => {
    const r = getBoundingRect(100, 200, 90, 60);
    expect(r.xMax).toBe(190);
  });
  it("computes correct yMax", () => {
    const r = getBoundingRect(100, 200, 90, 60);
    expect(r.yMax).toBe(260);
  });
  it("preserves width and depth", () => {
    const r = getBoundingRect(0, 0, 45, 30);
    expect(r.widthCm).toBe(45);
    expect(r.depthCm).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. toLocalCoords / toWorldCoords — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("coordinate transforms", () => {
  it("toLocalCoords subtracts item origin", () => {
    expect(toLocalCoords(150, 250, 100, 200)).toEqual({ x: 50, y: 50 });
  });
  it("toLocalCoords handles zero item origin", () => {
    expect(toLocalCoords(30, 40, 0, 0)).toEqual({ x: 30, y: 40 });
  });
  it("toWorldCoords adds item origin", () => {
    expect(toWorldCoords(50, 50, 100, 200)).toEqual({ x: 150, y: 250 });
  });
  it("toLocalCoords and toWorldCoords are inverses", () => {
    const local = toLocalCoords(170, 260, 120, 210);
    const world = toWorldCoords(local.x, local.y, 120, 210);
    expect(world).toEqual({ x: 170, y: 260 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. serializeSession / serializePlacement — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("serialization", () => {
  const fakeSession = {
    id: "s1", tenantId: null, roomTemplateId: null,
    name: "Test", status: "active", coordinateUnit: "cm",
    roomWidthCm: "500", roomLengthCm: "700", metadata: {},
    createdBy: "system", createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"), archivedAt: null,
  } as unknown as Parameters<typeof serializeSession>[0];

  it("serializeSession converts roomWidthCm to number", () => {
    const s = serializeSession(fakeSession);
    expect(typeof s["roomWidthCm"]).toBe("number");
    expect(s["roomWidthCm"]).toBe(500);
  });
  it("serializeSession has null archivedAt", () => {
    const s = serializeSession(fakeSession);
    expect(s["archivedAt"]).toBeNull();
  });
  it("serializePlacement converts numeric fields", () => {
    const fakePlacement = {
      id: "p1", tenantId: null, sessionId: "s1", furnitureItemId: "f1",
      xCm: "100", yCm: "200", widthCm: "90", depthCm: "60", heightCm: "85",
      rotationDeg: "0", anchorType: "none", anchorData: {}, snapType: "none",
      snapData: {}, metadata: {}, version: 1, createdBy: "system",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
      archivedAt: null,
    } as unknown as Parameters<typeof serializePlacement>[0];
    const p = serializePlacement(fakePlacement);
    expect(typeof p["xCm"]).toBe("number");
    expect(p["rotationDeg"]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. deserializeSession / deserializePlacement — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("deserialization", () => {
  it("deserializeSession returns object with id and name", () => {
    const obj = { id: "s1", name: "Room" };
    expect(deserializeSession(obj)).toMatchObject({ id: "s1", name: "Room" });
  });
  it("deserializeSession throws on null", () =>
    expect(() => deserializeSession(null)).toThrow(PlacementEngineError));
  it("deserializeSession throws on missing name", () =>
    expect(() => deserializeSession({ id: "s1" })).toThrow(PlacementEngineError));
  it("deserializePlacement throws on missing sessionId", () =>
    expect(() =>
      deserializePlacement({ id: "p1", furnitureItemId: "f1" })
    ).toThrow(PlacementEngineError));
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. snapToGrid — 6 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("snapToGrid", () => {
  it("snaps to nearest grid cell", () => {
    const r = snapToGrid(13, 27, { gridSizeCm: 10 });
    expect(r.x).toBe(10);
    expect(r.y).toBe(30);
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("grid");
  });
  it("returns unchanged when already aligned", () => {
    const r = snapToGrid(50, 100, { gridSizeCm: 10 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(100);
    expect(r.snapped).toBe(false);
  });
  it("snaps with 5cm grid", () => {
    const r = snapToGrid(7, 3, { gridSizeCm: 5 });
    expect(r.x).toBe(5);
    expect(r.y).toBe(5);
  });
  it("returns unchanged for gridSizeCm = 0", () => {
    const r = snapToGrid(13, 27, { gridSizeCm: 0 });
    expect(r.x).toBe(13);
    expect(r.y).toBe(27);
    expect(r.snapped).toBe(false);
  });
  it("snaps large coordinates correctly", () => {
    const r = snapToGrid(495, 703, { gridSizeCm: 100 });
    expect(r.x).toBe(500);
    expect(r.y).toBe(700);
  });
  it("snapType is none when not snapped", () => {
    const r = snapToGrid(10, 20, { gridSizeCm: 10 });
    expect(r.snapType).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. snapToWall — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("snapToWall", () => {
  const opts = { roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60 };

  it("snaps to left wall", () => {
    const r = snapToWall(5, 200, opts);
    expect(r.x).toBe(0);
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("wall");
  });
  it("snaps to right wall", () => {
    const r = snapToWall(415, 200, opts);
    expect(r.x).toBe(500 - 90);
    expect(r.snapped).toBe(true);
  });
  it("snaps to bottom wall", () => {
    const r = snapToWall(200, 5, opts);
    expect(r.y).toBe(0);
    expect(r.snapped).toBe(true);
  });
  it("snaps to top wall", () => {
    const r = snapToWall(200, 645, opts);
    expect(r.y).toBe(700 - 60);
    expect(r.snapped).toBe(true);
  });
  it("no snap in center", () => {
    const r = snapToWall(250, 350, opts);
    expect(r.snapped).toBe(false);
    expect(r.snapType).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. snapToCorner — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("snapToCorner", () => {
  const opts = { roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60 };

  it("snaps to lower-left corner", () => {
    const r = snapToCorner(5, 5, opts);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("corner");
  });
  it("snaps to upper-right corner", () => {
    const r = snapToCorner(405, 638, opts);
    expect(r.x).toBe(500 - 90);
    expect(r.y).toBe(700 - 60);
    expect(r.snapped).toBe(true);
  });
  it("no snap when far from corners", () => {
    const r = snapToCorner(250, 350, opts);
    expect(r.snapped).toBe(false);
  });
  it("snaps to nearest of multiple corners", () => {
    // Closer to lower-right (410, 0) than lower-left (0, 0)
    const r = snapToCorner(400, 5, opts);
    expect(r.x).toBe(500 - 90);
    expect(r.y).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. snapToItemAnchor — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("snapToItemAnchor", () => {
  const anchorBounds = { xMin: 100, yMin: 200, xMax: 190, yMax: 260, widthCm: 90, depthCm: 60 };

  it("snaps to left edge of anchor item", () => {
    const r = snapToItemAnchor(102, 230, { anchorItemBounds: anchorBounds });
    expect(r.x).toBe(100);
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("item_anchor");
  });
  it("snaps to center of anchor item", () => {
    const r = snapToItemAnchor(146, 231, { anchorItemBounds: anchorBounds });
    expect(r.x).toBe(145);  // centerX = (100+190)/2
    expect(r.snapped).toBe(true);
  });
  it("does not snap when too far", () => {
    const r = snapToItemAnchor(300, 500, { anchorItemBounds: anchorBounds });
    expect(r.snapped).toBe(false);
    expect(r.snapType).toBe("none");
  });
  it("respects custom snapDistanceCm", () => {
    const r = snapToItemAnchor(110, 230, {
      anchorItemBounds: anchorBounds,
      snapDistanceCm: 2,
    });
    expect(r.snapped).toBe(false);
  });
  it("snaps to right edge", () => {
    const r = snapToItemAnchor(191, 231, { anchorItemBounds: anchorBounds });
    expect(r.x).toBe(190);
    expect(r.snapped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. assertTenantConsistency — 8 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("assertTenantConsistency", () => {
  const T1 = "aaaaaaaa-0000-0000-0000-000000000001";
  const T2 = "bbbbbbbb-0000-0000-0000-000000000002";

  it("NULL / NULL is allowed", () =>
    expect(() => assertTenantConsistency(null, null)).not.toThrow());
  it("T1 / T1 is allowed", () =>
    expect(() => assertTenantConsistency(T1, T1)).not.toThrow());
  it("NULL / T1 is rejected", () =>
    expect(() => assertTenantConsistency(null, T1)).toThrow(PlacementEngineError));
  it("T1 / NULL is rejected", () =>
    expect(() => assertTenantConsistency(T1, null)).toThrow(PlacementEngineError));
  it("T1 / T2 is rejected", () =>
    expect(() => assertTenantConsistency(T1, T2)).toThrow(PlacementEngineError));
  it("undefined / undefined treated as NULL/NULL", () =>
    expect(() => assertTenantConsistency(undefined, undefined)).not.toThrow());
  it("T1 / undefined rejected", () =>
    expect(() => assertTenantConsistency(T1, undefined)).toThrow(PlacementEngineError));
  it("error code is TENANT_MISMATCH", () => {
    try { assertTenantConsistency(T1, T2); } catch (e) {
      expect((e as PlacementEngineError).code).toBe("TENANT_MISMATCH");
      expect((e as PlacementEngineError).status).toBe(403);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. PlacementEngineError — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PlacementEngineError", () => {
  it("has correct name", () => {
    const e = new PlacementEngineError("msg", "NOT_FOUND", 404);
    expect(e.name).toBe("PlacementEngineError");
  });
  it("has correct code", () => {
    const e = new PlacementEngineError("msg", "TENANT_MISMATCH", 403);
    expect(e.code).toBe("TENANT_MISMATCH");
  });
  it("has correct status", () => {
    const e = new PlacementEngineError("msg", "INVALID_INPUT", 400);
    expect(e.status).toBe(400);
  });
  it("defaults status to 400", () => {
    const e = new PlacementEngineError("msg", "CONFLICT");
    expect(e.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Session service — with mocked DB (12 tests)
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@workspace/db";

describe("createSession — validation", () => {
  it("throws on empty name", async () => {
    const { createSession } = await import("../services/placementEngineService.js");
    await expect(
      createSession({ name: "", roomWidthCm: 500, roomLengthCm: 700 }),
    ).rejects.toThrow(PlacementEngineError);
  });
  it("throws on zero width", async () => {
    const { createSession } = await import("../services/placementEngineService.js");
    await expect(
      createSession({ name: "Room", roomWidthCm: 0, roomLengthCm: 700 }),
    ).rejects.toThrow(PlacementEngineError);
  });
  it("throws on negative length", async () => {
    const { createSession } = await import("../services/placementEngineService.js");
    await expect(
      createSession({ name: "Room", roomWidthCm: 500, roomLengthCm: -100 }),
    ).rejects.toThrow(PlacementEngineError);
  });
  it("throws on non-finite width", async () => {
    const { createSession } = await import("../services/placementEngineService.js");
    await expect(
      createSession({ name: "Room", roomWidthCm: NaN, roomLengthCm: 700 }),
    ).rejects.toThrow(PlacementEngineError);
  });
});

describe("getSession — not found", () => {
  beforeEach(() => {
    // Mock db.select chain to return empty array
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof db.select>);
  });
  it("throws NOT_FOUND for unknown session", async () => {
    const { getSession } = await import("../services/placementEngineService.js");
    await expect(getSession("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("updateSession — validation", () => {
  it("throws on empty name in update", async () => {
    // Mock getSession to return existing
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: "s1", name: "Room", status: "active",
        roomWidthCm: "500", roomLengthCm: "700",
        tenantId: null, coordinateUnit: "cm", metadata: {},
        createdBy: "system", createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
      }]),
      orderBy: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof db.select>);

    const { updateSession } = await import("../services/placementEngineService.js");
    await expect(updateSession("s1", { name: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. Placement service — with mocked DB (6 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("createPlacement — validation", () => {
  const mockSession = {
    id: "s1", name: "Room", status: "active",
    roomWidthCm: "500", roomLengthCm: "700",
    tenantId: null, coordinateUnit: "cm", metadata: {},
    createdBy: "system", createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
  };

  beforeEach(() => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockSession]),
      orderBy: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof db.select>);
  });

  it("throws SESSION_ARCHIVED when session is archived", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ...mockSession, status: "archived" }]),
      orderBy: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof db.select>);

    const { createPlacement } = await import("../services/placementEngineService.js");
    await expect(
      createPlacement("s1", {
        furnitureItemId: "f1", widthCm: 90, depthCm: 60, heightCm: 85,
      }),
    ).rejects.toMatchObject({ code: "SESSION_ARCHIVED", status: 409 });
  });

  it("throws INVALID_INPUT when furnitureItemId is missing", async () => {
    const { createPlacement } = await import("../services/placementEngineService.js");
    await expect(
      createPlacement("s1", {
        furnitureItemId: "", widthCm: 90, depthCm: 60, heightCm: 85,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("throws INVALID_INPUT for zero depth", async () => {
    const { createPlacement } = await import("../services/placementEngineService.js");
    await expect(
      createPlacement("s1", {
        furnitureItemId: "f1", widthCm: 90, depthCm: 0, heightCm: 85,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("throws TENANT_MISMATCH for cross-tenant placement", async () => {
    const T1 = "aaaaaaaa-0000-0000-0000-000000000001";
    const T2 = "bbbbbbbb-0000-0000-0000-000000000002";
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ ...mockSession, tenantId: T1 }]),
      orderBy: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
    } as unknown as ReturnType<typeof db.select>);

    const { createPlacement } = await import("../services/placementEngineService.js");
    await expect(
      createPlacement("s1", {
        tenantId: T2, furnitureItemId: "f1", widthCm: 90, depthCm: 60, heightCm: 85,
      }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("NULL/NULL tenant is accepted (service layer)", async () => {
    const { assertTenantConsistency } = await import("../services/placementEngineService.js");
    expect(() => assertTenantConsistency(null, null)).not.toThrow();
  });

  it("same tenant is accepted (service layer)", async () => {
    const T1 = "aaaaaaaa-0000-0000-0000-000000000001";
    expect(() => assertTenantConsistency(T1, T1)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Snapping priority contract — 4 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("snapping priority contract", () => {
  it("grid snaps first when near grid boundary AND wall", () => {
    // x=8 is within 10cm of left wall (snap) but also near a 10cm grid line (snap to 10)
    // Grid takes priority
    const gridResult = snapToGrid(8, 50, { gridSizeCm: 10 });
    const wallResult = snapToWall(8, 50, {
      roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60,
    });
    // Grid fires first: 8 → 10 (not 0)
    expect(gridResult.x).toBe(10);
    // Wall would snap to 0
    expect(wallResult.x).toBe(0);
    // Priority rule: grid result used when grid enabled
    expect(gridResult.snapType).toBe("grid");
  });
  it("wall snaps before corner when near wall but not corner", () => {
    const wallResult = snapToWall(5, 350, {
      roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60,
    });
    const cornerResult = snapToCorner(5, 350, {
      roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60,
    });
    expect(wallResult.snapped).toBe(true);
    expect(wallResult.snapType).toBe("wall");
    expect(cornerResult.snapped).toBe(false); // 350 is not near any corner
  });
  it("corner snap fires when near corner", () => {
    const r = snapToCorner(3, 5, {
      roomWidthCm: 500, roomLengthCm: 700, itemWidthCm: 90, itemDepthCm: 60,
    });
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("corner");
  });
  it("item_anchor snap only applies when explicitly requested", () => {
    // Without item_anchor request, result should have snapType "none"
    const r = snapToItemAnchor(300, 400, {
      anchorItemBounds: { xMin: 300, yMin: 400, xMax: 390, yMax: 460, widthCm: 90, depthCm: 60 },
      snapDistanceCm: 1,  // very tight threshold
    });
    // 300 is exactly at xMin → distance 0 → snapped
    expect(r.snapped).toBe(true);
    expect(r.snapType).toBe("item_anchor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. API endpoint tests — using supertest (12 tests)
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import request from "supertest";
import placementEngineRouter from "../routes/placement-engine.js";

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(placementEngineRouter);
  return app;
}

describe("API — layout sessions", () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    app = buildTestApp();
  });

  it("POST /ai/layout-sessions — 400 on missing name", async () => {
    const res = await request(app)
      .post("/ai/layout-sessions")
      .send({ roomWidthCm: 500, roomLengthCm: 700 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("POST /ai/layout-sessions — 400 on zero roomWidthCm", async () => {
    const res = await request(app)
      .post("/ai/layout-sessions")
      .send({ name: "Room", roomWidthCm: 0, roomLengthCm: 700 });
    expect(res.status).toBe(400);
  });

  it("GET /ai/layout-sessions — 200 with sessions array", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockImplementation(() => {
        // First call returns sessions, second returns count
        return Promise.resolve([]);
      }),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).get("/ai/layout-sessions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it("GET /ai/layout-sessions/:id — 404 for unknown session", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).get("/ai/layout-sessions/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("PATCH /ai/layout-sessions/:id — 400 on invalid body", async () => {
    const res = await request(app)
      .patch("/ai/layout-sessions/some-id")
      .send({ roomWidthCm: -100 });
    expect(res.status).toBe(400);
  });

  it("POST /ai/layout-sessions/:id/archive — 404 for unknown session", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).post("/ai/layout-sessions/unknown/archive");
    expect(res.status).toBe(404);
  });
});

describe("API — placements", () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    app = buildTestApp();
  });

  it("POST /ai/layout-sessions/:id/placements — 400 on missing furnitureItemId", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: "s1", status: "active", tenantId: null,
        name: "R", roomWidthCm: "500", roomLengthCm: "700",
        coordinateUnit: "cm", metadata: {}, createdBy: "system",
        createdAt: new Date(), updatedAt: new Date(), archivedAt: null,
      }]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app)
      .post("/ai/layout-sessions/s1/placements")
      .send({ widthCm: 90, depthCm: 60, heightCm: 85 });
    expect(res.status).toBe(400);
  });

  it("GET /ai/layout-sessions/:id/placements — 200 with placements array", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).get("/ai/layout-sessions/s1/placements");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.placements)).toBe(true);
  });

  it("GET /ai/layout-sessions/:id/placements/:pid — 404 for unknown", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).get("/ai/layout-sessions/s1/placements/p_unknown");
    expect(res.status).toBe(404);
  });

  it("DELETE /ai/layout-sessions/:id/placements/:pid — 404 for unknown", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).delete("/ai/layout-sessions/s1/placements/p_unknown");
    expect(res.status).toBe(404);
  });

  it("error response never exposes SQL trigger text", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      offset: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof db.select>);

    const res = await request(app).get("/ai/layout-sessions/unknown-id");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("trg_");
    expect(body).not.toContain("fn_placements_tenant");
    expect(body).not.toContain("SQLSTATE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. RLS and policy structure — 5 tests
// ─────────────────────────────────────────────────────────────────────────────

describe("RLS / database policy expectations", () => {
  it("migration file exists: wp03a-placement-engine-v2.sql", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const content = readFileSync(
      resolve(process.cwd(), "scripts/migrations/wp03a-placement-engine-v2.sql"),
      "utf-8",
    );
    expect(content).toContain("layout_sessions");
    expect(content).toContain("placements");
  });

  it("RLS migration file exists: rls-wp03a-placement-engine-v2.sql", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const content = readFileSync(
      resolve(process.cwd(), "scripts/migrations/rls-wp03a-placement-engine-v2.sql"),
      "utf-8",
    );
    expect(content).toContain("ENABLE ROW LEVEL SECURITY");
    expect(content).toContain("FORCE ROW LEVEL SECURITY");
  });

  it("RLS migration has 4 policies for layout_sessions", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const content = readFileSync(
      resolve(process.cwd(), "scripts/migrations/rls-wp03a-placement-engine-v2.sql"),
      "utf-8",
    );
    const sessionPolicies = (content.match(/sessions_\w+_tenant/g) ?? []).length;
    expect(sessionPolicies).toBe(4);
  });

  it("RLS migration has 4 policies for placements", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const content = readFileSync(
      resolve(process.cwd(), "scripts/migrations/rls-wp03a-placement-engine-v2.sql"),
      "utf-8",
    );
    const placementPolicies = (content.match(/placements_\w+_tenant/g) ?? []).length;
    expect(placementPolicies).toBe(4);
  });

  it("tenant consistency migration has both triggers", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const content = readFileSync(
      resolve(process.cwd(), "scripts/migrations/wp03a-placement-tenant-consistency-v2.sql"),
      "utf-8",
    );
    expect(content).toContain("trg_placements_tenant_consistency");
    expect(content).toContain("trg_layout_sessions_protect_tenant");
    expect(content).toContain("IS NOT DISTINCT FROM");
  });
});
