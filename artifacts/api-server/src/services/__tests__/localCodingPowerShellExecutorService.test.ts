import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn(async () => undefined),
}));

import {
  approveOllamaPowerShellExecution,
  executeApprovedOllamaPowerShellExecution,
  LocalCodingPowerShellError,
  parseAllowlistedPowerShellCommand,
  prepareOllamaPowerShellExecution,
} from "../localCodingPowerShellExecutorService.js";

const roots: string[] = [];

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "core-ai-powershell-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ollama PowerShell allowlist", () => {
  it("accepts bounded diagnostic and verification commands", () => {
    expect(parseAllowlistedPowerShellCommand("Get-Location")).not.toBeNull();
    expect(parseAllowlistedPowerShellCommand("Get-ChildItem -Name")).not.toBeNull();
    expect(parseAllowlistedPowerShellCommand("git status --short")).not.toBeNull();
    expect(parseAllowlistedPowerShellCommand("git rev-parse HEAD")).not.toBeNull();
    expect(parseAllowlistedPowerShellCommand("pnpm typecheck")).not.toBeNull();
    expect(
      parseAllowlistedPowerShellCommand(
        "pnpm --filter @workspace/api-server run test",
      ),
    ).not.toBeNull();
    expect(parseAllowlistedPowerShellCommand("npm run build")).not.toBeNull();
  });

  it("rejects arbitrary shell, chaining, network, destructive, and file-read commands", () => {
    for (const command of [
      "Remove-Item -Recurse -Force .",
      "Get-Content .env",
      "curl https://example.com",
      "Invoke-WebRequest https://example.com",
      "git push origin main",
      "git commit -am change",
      "pnpm exec powershell whoami",
      "pnpm test; whoami",
      "Get-ChildItem | Remove-Item",
      "cmd /c whoami",
    ]) {
      expect(parseAllowlistedPowerShellCommand(command), command).toBeNull();
    }
  });
});

describe("Ollama PowerShell approval gate", () => {
  it("fails closed unless explicitly enabled", async () => {
    const root = await workspace();
    await expect(
      prepareOllamaPowerShellExecution({
        requestedBy: "test",
        modelId: "qwen2.5-coder:7b",
        commands: ["Get-Location"],
        env: {
          LOCAL_CODING_POWERSHELL_ROOT: root,
        } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({ code: "DISABLED" });
  });

  it("fails closed in production without a second explicit switch", async () => {
    const root = await workspace();
    await expect(
      prepareOllamaPowerShellExecution({
        requestedBy: "test",
        modelId: "qwen2.5-coder:7b",
        commands: ["Get-Location"],
        env: {
          NODE_ENV: "production",
          OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
          LOCAL_CODING_POWERSHELL_ROOT: root,
        } as NodeJS.ProcessEnv,
      }),
    ).rejects.toMatchObject({ code: "DISABLED" });
  });

  it("requires digest-bound approval before running PowerShell", async () => {
    const root = await workspace();
    const env = {
      OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
      LOCAL_CODING_POWERSHELL_ROOT: root,
      LOCAL_CODING_POWERSHELL_BIN: "powershell.exe",
      PATH: "fixture-path",
    } as NodeJS.ProcessEnv;

    const prepared = await prepareOllamaPowerShellExecution({
      taskId: "11111111-1111-4111-8111-111111111111",
      requestedBy: "ollama-worker-test",
      modelId: "qwen2.5-coder:7b",
      commands: ["git status --short", "pnpm typecheck"],
      env,
    });

    expect(prepared.status).toBe("PREPARED");

    await expect(
      executeApprovedOllamaPowerShellExecution({
        approvalId: prepared.approvalId,
        expectedDigest: prepared.digest,
        env,
        executor: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "NOT_READY" });

    await expect(
      approveOllamaPowerShellExecution(
        prepared.approvalId,
        "0".repeat(64),
      ),
    ).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });

    const approved = await approveOllamaPowerShellExecution(
      prepared.approvalId,
      prepared.digest,
    );
    expect(approved.status).toBe("APPROVED");

    const executor = vi.fn(async () => ({ stdout: "ok\n", stderr: "" }));
    const completed = await executeApprovedOllamaPowerShellExecution({
      approvalId: prepared.approvalId,
      expectedDigest: prepared.digest,
      env,
      executor,
    });

    expect(completed.status).toBe("COMPLETED");
    expect(completed.results.map((result) => result.status)).toEqual([
      "PASSED",
      "PASSED",
    ]);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[0]?.[0]).toBe("powershell.exe");
    expect(executor.mock.calls[0]?.[1]).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "& git status --short",
    ]);
    expect(executor.mock.calls[0]?.[2]?.cwd).toBe(root);
    expect(executor.mock.calls[0]?.[2]?.env).toEqual(
      expect.objectContaining({
        PATH: "fixture-path",
        CI: "1",
        NO_COLOR: "1",
      }),
    );
    expect(executor.mock.calls[0]?.[2]?.env).not.toHaveProperty("ADMIN_API_KEY");
  });

  it("rejects a non-allowlisted command during preparation", async () => {
    const root = await workspace();
    await expect(
      prepareOllamaPowerShellExecution({
        requestedBy: "test",
        modelId: "qwen2.5-coder:7b",
        commands: ["Remove-Item -Recurse -Force ."],
        env: {
          OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
          LOCAL_CODING_POWERSHELL_ROOT: root,
        } as NodeJS.ProcessEnv,
      }),
    ).rejects.toBeInstanceOf(LocalCodingPowerShellError);
  });
});
