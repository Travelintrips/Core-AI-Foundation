import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...values: unknown[]) => values),
}));

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
  db: {},
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
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

const { runDeterministicCodingTests } = await import("../codingVerificationService.js");

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "coding-verification-test-"));
  workspaces.push(dir);
  return dir;
}

describe("Test Agent deterministic verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void,
      ) => callback(null, "", ""),
    );
  });

  afterEach(async () => {
    await Promise.all(
      workspaces.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("fails a proposed JS test when its relative import does not exist", async () => {
    const root = await workspace();
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(
      join(root, "tests", "codingTask.test.js"),
      "import { codingTask } from '../src/codingTask';\nconsole.log(codingTask);\n",
      "utf8",
    );

    const report = await runDeterministicCodingTests(root, {
      summary: "Add a test",
      verificationCommands: [],
      risks: [],
      changes: [{
        path: "tests/codingTask.test.js",
        changeType: "ADDED",
        content: "import { codingTask } from '../src/codingTask';",
      }],
    });

    expect(report.outcome).toBe("FAILED");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "import:tests/codingTask.test.js:../src/codingTask",
          status: "FAILED",
        }),
      ]),
    );
  });

  it("passes relative-import resolution when the target exists", async () => {
    const root = await workspace();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "src", "codingTask.js"), "export const codingTask = () => true;\n", "utf8");
    await writeFile(
      join(root, "tests", "codingTask.test.js"),
      "import { codingTask } from '../src/codingTask.js';\nconsole.log(codingTask);\n",
      "utf8",
    );

    const report = await runDeterministicCodingTests(root, {
      summary: "Add a test",
      verificationCommands: [],
      risks: [],
      changes: [{
        path: "tests/codingTask.test.js",
        changeType: "ADDED",
        content: "import { codingTask } from '../src/codingTask.js';",
      }],
    });

    expect(report.outcome).toBe("PASSED");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "import:tests/codingTask.test.js:../src/codingTask.js",
          status: "PASSED",
        }),
      ]),
    );
  });

  it("fails malformed JSON proposed changes", async () => {
    const root = await workspace();
    await writeFile(join(root, "package.json"), "{ invalid json", "utf8");

    const report = await runDeterministicCodingTests(root, {
      summary: "Modify package",
      verificationCommands: [],
      risks: [],
      changes: [{
        path: "package.json",
        changeType: "MODIFIED",
        content: "{ invalid json",
      }],
    });

    expect(report.outcome).toBe("FAILED");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "json:package.json",
          status: "FAILED",
        }),
      ]),
    );
  });
});
