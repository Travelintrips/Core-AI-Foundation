import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { eq } from "drizzle-orm";
import { aiCodingTasksTable, db } from "@workspace/db";
import {
  runTrustedOllamaPowerShellTask,
  type TrustedPowerShellTaskResult,
} from "./localCodingTrustedPowerShellTaskService.js";
import {
  executeTrustedOllamaPowerShellCommands,
  LocalCodingPowerShellError,
} from "./localCodingPowerShellExecutorService.js";
import {
  buildFailureContexts,
  enrichFailureContextsWithSymbols,
} from "./localCodingFailureDiagnosticService.js";
import {
  buildLocalFailureRecoveryContext,
} from "./localCodingFailureRecoveryService.js";
import {
  buildLocalCodingContextPackage,
  isSensitiveRepositoryPath,
} from "./localCodingEngineService.js";
import {
  buildAiHandoffPackage,
  type AiHandoffSnippet,
  type ApprovedAiHandoffLease,
} from "./localCodingAiHandoffService.js";
import {
  computeAiHandoffPackageHash,
} from "./localCodingAiProposalPolicyService.js";
import {
  createConstrainedModelInvocationAdapter,
} from "./localCodingAiModelAdapterService.js";
import {
  createScheduledOllamaProviderAdapter,
} from "./localCodingOllamaWorkerProviderService.js";
import {
  invokeConstrainedAiProposal,
  validateAndApplyAiProposal,
} from "./localCodingAiExecutionGateService.js";
import { buildLocalCodingAiPrompt } from "./localCodingAiPromptBuilderService.js";
import { logAudit } from "./aiAuditService.js";

const execFileAsync = promisify(execFile);
const MAX_ALLOWED_FILES = 6;
const MAX_SNIPPET_CHARS = 18_000;
const REPAIR_LEASE_MS = 10 * 60_000;

function readEnvCaseInsensitive(env: NodeJS.ProcessEnv, name: string): string {
  const direct = env[name];
  if (typeof direct === "string") return direct;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === target && typeof value === "string") return value;
  }
  return "";
}

async function resolveWorkspaceRoot(env: NodeJS.ProcessEnv): Promise<string> {
  const configured = env["LOCAL_CODING_POWERSHELL_ROOT"]?.trim();
  const candidate = resolve(configured || process.cwd());
  const info = await stat(candidate).catch(() => null);
  if (!info?.isDirectory()) {
    throw new LocalCodingPowerShellError(
      "Configured PowerShell workspace root does not exist or is not a directory.",
      "WORKSPACE_INVALID",
    );
  }
  return realpath(candidate);
}

function normalizeRepoPath(value: string): string | null {
  const portable = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !portable ||
    isAbsolute(portable) ||
    portable.startsWith("/") ||
    portable === ".." ||
    portable.startsWith("../") ||
    portable.includes("/../") ||
    isSensitiveRepositoryPath(portable)
  ) {
    return null;
  }
  return portable;
}

export function extractExplicitTrustedRepairFiles(instruction: string): string[] {
  const matches =
    instruction.match(/[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]{1,12}/g) ?? [];
  const files: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    // Require an explicit repository-relative path, not only a bare filename.
    if (!raw.includes("/")) continue;
    const normalized = normalizeRepoPath(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    files.push(normalized);
    if (files.length >= MAX_ALLOWED_FILES) break;
  }
  return files;
}

async function git(root: string, args: string[]): Promise<string> {
  const output = await execFileAsync("git", args, {
    cwd: root,
    timeout: 15_000,
    maxBuffer: 1_000_000,
    env: {
      PATH: readEnvCaseInsensitive(process.env, "PATH"),
      HOME: readEnvCaseInsensitive(process.env, "HOME"),
      USERPROFILE: readEnvCaseInsensitive(process.env, "USERPROFILE"),
      SystemRoot: readEnvCaseInsensitive(process.env, "SystemRoot"),
      GIT_TERMINAL_PROMPT: "0",
      LANG: "C",
      LC_ALL: "C",
    },
  });
  return output.stdout.trim();
}

async function createIsolatedRepairWorkspace(
  sourceRoot: string,
  branch: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parent = await mkdtemp(join(tmpdir(), "trusted-ollama-repair-"));
  const cloneRoot = join(parent, "repo");
  try {
    await execFileAsync(
      "git",
      ["clone", "--no-hardlinks", "--single-branch", "--branch", branch, sourceRoot, cloneRoot],
      {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          PATH: readEnvCaseInsensitive(process.env, "PATH"),
          HOME: readEnvCaseInsensitive(process.env, "HOME"),
          USERPROFILE: readEnvCaseInsensitive(process.env, "USERPROFILE"),
          SystemRoot: readEnvCaseInsensitive(process.env, "SystemRoot"),
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
      },
    );
    return {
      root: cloneRoot,
      cleanup: () => rm(parent, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(parent, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function snapshotAllowedFiles(
  root: string,
  files: string[],
): Promise<Map<string, string>> {
  const snapshots = new Map<string, string>();
  for (const file of files) {
    snapshots.set(file, await readFile(resolve(root, file), "utf8"));
  }
  return snapshots;
}

async function restoreAllowedFiles(
  root: string,
  snapshots: Map<string, string>,
): Promise<void> {
  for (const [file, content] of snapshots) {
    await writeFile(resolve(root, file), content, "utf8");
  }
}

async function buildAllowedSnippets(
  root: string,
  files: string[],
): Promise<AiHandoffSnippet[]> {
  const snippets: AiHandoffSnippet[] = [];
  for (const file of files) {
    const absolute = resolve(root, file);
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile() || info.size > 256_000) {
      throw new LocalCodingPowerShellError(
        "Trusted repair target is missing or exceeds the bounded file size: " + file,
        "WORKSPACE_INVALID",
      );
    }
    const source = (await readFile(absolute, "utf8")).slice(0, MAX_SNIPPET_CHARS);
    const endLine = Math.max(1, source.split(/\r?\n/).length);
    snippets.push({
      file,
      startLine: 1,
      endLine,
      content: source,
      reason: "focus",
    });
  }
  return snippets;
}

function failedResultSummary(initial: TrustedPowerShellTaskResult): string {
  return initial.execution.results
    .filter((result) => result.status !== "PASSED")
    .map((result) => {
      const output = (result.stderr || result.stdout || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1_200);
      return `${result.command}: ${result.status}${output ? " — " + output : ""}`;
    })
    .join("\n");
}

export interface TrustedRepairResult {
  initial: TrustedPowerShellTaskResult;
  repaired: boolean;
  allowedFiles: string[];
  proposalSummary: string | null;
  changedFiles: string[];
  verification: TrustedPowerShellTaskResult["execution"] | null;
}

export async function runTrustedOllamaRepairTask(input: {
  instruction: string;
  taskId: string;
  requestedBy?: string;
  modelId?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<TrustedRepairResult> {
  const env = input.env ?? process.env;
  const sourceRoot = await resolveWorkspaceRoot(env);

  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, input.taskId));
  if (!task) {
    throw new LocalCodingPowerShellError(
      "Trusted repair requires an existing coding task.",
      "NOT_FOUND",
    );
  }

  const allowedFiles = extractExplicitTrustedRepairFiles(task.instruction);
  if (allowedFiles.length === 0) {
    throw new LocalCodingPowerShellError(
      "Trusted repair is fail-closed because the task instruction does not contain an explicit repository-relative target file.",
      "INVALID_COMMAND",
    );
  }

  const branch = await git(sourceRoot, ["branch", "--show-current"]);
  if (branch !== task.branch) {
    throw new LocalCodingPowerShellError(
      `Trusted repair branch mismatch: task expects ${task.branch}, local workspace is ${branch || "(detached)"}.`,
      "WORKSPACE_INVALID",
    );
  }

  // Unrelated local files may be dirty (for example local Ollama launch/config
  // files), but an explicitly authorized repair target must itself be clean.
  const targetStatus = await git(sourceRoot, [
    "status",
    "--porcelain=v1",
    "--",
    ...allowedFiles,
  ]);
  if (targetStatus) {
    throw new LocalCodingPowerShellError(
      "Trusted repair target file has uncommitted local changes; refusing to overwrite it.",
      "WORKSPACE_INVALID",
    );
  }

  const initial = await runTrustedOllamaPowerShellTask({
    ...input,
    env: {
      ...env,
      LOCAL_CODING_POWERSHELL_ROOT: sourceRoot,
    },
  });

  if (initial.execution.status === "COMPLETED") {
    return {
      initial,
      repaired: false,
      allowedFiles,
      proposalSummary: null,
      changedFiles: [],
      verification: initial.execution,
    };
  }

  const sourceSnapshots = await snapshotAllowedFiles(sourceRoot, allowedFiles);
  const isolated = await createIsolatedRepairWorkspace(sourceRoot, task.branch);
  try {
    const root = isolated.root;

    const baseHeadSha = (await git(root, ["rev-parse", "HEAD"])).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(baseHeadSha)) {
      throw new LocalCodingPowerShellError(
        "Trusted repair could not resolve the isolated repository HEAD.",
        "WORKSPACE_INVALID",
      );
    }

    const contextPackage = await buildLocalCodingContextPackage({
      root,
      repository: task.repository,
      requestedBranch: task.branch,
      task: `${task.projectName}\n${task.instruction}\n\nVerification failure:\n${failedResultSummary(initial)}`,
    });

    let failureContexts = buildFailureContexts(initial.execution.results);
    failureContexts = await enrichFailureContextsWithSymbols(root, failureContexts);
    if (failureContexts.length === 0) {
      throw new LocalCodingPowerShellError(
        "Trusted repair requires at least one failed verification diagnostic.",
        "INVALID_COMMAND",
      );
    }

    const recovery = buildLocalFailureRecoveryContext(
      contextPackage,
      failureContexts,
    );
    const recoveryContext = {
      ...recovery,
      status: "CONTEXT_REFINED" as const,
      focusFiles: [
        ...allowedFiles,
        ...recovery.focusFiles.filter((file) => allowedFiles.includes(file)),
      ].slice(0, MAX_ALLOWED_FILES),
      verificationCommands: [
        ...new Set(initial.plannedCommands),
      ].slice(0, 6),
    };

    const snippets = await buildAllowedSnippets(root, allowedFiles);
    const currentPatch = await git(root, ["diff", "--no-ext-diff", "--"]);
    const pkg = buildAiHandoffPackage({
      task,
      baseHeadSha,
      reason:
        "Trusted PowerShell verification failed in an isolated workspace. Generate the smallest repair patch limited to the explicitly authorized target files, then re-run the same trusted verification commands.",
      recoveryContext,
      failureContexts,
      snippets,
      currentPatch,
    });
    const packageHash = computeAiHandoffPackageHash(pkg);
    const now = Date.now();
    const lease: ApprovedAiHandoffLease = {
      package: pkg,
      packageHash,
      approvedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + REPAIR_LEASE_MS).toISOString(),
    };

    const modelId = (
      input.modelId ||
      env["OLLAMA_WORKER_MODEL"] ||
      env["OLLAMA_MODEL"] ||
      "qwen2.5-coder:7b"
    ).trim();
    const provider = createScheduledOllamaProviderAdapter({ modelId });
    const adapter = createConstrainedModelInvocationAdapter(provider);
    const prompt = buildLocalCodingAiPrompt(lease);
    const proposalResult = await invokeConstrainedAiProposal({
      lease,
      adapter,
      target: { provider: "ollama", model: modelId },
      requestId: "trusted-repair-" + randomUUID(),
      prompt,
      timeoutMs: input.timeoutMs,
    });

    const applied = await validateAndApplyAiProposal({
      lease,
      proposal: proposalResult.proposal,
      repositoryRoot: root,
      currentRepositoryHeadSha: baseHeadSha,
    });

    const changedFiles = applied.applyResult.changedFiles ?? [];
    const unexpected = changedFiles.filter((file) => !allowedFiles.includes(file));
    if (unexpected.length > 0) {
      throw new LocalCodingPowerShellError(
        "Trusted repair changed a file outside the explicit allowlist.",
        "WORKSPACE_INVALID",
      );
    }

    let verification: TrustedPowerShellTaskResult["execution"];
    try {
      verification = await executeTrustedOllamaPowerShellCommands({
        taskId: input.taskId,
        requestedBy: input.requestedBy || "trusted-local-repair",
        modelId,
        commands: initial.plannedCommands,
        timeoutMs: input.timeoutMs,
        env: {
          ...env,
          LOCAL_CODING_POWERSHELL_ROOT: sourceRoot,
        },
      });
    } catch (error) {
      await restoreAllowedFiles(sourceRoot, sourceSnapshots);
      throw error;
    }

    if (verification.status !== "COMPLETED") {
      await restoreAllowedFiles(sourceRoot, sourceSnapshots);
      await logAudit(
        "ollama-worker",
        "trusted_repair_verification_failed",
        input.taskId,
        "coding_task",
        "failure",
        {
          packageHash,
          allowedFiles,
          changedFiles,
          isolatedWorkspace: true,
          results: verification.results.map((result) => ({
            command: result.command,
            status: result.status,
            exitCode: result.exitCode,
          })),
        },
      ).catch(() => undefined);

      return {
        initial,
        repaired: false,
        allowedFiles,
        proposalSummary: proposalResult.proposal.proposal.summary,
        changedFiles,
        verification,
      };
    }

    // Re-check the real workspace immediately before copying verified changes
    // back. Unrelated dirty files are tolerated; authorized targets are not.
    const finalTargetStatus = await git(sourceRoot, [
      "status",
      "--porcelain=v1",
      "--",
      ...allowedFiles,
    ]);
    if (finalTargetStatus) {
      throw new LocalCodingPowerShellError(
        "Trusted repair target changed locally while isolated verification was running.",
        "WORKSPACE_INVALID",
      );
    }

    for (const file of changedFiles) {
      await copyFile(resolve(root, file), resolve(sourceRoot, file));
    }

    await logAudit(
      "ollama-worker",
      "trusted_repair_completed",
      input.taskId,
      "coding_task",
      "success",
      {
        packageHash,
        allowedFiles,
        changedFiles,
        modelId,
        isolatedWorkspace: true,
        verificationCommands: initial.plannedCommands,
      },
    ).catch(() => undefined);

    return {
      initial,
      repaired: true,
      allowedFiles,
      proposalSummary: proposalResult.proposal.proposal.summary,
      changedFiles,
      verification,
    };
  } finally {
    await isolated.cleanup().catch(() => undefined);
  }
}
