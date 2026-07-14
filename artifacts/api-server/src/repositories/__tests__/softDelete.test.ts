/**
 * softDelete.test.ts — WP-04 soft-delete helper + repository integration tests.
 *
 * Covers:
 *  1. softDeleteGuard — pure function: returns SQL when includeDeleted=false,
 *     undefined when includeDeleted=true.
 *  2. deletedOnlyGuard / archivedOnlyGuard / purgeEligibleGuard — pure functions.
 *  3. packageInstallationRepository soft-delete lifecycle: softDeleteById,
 *     restoreById, archiveById, unarchiveById.
 *  4. RepositoryAlreadyDeletedError thrown when soft-deleting an already-
 *     deleted row.
 *  5. RepositoryNotFoundError thrown when the row does not exist.
 *
 * Mock design note: db.transaction passes the mocked `db` object itself as
 * the transaction executor (self-referential mock) so that resolveExecutor()
 * inside withTransaction returns an object with .select() / .update() etc.
 * Using a plain string ("fake-tx") would cause "executor.select is not a function".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionTenantContext, createSystemContext } from "../../security/requestContext.js";
import { makeRepositoryContext } from "../types.js";
import { softDeleteGuard, deletedOnlyGuard, archivedOnlyGuard, purgeEligibleGuard } from "../softDelete.js";
import { RepositoryAlreadyDeletedError, RepositoryNotFoundError } from "../errors.js";
import { TenantContextError } from "../../security/requestContext.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function tenantCtx(tenantId = "tenant-a") {
  return makeRepositoryContext(
    createSessionTenantContext({
      tenantId,
      actorId: "user-1",
      actorType: "tenant_admin",
      source: "admin_portal",
      requestId: `req-${tenantId}`,
    }),
  );
}

const FAKE_COL = "fake_deleted_at" as unknown as Parameters<typeof softDeleteGuard>[0];
const FAKE_ARCH_COL = "fake_archived_at" as unknown as Parameters<typeof deletedOnlyGuard>[0];

// ── 1 & 2. Pure helper tests (no DB needed) ────────────────────────────────────

describe("softDeleteGuard", () => {
  it("returns a SQL expression when includeDeleted is false (default)", () => {
    const result = softDeleteGuard(FAKE_COL, tenantCtx());
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("returns undefined when includeDeleted is true", () => {
    const ctx = makeRepositoryContext(tenantCtx().requestContext, { includeDeleted: true });
    expect(softDeleteGuard(FAKE_COL, ctx)).toBeUndefined();
  });
});

describe("deletedOnlyGuard", () => {
  it("always returns a SQL expression", () => {
    expect(deletedOnlyGuard(FAKE_COL)).toBeDefined();
  });
});

describe("archivedOnlyGuard", () => {
  it("always returns a SQL expression", () => {
    expect(archivedOnlyGuard(FAKE_ARCH_COL)).toBeDefined();
  });
});

describe("purgeEligibleGuard", () => {
  it("returns a SQL expression for any cutoff date", () => {
    const expr = purgeEligibleGuard(FAKE_COL, new Date("2026-01-01T00:00:00Z"));
    expect(expr).toBeDefined();
    expect(typeof expr).toBe("object");
  });
});

// ── 3-5. packageInstallationRepository soft-delete lifecycle ──────────────────

// Mutable in-memory row — beforeEach resets to a clean active state.
let fakeRow: Record<string, unknown> = {};

function makeSelectChain(rowSource: () => Record<string, unknown> | null = () => fakeRow) {
  const chain: Record<string, unknown> = {};
  chain["from"] = () => chain;
  chain["where"] = () => {
    const row = rowSource();
    return { then: (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(row ? [{ ...row }] : [])) };
  };
  return chain;
}

function makeUpdateChain(patcher: (patch: Record<string, unknown>) => void) {
  return {
    set: (patch: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          patcher(patch);
          return Promise.resolve([{ ...fakeRow }]);
        },
      }),
    }),
  };
}

function makeEmptyUpdateChain() {
  return {
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
  };
}

vi.mock("@workspace/db", () => {
  // Self-referential: db.transaction passes `db` itself as the executor so
  // that resolveExecutor() returns an object with .select(), .update() etc.
  const db: Record<string, unknown> = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain((patch) => Object.assign(fakeRow, patch))),
    delete: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([]) }) })),
  };
  db["transaction"] = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return {
    db,
    aiInstalledPackagesTable: {
      id: "id", tenantId: "tenantId", packageType: "packageType",
      packageId: "packageId", enabled: "enabled",
      deletedAt: "deletedAt", archivedAt: "archivedAt",
    },
  };
});

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const repo = await import("../packageInstallationRepository.js");

beforeEach(async () => {
  fakeRow = {
    id: 1, tenantId: "tenant-a", packageType: "tool", packageId: 10,
    enabled: true, deletedAt: null, archivedAt: null,
  };
  vi.clearAllMocks();

  // Re-set implementations after clearAllMocks (clearAllMocks resets call history
  // but also implementation — re-setup ensures each test starts with a fresh mock).
  const { db } = await import("@workspace/db");
  (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain());
  (db.update as ReturnType<typeof vi.fn>).mockImplementation(
    () => makeUpdateChain((patch) => Object.assign(fakeRow, patch)),
  );
  (db.delete as ReturnType<typeof vi.fn>).mockReturnValue({
    where: () => ({ returning: () => Promise.resolve([]) }),
  });
  (db["transaction"] as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(db),
  );
});

describe("packageInstallationRepository — soft delete lifecycle", () => {
  it("softDeleteById sets deletedAt on an active row", async () => {
    const result = await repo.softDeleteById(tenantCtx("tenant-a"), 1);
    expect(result.deletedAt).not.toBeNull();
  });

  it("softDeleteById throws RepositoryAlreadyDeletedError when already deleted", async () => {
    fakeRow.deletedAt = new Date("2026-01-01");
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain());
    await expect(repo.softDeleteById(tenantCtx("tenant-a"), 1)).rejects.toThrow(RepositoryAlreadyDeletedError);
  });

  it("softDeleteById throws RepositoryNotFoundError for a missing row", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => makeSelectChain(() => null));
    await expect(repo.softDeleteById(tenantCtx("tenant-a"), 99)).rejects.toThrow(RepositoryNotFoundError);
  });

  it("restoreById clears deletedAt and archivedAt", async () => {
    fakeRow.deletedAt = new Date("2026-01-01");
    fakeRow.archivedAt = new Date("2026-01-02");
    const result = await repo.restoreById(tenantCtx("tenant-a"), 1);
    expect(result.deletedAt).toBeNull();
    expect(result.archivedAt).toBeNull();
  });

  it("restoreById throws RepositoryNotFoundError when no row matches", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeEmptyUpdateChain());
    await expect(repo.restoreById(tenantCtx("tenant-a"), 99)).rejects.toThrow(RepositoryNotFoundError);
  });
});

describe("packageInstallationRepository — archive lifecycle", () => {
  it("archiveById sets archivedAt on an active row", async () => {
    const result = await repo.archiveById(tenantCtx("tenant-a"), 1);
    expect(result.archivedAt).not.toBeNull();
  });

  it("archiveById throws RepositoryNotFoundError when update matches nothing", async () => {
    const { db } = await import("@workspace/db");
    (db.update as ReturnType<typeof vi.fn>).mockImplementation(() => makeEmptyUpdateChain());
    await expect(repo.archiveById(tenantCtx("tenant-a"), 99)).rejects.toThrow(RepositoryNotFoundError);
  });

  it("unarchiveById clears archivedAt", async () => {
    fakeRow.archivedAt = new Date("2026-01-01");
    const result = await repo.unarchiveById(tenantCtx("tenant-a"), 1);
    expect(result.archivedAt).toBeNull();
  });
});

describe("packageInstallationRepository — tenant enforcement with soft delete", () => {
  it("softDeleteById rejects a platform-wide context (no tenantId)", async () => {
    const platformCtx = makeRepositoryContext(
      createSystemContext({
        tenantId: null, actorType: "scheduler", source: "scheduler",
        requestId: "r1", isPlatformWide: true,
      }),
    );
    await expect(repo.softDeleteById(platformCtx, 1)).rejects.toThrow(TenantContextError);
  });
});
