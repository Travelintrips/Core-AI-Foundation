/**
 * __tests__/designProjectPersistenceAdapter.test.ts — Team 08
 *
 * Tests for the persistence adapter layer.
 * Mocks @workspace/db and the repository helpers to stay unit-level.
 *
 * Covers:
 *  - loadProject: found, not-found
 *  - attachArtifact: idempotency key deduplication
 *  - appendLifecycleEvent: correct payload shape / tenantId propagation
 *  - listArtifacts: empty / populated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ── vi.hoisted() prevents TDZ errors when variables are referenced inside vi.mock() ──
const { mockDb, mockInsert, mockSelect } = vi.hoisted(() => {
  // Minimal chain builder — each method returns `this` so Drizzle-style
  // call chains resolve to the terminal mock.
  function makeSelectChain(rows: unknown[] = []) {
    const chain = {
      from: vi.fn(),
      where: vi.fn(),
    };
    // Make the chain awaitable (vitest resolves it via .then)
    const resolved = Promise.resolve(rows);
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(resolved);
    return chain;
  }

  const mockSelect = vi.fn().mockImplementation(() => makeSelectChain([]));
  const mockInsertValues = vi.fn();
  const mockInsertReturning = vi.fn().mockResolvedValue([]);
  mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockDb = {
    select: mockSelect,
    insert: mockInsert,
    update: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  };

  return { mockDb, mockInsert, mockSelect };
});

vi.mock("@workspace/db", () => ({
  db: mockDb,
  creativeProjectsTable: { projectId: "project_id", status: "status", deletedAt: "deleted_at", lifecycleVersion: "lifecycle_version", lifecycleMetadata: "lifecycle_metadata", designPluginId: "design_plugin_id", id: "id", createdAt: "created_at", updatedAt: "updated_at" },
  creativeProjectStepsTable: { id: "id", projectId: "project_id" },
  creativeAiAssetsTable: { id: "id", projectId: "project_id", metadata: "metadata" },
  aiEventsTable: { id: "id" },
}));

vi.mock("../../aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../repositories/creativeProjectRepository.js", () => ({
  withTransaction: vi.fn(async (_ctx: unknown, fn: (ctx: unknown) => Promise<unknown>) =>
    fn(_ctx),
  ),
}));

import {
  loadProject,
  attachArtifact,
  appendLifecycleEvent,
  listArtifacts,
} from "../designProjectPersistenceAdapter.js";
import { LifecycleNotFoundError } from "../types.js";
import type { RepositoryContext } from "../../../repositories/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-01T00:00:00Z");

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    projectId: "proj-uuid-001",
    status: "pending",
    deletedAt: null,
    lifecycleVersion: 0,
    lifecycleMetadata: null,
    designPluginId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCtx(tenantId = "tenant-acme"): RepositoryContext {
  return {
    requestContext: {
      tenantId,
      actorId: "u1",
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

/** Re-configures mockSelect to return the given rows on the next query. */
function setupSelectToReturn(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  const resolved = Promise.resolve(rows);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(resolved);
  mockSelect.mockReturnValueOnce(chain);
  return chain;
}

/** Re-configures mockInsert to return the given rows via .values().returning(). */
function setupInsertToReturn(rows: unknown[]) {
  const mockReturning = vi.fn().mockResolvedValue(rows);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValueOnce({ values: mockValues });
  return { mockValues, mockReturning };
}

// ── loadProject ───────────────────────────────────────────────────────────────

describe("loadProject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a DesignProjectView for an existing active project", async () => {
    setupSelectToReturn([makeDbRow()]);

    const result = await loadProject(makeCtx(), "proj-uuid-001");

    expect(result.projectId).toBe("proj-uuid-001");
    expect(result.designStage).toBe("draft"); // 'pending' → draft
    expect(result.rawStatus).toBe("pending");
    expect(result.lifecycleVersion).toBe(0);
    expect(result.designPluginId).toBeNull();
  });

  it("resolves designStage from lifecycle_metadata.designStage if present", async () => {
    setupSelectToReturn([
      makeDbRow({ lifecycleMetadata: { designStage: "brief_in_progress" } }),
    ]);

    const result = await loadProject(makeCtx(), "proj-uuid-001");
    expect(result.designStage).toBe("brief_in_progress");
  });

  it("throws LifecycleNotFoundError when no row is returned", async () => {
    setupSelectToReturn([]);

    await expect(loadProject(makeCtx(), "missing")).rejects.toThrow(
      LifecycleNotFoundError,
    );
  });

  it("maps building → active correctly", async () => {
    setupSelectToReturn([makeDbRow({ status: "building" })]);

    const result = await loadProject(makeCtx(), "proj-uuid-001");
    expect(result.designStage).toBe("active");
    expect(result.rawStatus).toBe("building");
  });
});

// ── attachArtifact — idempotency ──────────────────────────────────────────────

describe("attachArtifact — idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns existing artifact when idempotencyKey matches", async () => {
    const existingRow = {
      id: 42,
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "replicate",
      model: "flux",
      prompt: "test",
      imageUrl: null,
      storagePath: null,
      status: "completed",
      category: null,
      metadata: { idempotencyKey: "idem-key-123" },
    };
    // First select: existing assets for idempotency check
    setupSelectToReturn([existingRow]);

    const result = await attachArtifact(makeCtx(), {
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "replicate",
      model: "flux",
      prompt: "test",
      status: "pending",
      idempotencyKey: "idem-key-123",
    });

    expect(result.id).toBe(42);
    expect(result.status).toBe("completed");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("inserts a new artifact when no idempotencyKey match exists", async () => {
    // Existing assets — no match
    setupSelectToReturn([]);

    const newRow = {
      id: 99,
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "openai",
      model: "dall-e-3",
      prompt: "new image",
      imageUrl: null,
      storagePath: null,
      status: "pending",
      category: null,
      metadata: { idempotencyKey: "new-key-456" },
    };
    setupInsertToReturn([newRow]);

    const result = await attachArtifact(makeCtx(), {
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "openai",
      model: "dall-e-3",
      prompt: "new image",
      status: "pending",
      idempotencyKey: "new-key-456",
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(result.id).toBe(99);
  });

  it("inserts without idempotencyKey when none provided", async () => {
    const newRow = {
      id: 100,
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "replicate",
      model: "flux",
      prompt: "no key",
      imageUrl: null,
      storagePath: null,
      status: "pending",
      category: null,
      metadata: {},
    };
    setupInsertToReturn([newRow]);

    const result = await attachArtifact(makeCtx(), {
      projectId: "proj-uuid-001",
      assetType: "image",
      provider: "replicate",
      model: "flux",
      prompt: "no key",
      status: "pending",
      // no idempotencyKey
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(result.id).toBe(100);
  });
});

// ── appendLifecycleEvent ──────────────────────────────────────────────────────

describe("appendLifecycleEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts an event with correct eventType and payload", async () => {
    const { mockValues } = setupInsertToReturn([{ id: 1 }]);

    await appendLifecycleEvent(makeCtx(), {
      projectId: "proj-uuid-001",
      fromStage: "draft",
      toStage: "brief_in_progress",
      actor: "user-1",
      reason: "brief started",
    });

    expect(mockInsert).toHaveBeenCalled();
    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.eventType).toBe("design_lifecycle.transitioned");
    expect(valuesArg.sourceModule).toBe("design-lifecycle");
    expect(valuesArg.sourceId).toBe("proj-uuid-001");
    expect(valuesArg.payloadJson.fromStage).toBe("draft");
    expect(valuesArg.payloadJson.toStage).toBe("brief_in_progress");
    expect(valuesArg.status).toBe("published");
  });

  it("includes tenantId in metadataJson", async () => {
    const { mockValues } = setupInsertToReturn([{ id: 2 }]);

    await appendLifecycleEvent(makeCtx("tenant-xyz"), {
      projectId: "proj-uuid-001",
      toStage: "active",
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.metadataJson.tenantId).toBe("tenant-xyz");
  });

  it("generates a unique eventId (UUID format)", async () => {
    const { mockValues } = setupInsertToReturn([{ id: 3 }]);

    await appendLifecycleEvent(makeCtx(), {
      projectId: "proj-uuid-001",
      toStage: "ready",
    });

    const valuesArg = mockValues.mock.calls[0][0];
    expect(valuesArg.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

// ── listArtifacts ─────────────────────────────────────────────────────────────

describe("listArtifacts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when no assets exist", async () => {
    setupSelectToReturn([]);

    const result = await listArtifacts(makeCtx(), "proj-uuid-001");
    expect(result).toEqual([]);
  });

  it("maps DB rows to DesignArtifact shape", async () => {
    setupSelectToReturn([
      {
        id: 10,
        projectId: "proj-uuid-001",
        assetType: "image",
        provider: "replicate",
        model: "flux",
        prompt: "test",
        imageUrl: "https://cdn.example.com/img.png",
        storagePath: null,
        status: "completed",
        category: "logo",
        metadata: { idempotencyKey: "k1" },
      },
    ]);

    const result = await listArtifacts(makeCtx(), "proj-uuid-001");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
    expect(result[0].assetType).toBe("image");
    expect(result[0].category).toBe("logo");
    expect(result[0].idempotencyKey).toBe("k1");
    expect(result[0].imageUrl).toBe("https://cdn.example.com/img.png");
  });

  it("handles null metadata gracefully", async () => {
    setupSelectToReturn([
      {
        id: 11,
        projectId: "proj-uuid-001",
        assetType: "image",
        provider: "replicate",
        model: "flux",
        prompt: "no meta",
        imageUrl: null,
        storagePath: null,
        status: "pending",
        category: null,
        metadata: null,
      },
    ]);

    const result = await listArtifacts(makeCtx(), "proj-uuid-001");
    expect(result[0].metadata).toBeNull();
    expect(result[0].idempotencyKey).toBeNull();
  });
});
