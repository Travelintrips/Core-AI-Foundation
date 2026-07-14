/**
 * packageInstallationRepository.test.ts — WP-02 pilot repository tests:
 * tenant isolation, platform-scope rejection, and transaction wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionTenantContext, createSystemContext } from "../../security/requestContext.js";
import { TenantContextError } from "../../security/requestContext.js";
import { makeRepositoryContext } from "../types.js";

const rows: Record<string, unknown>[] = [
  { id: 1, tenantId: "tenant-a", packageType: "tool", packageId: 10, enabled: true },
  { id: 2, tenantId: "tenant-b", packageType: "tool", packageId: 10, enabled: true },
];

function makeSelectChain(filterFn: (r: Record<string, unknown>) => boolean) {
  const chain: Record<string, unknown> = {};
  chain["from"] = () => chain;
  chain["where"] = () => {
    const result = rows.filter(filterFn);
    return { ...chain, then: (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(result)) };
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain(() => true)),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn("fake-tx")),
  },
  aiInstalledPackagesTable: { id: "id", tenantId: "tenantId", packageType: "packageType", packageId: "packageId", enabled: "enabled" },
}));

const repo = await import("../packageInstallationRepository.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function ctxFor(tenantId: string) {
  return makeRepositoryContext(
    createSessionTenantContext({ tenantId, actorId: "1", actorType: "tenant_admin", source: "admin_portal", requestId: `req-${tenantId}` }),
  );
}

describe("packageInstallationRepository — tenant enforcement", () => {
  it("requires a tenantId on the context before querying", async () => {
    const platformWideCtx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r1", isPlatformWide: true }),
    );
    await expect(repo.listInstalled(platformWideCtx, "tool")).rejects.toThrow(TenantContextError);
  });

  it("never leaks another tenant's installation row through findInstallation", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() =>
      makeSelectChain((r) => r.tenantId === "tenant-a" && r.packageType === "tool" && r.packageId === 10),
    );
    const found = await repo.findInstallation(ctxFor("tenant-a"), "tool", 10);
    expect(found?.id).toBe(1);

    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() =>
      makeSelectChain((r) => r.tenantId === "tenant-c" && r.packageType === "tool" && r.packageId === 10),
    );
    const notFound = await repo.findInstallation(ctxFor("tenant-c"), "tool", 10);
    expect(notFound).toBeUndefined();
  });
});

describe("packageInstallationRepository — withTransaction", () => {
  it("uses db.transaction and binds the callback's tx as the executor", async () => {
    const { db } = await import("@workspace/db");
    const ctx = ctxFor("tenant-a");
    const seenExecutors: unknown[] = [];
    await repo.withTransaction(ctx, async (txCtx) => {
      seenExecutors.push(txCtx.executor);
      return null;
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(seenExecutors[0]).toBe("fake-tx");
  });

  it("does not open a second nested transaction if the context already has an executor", async () => {
    const { db } = await import("@workspace/db");
    const ctx = makeRepositoryContext(ctxFor("tenant-a").requestContext, { executor: "already-in-tx" as never });
    await repo.withTransaction(ctx, async (txCtx) => {
      expect(txCtx.executor).toBe("already-in-tx");
      return null;
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
