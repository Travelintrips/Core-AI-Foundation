import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  parseAllowlistedVerificationCommand,
  type VerificationCommandResult,
} from "./localCodingEngineService.js";
import {
  buildFailureContexts,
  type LocalFailureContext,
} from "./localCodingFailureDiagnosticService.js";

const execFileAsync = promisify(execFile);

const MAX_COMMANDS = 6;
const MIN_TIMEOUT_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_STDOUT_BYTES = 200_000;
const MAX_STDERR_BYTES = 100_000;
const DEFAULT_MEMORY = "1024m";
const DEFAULT_CPUS = "1";
const DEFAULT_PIDS = "256";

type SandboxExecutorOptions = {
  cwd: string;
  timeout: number;
  maxBuffer: number;
  env: NodeJS.ProcessEnv;
};

export type SandboxExecutor = (
  file: string,
  args: string[],
  options: SandboxExecutorOptions,
) => Promise<{ stdout?: string; stderr?: string }>;

export interface SandboxedVerificationResult {
  status: "PASSED" | "FAILED" | "BLOCKED";
  runtime: "docker";
  image: string | null;
  network: "none";
  dependencyBootstrap: VerificationCommandResult | null;
  commands: VerificationCommandResult[];
  deterministicRetries: Array<{
    command: string;
    trigger: "TIMEOUT";
    status: VerificationCommandResult["status"];
  }>;
  failureContexts: LocalFailureContext[];
  scriptsExecuted: boolean;
  warnings: string[];
}

interface SandboxedVerificationOptions {
  enabled?: boolean;
  image?: string;
  timeoutMs?: number;
  executor?: SandboxExecutor;
  bootstrapDependencies?: boolean;
}

function boundedTimeout(value: number | undefined): number {
  return Math.max(
    MIN_TIMEOUT_MS,
    Math.min(value ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  );
}

function pinnedImage(value: string): string | null {
  const trimmed = value.trim();
  if (
    !/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function scrubbedHostEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/nonexistent",
    LANG: "C",
    LC_ALL: "C",
  };
}

function sandboxUser(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 65532;
  const gid = typeof process.getgid === "function" ? process.getgid() : 65532;
  return `${uid}:${gid}`;
}

function dockerBaseArgs(root: string, image: string): string[] {
  return [
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    process.env["AI_CODING_SANDBOX_PIDS"]?.trim() || DEFAULT_PIDS,
    "--memory",
    process.env["AI_CODING_SANDBOX_MEMORY"]?.trim() || DEFAULT_MEMORY,
    "--cpus",
    process.env["AI_CODING_SANDBOX_CPUS"]?.trim() || DEFAULT_CPUS,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=256m",
    "--tmpfs",
    "/home/sandbox:rw,nosuid,nodev,size=64m",
    "--user",
    sandboxUser(),
    "--env",
    "CI=1",
    "--env",
    "NODE_ENV=test",
    "--env",
    "NO_COLOR=1",
    "--env",
    "HOME=/home/sandbox",
    "--volume",
    `${root}:/workspace:rw`,
    "--workdir",
    "/workspace",
    image,
  ];
}

function commandResult(
  command: string,
  started: number,
  output: { stdout?: string; stderr?: string },
): VerificationCommandResult {
  return {
    command,
    status: "PASSED",
    exitCode: 0,
    stdout: (output.stdout ?? "").slice(0, MAX_STDOUT_BYTES),
    stderr: (output.stderr ?? "").slice(0, MAX_STDERR_BYTES),
    durationMs: Date.now() - started,
  };
}

function failedCommandResult(
  command: string,
  started: number,
  error: unknown,
): VerificationCommandResult {
  const typed = error as Error & {
    code?: number | string;
    killed?: boolean;
    signal?: string;
    stdout?: string;
    stderr?: string;
  };
  const timedOut =
    typed.killed === true ||
    typed.signal === "SIGTERM" ||
    typed.signal === "SIGKILL" ||
    typed.code === "ETIMEDOUT";
  return {
    command,
    status: timedOut ? "TIMEOUT" : "FAILED",
    exitCode: typeof typed.code === "number" ? typed.code : null,
    stdout: (typed.stdout ?? "").slice(0, MAX_STDOUT_BYTES),
    stderr: (typed.stderr ?? typed.message ?? "").slice(0, MAX_STDERR_BYTES),
    durationMs: Date.now() - started,
  };
}

async function executeInSandbox(
  root: string,
  image: string,
  command: string,
  pnpmArgs: string[],
  timeoutMs: number,
  executor: SandboxExecutor,
): Promise<VerificationCommandResult> {
  const started = Date.now();
  try {
    const output = await executor(
      "docker",
      [...dockerBaseArgs(root, image), "pnpm", ...pnpmArgs],
      {
        cwd: root,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        env: scrubbedHostEnvironment(),
      },
    );
    return commandResult(command, started, output);
  } catch (error) {
    return failedCommandResult(command, started, error);
  }
}

export async function runSandboxedRepositoryVerification(
  root: string,
  commands: string[],
  options: SandboxedVerificationOptions = {},
): Promise<SandboxedVerificationResult> {
  const enabled =
    options.enabled ??
    process.env["AI_CODING_SANDBOX_ENABLED"]?.trim().toLowerCase() === "true";
  const rawImage =
    options.image ??
    process.env["AI_CODING_SANDBOX_IMAGE"]?.trim() ??
    "";
  const image = pinnedImage(rawImage);

  if (!enabled) {
    return {
      status: "BLOCKED",
      runtime: "docker",
      image: image ?? null,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: [
        "Sandboxed repository scripts remain fail-closed because AI_CODING_SANDBOX_ENABLED is not true.",
      ],
    };
  }

  if (!image) {
    return {
      status: "BLOCKED",
      runtime: "docker",
      image: null,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: [
        "AI_CODING_SANDBOX_IMAGE must be an immutable image reference pinned with @sha256:<64 hex>.",
      ],
    };
  }

  const absoluteRoot = resolve(root);
  const rootInfo = await stat(absoluteRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) {
    return {
      status: "BLOCKED",
      runtime: "docker",
      image,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: ["Repository sandbox root does not exist."],
    };
  }

  const resolvedRoot = await realpath(absoluteRoot).catch(() => null);
  if (!resolvedRoot) {
    return {
      status: "BLOCKED",
      runtime: "docker",
      image,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: ["Repository sandbox root could not be resolved safely."],
    };
  }

  const uniqueCommands = [...new Set(commands)].slice(0, MAX_COMMANDS);
  for (const command of uniqueCommands) {
    if (!parseAllowlistedVerificationCommand(command)) {
      return {
        status: "BLOCKED",
        runtime: "docker",
        image,
        network: "none",
        dependencyBootstrap: null,
        commands: [{
          command,
          status: "BLOCKED",
          exitCode: null,
          stdout: "",
          stderr: "Command is not allowlisted for sandboxed repository verification.",
          durationMs: 0,
        }],
        scriptsExecuted: false,
        warnings: ["Sandbox verification rejected a non-allowlisted command before starting Docker."],
      };
    }
  }

  const timeoutMs = boundedTimeout(options.timeoutMs);
  const executor: SandboxExecutor =
    options.executor ??
    (async (file, args, execOptions) => {
      const output = await execFileAsync(file, args, execOptions);
      return { stdout: output.stdout, stderr: output.stderr };
    });

  if (uniqueCommands.length === 0) {
    return {
      status: "PASSED",
      runtime: "docker",
      image,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: [
        "No repository verification scripts were discovered; static verification remains the only applicable check.",
      ],
    };
  }

  try {
    await executor(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      {
        cwd: resolvedRoot,
        timeout: Math.min(timeoutMs, 10_000),
        maxBuffer: 256_000,
        env: scrubbedHostEnvironment(),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    return {
      status: "BLOCKED",
      runtime: "docker",
      image,
      network: "none",
      dependencyBootstrap: null,
      commands: [],
      deterministicRetries: [],
      failureContexts: [],
      scriptsExecuted: false,
      warnings: [`Docker sandbox runtime is unavailable: ${message}`],
    };
  }

  let dependencyBootstrap: VerificationCommandResult | null = null;
  if (options.bootstrapDependencies !== false && uniqueCommands.length > 0) {
    dependencyBootstrap = await executeInSandbox(
      resolvedRoot,
      image,
      "pnpm install --offline --frozen-lockfile --ignore-scripts",
      [
        "install",
        "--offline",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        "/opt/pnpm-store",
      ],
      timeoutMs,
      executor,
    );
    if (dependencyBootstrap.status !== "PASSED") {
      return {
        status: "FAILED",
        runtime: "docker",
        image,
        network: "none",
        dependencyBootstrap,
        commands: [],
        deterministicRetries: [],
        failureContexts: buildFailureContexts([dependencyBootstrap]),
        scriptsExecuted: false,
        warnings: [
          "Offline dependency bootstrap failed inside the network-disabled sandbox. No repository verification script was executed.",
        ],
      };
    }
  }

  const results: VerificationCommandResult[] = [];
  const deterministicRetries: SandboxedVerificationResult["deterministicRetries"] = [];
  for (const command of uniqueCommands) {
    const parsed = parseAllowlistedVerificationCommand(command)!;
    let result = await executeInSandbox(
      resolvedRoot,
      image,
      command,
      parsed.args,
      timeoutMs,
      executor,
    );

    if (result.status === "TIMEOUT") {
      const retried = await executeInSandbox(
        resolvedRoot,
        image,
        command,
        parsed.args,
        timeoutMs,
        executor,
      );
      deterministicRetries.push({
        command,
        trigger: "TIMEOUT",
        status: retried.status,
      });
      result = retried;
    }

    results.push(result);
    if (result.status !== "PASSED") break;
  }

  const failedResults = results.filter((item) => item.status !== "PASSED");
  return {
    status:
      results.length === uniqueCommands.length &&
      results.every((item) => item.status === "PASSED")
        ? "PASSED"
        : "FAILED",
    runtime: "docker",
    image,
    network: "none",
    dependencyBootstrap,
    commands: results,
    deterministicRetries,
    failureContexts: buildFailureContexts(failedResults),
    scriptsExecuted: results.length > 0,
    warnings: [],
  };
}
