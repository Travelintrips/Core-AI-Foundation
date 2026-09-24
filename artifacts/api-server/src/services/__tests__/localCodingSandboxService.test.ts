import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxedRepositoryVerification } from "../localCodingSandboxService.js";

const roots: string[] = [];
const image = "ghcr.io/travelintrips/ai-coding-sandbox@sha256:" + "a".repeat(64);

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "coding-sandbox-test-"));
  roots.push(root);
  return root;
}

describe("Local Coding Sandbox", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("passes without starting Docker when no repository scripts are discovered", async () => {
    const root = await workspace();
    let invoked = false;
    const result = await runSandboxedRepositoryVerification(root, [], {
      enabled: true,
      image,
      executor: async () => {
        invoked = true;
        return {};
      },
    });

    expect(result.status).toBe("PASSED");
    expect(result.scriptsExecuted).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/no repository verification scripts/i);
    expect(invoked).toBe(false);
  });

  it("fails closed when sandbox execution is disabled", async () => {
    const root = await workspace();
    let invoked = false;
    const result = await runSandboxedRepositoryVerification(root, ["pnpm test"], {
      enabled: false,
      image,
      executor: async () => {
        invoked = true;
        return {};
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.scriptsExecuted).toBe(false);
    expect(invoked).toBe(false);
  });

  it("requires an immutable digest-pinned sandbox image", async () => {
    const root = await workspace();
    const result = await runSandboxedRepositoryVerification(root, ["pnpm test"], {
      enabled: true,
      image: "node:22",
      executor: async () => ({ stdout: "unexpected" }),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.image).toBeNull();
    expect(result.warnings.join(" ")).toMatch(/sha256/i);
  });

  it("blocks arbitrary commands before starting the runtime", async () => {
    const root = await workspace();
    let invoked = false;
    const result = await runSandboxedRepositoryVerification(
      root,
      ["pnpm exec bash -lc whoami"],
      {
        enabled: true,
        image,
        executor: async () => {
          invoked = true;
          return {};
        },
      },
    );

    expect(result.status).toBe("BLOCKED");
    expect(result.commands[0]?.status).toBe("BLOCKED");
    expect(invoked).toBe(false);
  });

  it("runs offline dependency bootstrap and allowlisted scripts with hardened Docker arguments", async () => {
    const root = await workspace();
    const calls: Array<{ file: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const result = await runSandboxedRepositoryVerification(
      root,
      ["pnpm test", "pnpm --filter @workspace/api-server typecheck"],
      {
        enabled: true,
        image,
        executor: async (file, args, options) => {
          calls.push({ file, args, env: options.env });
          return { stdout: "ok", stderr: "" };
        },
      },
    );

    expect(result.status).toBe("PASSED");
    expect(result.scriptsExecuted).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.file === "docker")).toBe(true);
    expect(calls[0]?.args).toEqual(["version", "--format", "{{.Server.Version}}"]);
    for (const call of calls) {
      expect(call.env).not.toHaveProperty("AI_CODING_GITHUB_TOKEN");
      expect(call.env).not.toHaveProperty("DATABASE_URL");
      expect(call.env).not.toHaveProperty("OPENAI_API_KEY");
    }
    for (const call of calls.slice(1)) {
      expect(call.args).toEqual(expect.arrayContaining([
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--read-only",
        "--workdir", "/workspace",
        image,
      ]));
    }
    expect(calls[1]?.args.slice(-7)).toEqual([
      "pnpm",
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--store-dir",
      "/opt/pnpm-store",
    ]);
    expect(calls[2]?.args.slice(-2)).toEqual(["pnpm", "test"]);
    expect(calls[3]?.args.slice(-4)).toEqual([
      "pnpm", "--filter", "@workspace/api-server", "typecheck",
    ]);
  });

  it("stops before repository scripts when offline bootstrap fails", async () => {
    const root = await workspace();
    let calls = 0;
    const result = await runSandboxedRepositoryVerification(root, ["pnpm test"], {
      enabled: true,
      image,
      executor: async (_file, args) => {
        calls += 1;
        if (args[0] === "version") return { stdout: "27.0.0" };
        throw Object.assign(new Error("offline store miss"), {
          code: 1,
          stderr: "ERR_PNPM_NO_OFFLINE_META",
        });
      },
    });

    expect(result.status).toBe("FAILED");
    expect(result.dependencyBootstrap?.status).toBe("FAILED");
    expect(result.commands).toEqual([]);
    expect(result.scriptsExecuted).toBe(false);
    expect(calls).toBe(2);
  });

  it("returns sanitized structured diagnostics for a failed verification command", async () => {
    const root = await workspace();
    const result = await runSandboxedRepositoryVerification(root, ["pnpm typecheck"], {
      enabled: true,
      image,
      bootstrapDependencies: false,
      executor: async (_file, args) => {
        if (args[0] === "version") return { stdout: "27.0.0" };
        throw Object.assign(new Error("typecheck failed"), {
          code: 2,
          stderr: "src/payment.ts(8,4): error TS2322: password=super-secret is invalid",
        });
      },
    });

    expect(result.status).toBe("FAILED");
    expect(result.failureContexts[0]).toMatchObject({
      kind: "typescript",
      primaryFiles: ["src/payment.ts"],
      errorCodes: ["TS2322"],
    });
    expect(JSON.stringify(result.failureContexts)).toContain("password=[REDACTED]");
    expect(JSON.stringify(result.failureContexts)).not.toContain("super-secret");
  });

  it("fails closed when Docker runtime is unavailable", async () => {
    const root = await workspace();
    const result = await runSandboxedRepositoryVerification(root, ["pnpm test"], {
      enabled: true,
      image,
      executor: async () => {
        throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
      },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.scriptsExecuted).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/runtime is unavailable/i);
  });

  it("continues when a single deterministic timeout retry succeeds", async () => {
    const root = await workspace();
    let testAttempts = 0;
    const result = await runSandboxedRepositoryVerification(
      root,
      ["pnpm test", "pnpm typecheck"],
      {
        enabled: true,
        image,
        bootstrapDependencies: false,
        executor: async (_file, args) => {
          if (args[0] === "version") return { stdout: "27.0.0" };
          if (args.at(-1) === "test") {
            testAttempts += 1;
            if (testAttempts === 1) {
              throw Object.assign(new Error("timed out"), {
                code: "ETIMEDOUT",
                killed: true,
                signal: "SIGTERM",
              });
            }
          }
          return { stdout: "ok", stderr: "" };
        },
      },
    );

    expect(result.status).toBe("PASSED");
    expect(result.commands.map((item) => item.status)).toEqual(["PASSED", "PASSED"]);
    expect(result.deterministicRetries).toEqual([
      { command: "pnpm test", trigger: "TIMEOUT", status: "PASSED" },
    ]);
    expect(result.failureContexts).toEqual([]);
    expect(testAttempts).toBe(2);
  });

  it("reports timeout and stops the verification sequence", async () => {
    const root = await workspace();
    let calls = 0;
    const result = await runSandboxedRepositoryVerification(
      root,
      ["pnpm test", "pnpm typecheck"],
      {
        enabled: true,
        image,
        bootstrapDependencies: false,
        executor: async (_file, args) => {
          calls += 1;
          if (args[0] === "version") return { stdout: "27.0.0" };
          throw Object.assign(new Error("timed out"), {
            code: "ETIMEDOUT",
            killed: true,
            signal: "SIGTERM",
          });
        },
      },
    );

    expect(result.status).toBe("FAILED");
    expect(result.commands[0]?.status).toBe("TIMEOUT");
    expect(result.commands).toHaveLength(1);
    expect(result.deterministicRetries).toEqual([
      { command: "pnpm test", trigger: "TIMEOUT", status: "TIMEOUT" },
    ]);
    expect(result.failureContexts[0]).toMatchObject({
      command: "pnpm test",
      kind: "timeout",
      retry: expect.objectContaining({ allowed: true }),
    });
    expect(calls).toBe(3);
  });
});
