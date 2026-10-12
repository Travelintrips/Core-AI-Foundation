import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableRecoveryStore } from "./durable-recovery-store.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "recovery-"));
  const store = new DurableRecoveryStore(join(dir, "state.sqlite"));
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("persists checkpoint and claims exactly once while lease is active", () => {
  const f = fixture();
  try {
    f.store.checkpoint("cmd-1", "abc123");
    const first = f.store.claimResume("cmd-1", "runner-a", 60000);
    assert.equal(first.checkpointSha, "abc123");
    assert.equal(first.resumeAttempts, 1);
    assert.equal(f.store.claimResume("cmd-1", "runner-b", 60000), null);
  } finally { f.cleanup(); }
});

test("approval pending blocks resume", () => {
  const f = fixture();
  try {
    f.store.checkpoint("cmd-2", "def456", { approvalPending: true });
    assert.equal(f.store.claimResume("cmd-2", "runner-a"), null);
  } finally { f.cleanup(); }
});

test("completion is owner-bound and prevents duplicate recovery", () => {
  const f = fixture();
  try {
    f.store.checkpoint("cmd-3", "789abc");
    assert.ok(f.store.claimResume("cmd-3", "runner-a"));
    assert.equal(f.store.complete("cmd-3", "runner-b"), false);
    assert.equal(f.store.complete("cmd-3", "runner-a"), true);
    assert.equal(f.store.claimResume("cmd-3", "runner-b"), null);
  } finally { f.cleanup(); }
});
