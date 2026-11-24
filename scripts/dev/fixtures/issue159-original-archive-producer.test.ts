// Execute ONLY inside a disposable checkout of the pinned OpenClaw v2026.10.7
// source tree, copied temporarily to src/commands/ by GitHub Actions.
// Never use a real DELL state, config, credential or remote storage location.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createBackupArchive } from "../infra/backup-create.js";
import {
  closeOpenClawStateDatabase,
  openOpenClawStateDatabase,
} from "../state/openclaw-state-db.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";

it("creates an original-version archive with synthetic state for candidate consumption", async () => {
  const sharedArchive = process.env.ISSUE159_SYNTHETIC_ARCHIVE;
  expect(typeof sharedArchive).toBe("string");
  expect(sharedArchive).toMatch(/issue159-original-synthetic\.tar\.gz$/u);
  await withOpenClawTestState(
    { layout: "state-only", prefix: "issue159-original-archive-", scenario: "minimal" },
    async (state) => {
      const outputDir = state.path("synthetic-archives");
      await fs.mkdir(outputDir, { recursive: true });
      openOpenClawStateDatabase({ env: state.env });
      try {
        const result = await createBackupArchive({
          output: outputDir,
          includeWorkspace: false,
          nowMs: Date.UTC(2026, 10, 14, 12, 0, 0),
        });
        expect(result.dryRun).toBe(false);
        expect(result.archivePath).toContain("openclaw-backup");
        await fs.mkdir(path.dirname(sharedArchive!), { recursive: true });
        await fs.copyFile(result.archivePath, sharedArchive!);
        expect((await fs.stat(sharedArchive!)).size).toBeGreaterThan(4096);
      } finally {
        closeOpenClawStateDatabase();
      }
    },
  );
});
