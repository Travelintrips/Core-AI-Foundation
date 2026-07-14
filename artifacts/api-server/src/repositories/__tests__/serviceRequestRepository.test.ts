/**
 * serviceRequestRepository.test.ts — WP-04/WP-05 service-request repository tests.
 *
 * Covers:
 *  1. Tenant enforcement — platform-wide context rejected on mutations.
 *  2. findServiceRequest — wrong-tenant row returns undefined (fail-closed).
 *  3. softDeleteById — sets deletedAt; throws AlreadyDeletedError; throws
 *     NotFoundError for missing rows; throws NotFoundError for wrong-tenant.
 *  4. restoreById — clears deletedAt and archivedAt.
 *  5. archiveById — sets archivedAt on active rows.
 *  6. listServiceRequests — calls db.select (soft-delete filter varies by context).
 *  7. retentionPolicy.runPurge — requires platform scope; calls hardDelete with
 *     correct cutoff date; returns PurgeResult; audits on failure.
 *
 * Mock design note: db.transaction passes the mocked `db` object itself as
 * the executor (self-referential pattern) so resolveExecutor() inside
 * withTransaction returns an object with .select() / .update() / .delete().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionTenantContext, createSystemContext } from "../../security/requestContext.js";
import { makeRepositoryContext } from "../types.js";
import { RepositoryAlreadyDeletedError, RepositoryNotFoundError, RepositoryPlatformScopeError } from "../errors.js";
import { TenantContextError } from "../../security/requestContext.js";

// ── Context factories ──────────────────────────────────────────────────────────

function tenantCtx(tenantId = "tenant-a") {
  return makeRepositoryContext(
    createSessionTenantContext({
      tenantId, actorId: "user-1", actorType: "tenant_admin",
      source: "admin_portal", requestId: `req-${tenantId}`,
    }),
  );
}

function platformCtx() {
  return makeRepositoryContext(
    createSystemContext({
      tenantId: null, actorType: "scheduler", source: "scheduler",
      requestId: "req-platform", isPlatformWide: true,
    }),
    { platformOperation: { name: "retention_sweep", reason: "nightly purge" } },
  );
}

// ── In-memory fake DB rows ─────────────────────────────────────────────────────

type FakeRow = {
  id: number; tenantId: string | null; requestId: string; status: string;
  deletedAt: Date | null; archivedAt: Date | null; createdAt: Date;
};

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 1, tenantId: "tenant-a", requestId: "req-uuid-1", status: "draft",
    deletedAt: null, archivedAt: null, createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// Mutable rows array — mutated (not replaced) so the mock closure stays live.
const rows: FakeRow[] = [];

function makeSelectChain(source: FakeRow[] = rows) {
  const chain: Record<string, unknown> = {};
  const snap = [...source]; // snapshot at call time
  const thenable = {
    then: (resolve: (v: FakeRow[]) => void) => Promise.resolve(resolve(snap)),
  };
  chain["from"] = () => ({ ...chain, ...thenable });
  chain["where"] = () => ({ ...chain, ...thenable });
  chain["orderBy"] = () => ({ ...chain, ...thenable });
  chain["limit"] = () => ({ ...chain, ...thenable });
  chain["offset"] = () => ({ ...chain, ...thenable });
  return { ...chain, ...thenable };
}

function makeUpdateChain(patch: Partial<FakeRow>, targetRows: FakeRow[] = rows) {
  return {
    set: () => ({
      where: () => ({
        returning: () => {
          if (targetRows.length === 0) return Promise.resolve([]);
          Object.assign(targetRows[0], patch);
          return Promise.resolve([{ ...targetRows[0] }]);
        },
      }),
    }),
  };
}

function makeEmptyUpdateChain() {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) };
}

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => {
  // Self-referential: db.transaction passes `db` as executor so that
  // resolveExecutor(txCtx, db) inside softDeleteById returns a valid mock object.
  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain({})),
    delete: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([]) }) })),
  };
  db["transaction"] = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return {
    db,
    aiServiceRequestsTable: {
      id: "id", tenantId: "tenantId", requestId: "requestId", status: "status",
      deletedAt: "deletedAt", archivedAt: "archivedAt", createdAt: "createdAt",
    },
  };
});

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const repo = await import("../serviceRequestRepository.js");

beforeEach(async () => {
  rows.length = 0;
  rows.push(makeRow());
  vi.clearAllMocks();

  const { db } = await import("@workspace/db");
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain());
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeUpdateChain({}));
  (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
    where: () => ({ returning: () => Promise.resolve([]) }),
  });
  // Restore the self-referential transaction mock after clearAllMocks
  (db["transaction"] as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(db),
  );
});

// ── 1. Tenant enforcement ──────────────────────────────────────────────────────

describe("serviceRequestRepository — tenant enforcement", () => {
  it("rejects platform-wide context for softDeleteById", async () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r1", isPlatformWide: true }),
    );
    await expect(repo.softDeleteById(ctx, 1)).rejects.toThrow(TenantContextError);
  });

  it("rejects platform-wide context for archiveById", async () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r2", isPlatformWide: true }),
    );
    await expect(repo.archiveById(ctx, 1)).rejects.toThrow(TenantContextError);
  });
});

// ── 2. findServiceRequest — tenant isolation ───────────────────────────────────

describe("serviceRequestRepository — findServiceRequest", () => {
  it("returns the row when tenantId matches", async () => {
    const row = await repo.findServiceRequest(tenantCtx("tenant-a"), 1);
    expect(row?.id).toBe(1);
  });

  it("returns undefined when the row belongs to a different tenant", async () => {
    rows[0].tenantId = "tenant-b";
    const row = await repo.findServiceRequest(tenantCtx("tenant-a"), 1);
    expect(row).toBeUndefined();
  });

  it("returns the row when tenantId is null (shared/default tenant)", async () => {
    rows[0].tenantId = null;
    const row = await repo.findServiceRequest(tenantCtx("tenant-a"), 1);
    expect(row).toBeDefined();
  });
});

// ── 3. softDeleteById ──────────────────────────────────────────────────────────

describe("serviceRequestRepository — softDeleteById", () => {
  it("throws RepositoryNotFoundError when the row does not exist", async () => {
    rows.length = 0; // empty db
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain([]));
    await expect(repo.softDeleteById(tenantCtx(), 99)).rejects.toThrow(RepositoryNotFoundError);
  });

  it("throws RepositoryAlreadyDeletedError when the row is already soft-deleted", async () => {
    rows[0].deletedAt = new Date("2026-01-01");
    await expect(repo.softDeleteById(tenantCtx(), 1)).rejects.toThrow(RepositoryAlreadyDeletedError);
  });

  it("sets deletedAt on a previously active row", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(
      () => makeUpdateChain({ deletedAt: new Date() }),
    );
    const result = await repo.softDeleteById(tenantCtx(), 1);
    expect(result.deletedAt).not.toBeNull();
  });

  it("throws RepositoryNotFoundError when tenantId does not match", async () => {
    rows[0].tenantId = "tenant-b";
    await expect(repo.softDeleteById(tenantCtx("tenant-a"), 1)).rejects.toThrow(RepositoryNotFoundError);
  });
});

// ── 4. restoreById ─────────────────────────────────────────────────────────────

describe("serviceRequestRepository — restoreById", () => {
  it("clears deletedAt and archivedAt", async () => {
    rows[0].deletedAt = new Date("2026-01-01");
    rows[0].archivedAt = new Date("2026-01-02");
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(
      () => makeUpdateChain({ deletedAt: null, archivedAt: null }),
    );
    const result = await repo.restoreById(tenantCtx(), 1);
    expect(result.deletedAt).toBeNull();
    expect(result.archivedAt).toBeNull();
  });

  it("throws RepositoryNotFoundError when the row does not exist", async () => {
    rows.length = 0;
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain([]));
    await expect(repo.restoreById(tenantCtx(), 99)).rejects.toThrow(RepositoryNotFoundError);
  });
});

// ── 5. archiveById ─────────────────────────────────────────────────────────────

describe("serviceRequestRepository — archiveById", () => {
  it("sets archivedAt when the update matches a row", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(
      () => makeUpdateChain({ archivedAt: new Date() }),
    );
    const result = await repo.archiveById(tenantCtx(), 1);
    expect(result.archivedAt).not.toBeNull();
  });

  it("throws RepositoryNotFoundError when the update matches no rows", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeEmptyUpdateChain());
    await expect(repo.archiveById(tenantCtx(), 99)).rejects.toThrow(RepositoryNotFoundError);
  });
});

// ── 6. listServiceRequests ────────────────────────────────────────────────────

describe("serviceRequestRepository — listServiceRequests", () => {
  it("calls db.select on the service requests table", async () => {
    const { db } = await import("@workspace/db");
    await repo.listServiceRequests(tenantCtx());
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("executes select twice for two calls with different includeDeleted settings", async () => {
    const { db } = await import("@workspace/db");
    await repo.listServiceRequests(tenantCtx());
    await repo.listServiceRequests(makeRepositoryContext(tenantCtx().requestContext, { includeDeleted: true }));
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

// ── 7. retentionPolicy.runPurge ────────────────────────────────────────────────

describe("retentionPolicy — runPurge", () => {
  it("throws RepositoryPlatformScopeError for a tenant context (not platform-wide)", async () => {
    const { runPurge, RETENTION_POLICIES } = await import("../retentionPolicy.js");
    await expect(
      runPurge(tenantCtx(), RETENTION_POLICIES["service_request"]!, async () => 0),
    ).rejects.toThrow(RepositoryPlatformScopeError);
  });

  it("throws RepositoryPlatformScopeError without a declared platformOperation", async () => {
    const { runPurge, RETENTION_POLICIES } = await import("../retentionPolicy.js");
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r9", isPlatformWide: true }),
      // No platformOperation — should still fail
    );
    await expect(
      runPurge(ctx, RETENTION_POLICIES["service_request"]!, async () => 0),
    ).rejects.toThrow(RepositoryPlatformScopeError);
  });

  it("calls hardDelete with a cutoff date that is windowDays ago", async () => {
    const { runPurge } = await import("../retentionPolicy.js");
    const policy = { resourceType: "test_resource", windowDays: 30, description: "test" };
    const hardDelete = vi.fn().mockResolvedValue(5);

    const before = Date.now();
    const result = await runPurge(platformCtx(), policy, hardDelete);
    const after = Date.now();

    expect(hardDelete).toHaveBeenCalledTimes(1);
    const [cutoffDate] = hardDelete.mock.calls[0] as [Date];
    const expectedMs = 30 * 86_400_000;
    expect(before - cutoffDate.getTime()).toBeGreaterThanOrEqual(expectedMs - 1000);
    expect(after - cutoffDate.getTime()).toBeLessThanOrEqual(expectedMs + 1000);
    expect(result.purgedCount).toBe(5);
    expect(result.resourceType).toBe("test_resource");
    expect(result.windowDays).toBe(30);
  });

  it("re-throws hardDelete errors and records a failure audit", async () => {
    const { runPurge } = await import("../retentionPolicy.js");
    const { logAudit } = await import("../../services/aiAuditService.js");
    const policy = { resourceType: "test_resource", windowDays: 30, description: "test" };

    await expect(
      runPurge(platformCtx(), policy, async () => { throw new Error("DB exploded"); }),
    ).rejects.toThrow("DB exploded");

    expect(logAudit).toHaveBeenCalledWith(
      "retentionPolicy", "purge_failed", "test_resource", "retention_purge", "failure",
      expect.objectContaining({ error: expect.stringContaining("DB exploded") }),
    );
  });
});
