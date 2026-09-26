import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockTxUpdateSet = vi.hoisted(() => vi.fn());
const mockTxUpdateWhere = vi.hoisted(() => vi.fn());
const mockTxUpdateReturning = vi.hoisted(() => vi.fn());

const selectBuilder = {
  from: vi.fn(() => selectBuilder),
  where: vi.fn(() => Promise.resolve([{
    id: "11111111-1111-4111-8111-111111111111",
    projectName: "Analyzer test",
    repository: ".",
    branch: "main",
    instruction: "Inspect the repository",
  }])),
};
const updateBuilder = {
  set: mockTxUpdateSet,
  where: mockTxUpdateWhere,
  returning: mockTxUpdateReturning,
};
const tx = {
  update: vi.fn(() => updateBuilder),
};

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...conditions: unknown[]) => conditions),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
  aiCodingRunsTable: {
    id: "codingRuns.id",
    status: "codingRuns.status",
  },
  aiCodingTasksTable: {
    id: "codingTasks.id",
  },
  aiJobsTable: {
    id: "jobs.id",
    status: "jobs.status",
  },
}));

const {
  buildRepositoryCloneArgs,
  buildRepositoryCloneEnvironment,
  isRetryableRepositoryCloneResourceError,
  completeRepositoryAnalyzerRun,
  configureIsolatedRepositoryWorkspace,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
  prepareRepositoryWorkspace,
} = await import("../repositoryAnalyzerService.js");

const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const execFileAsync = promisify(execFile);

describe("repository analyzer isolated multi-worker workspace", () => {
  it("creates a local isolated branch only when cloned HEAD matches the approved base SHA", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-analyzer-isolated-"));
    try {
      await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      await execFileAsync("git", ["config", "user.name", "Isolation Test"], { cwd: root });
      await writeFile(join(root, "fixture.ts"), "export const value = 1;\n", "utf8");
      await execFileAsync("git", ["add", "fixture.ts"], { cwd: root });
      await execFileAsync("git", ["commit", "-m", "fixture"], {
        cwd: root,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
        },
      });
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
      const head = stdout.trim();

      await configureIsolatedRepositoryWorkspace(
        root,
        head,
        "ai-core/111111111111/ws-001-a1",
      );

      const branch = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: root },
      );
      const isolatedHead = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: root,
      });

      expect(branch.stdout.trim()).toBe("ai-core/111111111111/ws-001-a1");
      expect(isolatedHead.stdout.trim()).toBe(head);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed before branch creation when the cloned HEAD no longer matches approved base SHA", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-analyzer-stale-"));
    try {
      await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      await execFileAsync("git", ["config", "user.name", "Isolation Test"], { cwd: root });
      await writeFile(join(root, "fixture.ts"), "export const value = 1;\n", "utf8");
      await execFileAsync("git", ["add", "fixture.ts"], { cwd: root });
      await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });

      await expect(
        configureIsolatedRepositoryWorkspace(
          root,
          "f".repeat(40),
          "ai-core/111111111111/ws-001-a1",
        ),
      ).rejects.toThrow(/HEAD changed before isolated worker execution/);

      const branch = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: root },
      );
      expect(branch.stdout.trim()).toBe("main");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses isolated execution against a non-disposable local repository", async () => {
    await expect(
      prepareRepositoryWorkspace(".", "main", {
        isolatedBranchName: "ai-core/111111111111/ws-001-a1",
        expectedBaseSha: "a".repeat(40),
      }),
    ).rejects.toThrow(/requires a disposable cloned workspace/);
  });
});

describe("repository analyzer GitHub clone authentication", () => {
  it("passes GitHub credentials through process environment without embedding them in the repository URL", () => {
    const token = "github_pat_test_secret";
    const env = buildRepositoryCloneEnvironment(
      "https://github.com/Travelintrips/Core-AI-Foundation.git",
      {
        PATH: "/usr/bin",
        AI_CODING_GITHUB_TOKEN: token,
      } as NodeJS.ProcessEnv,
    );

    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_CONFIG_COUNT).toBe("7");

    const configs = Array.from(
      { length: Number(env.GIT_CONFIG_COUNT) },
      (_, index) => [
        env[`GIT_CONFIG_KEY_${index}`],
        env[`GIT_CONFIG_VALUE_${index}`],
      ],
    );

    expect(configs).toEqual(
      expect.arrayContaining([
        ["pack.threads", "1"],
        ["index.threads", "1"],
        ["checkout.workers", "1"],
        ["fetch.parallel", "1"],
        ["core.preloadIndex", "false"],
        ["core.deltaBaseCacheLimit", "16m"],
      ]),
    );

    const authorization = configs.find(([key]) => key === "http.extraHeader");
    expect(authorization?.[1]).toContain("AUTHORIZATION: basic ");
    expect(authorization?.[1]).not.toContain(token);
    expect(
      Buffer.from(
        String(authorization?.[1]).replace("AUTHORIZATION: basic ", ""),
        "base64",
      ).toString("utf8"),
    ).toBe("x-access-token:" + token);
  });

  it("does not attach the GitHub token to GitLab clones", () => {
    const env = buildRepositoryCloneEnvironment(
      "https://gitlab.com/example/repo.git",
      {
        AI_CODING_GITHUB_TOKEN: "do-not-forward",
      } as NodeJS.ProcessEnv,
    );

    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_CONFIG_COUNT).toBe("6");

    const keys = Array.from(
      { length: Number(env.GIT_CONFIG_COUNT) },
      (_, index) => env[`GIT_CONFIG_KEY_${index}`],
    );
    expect(keys).toContain("pack.threads");
    expect(keys).toContain("index.threads");
    expect(keys).not.toContain("http.extraHeader");
  });

  it("builds a shallow single-branch clone command without changing the remote", () => {
    expect(
      buildRepositoryCloneArgs(
        "https://github.com/Travelintrips/Core-AI-Foundation.git",
        "main",
        "/tmp/coding-analyzer-test",
        20,
      ),
    ).toEqual([
      "clone",
      "--depth",
      "20",
      "--no-tags",
      "--single-branch",
      "--branch",
      "main",
      "https://github.com/Travelintrips/Core-AI-Foundation.git",
      "/tmp/coding-analyzer-test",
    ]);
  });

  it("retries only resource/index-pack failures with minimal history", () => {
    expect(
      isRetryableRepositoryCloneResourceError(
        "fatal: unable to create thread: Resource temporarily unavailable",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "fetch-pack: invalid index-pack output",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "fatal: Remote branch missing does not exist",
      ),
    ).toBe(false);
  });
});

describe("repository analyzer execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue(selectBuilder);
    mockDbTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
    mockTxUpdateSet.mockReturnValue(updateBuilder);
    mockTxUpdateWhere.mockReturnValue(updateBuilder);
    mockTxUpdateReturning.mockResolvedValue([{ id: runId }]);
  });

  it("accepts the coding task/run context and returns structured repository findings", async () => {
    const result = await executeRepositoryAnalyzerJob({
      id: 701,
      jobType: "coding_repository_analyzer",
      payloadJson: {
        codingTaskId: taskId,
        codingRunId: runId,
        repository: ".",
        branch: "main",
        title: "Analyzer test",
        description: "Inspect the repository",
      },
    } as never);

    expect(result).toMatchObject({
      codingTaskId: taskId,
      codingRunId: runId,
      executionStatus: "COMPLETED",
      sourceTarget: ".",
      branch: "main",
    });
    expect(Array.isArray(result.filesInspected)).toBe(true);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.recommendedChanges)).toBe(true);
    expect(result.contextPackage).toEqual(
      expect.objectContaining({
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      }),
    );
    expect(result.localExecutionPlan).toMatchObject({
      status: "AI_REQUIRED",
      operations: [],
    });
    expect(result.localExecution).toBeNull();
  });

  it("handles the exact production audit instruction without undefined split failures", async () => {
    const result = await executeRepositoryAnalyzerJob({
      id: 702,
      jobType: "coding_repository_analyzer",
      payloadJson: {
        codingTaskId: taskId,
        codingRunId: runId,
        repository: ".",
        branch: "main",
        title: "cek",
        description:
          "audit apa anda konek dengan bizportla dan supabase dan dapat coding sendiri",
      },
    } as never);

    expect(result).toMatchObject({
      codingTaskId: taskId,
      codingRunId: runId,
      executionStatus: "COMPLETED",
      sourceTarget: ".",
      branch: expect.any(String),
    });
    expect(result.summary).toEqual(expect.any(String));
    expect(result.contextPackage).toEqual(
      expect.objectContaining({
        affectedFiles: expect.any(Array),
        relevantFiles: expect.any(Array),
        verificationCommands: expect.any(Array),
      }),
    );
  });

  it("persists successful analysis and moves the task to READY_REVIEW", async () => {
    const result = {
      codingTaskId: taskId,
      codingRunId: runId,
      executionStatus: "COMPLETED",
      summary: "Repository analysis completed.",
      findings: [],
    };

    await completeRepositoryAnalyzerRun(result);

    expect(mockDbTransaction).toHaveBeenCalledOnce();
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "COMPLETED",
      finishedAt: expect.any(Date),
      logs: expect.stringContaining('"executionStatus": "COMPLETED"'),
      errorMessage: null,
    }));
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(2, {
      status: "READY_REVIEW",
      resultSummary: "Repository analysis completed.",
    });
  });

  it("persists analyzer failure and prevents a stale RUNNING task", async () => {
    await failRepositoryAnalyzerRun(
      { codingTaskId: taskId, codingRunId: runId },
      "branch was not found",
    );

    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "FAILED",
      finishedAt: expect.any(Date),
      errorMessage: "branch was not found",
      logs: expect.stringContaining('"executionStatus": "FAILED"'),
    }));
    expect(mockTxUpdateSet).toHaveBeenNthCalledWith(2, {
      status: "FAILED",
      resultSummary: "Repository Analyzer failed: branch was not found",
    });
  });
});