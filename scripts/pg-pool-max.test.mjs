import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute only the pure constant-declaration segment from the actual pool
// config; no database module import, credentials, or network access required.
const source = readFileSync(new URL("../lib/db/src/index.ts", import.meta.url), "utf8");
const begin = source.indexOf('const isProduction = process.env["NODE_ENV"] === "production";');
const end = source.indexOf("\nconst poolConfig =", begin);
assert.ok(begin >= 0 && end > begin);
const segment = source.slice(begin, end);

function getPoolMax(NODE_ENV, PG_POOL_MAX) {
  const context = { process: { env: { NODE_ENV, PG_POOL_MAX } } };
  return vm.runInNewContext(segment + "\n poolMax;", context, { timeout: 1000 });
}

test("production defaults to 10 and never increases above 10", () => {
  assert.equal(getPoolMax("production", undefined), 10);
  assert.equal(getPoolMax("production", "1000"), 10);
  assert.equal(getPoolMax("production", "10"), 10);
});
test("dedicated production workers can opt into a smaller pool", () => {
  assert.equal(getPoolMax("production", "2"), 2);
  assert.equal(getPoolMax("production", "1"), 1);
  assert.equal(getPoolMax("production", "3.9"), 3);
});
test("invalid overrides fail back to existing defaults", () => {
  for (const input of ["", "0", "-1", "not-a-number", "Infinity"]) {
    assert.equal(getPoolMax("production", input), 10);
    assert.equal(getPoolMax("development", input), 5);
  }
});
test("development keeps its prior safe defaults and overrides", () => {
  assert.equal(getPoolMax("development", undefined), 5);
  assert.equal(getPoolMax("development", "8"), 8);
  assert.equal(getPoolMax("development", "20"), 10);
});
