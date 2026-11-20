// Execute ONLY inside the pinned candidate checkout on the same disposable
// runner as the 2026.10.7 producer fixture. No real credentials or live Gateway.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { backupRestoreCommand } from "./backup-restore.js";
import { verifyBackupArchive } from "./backup-verify.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

it("verifies and restores a genuine synthetic archive produced by original v2026.10.7", async () => {
  const archive = process.env.ISSUE159_SYNTHETIC_ARCHIVE;
  expect(archive).toMatch(/issue159-original-synthetic\.tar\.gz$/u);
  expect((await fs.stat(archive!)).size).toBeGreaterThan(4096);

  const verified = await verifyBackupArchive(archive!);
  expect(verified.ok).toBe(true);

  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "issue159-cross-release-restore-"));
  try {
    const target = path.join(scratch, "new-target");
    const result = await backupRestoreCommand(createTestRuntime(), {
      archive: archive!,
      target,
      json: true,
    });
    expect(result.ok).toBe(true);
    const restoredEntries = await fs.readdir(target, { recursive: true });
    const db = restoredEntries.find((name) =>
      name.replaceAll("\\", "/").endsWith("/state/openclaw.sqlite")
    );
    expect(db).toBeDefined();
    const database = new DatabaseSync(path.join(target, db!), { readOnly: true });
    try {
      expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      database.close();
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
