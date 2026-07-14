/**
 * packageInstallationRepository.audit.test.ts — WP-03/WP-08: every write on
 * the pilot domain (Marketplace Installation) emits exactly one audit
 * record via the repository audit hook, with no manual logAudit call added
 * at the packageManagerService.ts call site. Read methods must never emit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionTenantContext } from "../../security/requestContext.js";
import { makeRepositoryContext } from "../types.js";

const emitRepositoryAuditRecord = vi.fn().mockResolvedValue(undefined);
vi.mock("../auditHook.js", () => ({ emitRepositoryAuditRecord }));

let existingRow: Record<string, unknown> | undefined;

function makeSelectChain() {
  const chain: Record<string, unknown> = {};
  chain["from"] = () => chain;
  chain["where"] = () => Promise.resolve(existingRow ? [existingRow] : []);
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 99, tenantId: "tenant-a", packageType: "tool", packageId: 10, installedVersion: "1.0.0", enabled: true }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ id: 99, tenantId: "tenant-a", packageType: "tool", packageId: 10, installedVersion: "2.0.0", enabled: true }])),
        })),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn("fake-tx")),
  },
  aiInstalledPackagesTable: { id: "id", tenantId: "tenantId", packageType: "packageType", packageId: "packageId", enabled: "enabled" },
}));

const repo = await import("../packageInstallationRepository.js");

function ctxFor(tenantId: string) {
  return makeRepositoryContext(
    createSessionTenantContext({ tenantId, actorId: "1", actorType: "tenant_admin", source: "admin_portal", requestId: `req-${tenantId}` }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  existingRow = undefined;
});

describe("packageInstallationRepository — WP-08 auto audit emission", () => {
  it("insertInstallation emits exactly one 'create' audit record", async () => {
    const ctx = ctxFor("tenant-a");
    await repo.insertInstallation(ctx, { packageType: "tool", packageId: 10, installedVersion: "1.0.0", configurationJson: {} });
    expect(emitRepositoryAuditRecord).toHaveBeenCalledTimes(1);
    expect(emitRepositoryAuditRecord).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ operation: "create", module: "marketplace", resourceType: "installed_package", resourceId: 99 }),
    );
  });

  it("updateInstallationById emits exactly one 'update' audit record with before/after", async () => {
    existingRow = { id: 99, tenantId: "tenant-a", packageType: "tool", packageId: 10, installedVersion: "1.0.0", enabled: true };
    const ctx = ctxFor("tenant-a");
    await repo.updateInstallationById(ctx, 99, { installedVersion: "2.0.0" });
    expect(emitRepositoryAuditRecord).toHaveBeenCalledTimes(1);
    expect(emitRepositoryAuditRecord).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ operation: "update", resourceId: 99, before: expect.objectContaining({ installedVersion: "1.0.0" }) }),
    );
  });

  it("deleteInstallationById emits exactly one 'delete' audit record with the pre-delete snapshot", async () => {
    existingRow = { id: 99, tenantId: "tenant-a", packageType: "tool", packageId: 10, installedVersion: "1.0.0", enabled: true };
    const ctx = ctxFor("tenant-a");
    await repo.deleteInstallationById(ctx, 99);
    expect(emitRepositoryAuditRecord).toHaveBeenCalledTimes(1);
    expect(emitRepositoryAuditRecord).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ operation: "delete", resourceId: 99, before: expect.objectContaining({ installedVersion: "1.0.0" }) }),
    );
  });

  it("deleteInstallationById skips audit emission if the row never existed (nothing to attribute)", async () => {
    existingRow = undefined;
    const ctx = ctxFor("tenant-a");
    await repo.deleteInstallationById(ctx, 404);
    expect(emitRepositoryAuditRecord).not.toHaveBeenCalled();
  });

  it("read-only methods (findInstallation, listInstalled) never emit an audit record", async () => {
    existingRow = { id: 99, tenantId: "tenant-a", packageType: "tool", packageId: 10, enabled: true };
    const ctx = ctxFor("tenant-a");
    await repo.findInstallation(ctx, "tool", 10);
    await repo.listInstalled(ctx, "tool");
    expect(emitRepositoryAuditRecord).not.toHaveBeenCalled();
  });
});
