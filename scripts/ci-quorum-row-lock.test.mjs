import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../artifacts/api-server/src/services/localCodingCiGateService.ts", import.meta.url), "utf8");

test("one transaction locks each CI binding before aggregating check results", () => {
  const txn = source.indexOf("const transition = await db.transaction(async (tx) => {");
  const binding = source.indexOf(".from(aiCodingCiBindingsTable)", txn);
  const rowLock = source.indexOf('.for("update")', binding);
  const verdict = source.indexOf("decideSignedGithubCiGate({", rowLock);
  const update = source.indexOf("await tx.update(aiCodingCiBindingsTable)", verdict);
  const commit = source.indexOf("if (!transition) continue;", update);
  const dispatch = source.indexOf("if (verdict.newlyGreen)", commit);
  assert.ok(txn > 0 && binding > txn && rowLock > binding && verdict > rowLock);
  assert.ok(update > verdict && commit > update && dispatch > commit);
  assert.ok(source.includes("ciChecks: verdict.checkResults"));
  assert.ok(source.includes("ciLastEventId: event.eventId"));
});

test("an unrelated or unsigned event does not transition a workstream", () => {
  assert.ok(source.includes("if (!verdict.accepted) return null"));
  assert.ok(source.includes('sourceModule: event.sourceModule'));
  assert.ok(source.includes('requiredChecks: binding.requiredChecksJson'));
  assert.ok(!source.includes('if (success) {\n      const { continueAfterGreenCi'));
});
