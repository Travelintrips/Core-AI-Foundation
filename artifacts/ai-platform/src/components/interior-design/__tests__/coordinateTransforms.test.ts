import { describe, expect, it } from "vitest";
import { createCoordinateTransform } from "../coordinateTransforms";

describe("createCoordinateTransform", () => {
  it("round-trips room coordinates with zoom and pan", () => {
    const transform = createCoordinateTransform(
      { width: 400, height: 500 },
      { width: 720, height: 470 },
      1.5,
      { x: 24, y: -18 },
    );
    const roomPoint = { x: 125, y: 275 };
    const canvasPoint = transform.roomToCanvas(roomPoint);
    expect(transform.canvasToRoom(canvasPoint).x).toBeCloseTo(roomPoint.x);
    expect(transform.canvasToRoom(canvasPoint).y).toBeCloseTo(roomPoint.y);
  });

  it.each([
    [{ width: 0, height: 500 }, { width: 720, height: 470 }],
    [{ width: -1, height: 500 }, { width: 720, height: 470 }],
    [{ width: 400, height: 500 }, { width: 0, height: 470 }],
    [{ width: 400, height: 500 }, { width: 720, height: -1 }],
  ])("rejects invalid dimensions", (room, canvas) => {
    expect(() => createCoordinateTransform(room, canvas)).toThrow();
  });

  it("rejects non-finite coordinates and zoom", () => {
    expect(() => createCoordinateTransform({ width: 400, height: 500 }, { width: 720, height: 470 }, 0)).toThrow();
    const transform = createCoordinateTransform({ width: 400, height: 500 }, { width: 720, height: 470 });
    expect(() => transform.roomToCanvas({ x: Number.NaN, y: 1 })).toThrow();
    expect(() => transform.canvasToRoom({ x: Number.POSITIVE_INFINITY, y: 1 })).toThrow();
  });
});