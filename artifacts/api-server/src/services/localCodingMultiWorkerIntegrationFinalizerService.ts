import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { desc, eq } from "drizzle-orm";
import {
  aiCodingRunsTable,
  aiCodingTasksTable,
  db,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import {
  getCodingIntegrationManifest,
  type CodingIntegrationManifest,
} from "./localCodingMultiWorkerIntegrationGateService.js";
import {
  buildRepositoryCloneEnvironment,
  prepareRepositoryWorkspace,
} from "./repositoryAnalyzerService.js";
import {
  createGitHubApiClient,
  parseGitHubRepository,
} from "./localCodingGitHubPublisherService.js";

const execFileAsync = promisify(execFile);
const SHA40_RE = /^[0-9a-f]{40}$/i;

export class CodingIntegrationFinalizerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "NOT_READY"
      | "STALE_BASE"
      | "PATCH_CONFLICT"
      | "VERIFY_FAILED"
      | "GITHUB_AUTH"
      | "PUBLISH_FAILED",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CodingIntegrationFinalizerError";
  }
}

export interface CodingIntegrationFinalizerResult {
  taskId: string;
  graphId: string;
  manifestHash: string;
  repository: string;
  baseBranch: string;
  baseSha: string;
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  changedFiles: string[];
  verification: {
    gitDiffCheck: "PASSED";
    changedFileSet: "PASSED";
  };
  nextAction: "REVIEW_PR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFiles(raw: string): string[] {
  return [...new Set(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/\\/g, "/")),
  )].sort();
}

function sameFiles(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function integrationBranch(taskNumber: string, taskId: string): string {
  const slug = taskNumber
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 40) || "task";
  return `ai-integration/${slug}-${taskId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

function gitEnv(repository: string): NodeJS.ProcessEnv {
  return {
    ...buildRepositoryCloneEnvironment(repository),
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(
  root: string,
  repository: string,
  args: string[],
  timeout = 120_000,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    env: gitEnv(repository),
  });
  return stdout.trim();
}

async function applyManifest(
  workspace: string,
  repository: string,
  manifest: CodingIntegrationManifest,
): Promise<void> {
  for (const workstream of manifest.workstreams) {
    if (!workstream.patch) continue;
    const patchFile = join(
      tmpdir(),
      `coding-integration-${workstream.workstreamId}-${randomUUID()}.patch`,
    );
    try {
      await writeFile(patchFile, workstream.patch, { encoding: "utf8", flag: "wx" });
      await git(
        workspace,
        repository,
        ["apply", "--check", "--whitespace=nowarn", patchFile],
      ).catch((error) => {
        throw new CodingIntegrationFinalizerError(
          `Patch workstream ${workstream.key} tidak dapat diterapkan ke integration workspace.`,
          "PATCH_CONFLICT",
          { workstreamKey: workstream.key, error: error instanceof Error ? error.message.slice(0, 1000) : String(error) },
        );
      });
      await git(
        workspace,
        repository,
        ["apply", "--whitespace=nowarn", patchFile],
      );
    } finally {
      await unlink(patchFile).catch(() => undefined);
    }
  }
}

async function persistFinalizerPayload(
  taskId: string,
  manifest: CodingIntegrationManifest,
  result: CodingIntegrationFinalizerResult,
): Promise<void> {
  const runs = await db
    .select()
    .from(aiCodingRunsTable)
    .where(eq(aiCodingRunsTable.taskId, taskId))
    .orderBy(desc(aiCodingRunsTable.startedAt));

  const orchestratorRun = runs.find(
    (run) =>
      run.agentName === "Coding Orchestrator" &&
      run.status === "COMPLETED" &&
      Boolean(run.logs),
  );
  if (!orchestratorRun?.logs) {
    throw new CodingIntegrationFinalizerError(
      "Completed Coding Orchestrator payload was not found.",
      "NOT_READY",
    );
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(orchestratorRun.logs) as unknown;
    payload = isRecord(parsed) ? parsed : {};
  } catch {
    payload = {};
  }

  const orchestration = isRecord(payload.orchestration) ? payload.orchestration : {};
  const nextPayload = {
    ...payload,
    integrationManifest: {
      graphId: manifest.graphId,
      graphVersion: manifest.graphVersion,
      planHash: manifest.planHash,
      manifestHash: manifest.manifestHash,
      baseSha: manifest.baseSha,
      changedFiles: manifest.changedFiles,
      patchCount: manifest.patchCount,
      status: "PUBLISHED",
    },
    localPatchApproval: {
      gateStatus: "PATCH_VALIDATED",
      patchSha256: manifest.manifestHash,
      baseHeadSha: result.baseSha,
      changedFiles: result.changedFiles,
      commitCreated: true,
      pushed: true,
      source: "MULTI_WORKSTREAM_INTEGRATION",
    },
    localCommitApproval: {
      status: "PUBLISHED",
      baseBranch: result.baseBranch,
      baseHeadSha: result.baseSha,
      commitSha: result.commitSha,
      commitCreated: true,
      pushed: true,
      autoMerged: false,
      pullRequestNumber: result.pullRequestNumber,
      pullRequestUrl: result.pullRequestUrl,
      branchName: result.branch,
      source: "MULTI_WORKSTREAM_INTEGRATION",
    },
    integrationFinalizer: result,
    orchestration: {
      ...orchestration,
      status: "PR_CREATED",
      nextAction: "REVIEW_PR",
    },
  };

  await db.transaction(async (tx) => {
    await tx
      .update(aiCodingRunsTable)
      .set({ logs: JSON.stringify(nextPayload, null, 2) })
      .where(eq(aiCodingRunsTable.id, orchestratorRun.id));

    await tx
      .update(aiCodingTasksTable)
      .set({
        status: "PR_CREATED",
        commitSha: result.commitSha,
        resultSummary:
          `Multi-workstream integration PR #${result.pullRequestNumber} dibuat setelah manifest validation dan combined static verification PASS.`,
      })
      .where(eq(aiCodingTasksTable.id, taskId));
  });
}

export async function finalizeCodingTaskGraphIntegration(
  taskId: string,
): Promise<CodingIntegrationFinalizerResult> {
  const [task] = await db
    .select()
    .from(aiCodingTasksTable)
    .where(eq(aiCodingTasksTable.id, taskId));
  if (!task) {
    throw new CodingIntegrationFinalizerError("Coding task not found.", "NOT_FOUND");
  }

  const manifest = await getCodingIntegrationManifest(taskId);
  if (!manifest.baseSha || !SHA40_RE.test(manifest.baseSha)) {
    if (manifest.changedFiles.length === 0) {
      throw new CodingIntegrationFinalizerError(
        "Integration manifest has no changes to publish.",
        "NOT_READY",
      );
    }
    throw new CodingIntegrationFinalizerError(
      "Integration manifest does not have one canonical base SHA.",
      "NOT_READY",
    );
  }

  const token = process.env["AI_CODING_GITHUB_TOKEN"]?.trim() ?? "";
  if (!token) {
    throw new CodingIntegrationFinalizerError(
      "AI_CODING_GITHUB_TOKEN is not configured.",
      "GITHUB_AUTH",
    );
  }

  const workspace = await prepareRepositoryWorkspace(task.repository, task.branch);
  const branchName = integrationBranch(task.taskNumber, task.id);

  try {
    const head = (await git(workspace.path, task.repository, ["rev-parse", "HEAD"])).toLowerCase();
    if (head !== manifest.baseSha.toLowerCase()) {
      throw new CodingIntegrationFinalizerError(
        `Base branch moved from ${manifest.baseSha} to ${head}; integration must be replanned.`,
        "STALE_BASE",
        { expected: manifest.baseSha, actual: head },
      );
    }

    await git(workspace.path, task.repository, ["checkout", "-b", branchName]);
    await applyManifest(workspace.path, task.repository, manifest);

    await git(workspace.path, task.repository, ["diff", "--check"]).catch((error) => {
      throw new CodingIntegrationFinalizerError(
        "Combined integration failed git diff --check.",
        "VERIFY_FAILED",
        { error: error instanceof Error ? error.message.slice(0, 1000) : String(error) },
      );
    });

    const actualFiles = normalizeFiles(
      await git(workspace.path, task.repository, ["status", "--short"])
        .then((raw) =>
          raw
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line) => line.slice(3).trim())
            .join("\n"),
        ),
    );
    const expectedFiles = [...manifest.changedFiles].sort();
    if (!sameFiles(actualFiles, expectedFiles)) {
      throw new CodingIntegrationFinalizerError(
        "Combined integration changed-file set differs from the reviewed manifest.",
        "VERIFY_FAILED",
        { expectedFiles, actualFiles },
      );
    }

    await git(workspace.path, task.repository, ["add", "--", ...expectedFiles]);
    await git(workspace.path, task.repository, ["config", "user.name", "CST AI Core"]);
    await git(workspace.path, task.repository, ["config", "user.email", "ai-core@cstlogistic.co.id"]);
    await git(
      workspace.path,
      task.repository,
      ["commit", "-m", `coding(${task.taskNumber}): integrate approved workstreams`],
    );

    const commitSha = (
      await git(workspace.path, task.repository, ["rev-parse", "HEAD"])
    ).toLowerCase();
    if (!SHA40_RE.test(commitSha)) {
      throw new CodingIntegrationFinalizerError(
        "Integration commit SHA is invalid.",
        "VERIFY_FAILED",
      );
    }

    const remoteRef = `refs/heads/${branchName}`;
    const remote = await git(
      workspace.path,
      task.repository,
      ["ls-remote", "--heads", "origin", remoteRef],
    );
    if (remote) {
      throw new CodingIntegrationFinalizerError(
        `Integration branch already exists: ${branchName}`,
        "PUBLISH_FAILED",
      );
    }
    await git(
      workspace.path,
      task.repository,
      ["push", "origin", `HEAD:${remoteRef}`],
    );

    const client = createGitHubApiClient(token);
    const { owner, repo } = parseGitHubRepository(task.repository);
    const pr = await client.request<Record<string, unknown>>(
      "POST",
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        title: `[${task.taskNumber}] Integrate approved workstreams`,
        head: branchName,
        base: task.branch,
        body: [
          "AI Core multi-workstream integration.",
          "",
          `Task: ${task.taskNumber}`,
          `Graph: ${manifest.graphId}`,
          `Manifest SHA-256: ${manifest.manifestHash}`,
          `Base SHA: ${manifest.baseSha}`,
          `Workstreams: ${manifest.workstreams.length}`,
          `Changed files: ${manifest.changedFiles.length}`,
          "Combined static verification: PASSED",
          "git diff --check: PASSED",
          "",
          "Merge remains locked behind PR verification and explicit critical approval.",
        ].join("\n"),
      },
    );

    const pullRequestNumber =
      typeof pr.number === "number" ? pr.number : Number.NaN;
    const pullRequestUrl =
      typeof pr.html_url === "string" ? pr.html_url : "";
    if (!Number.isInteger(pullRequestNumber) || !pullRequestUrl) {
      throw new CodingIntegrationFinalizerError(
        "GitHub did not return a valid pull request.",
        "PUBLISH_FAILED",
      );
    }

    const result: CodingIntegrationFinalizerResult = {
      taskId,
      graphId: manifest.graphId,
      manifestHash: manifest.manifestHash,
      repository: task.repository,
      baseBranch: task.branch,
      baseSha: manifest.baseSha.toLowerCase(),
      branch: branchName,
      commitSha,
      pullRequestNumber,
      pullRequestUrl,
      changedFiles: expectedFiles,
      verification: {
        gitDiffCheck: "PASSED",
        changedFileSet: "PASSED",
      },
      nextAction: "REVIEW_PR",
    };

    await persistFinalizerPayload(taskId, manifest, result);
    await logAudit(
      "coding-multi-worker",
      "integration_finalizer_published",
      taskId,
      "coding_task",
      "success",
      {
        graphId: manifest.graphId,
        manifestHash: manifest.manifestHash,
        branch: branchName,
        commitSha,
        pullRequestNumber,
        changedFiles: expectedFiles,
      },
    ).catch(() => undefined);

    return result;
  } catch (error) {
    if (error instanceof CodingIntegrationFinalizerError) throw error;
    throw new CodingIntegrationFinalizerError(
      "Multi-workstream integration finalizer failed: " +
        (error instanceof Error ? error.message.slice(0, 1200) : String(error)),
      "PUBLISH_FAILED",
    );
  } finally {
    if (workspace.cleanup) {
      await rm(workspace.path, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
