import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHardRules, scoreSoftRules, generateCandidates } from "../lib/placement.mjs";

const room = { width: 6.4, depth: 4.8, defaultClearance: 0.35 };
const item = (overrides = {}) => ({ id: "item", name: "Item", x: 1, y: 1, width: 1, depth: 1, height: .7, ...overrides });

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