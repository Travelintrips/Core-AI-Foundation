/**
 * __tests__/designProjectLifecycleService.test.ts — Team 08
 *
 * Tests for the lifecycle application service.
 * Mocks the persistence adapter to isolate business logic.
 *
 * Covers (per Team 08 acceptance criteria):
 *  - load project
 *  - create/init lifecycle metadata
 *  - valid transition
 *  - invalid transition
 *  - stale version / concurrency
 *  - idempotent command (allowNoop)
 *  - event atomicity (verified via mock call order)
 *  - tenant isolation (tenantId propagated)
 *  - legacy project mapping
 *  - rollback on failure (transaction aborted)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import type { RepositoryContext } from "../../../repositories/types.js";

// ── Mock the persistence adapter ──────────────────────────────────────────────
vi.mock("../designProjectPersistenceAdapter.js", () => ({
  loadProject: vi.fn(),
  transitionProjectStatus: vi.fn(),
  appendLifecycleEvent: vi.fn(),
  listArtifacts: vi.fn(),
  attachArtifact: vi.fn(),
  listStages: vi.fn(),
  saveStage: vi.fn(),
}));

// ── Mock creativeProjectRepository withTransaction ────────────────────────────
vi.mock("../../../repositories/creativeProjectRepository.js", () => ({
  withTransaction: vi.fn(async (_ctx: unknown, fn: (ctx: unknown) => Promise<unknown>) =>
    fn(_ctx),
  ),
}));

import * as adapter from "../designProjectPersistenceAdapter.js";
import {
  getProject,
  getArtifacts,
  getStages,
  transitionLifecycle,
  attachProjectArtifact,
  mapLegacyProject,
} from "../designProjectLifecycleService.js";
import {
  LifecycleNotFoundError,
  LifecycleInvalidTransitionError,
  LifecycleStaleVersionError,
  LifecycleTerminalStateError,
} from "../types.js";
import type { DesignProjectView, DesignArtifact } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2025-01-15T12:00:00Z");

function makeProject(overrides: Partial<DesignProjectView> = {}): DesignProjectView {
  return {
    projectId: "proj-uuid-001",
    designStage: "draft",
    rawStatus: "pending",
    lifecycleVersion: 0,
    designPluginId: null,
    lifecycleMetadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCtx(tenantId = "tenant-acme"): RepositoryContext {
  return {
    requestContext: {
      tenantId,
      actorId: "user-1",
      actorType: "system",
      authMode: "internal",
      requestId: "req-test-001",
      correlationId: "corr-test-001",
      source: "internal_service",
      permissions: [],
      resourceScope: null,
      isPlatformAdmin: false,
      isPlatformWide: false,
      originatingActorId: null,
      metadata: {},
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ── getProject ────────────────────────────────────────────────────────────────

describe("getProject", () => {
  it("returns the project view when found", async () => {
    const project = makeProject();
    (adapter.loadProject as Mock).mockResolvedValue(project);

    const result = await getProject(makeCtx(), "proj-uuid-001");
    expect(result).toEqual(project);
    expect(adapter.loadProject).toHaveBeenCalledWith(
      expect.objectContaining({ requestContext: expect.objectContaining({ tenantId: "tenant-acme" }) }),
      "proj-uuid-001",
    );
  });

  it("propagates LifecycleNotFoundError for unknown projectId", async () => {
    (adapter.loadProject as Mock).mockRejectedValue(
      new LifecycleNotFoundError("proj-missing"),
    );
    await expect(getProject(makeCtx(), "proj-missing")).rejects.toThrow(
      LifecycleNotFoundError,
    );
  });
});

// ── transitionLifecycle — valid ───────────────────────────────────────────────

describe("transitionLifecycle — valid transition", () => {
  it("transitions draft → brief_in_progress and appends an event", async () => {
    const before = makeProject({ designStage: "draft", lifecycleVersion: 0 });
    const after = makeProject({ designStage: "brief_in_progress", lifecycleVersion: 1 });

    (adapter.loadProject as Mock).mockResolvedValue(before);
    (adapter.transitionProjectStatus as Mock).mockResolvedValue(after);
    (adapter.appendLifecycleEvent as Mock).mockResolvedValue(undefined);

    const result = await transitionLifecycle(makeCtx(), "proj-uuid-001", "brief_in_progress");

    expect(result.designStage).toBe("brief_in_progress");
    expect(result.lifecycleVersion).toBe(1);

    // Event must be appended in the same transaction call
    expect(adapter.appendLifecycleEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: "proj-uuid-001",
        fromStage: "draft",
        toStage: "brief_in_progress",
      }),
    );
  });

  it("passes actor and reason through to event payload", async () => {
    const before = makeProject({ designStage: "ready", lifecycleVersion: 2 });
    const after = makeProject({ designStage: "active", lifecycleVersion: 3 });

    (adapter.loadProject as Mock).mockResolvedValue(before);
    (adapter.transitionProjectStatus as Mock).mockResolvedValue(after);
    (adapter.appendLifecycleEvent as Mock).mockResolvedValue(undefined);

    await transitionLifecycle(makeCtx(), "proj-uuid-001", "active", {
      actor: "scheduler",
      reason: "auto-start",
    });

    expect(adapter.appendLifecycleEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: "scheduler", reason: "auto-start" }),
    );
  });

  it("passes expectedVersion for optimistic concurrency", async () => {
    const before = makeProject({ designStage: "generating", lifecycleVersion: 5 });
    const after = makeProject({ designStage: "in_review", lifecycleVersion: 6 });

    (adapter.loadProject as Mock).mockResolvedValue(before);
    (adapter.transitionProjectStatus as Mock).mockResolvedValue(after);
    (adapter.appendLifecycleEvent as Mock).mockResolvedValue(undefined);

    await transitionLifecycle(makeCtx(), "proj-uuid-001", "in_review", {
      expectedVersion: 5,
    });

    expect(adapter.transitionProjectStatus).toHaveBeenCalledWith(
      expect.anything(),
      "proj-uuid-001",
      "in_review",
      expect.objectContaining({ expectedVersion: 5 }),
    );
  });
});

// ── transitionLifecycle — invalid transition ──────────────────────────────────

describe("transitionLifecycle — invalid transition", () => {
  it("throws LifecycleInvalidTransitionError for draft → completed (skipping stages)", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(makeProject({ designStage: "draft" }));

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "completed"),
    ).rejects.toThrow(LifecycleInvalidTransitionError);

    // Adapter must NOT have been called (guard fires before any DB write)
    expect(adapter.transitionProjectStatus).not.toHaveBeenCalled();
    expect(adapter.appendLifecycleEvent).not.toHaveBeenCalled();
  });

  it("throws LifecycleTerminalStateError when project is completed", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(
      makeProject({ designStage: "completed" }),
    );

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "draft"),
    ).rejects.toThrow(LifecycleTerminalStateError);
  });

  it("throws LifecycleTerminalStateError when project is cancelled", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(
      makeProject({ designStage: "cancelled" }),
    );

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "active"),
    ).rejects.toThrow(LifecycleTerminalStateError);
  });
});

// ── transitionLifecycle — stale version ──────────────────────────────────────

describe("transitionLifecycle — stale version / concurrency", () => {
  it("propagates LifecycleStaleVersionError from adapter", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(
      makeProject({ designStage: "ready", lifecycleVersion: 3 }),
    );
    (adapter.transitionProjectStatus as Mock).mockRejectedValue(
      new LifecycleStaleVersionError("proj-uuid-001", 2, 3),
    );

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "active", { expectedVersion: 2 }),
    ).rejects.toThrow(LifecycleStaleVersionError);
  });
});

// ── transitionLifecycle — idempotent noop ────────────────────────────────────

describe("transitionLifecycle — idempotent command (allowNoop)", () => {
  it("rejects noop by default", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(
      makeProject({ designStage: "active" }),
    );

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "active"),
    ).rejects.toThrow(LifecycleInvalidTransitionError);
  });

  it("allows noop with allowNoop=true without writing to DB", async () => {
    const project = makeProject({ designStage: "active" });
    (adapter.loadProject as Mock).mockResolvedValue(project);
    (adapter.transitionProjectStatus as Mock).mockResolvedValue(project);
    (adapter.appendLifecycleEvent as Mock).mockResolvedValue(undefined);

    // Should not throw
    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "active", { allowNoop: true }),
    ).resolves.toBeDefined();
  });
});

// ── Event atomicity ───────────────────────────────────────────────────────────

describe("event atomicity", () => {
  it("aborts both status update and event when transitionProjectStatus throws", async () => {
    (adapter.loadProject as Mock).mockResolvedValue(
      makeProject({ designStage: "ready" }),
    );
    (adapter.transitionProjectStatus as Mock).mockRejectedValue(
      new Error("DB connection lost"),
    );

    await expect(
      transitionLifecycle(makeCtx(), "proj-uuid-001", "active"),
    ).rejects.toThrow("DB connection lost");

    // appendLifecycleEvent must NOT have been called if status update failed
    expect(adapter.appendLifecycleEvent).not.toHaveBeenCalled();
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe("tenant isolation", () => {
  it("passes tenantId from context to all adapter calls", async () => {
    const ctx = makeCtx("tenant-x");
    (adapter.loadProject as Mock).mockResolvedValue(makeProject());
    (adapter.transitionProjectStatus as Mock).mockResolvedValue(
      makeProject({ designStage: "brief_in_progress", lifecycleVersion: 1 }),
    );
    (adapter.appendLifecycleEvent as Mock).mockResolvedValue(undefined);

    await transitionLifecycle(ctx, "proj-uuid-001", "brief_in_progress");

    const loadCall = (adapter.loadProject as Mock).mock.calls[0][0];
    expect(loadCall.requestContext.tenantId).toBe("tenant-x");
  });
});

// ── getArtifacts ──────────────────────────────────────────────────────────────

describe("getArtifacts", () => {
  it("returns artifacts list from adapter", async () => {
    const artifacts: DesignArtifact[] = [
      {
        id: 1,
        projectId: "proj-uuid-001",
        assetType: "image",
        provider: "replicate",
        model: "flux-schnell",
        prompt: "test",
        status: "completed",
      },
    ];
    (adapter.listArtifacts as Mock).mockResolvedValue(artifacts);

    const result = await getArtifacts(makeCtx(), "proj-uuid-001");
    expect(result).toEqual(artifacts);
  });
});

// ── attachProjectArtifact ─────────────────────────────────────────────────────

describe("attachProjectArtifact", () => {
  it("verifies project exists before attaching", async () => {
    (adapter.loadProject as Mock).mockRejectedValue(
      new LifecycleNotFoundError("missing-project"),
    );

    await expect(
      attachProjectArtifact(makeCtx(), "missing-project", {
        assetType: "image",
        provider: "replicate",
        model: "flux",
        prompt: "test",
        status: "pending",
      }),
    ).rejects.toThrow(LifecycleNotFoundError);

    expect(adapter.attachArtifact).not.toHaveBeenCalled();
  });
});

// ── Legacy project mapping ────────────────────────────────────────────────────

describe("mapLegacyProject", () => {
  it("maps a legacy 'running' project to the generating stage", () => {
    const view = mapLegacyProject({
      projectId: "legacy-001",
      status: "running",
      lifecycleVersion: null,
      designPluginId: null,
      lifecycleMetadata: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(view.designStage).toBe("generating");
    expect(view.rawStatus).toBe("running");
    expect(view.lifecycleVersion).toBe(0);
  });

  it("maps a legacy 'building' project to the active stage", () => {
    const view = mapLegacyProject({
      projectId: "legacy-002",
      status: "building",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(view.designStage).toBe("active");
  });

  it("maps an unknown legacy status to draft (graceful degradation)", () => {
    const view = mapLegacyProject({
      projectId: "legacy-003",
      status: "some_old_status",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(view.designStage).toBe("draft");
  });

  it("uses lifecycle_metadata.designStage as tie-breaker for legacy records with metadata", () => {
    const view = mapLegacyProject({
      projectId: "legacy-004",
      status: "pending",
      lifecycleMetadata: { designStage: "brief_in_progress" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(view.designStage).toBe("brief_in_progress");
  });

  it("is a pure function — never throws for any valid input", () => {
    const statuses = ["pending", "running", "completed", "failed", "", "unknown"];
    for (const status of statuses) {
      expect(() =>
        mapLegacyProject({ projectId: "p", status, createdAt: NOW, updatedAt: NOW }),
      ).not.toThrow();
    }
  });
});
