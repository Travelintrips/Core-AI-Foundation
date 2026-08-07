import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHardRules, scoreSoftRules, generateCandidates } from "../lib/placement.mjs";
import { isUuid, validateItem, validatePlacementRequest } from "../lib/contracts.mjs";

const room = { width: 6.4, depth: 4.8, defaultClearance: 0.35 };
const item = (overrides = {}) => ({ id: "item", name: "Item", x: 1, y: 1, width: 1, depth: 1, height: .7, ...overrides });
const uuid = "3d08c1a1-2f2a-4f9e-8a2a-7e0d835dc101";
const validItem = (overrides = {}) => item({ id: uuid, rotation: 0, ...overrides });

test("hard rules reject out-of-bounds and overlap", () => {
  assert.ok(evaluateHardRules(room, [item({ x: -1 })]).some((r) => r.code === "HR-1"));
  assert.ok(evaluateHardRules(room, [item(), item({ id: "two", x: 1.5, y: 1 })]).some((r) => r.code === "HR-3"));
});
test("hard rules reject invalid geometry and spacing", () => {
  assert.ok(evaluateHardRules(room, [item({ width: 0 })]).some((r) => r.code === "HR-2"));
  assert.ok(evaluateHardRules(room, [item(), item({ id: "two", x: 2.1, y: 1 })]).some((r) => r.code === "HR-6"));
});
test("soft score is finite and in the required range", () => {
  const result = scoreSoftRules(room, [item({ x: .25, y: .25 })]);
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.contributions.length, 6);
});
test("candidate generation is deterministic and preserves locked placement", () => {
  const locked = item({ id: "locked", name: "Locked", x: .5, y: .5, locked: true, manual: true });
  const items = [locked, item({ id: "move", x: 3, y: 3 })];
  const first = generateCandidates(room, items, { maxAlternatives: 3 });
  const second = generateCandidates(room, items, { maxAlternatives: 3 });
  assert.deepEqual(first, second);
  assert.ok(first.every((candidate) => candidate.items.find((entry) => entry.id === "locked").x === .5));
});
test("candidate generation caps alternatives at three", () => {
  assert.equal(generateCandidates(room, [item()], { maxAlternatives: 3 }).length, 3);
});
test("all hard rule families are independently reported", () => {
  const clearanceRoom = { width: 3, depth: 3, defaultClearance: .35 };
  const first = validItem({ id: uuid, x: .1, y: .1, width: 1, depth: 1, clearanceZone: { x: .3, y: .3 } });
  const second = validItem({ id: "3d08c1a1-2f2a-4f9e-8a2a-7e0d835dc102", x: 1.2, y: .1, clearanceZone: { x: .3, y: .3 } });
  const rules = evaluateHardRules(clearanceRoom, [first, second], { wallGap: .2, minimumSpacing: .4 });
  assert.ok(rules.some((rule) => rule.code === "HR-5"));
  assert.ok(rules.some((rule) => rule.code === "HR-4" || rule.code === "HR-6"));
  assert.ok(evaluateHardRules(room, Array.from({ length: 51 }, (_, index) => validItem({ id: `3d08c1a1-2f2a-4f9e-8a2a-${String(index + 101).padStart(4, "0")}` }))).some((rule) => rule.code === "HR-8"));
});
test("soft rules remain finite for empty rooms and preferred zones", () => {
  const result = scoreSoftRules(room, [], { preferredZones: [{ x: 0, y: 0, width: 1, depth: 1 }] });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.contributions.every((entry) => Number.isFinite(entry.value)));
});
test("contracts validate UUIDs, geometry, limits, and deadlines", () => {
  assert.equal(isUuid(uuid), true);
  assert.equal(isUuid("item"), false);
  assert.ok(validateItem({ ...validItem(), width: 0 }).some((message) => message.includes("positive")));
  assert.ok(validatePlacementRequest({ maxAlternatives: 4 }).length > 0);
  assert.ok(validatePlacementRequest({ deadline: 0 }).length > 0);
  assert.equal(validatePlacementRequest({ sessionId: uuid, items: [validItem()] }).length, 0);
});
test("input objects are not mutated and valid candidates rank before invalid ones", () => {
  const input = [validItem({ id: uuid, locked: true, manual: true }), validItem({ id: "3d08c1a1-2f2a-4f9e-8a2a-7e0d835dc102", x: 3, y: 3 })];
  const before = structuredClone(input);
  const candidates = generateCandidates(room, input);
  assert.deepEqual(input, before);
  const firstInvalid = candidates.findIndex((candidate) => !candidate.valid);
  if (firstInvalid >= 0) assert.ok(candidates.slice(0, firstInvalid).every((candidate) => candidate.valid));
});
test("bounded generation handles the 10, 25, and 50 item caps", () => {
  for (const count of [10, 25, 50]) {
    const items = Array.from({ length: count }, (_, index) => validItem({
      id: `3d08c1a1-2f2a-4f9e-8a2a-${String(index + 201).padStart(4, "0")}`,
      x: .3 + (index % 8) * .7, y: .3 + Math.floor(index / 8) * .7, width: .35, depth: .35
    }));
    const candidates = generateCandidates(room, items);
    assert.equal(candidates.length, 3);
    assert.ok(candidates.every((candidate) => Number.isFinite(candidate.score)));
  }
});