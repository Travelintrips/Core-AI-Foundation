/**
 * auditHook.test.ts — WP-03: repository-driven audit emission derives the
 * right tenant/actor identity from RepositoryContext, redacts/diffs
 * before-after snapshots, and never throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Record<string, unknown>[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        inserted.push(v);
        return Promise.resolve();
      }),
    })),
  },
  aiAuditLogsTable: {},
}));

const { emitRepositoryAuditRecord } = await import("../auditHook.js");
const { makeRepositoryContext } = await import("../types.js");
const { createSessionTenantContext, createSystemContext } = await import("../../security/requestContext.js");

beforeEach(() => {
  inserted.length = 0;
  vi.clearAllMocks();
});

describe("emitRepositoryAuditRecord", () => {
  it("derives tenantId/actorId/actorType from the RequestContext on the RepositoryContext", async () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "tenant-a", actorId: "user-1", actorType: "tenant_admin", source: "admin_portal", requestId: "req-1" }),
    );
    await emitRepositoryAuditRecord(ctx, {
      module: "marketplace",
      operation: "create",
      action: "package_installed",
      resourceType: "installed_package",
      resourceId: 7,
      after: { id: 7, installedVersion: "1.0.0" },
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      module: "marketplace",
      action: "package_installed",
      resourceType: "installed_package",
      resourceId: "7",
      tenantId: "tenant-a",
      actorId: "user-1",
      actorType: "internal_user",
    });
  });

  it("includes a redacted before/after diff for updates", async () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "tenant-a", actorId: "user-1", actorType: "tenant_admin", source: "admin_portal", requestId: "req-2" }),
    );
    await emitRepositoryAuditRecord(ctx, {
      module: "marketplace",
      operation: "update",
      action: "package_updated",
      resourceType: "installed_package",
      resourceId: 7,
      before: { enabled: true, apiKey: "old-secret" },
      after: { enabled: false, apiKey: "old-secret" },
    });

    const details = inserted[0].details as { diff?: { before: Record<string, unknown>; after: Record<string, unknown> } };
    expect(details.diff).toEqual({ before: { enabled: true }, after: { enabled: false } });
    expect(JSON.stringify(details)).not.toContain("old-secret");
  });

  it("forwards auditMetadata as details.meta", async () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "tenant-a", actorId: "user-1", actorType: "tenant_admin", source: "admin_portal", requestId: "req-3" }),
      { auditMetadata: { source: "admin-console" } },
    );
    await emitRepositoryAuditRecord(ctx, {
      module: "marketplace",
      operation: "delete",
      action: "package_removed",
      resourceType: "installed_package",
      resourceId: 7,
      before: { id: 7 },
    });
    const details = inserted[0].details as { meta?: Record<string, unknown> };
    expect(details.meta).toEqual({ source: "admin-console" });
  });

  it("derives a null tenantId for platform-wide system contexts, and never throws", async () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "req-4", isPlatformWide: true }),
    );
    await expect(
      emitRepositoryAuditRecord(ctx, {
        module: "worker-cluster",
        operation: "update",
        action: "stale_job_recovered",
        resourceType: "ai_job",
        resourceId: 1,
      }),
    ).resolves.toBeUndefined();
    expect(inserted[0]).toMatchObject({ tenantId: null, actorType: "system" });
  });
});
