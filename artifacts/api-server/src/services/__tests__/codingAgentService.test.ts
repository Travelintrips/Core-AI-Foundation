import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("@workspace/db", () => ({
  aiCodeChangesTable: {},
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
  db: {},
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../aiExecutionService.js", () => ({
  executeAI: vi.fn(),
}));

vi.mock("../aiModelRouter.js", () => ({
  getFallbackModels: vi.fn(),
  routeToModel: vi.fn(),
}));

const { buildProposedDiff } = await import("../codingAgentService.js");

describe("Coding Agent proposed diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles callback-style promisified stdout without assuming an object wrapper", async () => {
    mockExecFile
      .mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout?: string, stderr?: string) => void,
        ) => callback(null, "", ""),
      )
      .mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout?: string, stderr?: string) => void,
        ) => callback(null, "diff --git a/a.ts b/a.ts\n+new line\n", ""),
      );

    const diff = await buildProposedDiff("/tmp/coding-agent-test");

    expect(diff).toContain("diff --git");
    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      "git",
      ["add", "-N", "--", "."],
      expect.objectContaining({ cwd: "/tmp/coding-agent-test" }),
      expect.any(Function),
    );
    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      "git",
      ["diff", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--", "."],
      expect.objectContaining({ cwd: "/tmp/coding-agent-test" }),
      expect.any(Function),
    );
  });

  it("returns an empty diff instead of throwing when stdout is undefined", async () => {
    mockExecFile
      .mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout?: string, stderr?: string) => void,
        ) => callback(null, "", ""),
      )
      .mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout?: string, stderr?: string) => void,
        ) => callback(null, undefined, ""),
      );

    await expect(buildProposedDiff("/tmp/coding-agent-test")).resolves.toBe("");
  });
});
