import assert from "node:assert/strict";
import test from "node:test";
import {
  safeTask183FailureCode,
  runCombinedRelockLanes,
} from "./gpt02_issue159_relock_catalog_supervisor.mjs";

// No database connection, credential injection, systemd invocation or relock execution.
// Test only injected lane stubs and redacted public error codes.
test("recognized Task183 failure categories are retained safely", async () => {
  for (const code of [
    "RELOCK_TASK183_UNVERIFIED_SCOPE_OR_GRANT",
    "RELOCK_TASK183_UNTRUSTED_RESULT",
  ]) {
    assert.equal(safeTask183FailureCode(new Error(code)), code);
    await assert.rejects(
      runCombinedRelockLanes(null, {
        task183Enabled: true,
        runLegacy: async () => ({ readerInstalled: true }),
        runTask183: async () => { throw new Error(code); },
      }),
      (error) => error.message === code,
    );
  }
});

test("raw PG errors and forged codes never appear in public diagnostics", () => {
  for (const error of [
    new Error("password=do-not-log db=mydb"),
    new Error("SQL ERROR SELECT FROM pg_authid"),
    { message: "RELOCK_FAKE_SUCCESS" },
    null,
  ]) {
    assert.equal(safeTask183FailureCode(error), "RELOCK_TASK183_DATABASE_OR_RUNTIME_UNAVAILABLE");
  }
});

test("dual lane failure remains denied without leaking raw errors", async () => {
  await assert.rejects(
    runCombinedRelockLanes(null, {
      task183Enabled: true,
      runLegacy: async () => { throw new Error("private legacy error"); },
      runTask183: async () => { throw new Error("private task error"); },
    }),
    (error) => error.message === "RELOCK_MULTIPLE_LANES_FAILED",
  );
});

test("successful mocked lanes retain legacy result and Task183 evidence", async () => {
  const result = await runCombinedRelockLanes(null, {
    task183Enabled: true,
    runLegacy: async () => ({ readerInstalled: true }),
    runTask183: async () => ({ roleLocked: true, sessionsRemaining: 0 }),
  });
  assert.equal(result.readerInstalled, true);
  assert.equal(result.task183Relock.roleLocked, true);
  assert.equal(result.task183RelockEnabled, true);
});

test("Task183 opt-out preserves legacy result", async () => {
  let task183Called = false;
  const result = await runCombinedRelockLanes(null, {
    task183Enabled: false,
    runLegacy: async () => ({ readerInstalled: true }),
    runTask183: async () => { task183Called = true; },
  });
  assert.equal(task183Called, false);
  assert.equal(result.task183RelockEnabled, false);
});
