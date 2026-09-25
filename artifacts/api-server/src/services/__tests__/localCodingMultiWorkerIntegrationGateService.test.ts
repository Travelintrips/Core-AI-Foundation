import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCodingIntegrationManifest,
  CodingIntegrationGateError,
} from "../localCodingMultiWorkerIntegrationGateService.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const GRAPH_ID = "22222222-2222-4222-8222-222222222222";
const BASE_SHA = "a".repeat(40);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function workstream(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    key: "WS-001",
    title: "Backend",
    role: "backend",
    instruction: "Implement backend.",
    status: "COMPLETED",
    priority: 80,
    ownershipPaths: ["artifacts/api-server/src/example/**"],
    acceptanceCriteria: ["Backend passes."],
    verificationProfiles: ["typecheck"],
    workerId: null,
    branchName: "ai-core/111111111111/ws-001-a1",
    childTaskId: null,
    childRunId: null,
    jobId: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    baseSha: BASE_SHA,
    headSha: null,
    attemptCount: 1,
    resultJson: {
      localExecution: {
        status: "APPLIED",
        changedFiles: ["artifacts/api-server/src/example/routes.ts"],
        patch: "diff --git a/artifacts/api-server/src/example/routes.ts b/artifacts/api-server/src/example/routes.ts\n+backend",
      },
    },
    errorMessage: null,
    dependencies: [],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    graph: {
      id: GRAPH_ID,
      taskId: TASK_ID,
      version: 1,
      contractVersion: 1,
      planHash: "f".repeat(64),
      objective: "Build integrated feature.",
      status: "COMPLETED",
      planJson: {},
      approvedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    workstreams: [workstream()],
    ...overrides,
  } as any;
}

describe("multi-worker integration review manifest", () => {
  it("builds a deterministic read-only manifest across reviewed workstreams", () => {
    const aiPatch = "diff --git a/artifacts/ai-platform/src/example/page.tsx b/artifacts/ai-platform/src/example/page.tsx\n+frontend";
    const input = snapshot({
      workstreams: [
        workstream(),
        workstream({
          id: "44444444-4444-4444-8444-444444444444",
          key: "WS-002",
          title: "Frontend",
          role: "frontend",
          ownershipPaths: ["artifacts/ai-platform/src/example/**"],
          branchName: "ai-core/111111111111/ws-002-a1",
          dependencies: ["WS-001"],
          resultJson: {
            workstreamAiExecution: {
              status: "CANDIDATE_READY",
              reviewStatus: "APPROVED",
              changedFiles: ["artifacts/ai-platform/src/example/page.tsx"],
              patch: aiPatch,
              patchSha256: sha256(aiPatch),
            },
          },
        }),
      ],
    });

    const result = buildCodingIntegrationManifest(TASK_ID, input);

    expect(result).toMatchObject({
      version: 1,
      taskId: TASK_ID,
      graphId: GRAPH_ID,
      baseSha: BASE_SHA,
      patchCount: 2,
      nextAction: "REVIEW_INTEGRATION_MANIFEST",
      commitCreated: false,
      pushed: false,
      merged: false,
    });
    expect(result.workstreams.map((item) => item.key)).toEqual([
      "WS-001",
      "WS-002",
    ]);
    expect(result.changedFiles).toEqual([
      "artifacts/ai-platform/src/example/page.tsx",
      "artifacts/api-server/src/example/routes.ts",
    ]);
    expect(result.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses integration review until every workstream is completed", () => {
    const input = snapshot();
    input.graph.status = "RUNNING";
    input.workstreams[0].status = "REVIEW_REQUIRED";

    expect(() => buildCodingIntegrationManifest(TASK_ID, input)).toThrow(
      expect.objectContaining({ code: "NOT_READY" } satisfies Partial<CodingIntegrationGateError>),
    );
  });

  it("rejects changed files outside the approved ownership boundary", () => {
    const input = snapshot({
      workstreams: [
        workstream({
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/ai-platform/src/escape.tsx"],
              patch: "diff --git a/artifacts/ai-platform/src/escape.tsx b/artifacts/ai-platform/src/escape.tsx\n+escape",
            },
          },
        }),
      ],
    });

    expect(() => buildCodingIntegrationManifest(TASK_ID, input)).toThrow(
      expect.objectContaining({ code: "OWNERSHIP_ESCAPE" } satisfies Partial<CodingIntegrationGateError>),
    );
  });

  it("rejects completed workstreams based on different repository SHAs", () => {
    const input = snapshot({
      workstreams: [
        workstream(),
        workstream({
          id: "44444444-4444-4444-8444-444444444444",
          key: "WS-002",
          title: "Frontend",
          role: "frontend",
          baseSha: "b".repeat(40),
          ownershipPaths: ["artifacts/ai-platform/src/example/**"],
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/ai-platform/src/example/page.tsx"],
              patch: "diff --git a/artifacts/ai-platform/src/example/page.tsx b/artifacts/ai-platform/src/example/page.tsx\n+frontend",
            },
          },
        }),
      ],
    });

    expect(() => buildCodingIntegrationManifest(TASK_ID, input)).toThrow(
      expect.objectContaining({ code: "BASE_SHA_MISMATCH" } satisfies Partial<CodingIntegrationGateError>),
    );
  });

  it("rejects same-file changes from parallel workstreams", () => {
    const patch = "diff --git a/artifacts/api-server/src/shared.ts b/artifacts/api-server/src/shared.ts\n+change";
    const input = snapshot({
      workstreams: [
        workstream({
          ownershipPaths: ["artifacts/api-server/src/shared.ts"],
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/api-server/src/shared.ts"],
              patch,
            },
          },
        }),
        workstream({
          id: "44444444-4444-4444-8444-444444444444",
          key: "WS-002",
          ownershipPaths: ["artifacts/api-server/src/shared.ts"],
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/api-server/src/shared.ts"],
              patch,
            },
          },
        }),
      ],
    });

    expect(() => buildCodingIntegrationManifest(TASK_ID, input)).toThrow(
      expect.objectContaining({ code: "PARALLEL_FILE_CONFLICT" } satisfies Partial<CodingIntegrationGateError>),
    );
  });

  it("allows same-file changes only when dependency order serializes them", () => {
    const patch1 = "diff --git a/artifacts/api-server/src/shared.ts b/artifacts/api-server/src/shared.ts\n+first";
    const patch2 = "diff --git a/artifacts/api-server/src/shared.ts b/artifacts/api-server/src/shared.ts\n+second";
    const input = snapshot({
      workstreams: [
        workstream({
          ownershipPaths: ["artifacts/api-server/src/shared.ts"],
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/api-server/src/shared.ts"],
              patch: patch1,
            },
          },
        }),
        workstream({
          id: "44444444-4444-4444-8444-444444444444",
          key: "WS-002",
          dependencies: ["WS-001"],
          ownershipPaths: ["artifacts/api-server/src/shared.ts"],
          resultJson: {
            localExecution: {
              status: "APPLIED",
              changedFiles: ["artifacts/api-server/src/shared.ts"],
              patch: patch2,
            },
          },
        }),
      ],
    });

    expect(
      buildCodingIntegrationManifest(TASK_ID, input).workstreams.map(
        (item) => item.key,
      ),
    ).toEqual(["WS-001", "WS-002"]);
  });

  it("rejects approved AI candidate when persisted patch hash no longer matches", () => {
    const input = snapshot({
      workstreams: [
        workstream({
          resultJson: {
            workstreamAiExecution: {
              status: "CANDIDATE_READY",
              reviewStatus: "APPROVED",
              changedFiles: ["artifacts/api-server/src/example/routes.ts"],
              patch: "tampered patch",
              patchSha256: "0".repeat(64),
            },
          },
        }),
      ],
    });

    expect(() => buildCodingIntegrationManifest(TASK_ID, input)).toThrow(
      expect.objectContaining({ code: "PATCH_HASH_MISMATCH" } satisfies Partial<CodingIntegrationGateError>),
    );
  });
});
