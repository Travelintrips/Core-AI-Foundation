/**
 * aiAuditService.test.ts — WP-03: backward compatibility (legacy positional
 * call sites keep working unmodified), the new object-calling convention,
 * tenant/actor context propagation, and the immutability guards.
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

const { logAudit, updateAuditLog, deleteAuditLog, AuditLogImmutableError } = await import("../aiAuditService.js");

beforeEach(() => {
  inserted.length = 0;
  vi.clearAllMocks();
});

describe("logAudit — legacy positional call sites", () => {
  it("keeps working with only the original 4 required args", async () => {
    await logAudit("agents", "create_agent", "42", "ai_agent");
    expect(inserted[0]).toMatchObject({
      module: "agents",
      action: "create_agent",
      resourceId: "42",
      resourceType: "ai_agent",
      status: "success",
      tenantId: null,
      actorId: null,
      actorType: null,
    });
  });

  it("keeps working with status + details, still no tenant context", async () => {
    await logAudit("worker-cluster", "lease_expired", "5", "ai_worker", "failure", { reason: "timeout" });
    expect(inserted[0]).toMatchObject({
      module: "worker-cluster",
      action: "lease_expired",
      status: "failure",
      details: { reason: "timeout" },
      tenantId: null,
    });
  });

  it("accepts the new optional 7th context argument without breaking the positional shape", async () => {
    await logAudit("marketplace", "package_installed", "10", "tool", "success", { version: "1.0.0" }, {
      tenantId: "tenant-a",
      actorId: "user-1",
      actorType: "internal_user",
    });
    expect(inserted[0]).toMatchObject({
      tenantId: "tenant-a",
      actorId: "user-1",
      actorType: "internal_user",
    });
  });
});

describe("logAudit — object-style call sites (assetIntelligenceService, creativeBrandIntelligenceService, brand-intelligence)", () => {
  it("accepts entityType/entityId aliases and defaults module from resourceType", async () => {
    await logAudit({ action: "brand_dna_analyzed", entityType: "brand_dna", entityId: "client-1", details: { score: 90 } });
    expect(inserted[0]).toMatchObject({
      module: "brand_dna",
      action: "brand_dna_analyzed",
      resourceType: "brand_dna",
      resourceId: "client-1",
      details: { score: 90 },
    });
  });
});

describe("logAudit — failure isolation", () => {
  it("never throws even if the underlying insert rejects", async () => {
    const { db } = (await import("@workspace/db")) as unknown as { db: { insert: ReturnType<typeof vi.fn> } };
    db.insert.mockImplementationOnce(() => ({ values: () => Promise.reject(new Error("db down")) }));
    await expect(logAudit("x", "y", "1", "z")).resolves.toBeUndefined();
  });
});

describe("audit log immutability", () => {
  it("updateAuditLog always throws AuditLogImmutableError", () => {
    expect(() => updateAuditLog()).toThrow(AuditLogImmutableError);
  });

  it("deleteAuditLog always throws AuditLogImmutableError", () => {
    expect(() => deleteAuditLog()).toThrow(AuditLogImmutableError);
  });
});
