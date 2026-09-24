import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  aiCodingRunsTable: {},
  aiCodingTaskGraphsTable: {},
  aiCodingTasksTable: {},
  aiCodingWorkstreamDependenciesTable: {},
  aiCodingWorkstreamsTable: {},
  db: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../aiAuditService.js", () => ({
  logAudit: vi.fn(),
}));

vi.mock("../queueManagerService.js", () => ({
  enqueue: vi.fn(),
}));

vi.mock("../repositoryAnalyzerService.js", () => ({
  completeRepositoryAnalyzerRun: vi.fn(),
  executeRepositoryAnalyzerJob: vi.fn(),
  failRepositoryAnalyzerRun: vi.fn(),
}));

import {
  buildCodingWorkstreamBranchName,
  workstreamOwnsFile,
} from "../localCodingMultiWorkerOrchestratorService.js";

describe("multi-worker coding ownership helpers", () => {
  it("builds deterministic isolated branch metadata per graph version/workstream", () => {
    expect(
      buildCodingWorkstreamBranchName(
        "CWS-ABC123",
        3,
        "WS-002",
      ),
    ).toBe("ai-workstream/cws-abc123/v3-ws-002");
  });

  it("accepts exact files and descendants of a directory ownership path", () => {
    expect(
      workstreamOwnsFile(
        "artifacts/api-server/src/example/routes.ts",
        ["artifacts/api-server/src/example"],
      ),
    ).toBe(true);

    expect(
      workstreamOwnsFile(
        "artifacts/api-server/src/example",
        ["artifacts/api-server/src/example"],
      ),
    ).toBe(true);
  });

  it("supports bounded * and ** ownership patterns", () => {
    expect(
      workstreamOwnsFile(
        "artifacts/api-server/src/routes/example.ts",
        ["artifacts/api-server/src/routes/*.ts"],
      ),
    ).toBe(true);

    expect(
      workstreamOwnsFile(
        "artifacts/api-server/src/services/deep/example.ts",
        ["artifacts/api-server/src/**"],
      ),
    ).toBe(true);
  });

  it("rejects files outside the ownership boundary", () => {
    expect(
      workstreamOwnsFile(
        "artifacts/ai-platform/src/pages/example.tsx",
        ["artifacts/api-server/src/**"],
      ),
    ).toBe(false);
  });

  it("rejects traversal/absolute file paths even if a broad ownership glob exists", () => {
    expect(workstreamOwnsFile("../secret.ts", ["**"])).toBe(false);
    expect(workstreamOwnsFile("/etc/passwd", ["**"])).toBe(false);
  });
});
