/**
 * repositories/__tests__/quotationRepository.test.ts
 *
 * WP-08/09/10 unit tests for the Quotation repository.
 *
 * Uses vi.hoisted() for mock functions so they can be referenced inside
 * vi.mock() factory closures (factories are hoisted before variable assignments).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DbExecutor, RepositoryContext } from "../types.js";

// ── Hoisted mocks (available inside vi.mock factories) ────────────────────────

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    transaction: mocks.transaction,
  },
  aiQuotationsTable: {
    id: "id",
    tenantId: "tenantId",
    deletedAt: "deletedAt",
    deletedBy: "deletedBy",
    quotationCode: "quotationCode",
    serviceRequestId: "serviceRequestId",
    status: "status",
  },
  aiQuotationItemsTable: {
    quotationId: "quotationId",
    deletedAt: "deletedAt",
    deletedBy: "deletedBy",
  },
  creativeProjectQuotationsTable: {
    projectId: "projectId",
    status: "status",
    deletedAt: "deletedAt",
    deletedBy: "deletedBy",
  },
  AI_QUOTATION_TERMINAL_STATES: new Set(["approved", "rejected", "cancelled", "expired"]),
}));

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: mocks.logAudit,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  getCanonicalQuotationById,
  createCanonicalQuotation,
  updateCanonicalQuotation,
  softDeleteCanonicalQuotation,
  restoreCanonicalQuotation,
  getLegacyQuotationByProjectId,
  withTransaction,
} from "../quotationRepository.js";
import { makeRepositoryContext } from "../types.js";
import { createSessionTenantContext } from "../../security/requestContext.js";
import {
  RepositoryNotFoundError,
  RepositoryAlreadyDeletedError,
} from "../errors.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeCtx(
  overrides: {
    includeDeleted?: boolean;
    actorType?: Parameters<typeof createSessionTenantContext>[0]["actorType"];
  } = {},
): RepositoryContext {
  const rc = createSessionTenantContext({
    tenantId: "tenant-001",
    actorId: "user-99",
    actorType: overrides.actorType ?? "tenant_admin",
    requestId: "req-test-1",
    source: "admin_portal",
  });
  return makeRepositoryContext(rc, { includeDeleted: overrides.includeDeleted });
}

/** Stub quotation row matching AiQuotation shape (all relevant fields). */
function makeQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tenantId: "tenant-001",
    quotationCode: "QT-2026-001",
    serviceRequestId: 5,
    customerName: "Acme Corp",
    customerEmail: "acme@example.com",
    currency: "IDR",
    subtotal: 1_000_000,
    discount: 0,
    tax: 110_000,
    total: 1_110_000,
    pricingSnapshotJson: null,
    scopeSnapshotJson: null,
    termsSnapshotJson: null,
    validUntil: null,
    status: "draft",
    reviewTokenHash: null,
    reviewTokenExpiresAt: null,
    issuedAt: null,
    viewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    revisionRequestedAt: null,
    revisionNotes: null,
    deletedAt: null as Date | null,
    deletedBy: null as string | null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

/** Set up mock db.select() to return the given rows. */
function selectReturning(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(rows),
  };
  mocks.select.mockReturnValue(chain);
  return chain;
}

/** Set up mock db.insert() to return the given rows via .returning(). */
function insertReturning(rows: unknown[]) {
  mocks.insert.mockReturnValue({
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  });
}

/** Set up mock db.update() to return the given rows via .returning(). */
function updateReturning(rows: unknown[]) {
  mocks.update.mockReturnValue({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── WP-09: soft-delete filtering in canonical reads ───────────────────────────

describe("getCanonicalQuotationById — WP-09 soft-delete filter", () => {
  it("returns the row when tenantId matches and row is not deleted", async () => {
    const q = makeQuotation();
    selectReturning([q]);
    const result = await getCanonicalQuotationById(makeCtx(), 1);
    expect(result).toEqual(q);
  });

  it("returns undefined for a different tenant's row (tenant mismatch)", async () => {
    const q = makeQuotation({ tenantId: "tenant-OTHER" });
    selectReturning([q]);
    const result = await getCanonicalQuotationById(makeCtx(), 1);
    expect(result).toBeUndefined();
  });

  it("returns undefined when row not found", async () => {
    selectReturning([]);
    const result = await getCanonicalQuotationById(makeCtx(), 999);
    expect(result).toBeUndefined();
  });

  it("includes deleted rows when ctx.includeDeleted is true", async () => {
    const q = makeQuotation({ deletedAt: new Date("2026-07-05T00:00:00Z") });
    selectReturning([q]);
    const result = await getCanonicalQuotationById(makeCtx({ includeDeleted: true }), 1);
    expect(result).toEqual(q);
    expect(result?.deletedAt).toBeInstanceOf(Date);
  });
});

// ── WP-09: soft-delete filtering in legacy reads ──────────────────────────────

describe("getLegacyQuotationByProjectId — WP-09 soft-delete filter", () => {
  it("returns undefined when no row found", async () => {
    selectReturning([]);
    const result = await getLegacyQuotationByProjectId(makeCtx(), "proj-abc");
    expect(result).toBeUndefined();
  });

  it("returns the legacy row when not deleted", async () => {
    const row = { id: 10, projectId: "proj-abc", status: "sent", total: 500, deletedAt: null };
    selectReturning([row]);
    const result = await getLegacyQuotationByProjectId(makeCtx(), "proj-abc");
    expect(result).toEqual(row);
  });
});

// ── WP-08: createCanonicalQuotation ──────────────────────────────────────────

describe("createCanonicalQuotation — WP-08 audit emission", () => {
  it("inserts a new row and fires logAudit once", async () => {
    const newRow = makeQuotation();
    insertReturning([newRow]);

    const result = await createCanonicalQuotation(makeCtx(), {
      quotationCode: "QT-2026-001",
      serviceRequestId: 5,
      customerName: "Acme Corp",
      customerEmail: "acme@example.com",
      currency: "IDR",
    });

    expect(result.id).toBe(1);
    expect(mocks.insert).toHaveBeenCalledOnce();
    // logAudit is fire-and-forget (void), let microtasks drain
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    const [module, action] = mocks.logAudit.mock.calls[0] as [string, string];
    expect(module).toBe("ai-quotation");
    expect(action).toBe("quotation_created");
  });
});

// ── WP-08: updateCanonicalQuotation ──────────────────────────────────────────

describe("updateCanonicalQuotation — WP-08 audit emission", () => {
  it("patches the row and fires logAudit once", async () => {
    const existing = makeQuotation();
    const updated = makeQuotation({ status: "issued" });
    selectReturning([existing]);
    updateReturning([updated]);

    const result = await updateCanonicalQuotation(makeCtx(), 1, { status: "issued" });
    expect(result.status).toBe("issued");
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect((mocks.logAudit.mock.calls[0] as string[])[1]).toBe("quotation_updated");
  });

  it("throws RepositoryNotFoundError when row not found", async () => {
    selectReturning([]);
    await expect(updateCanonicalQuotation(makeCtx(), 999, { status: "issued" })).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    );
  });
});

// ── WP-09/10: softDeleteCanonicalQuotation ────────────────────────────────────

describe("softDeleteCanonicalQuotation — WP-09/10 cascade + audit", () => {
  it("throws RepositoryNotFoundError when row does not exist", async () => {
    selectReturning([]);
    await expect(softDeleteCanonicalQuotation(makeCtx(), 999)).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    );
  });

  it("throws RepositoryAlreadyDeletedError when already deleted", async () => {
    const deleted = makeQuotation({ deletedAt: new Date() });
    selectReturning([deleted]);
    await expect(softDeleteCanonicalQuotation(makeCtx(), 1)).rejects.toBeInstanceOf(
      RepositoryAlreadyDeletedError,
    );
  });

  it("runs cascade in a transaction and fires logAudit", async () => {
    const existing = makeQuotation(); // deletedAt: null
    selectReturning([existing]);

    // Simulate db.transaction calling fn with a fake tx executor
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const fakeTx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([]),
        }),
      };
      await fn(fakeTx);
    });

    await softDeleteCanonicalQuotation(makeCtx(), 1);

    expect(mocks.transaction).toHaveBeenCalledOnce();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect((mocks.logAudit.mock.calls[0] as string[])[1]).toBe("quotation_soft_deleted");
  });
});

// ── WP-10: restoreCanonicalQuotation ─────────────────────────────────────────

describe("restoreCanonicalQuotation — WP-10 role gate + audit", () => {
  it("throws when actor is not an elevated role (customer)", async () => {
    // "customer" is not in the elevated set (tenant_admin, platform_admin, system, worker, scheduler)
    const rc = createSessionTenantContext({
      tenantId: "tenant-001",
      actorId: "cust-1",
      actorType: "customer",
      requestId: "r1",
      source: "customer_portal",
    });
    const ctx = makeRepositoryContext(rc);
    await expect(restoreCanonicalQuotation(ctx, 1)).rejects.toThrow(/not permitted to restore/);
  });

  it("throws RepositoryNotFoundError when row not found for elevated actor", async () => {
    selectReturning([]);
    await expect(
      restoreCanonicalQuotation(makeCtx({ actorType: "platform_admin" }), 999),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });

  it("throws when row is not currently deleted", async () => {
    const existing = makeQuotation({ deletedAt: null });
    selectReturning([existing]);
    await expect(
      restoreCanonicalQuotation(makeCtx({ actorType: "platform_admin" }), 1),
    ).rejects.toThrow(/not soft-deleted/);
  });

  it("clears deleted_at and fires logAudit for elevated actor", async () => {
    const deleted = makeQuotation({ deletedAt: new Date("2026-07-10T00:00:00Z") });
    const restored = makeQuotation({ deletedAt: null, deletedBy: null });
    selectReturning([deleted]);
    updateReturning([restored]);

    const result = await restoreCanonicalQuotation(makeCtx({ actorType: "platform_admin" }), 1);
    expect(result.deletedAt).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.logAudit).toHaveBeenCalledOnce();
    expect((mocks.logAudit.mock.calls[0] as string[])[1]).toBe("quotation_restored");
  });
});

// ── withTransaction: no nested transactions ───────────────────────────────────

describe("withTransaction — no nested db.transaction", () => {
  it("reuses existing executor when ctx already carries one", async () => {
    const fakeExecutor = { select: vi.fn() } as unknown as DbExecutor;
    const rc = createSessionTenantContext({
      tenantId: "t1",
      actorId: "u1",
      actorType: "tenant_admin",
      requestId: "r1",
      source: "admin_portal",
    });
    const baseCtx = makeRepositoryContext(rc);
    const ctx: RepositoryContext = { ...baseCtx, executor: fakeExecutor };

    let capturedCtx: RepositoryContext | undefined;
    await withTransaction(ctx, async (txCtx) => { capturedCtx = txCtx; });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(capturedCtx?.executor).toBe(fakeExecutor);
  });

  it("opens db.transaction when no executor is on ctx", async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}));
    await withTransaction(makeCtx(), async () => {});
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });
});
