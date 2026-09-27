import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  aiCodingRunsTable: {},
  aiCodingTasksTable: {},
}));
vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn() }));
vi.mock("../localCodingMultiWorkerIntegrationGateService.js", () => ({
  getCodingIntegrationManifest: vi.fn(),
}));
vi.mock("../repositoryAnalyzerService.js", () => ({
  buildRepositoryCloneEnvironment: vi.fn(() => ({})),
  prepareRepositoryWorkspace: vi.fn(),
}));
vi.mock("../localCodingGitHubPublisherService.js", () => ({
  createGitHubApiClient: vi.fn(),
  parseGitHubRepository: vi.fn(),
}));

describe("multi-workstream integration finalizer contract", () => {
  it("exports the bounded integration finalizer", async () => {
    const service = await import("../localCodingMultiWorkerIntegrationFinalizerService.js");
    expect(service).toHaveProperty("finalizeCodingTaskGraphIntegration");
    expect(service).toHaveProperty("CodingIntegrationFinalizerError");
  });
});
