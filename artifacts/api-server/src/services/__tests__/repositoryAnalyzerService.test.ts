import { readFileSync } from "node:fs";
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
const mockWithTransientDatabaseRetry = vi.hoisted(() => vi.fn());
const mockReserveCodingFileSet = vi.hoisted(() => vi.fn());

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
  withTransientDatabaseRetry: mockWithTransientDatabaseRetry,
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

vi.mock("../codingConflictRegistryService.js", () => ({
  reserveCodingFileSet: mockReserveCodingFileSet,
}));

const {
  buildRepositoryCloneArgs,
  buildRepositoryCloneEnvironment,
  isRetryableRepositoryCloneResourceError,
  completeRepositoryAnalyzerRun,
  configureIsolatedRepositoryWorkspace,
  executeRepositoryAnalyzerJob,
  failRepositoryAnalyzerRun,
  getRepositoryAnalyzerQueueClaimTimeoutMs,
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

  it("checks out the approved base SHA when the remote branch tip has advanced", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-analyzer-stale-"));
    try {
      await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      await execFileAsync("git", ["config", "user.name", "Isolation Test"], { cwd: root });
      await writeFile(join(root, "fixture.ts"), "export const value = 1;\n", "utf8");
      await execFileAsync("git", ["add", "fixture.ts"], { cwd: root });
      await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
      const first = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
      const approvedBase = first.stdout.trim();

      await writeFile(join(root, "fixture.ts"), "export const value = 2;\n", "utf8");
      await execFileAsync("git", ["add", "fixture.ts"], { cwd: root });
      await execFileAsync("git", ["commit", "-m", "branch advanced"], { cwd: root });

      await configureIsolatedRepositoryWorkspace(
        root,
        approvedBase,
        "ai-core/111111111111/ws-001-a1",
      );

      const branch = await execFileAsync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: root },
      );
      const head = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
      expect(branch.stdout.trim()).toBe("ai-core/111111111111/ws-001-a1");
      expect(head.stdout.trim()).toBe(approvedBase);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the approved base SHA is not present in the cloned history", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-analyzer-missing-base-"));
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
      ).rejects.toThrow(/Approved repository base SHA is unavailable/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("documents that isolated workstream branches are local execution branches", () => {
    expect(
      buildRepositoryCloneArgs(
        "https://github.com/example/repo.git",
        "main",
        "/tmp/workspace",
        1,
      ),
    ).toContain("main");
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

  it("falls back to standard GitHub token environment variables for worker git access", () => {
    for (const tokenName of ["GITHUB_TOKEN", "GH_TOKEN"] as const) {
      const token = "github_pat_fallback_secret";
      const env = buildRepositoryCloneEnvironment(
        "https://github.com/Travelintrips/Core-AI-Foundation.git",
        {
          PATH: "/usr/bin",
          [tokenName]: token,
        } as NodeJS.ProcessEnv,
      );

      const configs = Array.from(
        { length: Number(env.GIT_CONFIG_COUNT) },
        (_, index) => [
          env[`GIT_CONFIG_KEY_${index}`],
          env[`GIT_CONFIG_VALUE_${index}`],
        ],
      );
      const authorization = configs.find(([key]) => key === "http.extraHeader");

      expect(authorization?.[1]).toContain("AUTHORIZATION: basic ");
      expect(
        Buffer.from(
          String(authorization?.[1]).replace("AUTHORIZATION: basic ", ""),
          "base64",
        ).toString("utf8"),
      ).toBe("x-access-token:" + token);
    }
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
        1,
      ),
    ).toEqual([
      "clone",
      "--depth",
      "1",
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
        "fatal: unable to access 'https://github.com/Travelintrips/Core-AI-Foundation.git/': timeout exceeded when trying to connect",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "fatal: unable to access repository: Connection reset by peer",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "Command failed: git clone --depth 1 --branch main https://github.com/Travelintrips/Core-AI-Foundation.git /tmp/coding-analyzer-test\nCloning into '/tmp/coding-analyzer-test'...\n",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "Repository clone failed: spawn git EAGAIN",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "spawn git EAGAIN",
      ),
    ).toBe(true);
    expect(
      isRetryableRepositoryCloneResourceError(
        "fatal: authentication failed for repository",
      ),
    ).toBe(false);
    expect(
      isRetryableRepositoryCloneResourceError(
        "fatal: Remote branch missing does not exist",
      ),
    ).toBe(false);
  });
});

describe("repository analyzer queue claim timeout", () => {
  it("defaults to one minute and bounds configured values", () => {
    expect(getRepositoryAnalyzerQueueClaimTimeoutMs({})).toBe(60_000);
    expect(getRepositoryAnalyzerQueueClaimTimeoutMs({
      REPOSITORY_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS: "45000",
    })).toBe(45_000);
    expect(getRepositoryAnalyzerQueueClaimTimeoutMs({
      REPOSITORY_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS: "1000",
    })).toBe(10_000);
    expect(getRepositoryAnalyzerQueueClaimTimeoutMs({
      REPOSITORY_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS: "9999999",
    })).toBe(300_000);
    expect(getRepositoryAnalyzerQueueClaimTimeoutMs({
      REPOSITORY_ANALYZER_QUEUE_CLAIM_TIMEOUT_MS: "invalid",
    })).toBe(60_000);
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
    mockWithTransientDatabaseRetry.mockImplementation(
      async (operation: () => Promise<unknown>) => operation(),
    );
    mockReserveCodingFileSet.mockResolvedValue({
      status: "RESERVED",
      files: [],
      conflicts: [],
    });
  });

  it("guards the task lookup with transient database retry", async () => {
    await executeRepositoryAnalyzerJob({
      id: 700,
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

    expect(mockWithTransientDatabaseRetry).toHaveBeenCalledWith(
      expect.any(Function),
      { attempts: 5, baseDelayMs: 250 },
    );
  }, 15_000);

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
      branch: expect.any(String),
    });
    expect(result.branch).toBe(result.contextPackage.branch);
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
  }, 15_000);

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

describe("repository analyzer stale incident recovery contract", () => {
  it("allows stale Incident Auto-Repair analyzer jobs to release the single-flight slot", () => {
    const source = readFileSync(
      new URL("../repositoryAnalyzerService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "r.agent_name IN ('Coding Orchestrator', 'Incident Auto-Repair')",
    );
  });
});


describe("repository remote HEAD resource-pressure recovery", () => {
  it("serializes and retries transient ls-remote failures", () => {
    const source = readFileSync(
      new URL("../repositoryAnalyzerService.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("return withRepositoryCloneSlot(async () => {");
    expect(source).toContain("for (let attempt = 1; attempt <= 3; attempt += 1)");
    expect(source).toContain("isRetryableRepositoryCloneResourceError(detail)");
  });
});
