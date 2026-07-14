/**
 * tenantScope.test.ts — WP-02 repository-layer tenant enforcement tests.
 */
import { describe, it, expect } from "vitest";
import { createSessionTenantContext, createSystemContext } from "../../security/requestContext.js";
import { TenantContextError } from "../../security/requestContext.js";
import { requireTenantId, requirePlatformScope } from "../tenantScope.js";
import { RepositoryPlatformScopeError } from "../errors.js";
import { makeRepositoryContext } from "../types.js";

describe("requireTenantId", () => {
  it("returns the tenantId for a normal tenant-scoped context", () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "default", actorId: "1", actorType: "tenant_admin", source: "admin_portal", requestId: "r1" }),
    );
    expect(requireTenantId(ctx)).toBe("default");
  });

  it("throws when the context is platform-wide (no single tenant)", () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r2", isPlatformWide: true }),
    );
    expect(() => requireTenantId(ctx)).toThrow(TenantContextError);
  });

  it("throws when a system context somehow has no tenantId and is not platform-wide", () => {
    expect(() =>
      createSystemContext({ tenantId: null, actorType: "worker", source: "worker", requestId: "r3" }),
    ).toThrow(TenantContextError);
  });
});

describe("requirePlatformScope", () => {
  it("rejects a platform-wide call with no declared platformOperation", () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r4", isPlatformWide: true }),
    );
    expect(() => requirePlatformScope(ctx)).toThrow(RepositoryPlatformScopeError);
  });

  it("rejects a declared platformOperation from an actor that is not platform-wide/admin", () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "default", actorId: "1", actorType: "tenant_admin", source: "admin_portal", requestId: "r5" }),
      { platformOperation: { name: "sweep_all", reason: "test" } },
    );
    expect(() => requirePlatformScope(ctx)).toThrow(RepositoryPlatformScopeError);
  });

  it("allows a declared platformOperation from a platform-wide system context", () => {
    const ctx = makeRepositoryContext(
      createSystemContext({ tenantId: null, actorType: "scheduler", source: "scheduler", requestId: "r6", isPlatformWide: true }),
      { platformOperation: { name: "sweep_all", reason: "test" } },
    );
    expect(requirePlatformScope(ctx)).toEqual({ name: "sweep_all", reason: "test" });
  });

  it("allows a declared platformOperation from a platform_admin session context", () => {
    const ctx = makeRepositoryContext(
      createSessionTenantContext({ tenantId: "default", actorId: "1", actorType: "platform_admin", isPlatformAdmin: true, source: "admin_portal", requestId: "r7" }),
      { platformOperation: { name: "cross_tenant_report", reason: "test" } },
    );
    expect(requirePlatformScope(ctx)).toEqual({ name: "cross_tenant_report", reason: "test" });
  });
});
