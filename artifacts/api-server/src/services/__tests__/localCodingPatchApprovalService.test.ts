import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockDbSelect = vi.hoisted(() => vi.fn());
const mockDbInsert = vi.hoisted(() => vi.fn());
const mockDbTransaction = vi.hoisted(() => vi.fn());
const mockPrepareRepositoryWorkspace = vi.hoisted(() => vi.fn());
const mockVerifyChangedFilesStatically = vi.hoisted(() => vi.fn());
const mockLogAudit = vi.hoisted(() => vi.fn());

const mockRunInsertValues = vi.hoisted(() => vi.fn());
const mockRunInsertReturning = vi.hoisted(() => vi.fn());
const mockTxUpdateSet = vi.hoisted(() => vi.fn());
const mockTxUpdateWhere = vi.hoisted(() => vi.fn());
const mockTxUpdateReturning = vi.hoisted(() => vi.fn());
const mockTxInsertValues = vi.hoisted(() => vi.fn());

const taskSelectBuilder = {
  from: vi.fn(() => taskSelectBuilder),
  where: vi.fn(),
};
const runsSelectBuilder = {
  from: vi.fn(() => runsSelectBuilder),
  where: vi.fn(() => runsSelectBuilder),
  orderBy: vi.fn(),
};
const runInsertBuilder = {
  values: mockRunInsertValues,
  returning: mockRunInsertReturning,
};
const txUpdateBuilder = {
  set: mockTxUpdateSet,
  where: mockTxUpdateWhere,
  returning: mockTxUpdateReturning,
};
const txInsertBuilder = {
  values: mockTxInsertValues,
};
const tx = {
  update: vi.fn(() => txUpdateBuilder),
  insert: vi.fn(() => txInsertBuilder),
};

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    transaction: mockDbTransaction,
  },
  aiCodeChangesTable: { taskId: "changes.taskId" },
  aiCodingRunsTable: {
    id: "runs.id",
    taskId: "runs.taskId",
    startedAt: "runs.startedAt",
  },
  aiCodingTasksTable: { id: "tasks.id" },
}));

vi.mock("../repositoryAnalyzerService.js", () => ({
  prepareRepositoryWorkspace: mockPrepareRepositoryWorkspace,
}));

vi.mock("../localCodingVerificationService.js", () => ({
  verifyChangedFilesStatically: mockVerifyChangedFilesStatically,
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: mockLogAudit,
}));

const {
  approveAndValidateLocalPatch,
  LocalPatchApprovalError,
} = await import("../localCodingPatchApprovalService.js");

const workspaces: string[] = [];
const taskId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const gateRunId = "33333333-3333-4333-8333-333333333333";

const task = {
  id: taskId,
  taskNumber: "CWS-PATCH",
  projectName: "Patch test",
  repository: "owner/repo",
  branch: "main",
  instruction: 'Replace "old" with "new" in src/sample.ts',
  status: "READY_REVIEW",
  priority: 50,
  resultSummary: null,
  commitSha: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const gateRun = {
  id: gateRunId,
  taskId,
  agentName: "Local Patch Gate",
  status: "RUNNING",
  startedAt: new Date("2026-01-01T00:02:00.000Z"),
  finishedAt: null,
  logs: null,
  errorMessage: null,
};

async function createFixture(): Promise<{ root: string; headSha: string; patch: string }> {
  const root = await mkdtemp(join(tmpdir(), "local-patch-gate-test-"));
  workspaces.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "sample.ts"), 'export const value = "old";\n', "utf8");
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "ci@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "CI"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

  await writeFile(join(root, "src", "sample.ts"), 'export const value = "new";\n', "utf8");
  const patch = execFileSync(
    "git",
    ["diff", "--no-ext-diff", "--unified=2", "--", "src/sample.ts"],
    { cwd: root, encoding: "utf8" },
  );
  execFileSync("git", ["checkout", "--", "src/sample.ts"], { cwd: root });
  return { root, headSha, patch };
}

function orchestratorRun(headSha: string, patch: string, changedFiles = ["src/sample.ts"]) {
  return {
    id: runId,
    taskId,
    agentName: "Coding Orchestrator",
    status: "COMPLETED",
    startedAt: new Date("2026-01-01T00:01:00.000Z"),
    finishedAt: new Date("2026-01-01T00:01:30.000Z"),
    errorMessage: null,
    logs: JSON.stringify({
      orchestration: { nextAction: "REVIEW_LOCAL_PATCH" },
      contextPackage: { headSha },
      localExecution: {
        status: "APPLIED",
        rolledBack: false,
        patch,
        changedFiles,
      },
    }),
  };
}

function wireDb(run: ReturnType<typeof orchestratorRun>) {
  mockDbSelect
    .mockReturnValueOnce(taskSelectBuilder)
    .mockReturnValueOnce(runsSelectBuilder);
  taskSelectBuilder.where.mockResolvedValueOnce([task]);
  runsSelectBuilder.orderBy.mockResolvedValueOnce([run]);
  mockDbInsert.mockReturnValue(runInsertBuilder);
  mockRunInsertValues.mockReturnValue(runInsertBuilder);
  mockRunInsertReturning.mockResolvedValue([gateRun]);

  mockDbTransaction.mockImplementation((callback: (executor: typeof tx) => unknown) => callback(tx));
  mockTxUpdateSet.mockReturnValue(txUpdateBuilder);
  mockTxUpdateWhere.mockReturnValue(txUpdateBuilder);
  mockTxUpdateReturning.mockResolvedValue([{
    ...gateRun,
    status: "COMPLETED",
    finishedAt: new Date("2026-01-01T00:03:00.000Z"),
  }]);
  mockTxInsertValues.mockResolvedValue([]);
}

describe("Local Patch Approval Gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskSelectBuilder.from.mockReturnValue(taskSelectBuilder);
    runsSelectBuilder.from.mockReturnValue(runsSelectBuilder);
    runsSelectBuilder.where.mockReturnValue(runsSelectBuilder);
    mockVerifyChangedFilesStatically.mockResolvedValue([]);
    mockLogAudit.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("rechecks HEAD, applies the exact patch in an isolated clone, and records validation without commit or push", async () => {
    const fixture = await createFixture();
    const run = orchestratorRun(fixture.headSha, fixture.patch);
    wireDb(run);
    mockPrepareRepositoryWorkspace.mockResolvedValue({
      path: fixture.root,
      cleanup: true,
    });

    const result = await approveAndValidateLocalPatch(taskId);

    expect(result).toMatchObject({
      id: gateRunId,
      agentName: "Local Patch Gate",
      status: "COMPLETED",
    });
    expect(mockVerifyChangedFilesStatically).toHaveBeenCalledWith(
      fixture.root,
      ["src/sample.ts"],
    );
    expect(mockTxInsertValues).toHaveBeenCalledWith({
      taskId,
      filePath: "src/sample.ts",
      changeType: "MODIFIED",
      commitSha: null,
    });

    const runUpdate = mockTxUpdateSet.mock.calls
      .map(([value]) => value)
      .find((value) => value && typeof value === "object" && "logs" in value);
    expect(runUpdate.logs).toContain('"gateStatus": "PATCH_VALIDATED"');
    expect(runUpdate.logs).toContain('"commitCreated": false');
    expect(runUpdate.logs).toContain('"pushed": false');
  });

  it("rejects a stale patch when remote HEAD has moved", async () => {
    const fixture = await createFixture();
    const run = orchestratorRun("0".repeat(40), fixture.patch);
    wireDb(run);
    mockPrepareRepositoryWorkspace.mockResolvedValue({
      path: fixture.root,
      cleanup: true,
    });

    await expect(approveAndValidateLocalPatch(taskId)).rejects.toMatchObject({
      kind: "STALE_HEAD",
    });
    expect(mockVerifyChangedFilesStatically).not.toHaveBeenCalled();
    expect(mockTxInsertValues).not.toHaveBeenCalled();
  });

  it("rejects patch headers that do not match the recorded deterministic change set before creating a gate run", async () => {
    const fixture = await createFixture();
    wireDb(orchestratorRun(fixture.headSha, fixture.patch, ["src/other.ts"]));

    await expect(approveAndValidateLocalPatch(taskId)).rejects.toBeInstanceOf(LocalPatchApprovalError);
    await expect(
      Promise.reject(new LocalPatchApprovalError("x", "INVALID_PATCH")),
    ).rejects.toMatchObject({ kind: "INVALID_PATCH" });
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockPrepareRepositoryWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a patch when post-apply static verification fails", async () => {
    const fixture = await createFixture();
    wireDb(orchestratorRun(fixture.headSha, fixture.patch));
    mockPrepareRepositoryWorkspace.mockResolvedValue({
      path: fixture.root,
      cleanup: true,
    });
    mockVerifyChangedFilesStatically.mockResolvedValueOnce([{
      file: "src/sample.ts",
      kind: "syntax",
      detail: "Expression expected.",
      line: 1,
    }]);

    await expect(approveAndValidateLocalPatch(taskId)).rejects.toMatchObject({
      kind: "VERIFICATION_FAILED",
    });
    expect(mockTxInsertValues).not.toHaveBeenCalled();
  });
});
