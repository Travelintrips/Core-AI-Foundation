import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./hostinger-runtime-classify.jq", import.meta.url));
function classify(input) {
  const proc = spawnSync("jq", ["-c", "-f", script], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: 5_000,
  });
  assert.equal(proc.status, 0, proc.stderr);
  return { output: proc.stdout.trim(), parsed: JSON.parse(proc.stdout) };
}

test("diagnostic output groups errors, never outputs raw messages or secrets", () => {
  const input = {
    logs: [
      { message: "MODULE_NOT_FOUND in runtime secret=sk-SHOULD-NEVER-PRINT" },
      { message: "ECONNREFUSED postgres password=extremely-sensitive" },
      { message: "uncaught exception token=TOKEN_NOT_FOR_LOG" },
      { message: "server started" },
      { message: "another missing module Cannot find module X" },
    ],
  };
  const { output, parsed } = classify(input);
  assert.deepEqual(parsed.runtime_log_categories, [
    { category: "dependency_connection", count: 1 },
    { category: "missing_module", count: 2 },
    { category: "other", count: 1 },
    { category: "runtime_error", count: 1 },
  ]);
  for (const sensitive of ["sk-SHOULD-NEVER-PRINT", "extremely-sensitive", "TOKEN_NOT_FOR_LOG", "MODULE_NOT_FOUND"]) {
    assert.equal(output.includes(sensitive), false);
  }
});

test("nested runtime response and missing logs fail safe", () => {
  const { parsed } = classify({ data: { logs: [{ message: "EADDRINUSE on port 3000" }] } });
  assert.deepEqual(parsed.runtime_log_categories, [{ category: "port_or_listener", count: 1 }]);
  assert.deepEqual(classify({ detail: "password=NEVER-PRINT" }).parsed.runtime_log_categories, []);
});

test("workflow only emits checked-in classifier result, not diagnostic JSON", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostinger-runtime-diagnostic.yml", import.meta.url), "utf8");
  assert.match(workflow, /jq -c -f scripts\/hostinger-runtime-classify\.jq/);
  assert.doesNotMatch(workflow, /cat \/tmp\/aicore-runtime-logs\.json/);
  assert.doesNotMatch(workflow, /jq .*\.logs\[\]/);
});
