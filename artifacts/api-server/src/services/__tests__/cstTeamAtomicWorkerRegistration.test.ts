import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existingWorker: null as Record<string, unknown> | null,
  rejectAudit: false,
  committed: [] as Array<{ table: string; value: Record<string, unknown> }>,
}));

vi.mock("@workspace/db", () => {
  const aiWorkersTable = { workerName: "worker_name", id: "id" };
  const aiAuditLogsTable = { id: "id", table: "audit" };
  return {
    aiWorkersTable, aiAuditLogsTable, aiJobsTable: { id: "id" },
    withTransientDatabaseRetry: (fn: () => Promise<unknown>) => fn(),
    db: {
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const pending: typeof state.committed = [];
        const tx = {
          execute: vi.fn(async () => ({ rows: [] })),
          select: () => ({
            from: () => ({
              where: () => ({
                for: async () => state.existingWorker ? [state.existingWorker] : [],
              }),
            }),
          }),
          update: (table: unknown) => ({
            set: (value: Record<string, unknown>) => ({
              where: () => ({
                returning: async () => {
                  if (table !== aiWorkersTable) throw Error("UNEXPECTED_UPDATE");
                  const worker = {
                    ...state.existingWorker, ...value,
                    id: state.existingWorker?.id ?? 111,
                  };
                  pending.push({ table: "worker_update", value: worker });
                  return [worker];
                },
              }),
            }),
          }),
          insert: (table: unknown) => ({
            values: (value: Record<string, unknown>) => {
              if (table === aiWorkersTable) return {
                returning: async () => {
                  const worker = { ...value, id: 111 };
                  pending.push({ table: "worker", value: worker });
                  return [worker];
                },
              };
              if (table === aiAuditLogsTable) return Promise.resolve().then(() => {
                if (state.rejectAudit) throw Object.assign(
                  new Error("ATOMIC_WORKER_AUDIT_RLS_DENIED"), { code: "42501" });
                pending.push({ table: "audit", value });
              });
              throw Error("UNEXPECTED_INSERT_TABLE");
            },
          }),
        };
        const result = await fn(tx);
        state.committed.push(...pending);
        return result;
      }),
    },
  };
});
vi.mock("../aiAuditService.js", () => ({ logAudit: vi.fn() }));
vi.mock("../repositoryAnalyzerService.js", () => ({ failRepositoryAnalyzerRun: vi.fn() }));
vi.mock("../localCodingMultiWorkerExecutionService.js", () => ({
  recoverFailedCodingWorkstreamJob: vi.fn(),
}));
vi.mock("../localCodingWorkstreamAiExecutionService.js", () => ({
  CODING_WORKSTREAM_AI_JOB_TYPE: "coding_workstream_execution",
  recoverFailedCodingWorkstreamAiJob: vi.fn(),
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { db } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { registerWorker } from "../workerClusterService.js";

const approved = {
  workerName: "cst-dev-dell-onejob-20261119", workerType: "coding_worker",
  clusterId: "ollama", nodeId: "cst-dev-dell-onejob-20261119",
  region: "cst-dev", version: "onejob",
  capabilities: ["ollama_inference"], maxConcurrentJobs: 1,
  leaseOwner: "ollama-remote:cst-dev-dell-onejob-20261119",
  providerSlug: "ollama", modelId: "qwen2.5:3b",
  endpointUrl: null, runtimeKind: "ollama_remote_pull",
  requireAtomicRegistrationAudit: true,
};

describe("scoped DEV remote-model registration uses one worker+audit transaction", () => {
  beforeEach(() => {
    state.existingWorker = null;
    state.rejectAudit = false;
    state.committed = [];
    vi.mocked(db.transaction).mockClear();
    vi.mocked(logAudit).mockClear();
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CST_TEAM_DEV_SCOPED_MODEL_CLAIM_ENABLED", "true");
    vi.stubEnv("CST_TEAM_DEV_APPROVED_WORKER_NAME", approved.workerName);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("commits exactly one model-only worker and its bound registration audit", async () => {
    const worker = await registerWorker(approved);
    expect(worker.id).toBe(111);
    expect(state.committed.map(x => x.table)).toEqual(["worker","audit"]);
    expect(state.committed[1].value.resourceId).toBe("111");
    expect(state.committed[1].value.module).toBe("worker-cluster");
    expect(state.committed[1].value.action).toBe("worker_registered");
    expect(state.committed[1].value.details).toMatchObject({
      workerName: approved.workerName, workerType: "coding_worker",
      leaseOwner: approved.leaseOwner, capabilities: ["ollama_inference"],
    });
    expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("RLS audit rejection rolls back the worker insert and heartbeat lease", async () => {
    state.rejectAudit = true;
    await expect(registerWorker(approved)).rejects.toMatchObject({ code: "42501" });
    expect(state.committed).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("rejects mis-scoped pilot before any transaction", async () => {
    for (const mutation of [
      { workerName: "another-worker" },
      { nodeId: "another-machine" },
      { workerType: "system_worker" },
      { modelId: "other-model" },
      { runtimeKind: "ollama_worker" },
      { capabilities: ["ollama_inference","coding_powershell_execution"] },
      { leaseOwner: "wrong-owner" },
      { maxConcurrentJobs: 2 },
    ]) {
      await expect(registerWorker({ ...approved, ...mutation })).rejects
        .toThrow("CST_DEV_MODEL_WORKER_ATOMIC_AUDIT_SCOPE_DENIED");
    }
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects active owner conflicts without registering or auditing", async () => {
    state.existingWorker = { id: 111, workerName: approved.workerName,
      leaseOwner: "another-owner",status: "online",
      leaseExpiresAt: new Date(Date.now() + 90000) };
    await expect(registerWorker(approved)).rejects
      .toThrow("CST_DEV_MODEL_WORKER_LEASE_CONFLICT");
    expect(state.committed).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("leaves the ordinary worker registration's best-effort audit unchanged", async () => {
    const worker = await registerWorker({ ...approved, requireAtomicRegistrationAudit: false });
    expect(worker.id).toBe(111);
    expect(state.committed.map(x => x.table)).toEqual(["worker"]);
    expect(logAudit).toHaveBeenCalledTimes(1);
  });
});
