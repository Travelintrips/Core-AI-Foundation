import { afterEach, describe, expect, it, vi } from "vitest";
import { runDirectLocalOllamaPowerShellTask } from "../localCodingDirectOllamaPowerShellService.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("direct local Ollama PowerShell bootstrap", () => {
  it("plans through loopback Ollama and executes only allowlisted commands", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  commands: ["git rev-parse HEAD", "pnpm --version"],
                  reason: "Verify the local checkout and package manager.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const executor = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "" });
    const env = {
      ...process.env,
      NODE_ENV: "development",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
      OLLAMA_MODEL: "qwen2.5-coder:7b",
      OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
      OLLAMA_WORKER_POWERSHELL_TRUSTED_MODE: "true",
      LOCAL_CODING_POWERSHELL_ROOT: process.cwd(),
    };

    const result = await runDirectLocalOllamaPowerShellTask({
      instruction: "Check the local repository.",
      env,
      executor,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    expect(result.plannedCommands).toEqual([
      "git rev-parse HEAD",
      "pnpm --version",
    ]);
    expect(result.execution.status).toBe("COMPLETED");
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("rejects commands outside the trusted allowlist before execution", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  commands: ["Remove-Item -Recurse C:\\temp"],
                  reason: "Unsafe request.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const executor = vi.fn();
    const env = {
      ...process.env,
      NODE_ENV: "development",
      OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1",
      OLLAMA_MODEL: "qwen2.5-coder:7b",
      OLLAMA_WORKER_POWERSHELL_ENABLED: "true",
      OLLAMA_WORKER_POWERSHELL_TRUSTED_MODE: "true",
      LOCAL_CODING_POWERSHELL_ROOT: process.cwd(),
    };

    await expect(
      runDirectLocalOllamaPowerShellTask({
        instruction: "Delete temp files.",
        env,
        executor,
      }),
    ).rejects.toThrow("outside the trusted allowlist");

    expect(executor).not.toHaveBeenCalled();
  });
});
