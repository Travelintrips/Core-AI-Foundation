import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readZeroLlmInstallStatus } from "../zeroLlmLocalService.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ZeroLLM deploy status", () => {
  it("returns a bounded sanitized install status written by the deploy bootstrap", async () => {
    const home = await mkdtemp(join(tmpdir(), "zerollm-status-"));
    dirs.push(home);
    await mkdir(home, { recursive: true });
    await writeFile(
      join(home, "status.json"),
      JSON.stringify({
        version: 1,
        state: "INSTALLED",
        installed: true,
        pythonAvailable: true,
        importOk: true,
        pythonVersion: "Python 3.12.4",
        requirementsHashShort: "abcdef123456",
        modelPreloaded: false,
        updatedAt: "2026-09-25T00:00:00.000Z",
        unexpectedSecret: "must-not-be-returned",
      }),
    );

    await expect(
      readZeroLlmInstallStatus({ ZEROLLM_HOME: home } as NodeJS.ProcessEnv),
    ).resolves.toEqual({
      state: "INSTALLED",
      installed: true,
      pythonAvailable: true,
      importOk: true,
      pythonVersion: "Python 3.12.4",
      requirementsHashShort: "abcdef123456",
      modelPreloaded: false,
      updatedAt: "2026-09-25T00:00:00.000Z",
    });
  });

  it("returns null when the deploy status file is unavailable", async () => {
    const home = await mkdtemp(join(tmpdir(), "zerollm-status-"));
    dirs.push(home);
    await expect(
      readZeroLlmInstallStatus({ ZEROLLM_HOME: home } as NodeJS.ProcessEnv),
    ).resolves.toBeNull();
  });
});
