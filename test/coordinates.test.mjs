import test from "node:test";
import assert from "node:assert/strict";
import { roomToCanvas, canvasToRoom, itemFootprint } from "../public/coordinates.js";

const room = { width: 6.4, depth: 4.8 };
const canvas = { width: 600, height: 450 };

test("room and canvas coordinate transforms are reversible", () => {
  const roomPoint = { x: 2.35, y: 1.7 };
  const canvasPoint = roomToCanvas(roomPoint, room, canvas);
  const roundTrip = canvasToRoom(canvasPoint, room, canvas);
  assert.ok(Math.abs(roundTrip.x - roomPoint.x) < 0.000001);
  assert.ok(Math.abs(roundTrip.y - roomPoint.y) < 0.000001);
});

test("rotation changes rendered footprint without changing source dimensions", () => {
  const furniture = { width: 1.2, depth: .7, rotation: 90 };
  assert.deepEqual(itemFootprint(furniture), { width: .7, depth: 1.2 });
  assert.equal(furniture.width, 1.2);
  assert.equal(furniture.depth, .7);
});

test("transform rejects non-finite values", () => {
  assert.throws(() => roomToCanvas({ x: Infinity, y: 1 }, room, canvas), TypeError);
  assert.throws(() => canvasToRoom({ x: 1, y: Number.NaN }, room, canvas), TypeError);
});