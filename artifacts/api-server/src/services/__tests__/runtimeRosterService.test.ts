import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ────────────────────────────────────────────────────────
// buildProjectRuntimeSnapshot makes two sequential `db.select(...)` calls:
//   1) creative_project_steps for the project (chain ends in .orderBy())
//   2) ai_employees LEFT JOIN ai_departments for metadata (chain ends in .where())
// Both chains are thenable (drizzle query builders resolve when awaited), so
// this mock returns a chainable, awaitable object fed by a per-test queue.
let resultQueue: unknown[][] = [];

function makeChain(result: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    leftJoin: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown[]) => void) => resolve(result),
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain(resultQueue.shift() ?? [])),
  },
  creativeProjectStepsTable: { projectId: "projectId", id: "id" },
  aiEmployeesTable: { agentSlug: "agentSlug", employeeName: "employeeName", position: "position", bio: "bio", departmentId: "departmentId", status: "status" },
  aiDepartmentsTable: { id: "id", departmentName: "departmentName" },
}));

import { buildProjectRuntimeSnapshot } from "../runtimeRosterService.js";

function step(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    projectId: 42,
    stepName: "Brand Strategy",
    status: "pending",
    provider: null,
    model: null,
    output: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  resultQueue = [];
});

describe("buildProjectRuntimeSnapshot", () => {
  it("returns the honest unavailable snapshot when internalProjectId is null", async () => {
    const snap = await buildProjectRuntimeSnapshot(null);
    expect(snap.source).toBe("unavailable");
    expect(snap.isLive).toBe(false);
    expect(snap.workers).toHaveLength(0);
    expect(snap.currentTask).toBeNull();
  });

  it("returns the honest unavailable snapshot when the project has no steps", async () => {
    resultQueue = [[]]; // steps query -> empty
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.source).toBe("unavailable");
    expect(snap.isLive).toBe(false);
    expect(snap.workers).toHaveLength(0);
  });

  it("marks a running step as the current task and surfaces it as 'working'", async () => {
    resultQueue = [
      [step({ id: 1, stepName: "Brand Strategy", status: "running" })],
      [], // no employee metadata found -> honest fallback name
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.isLive).toBe(true);
    expect(snap.workers).toHaveLength(1);
    expect(snap.workers[0].status).toBe("working");
    expect(snap.currentTask?.status).toBe("working");
    expect(snap.currentTask?.stepId).toBe(1);
  });

  it("prioritises a failed step over a running one for current task (needs attention)", async () => {
    resultQueue = [
      [
        step({ id: 1, stepName: "Brand Strategy", status: "completed" }),
        step({ id: 2, stepName: "Creative Direction", status: "failed" }),
        step({ id: 3, stepName: "Copy Production", status: "running" }),
      ],
      [],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.currentTask?.stepId).toBe(2);
    expect(snap.currentTask?.status).toBe("failed");
  });

  it("falls back to the latest completed step when nothing is running/failed/pending", async () => {
    resultQueue = [
      [
        step({ id: 1, stepName: "Brand Strategy", status: "completed", updatedAt: new Date("2026-01-01T00:00:00Z") }),
        step({ id: 2, stepName: "Creative Direction", status: "completed", updatedAt: new Date("2026-01-02T00:00:00Z") }),
      ],
      [],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.currentTask?.stepId).toBe(2);
    expect(snap.currentTask?.status).toBe("completed");
  });

  it("uses ai_employees metadata when a matching agentSlug is found", async () => {
    resultQueue = [
      [step({ id: 1, stepName: "Brand Strategy", status: "running" })],
      [{ agentSlug: "brand-strategist", employeeName: "Alex", position: "Brand Strategist", bio: null, departmentName: "Strategy" }],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.workers[0].displayName).toBe("Alex AI");
    expect(snap.workers[0].department).toBe("Strategy");
  });

  it("uses an honest fallback display name when no employee metadata matches", async () => {
    resultQueue = [
      [step({ id: 1, stepName: "Brand Strategy", status: "running" })],
      [],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.workers[0].displayName).toBe("Creative AI Worker — Brand Strategy");
    expect(snap.workers[0].department).toBeNull();
  });

  it("de-duplicates repeated steps for the same role, keeping only the latest", async () => {
    resultQueue = [
      [
        step({ id: 1, stepName: "Brand Strategy", status: "failed" }),
        step({ id: 2, stepName: "Brand Strategy", status: "running" }), // retry of the same role
      ],
      [],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    expect(snap.workers).toHaveLength(1);
    expect(snap.workers[0].stepId).toBe(2);
    expect(snap.workers[0].status).toBe("working");
  });

  it("never includes provider-response, prompt, or error-message fields on worker snapshots", async () => {
    resultQueue = [
      [step({ id: 1, stepName: "Brand Strategy", status: "failed", output: "some raw output", errorMessage: "stack trace leak" as unknown as undefined })],
      [],
    ];
    const snap = await buildProjectRuntimeSnapshot(42);
    const keys = Object.keys(snap.workers[0]);
    expect(keys).not.toContain("errorMessage");
    expect(keys).not.toContain("input");
    expect(keys).not.toContain("output");
    expect(keys).not.toContain("prompt");
  });
});
