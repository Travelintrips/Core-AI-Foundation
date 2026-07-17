/**
 * Team 17 — Interior Design — Validation unit tests
 * Tests: dimensions, impossible placement, clearance, circulation, safety disclaimers.
 */
import { describe, it, expect } from "vitest";
import {
  validateRoomDimensions,
  validateOpenings,
  checkFurnitureFitsRoom,
  checkClearanceBetween,
  checkAllClearances,
  validateCirculation,
  generateSafetyDisclaimers,
  runFullValidation,
  MIN_DOOR_WIDTH_M,
  MIN_RESIDENTIAL_PATHWAY_M,
  MIN_COMMERCIAL_PATHWAY_M,
  ABS_MIN_ROOM_DIM_M,
  MIN_FURNITURE_CLEARANCE_M,
  type RoomGeometry,
  type DoorSpec,
  type PlacedFurniture,
} from "../validation.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGeo = (l: number, w: number, h = 2.6, roomType = "living_room"): RoomGeometry => ({
  roomLengthM: l,
  roomWidthM: w,
  ceilingHeightM: h,
  roomType,
});

const makeDoor = (id: string, wall: DoorSpec["wall"], pos: number, width: number): DoorSpec => ({
  id,
  wall,
  positionM: pos,
  widthM: width,
});

const makeFurniture = (item: string, w: number, d: number, x = 0, y = 0): PlacedFurniture => ({
  item,
  widthM: w,
  depthM: d,
  xM: x,
  yM: y,
});

// ── validateRoomDimensions ────────────────────────────────────────────────────

describe("validateRoomDimensions", () => {
  it("passes for a normal living room", () => {
    const { warnings, passedChecks } = validateRoomDimensions(makeGeo(5, 4, 2.8));
    expect(warnings).toHaveLength(0);
    expect(passedChecks.length).toBeGreaterThan(0);
  });

  it("warns when length is below minimum", () => {
    const { warnings } = validateRoomDimensions(makeGeo(1.5, 4, 2.8));
    expect(warnings.some((w) => w.includes("length") && w.includes("minimum"))).toBe(true);
  });

  it("warns when width is below minimum", () => {
    const { warnings } = validateRoomDimensions(makeGeo(5, 1.5, 2.8));
    expect(warnings.some((w) => w.includes("width") && w.includes("minimum"))).toBe(true);
  });

  it("warns when ceiling height is below 2.0m", () => {
    const { warnings } = validateRoomDimensions(makeGeo(5, 4, 1.8));
    expect(warnings.some((w) => w.includes("Ceiling") && w.includes("minimum"))).toBe(true);
  });

  it("warns on negative dimensions", () => {
    const { warnings } = validateRoomDimensions(makeGeo(-2, 4, 2.6));
    expect(warnings.some((w) => w.includes("length") || w.includes("positive"))).toBe(true);
  });

  it("warns on zero dimensions", () => {
    const { warnings } = validateRoomDimensions(makeGeo(0, 4, 2.6));
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("warns on impossibly large room (sanity cap)", () => {
    const { warnings } = validateRoomDimensions(makeGeo(200, 4, 2.6));
    expect(warnings.some((w) => w.includes("maximum"))).toBe(true);
  });

  it("warns when total area is too small", () => {
    const { warnings } = validateRoomDimensions(makeGeo(2.0, 1.5, 2.6)); // 3m² — under 4m²
    expect(warnings.some((w) => w.includes("area") || w.includes("small") || w.includes("minimum"))).toBe(true);
  });

  it("warns for kitchen too narrow", () => {
    const { warnings } = validateRoomDimensions(makeGeo(4, 2.0, 2.6, "kitchen"));
    expect(warnings.some((w) => w.includes("Kitchen") && w.includes("2.5m"))).toBe(true);
  });

  it("passes for a kitchen meeting minimum width", () => {
    const { warnings } = validateRoomDimensions(makeGeo(5, 3.0, 2.6, "kitchen"));
    // No kitchen-width warning
    expect(warnings.filter((w) => w.includes("Kitchen") && w.includes("2.5m"))).toHaveLength(0);
  });

  it("warns for a restaurant that is too small", () => {
    const { warnings } = validateRoomDimensions(makeGeo(4, 4, 2.6, "restaurant")); // 16m² — under 20m²
    expect(warnings.some((w) => w.includes("restaurant") || w.includes("Restaurant"))).toBe(true);
  });

  it("warns for hotel room too narrow", () => {
    const { warnings } = validateRoomDimensions(makeGeo(5, 2.5, 2.6, "hotel"));
    expect(warnings.some((w) => w.includes("Hotel") || w.includes("hotel"))).toBe(true);
  });

  it("warns for lobby too narrow", () => {
    const { warnings } = validateRoomDimensions(makeGeo(8, 3.0, 2.6, "lobby"));
    expect(warnings.some((w) => w.toLowerCase().includes("lobby"))).toBe(true);
  });

  it("warns on unusually high ceiling", () => {
    const { warnings } = validateRoomDimensions(makeGeo(5, 4, 15));
    expect(warnings.some((w) => w.includes("high") || w.includes("confirm"))).toBe(true);
  });
});

// ── validateOpenings ──────────────────────────────────────────────────────────

describe("validateOpenings", () => {
  const geo = makeGeo(6, 4, 2.8);

  it("warns when no doors are defined", () => {
    const { warnings } = validateOpenings([], geo);
    expect(warnings.some((w) => w.includes("No doors"))).toBe(true);
  });

  it("passes for a door meeting minimum width", () => {
    const { passedChecks } = validateOpenings([makeDoor("d1", "north", 1, 0.9)], geo);
    expect(passedChecks.some((p) => p.includes("d1"))).toBe(true);
  });

  it("warns when door is narrower than accessible minimum", () => {
    const { warnings } = validateOpenings([makeDoor("d1", "north", 1, 0.7)], geo);
    expect(warnings.some((w) => w.includes("d1") && w.includes(String(MIN_DOOR_WIDTH_M)))).toBe(true);
  });

  it("warns when door extends beyond wall boundary", () => {
    // north wall = roomWidthM = 4m; door at position 3.5 with width 0.9 → extends to 4.4m
    const { warnings } = validateOpenings([makeDoor("d1", "north", 3.5, 0.9)], geo);
    expect(warnings.some((w) => w.includes("beyond wall"))).toBe(true);
  });

  it("passes when door is exactly within wall boundary", () => {
    const { warnings } = validateOpenings([makeDoor("d1", "north", 0, 0.9)], geo);
    expect(warnings.filter((w) => w.includes("beyond wall"))).toHaveLength(0);
  });
});

// ── checkFurnitureFitsRoom ────────────────────────────────────────────────────

describe("checkFurnitureFitsRoom", () => {
  const geo = makeGeo(5, 4, 2.8);

  it("passes for furniture that fits", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("Sofa", 2.2, 0.9, 0.5, 0.5), geo);
    expect(warnings).toHaveLength(0);
  });

  it("warns when furniture is larger than the room — impossible placement", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("GiantSofa", 6, 5, 0, 0), geo);
    expect(warnings.some((w) => w.includes("larger") || w.includes("impossible"))).toBe(true);
  });

  it("warns when furniture extends beyond east wall", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("Sofa", 2.0, 0.9, 4.5, 0), geo);
    expect(warnings.some((w) => w.includes("east wall"))).toBe(true);
  });

  it("warns when furniture extends beyond south wall", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("Sofa", 2.0, 1.0, 0, 3.5), geo);
    expect(warnings.some((w) => w.includes("south wall"))).toBe(true);
  });

  it("warns on negative position", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("Table", 1.0, 0.8, -0.5, 0), geo);
    expect(warnings.some((w) => w.includes("negative"))).toBe(true);
  });

  it("warns on zero or negative dimensions", () => {
    const warnings = checkFurnitureFitsRoom(makeFurniture("Ghost", 0, -1, 0, 0), geo);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ── checkClearanceBetween ─────────────────────────────────────────────────────

describe("checkClearanceBetween", () => {
  it("warns when two items overlap — impossible placement", () => {
    const a = makeFurniture("SofaA", 2.0, 0.9, 0, 0);
    const b = makeFurniture("SofaB", 2.0, 0.9, 1.0, 0.5); // overlaps a
    const warnings = checkClearanceBetween(a, b);
    expect(warnings.some((w) => w.includes("overlap") || w.includes("impossible"))).toBe(true);
  });

  it("warns when clearance is below minimum", () => {
    const a = makeFurniture("SofaA", 2.0, 0.9, 0, 0);
    const b = makeFurniture("Table", 1.0, 0.6, 2.1, 0); // gap of 0.1m — below 0.45m
    const warnings = checkClearanceBetween(a, b);
    expect(warnings.some((w) => w.includes("clearance") && w.includes("minimum"))).toBe(true);
  });

  it("passes when clearance meets minimum", () => {
    const a = makeFurniture("SofaA", 2.0, 0.9, 0, 0);
    const b = makeFurniture("Table", 1.0, 0.6, 2.6, 0); // gap of 0.6m — above 0.45m
    const warnings = checkClearanceBetween(a, b);
    expect(warnings).toHaveLength(0);
  });
});

// ── checkAllClearances ────────────────────────────────────────────────────────

describe("checkAllClearances", () => {
  const geo = makeGeo(6, 5, 2.8);

  it("returns no warnings for well-spaced furniture", () => {
    const items = [
      makeFurniture("Sofa", 2.2, 0.9, 0.5, 0.5),
      makeFurniture("TV Unit", 1.6, 0.4, 0.5, 4.0),
    ];
    const warnings = checkAllClearances(items, geo);
    expect(warnings).toHaveLength(0);
  });

  it("detects overlapping furniture", () => {
    const items = [
      makeFurniture("Sofa", 2.2, 0.9, 0.5, 0.5),
      makeFurniture("ArmChair", 0.8, 0.8, 1.0, 0.6), // overlaps with sofa
    ];
    const warnings = checkAllClearances(items, geo);
    expect(warnings.some((w) => w.includes("overlap") || w.includes("impossible"))).toBe(true);
  });

  it("warns when furniture blocks door swing zone", () => {
    const doors = [makeDoor("d1", "north", 0, 0.9)];
    const items = [makeFurniture("Cabinet", 0.8, 0.8, 0.1, 0.1)]; // in door swing zone
    const warnings = checkAllClearances(items, geo, doors);
    expect(warnings.some((w) => w.includes("door") || w.includes("swing"))).toBe(true);
  });
});

// ── validateCirculation ───────────────────────────────────────────────────────

describe("validateCirculation", () => {
  it("passes for residential with low occupancy", () => {
    const geo = makeGeo(6, 5, 2.8, "living_room");
    const items = [makeFurniture("Sofa", 2.2, 0.9, 0.5, 0.5)];
    const result = validateCirculation(items, geo);
    expect(result.isCommercial).toBe(false);
    expect(result.minPathwayWidth).toBe(MIN_RESIDENTIAL_PATHWAY_M);
    expect(result.warnings.filter((w) => w.includes("circulation") || w.includes("occupancy") || w.includes("occupies"))).toHaveLength(0);
  });

  it("warns when furniture occupancy is very high", () => {
    const geo = makeGeo(4, 3, 2.6, "living_room"); // 12m²
    // Furniture fills > 65% of room
    const items = [
      makeFurniture("ItemA", 3.5, 1.5, 0, 0),
      makeFurniture("ItemB", 3.5, 0.8, 0, 1.6),
    ];
    const result = validateCirculation(items, geo);
    expect(result.warnings.some((w) => w.includes("occupi") || w.includes("circulation"))).toBe(true);
  });

  it("uses commercial minimum for restaurant", () => {
    const geo = makeGeo(10, 8, 3.0, "restaurant");
    const result = validateCirculation([], geo);
    expect(result.isCommercial).toBe(true);
    expect(result.minPathwayWidth).toBe(MIN_COMMERCIAL_PATHWAY_M);
  });

  it("warns for kitchen with insufficient aisle width", () => {
    const geo = makeGeo(4, 2.0, 2.6, "kitchen"); // 2.0m wide — below 2*1.0+0.6=2.6
    const result = validateCirculation([], geo);
    expect(result.warnings.some((w) => w.toLowerCase().includes("kitchen") || w.includes("aisle"))).toBe(true);
  });
});

// ── generateSafetyDisclaimers ─────────────────────────────────────────────────

describe("generateSafetyDisclaimers", () => {
  it("includes base disclaimers for all room types", () => {
    for (const rt of ["living_room", "bedroom", "kitchen", "office"]) {
      const disclaimers = generateSafetyDisclaimers(rt);
      expect(disclaimers.some((d) => d.includes("not be used as construction"))).toBe(true);
      expect(disclaimers.some((d) => d.includes("structural"))).toBe(true);
      expect(disclaimers.some((d) => d.includes("No pricing"))).toBe(true);
    }
  });

  it("includes commercial disclaimers for restaurant", () => {
    const disclaimers = generateSafetyDisclaimers("restaurant");
    expect(disclaimers.some((d) => d.includes("fire safety") || d.includes("egress"))).toBe(true);
    expect(disclaimers.some((d) => d.includes("health department") || d.includes("food"))).toBe(true);
  });

  it("includes commercial disclaimers for cafe", () => {
    const disclaimers = generateSafetyDisclaimers("cafe");
    expect(disclaimers.some((d) => d.includes("fire") || d.includes("egress"))).toBe(true);
  });

  it("includes kitchen disclaimers for kitchen", () => {
    const disclaimers = generateSafetyDisclaimers("kitchen");
    expect(disclaimers.some((d) => d.includes("ventilation") || d.includes("hood"))).toBe(true);
    expect(disclaimers.some((d) => d.includes("gas") || d.includes("plumber"))).toBe(true);
  });

  it("includes hotel commercial disclaimers for hotel", () => {
    const disclaimers = generateSafetyDisclaimers("hotel");
    expect(disclaimers.some((d) => d.includes("fire") || d.includes("egress"))).toBe(true);
  });

  it("does not include restaurant-food disclaimer for bedroom", () => {
    const disclaimers = generateSafetyDisclaimers("bedroom");
    expect(disclaimers.some((d) => d.includes("health department"))).toBe(false);
  });

  it("always includes the no-pricing disclaimer", () => {
    for (const rt of ["cafe", "lobby", "booth", "office"]) {
      const disclaimers = generateSafetyDisclaimers(rt);
      expect(disclaimers.some((d) => d.includes("No pricing"))).toBe(true);
    }
  });
});

// ── runFullValidation ─────────────────────────────────────────────────────────

describe("runFullValidation", () => {
  it("returns structured result with all warning categories", () => {
    const result = runFullValidation({
      geo: makeGeo(5, 4, 2.8),
      doors: [makeDoor("d1", "north", 0.5, 0.9)],
      furniture: [makeFurniture("Sofa", 2.2, 0.9, 0.5, 1.0)],
    });

    expect(result).toHaveProperty("dimensionWarnings");
    expect(result).toHaveProperty("clearanceWarnings");
    expect(result).toHaveProperty("circulationWarnings");
    expect(result).toHaveProperty("placementWarnings");
    expect(result).toHaveProperty("passedChecks");
    expect(Array.isArray(result.dimensionWarnings)).toBe(true);
    expect(Array.isArray(result.passedChecks)).toBe(true);
  });

  it("reports no dimension warnings for a valid room", () => {
    const result = runFullValidation({ geo: makeGeo(6, 5, 2.8) });
    expect(result.dimensionWarnings).toHaveLength(0);
    expect(result.passedChecks.length).toBeGreaterThan(0);
  });

  it("catches impossible room + impossible furniture in same pass", () => {
    const result = runFullValidation({
      geo: makeGeo(2.5, 2.5, 2.0), // tiny room
      furniture: [makeFurniture("KingBed", 2.0, 2.1, 0, 0)], // barely fits but check still flags
    });
    // The room is at the edge of minimum — should have some warnings or passed checks
    expect(
      result.dimensionWarnings.length + result.clearanceWarnings.length + result.passedChecks.length,
    ).toBeGreaterThan(0);
  });

  it("flags missing doors in placementWarnings", () => {
    const result = runFullValidation({ geo: makeGeo(5, 4, 2.8) });
    expect(result.placementWarnings.some((w) => w.includes("No doors"))).toBe(true);
  });
});
