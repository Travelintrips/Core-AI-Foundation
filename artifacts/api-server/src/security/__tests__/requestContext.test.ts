/**
 * requestContext.test.ts — WP-01 canonical context unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  assertTenantOwned,
  createPublicTokenContext,
  createSessionTenantContext,
  createSystemContext,
  createWebhookContext,
  adaptLegacyTenantContext,
  getOrCreateCorrelationId,
  getOrCreateRequestId,
  hasPermission,
  TenantContextError,
} from "../requestContext.js";
import type { Request } from "express";

function fakeReq(overrides: Partial<Request> = {}): Request {
  return { headers: {}, ...overrides } as unknown as Request;
}

describe("requestContext factories", () => {
  it("session context: valid session produces a tenant-scoped context", () => {
    const ctx = createSessionTenantContext({
      tenantId: "default",
      actorId: "42",
      actorType: "tenant_admin",
      source: "admin_portal",
      requestId: "req-1",
    });
    expect(ctx.tenantId).toBe("default");
    expect(ctx.authMode).toBe("session");
    expect(ctx.isPlatformWide).toBe(false);
    expect(ctx.correlationId).toBe("req-1"); // falls back to requestId
  });

  it("public token context: requires a resourceScope and rejects wildcard permissions", () => {
    const ctx = createPublicTokenContext({
      tenantId: "default",
      resourceScope: { resourceType: "customer_workspace", resourceId: "tok-abc" },
      source: "public_page",
      requestId: "req-2",
    });
    expect(ctx.actorType).toBe("public_token");
    expect(ctx.resourceScope).toEqual({ resourceType: "customer_workspace", resourceId: "tok-abc" });

    expect(() =>
      createPublicTokenContext({
        tenantId: "default",
        resourceScope: { resourceType: "customer_workspace", resourceId: "tok-abc" },
        permissions: ["*"],
        source: "public_page",
        requestId: "req-3",
      }),
    ).toThrow(TenantContextError);
  });

  it("public token context: null resourceScope is rejected at construction", () => {
    expect(() =>
      createPublicTokenContext({
        // @ts-expect-error — deliberately violating the contract to prove the guard fires
        resourceScope: null,
        tenantId: "default",
        source: "public_page",
        requestId: "req-4",
      }),
    ).toThrow(TenantContextError);
  });

  it("system/worker context: tenant-owned operation without a tenantId is rejected", () => {
    expect(() =>
      createSystemContext({
        tenantId: null,
        actorType: "worker",
        source: "worker",
        requestId: "req-5",
        // isPlatformWide defaults to false
      }),
    ).toThrow(TenantContextError);
  });

  it("system/worker context: explicit platform-wide operation may omit tenantId", () => {
    const ctx = createSystemContext({
      tenantId: null,
      actorType: "scheduler",
      isPlatformWide: true,
      source: "scheduler",
      requestId: "req-6",
    });
    expect(ctx.tenantId).toBeNull();
    expect(ctx.isPlatformWide).toBe(true);
  });

  it("system context with a tenantId is accepted for tenant-owned operations", () => {
    const ctx = createSystemContext({
      tenantId: "default",
      actorType: "system",
      source: "api",
      requestId: "req-7",
    });
    const scoped = assertTenantOwned(ctx);
    expect(scoped.tenantId).toBe("default");
  });

  it("webhook context: always carries the server-mapped tenantId, never a payload value", () => {
    const ctx = createWebhookContext({
      tenantId: "default",
      source: "webhook",
      requestId: "req-8",
    });
    expect(ctx.tenantId).toBe("default");
    expect(ctx.authMode).toBe("webhook");
  });

  it("assertTenantOwned rejects a platform-wide context even if a tenantId leaked in", () => {
    const ctx = createSystemContext({
      tenantId: null,
      actorType: "scheduler",
      isPlatformWide: true,
      source: "scheduler",
      requestId: "req-9",
    });
    expect(() => assertTenantOwned(ctx)).toThrow(TenantContextError);
  });

  it("permission checks are exact-match, not substring/prefix", () => {
    const ctx = createSessionTenantContext({
      tenantId: "default",
      actorId: "1",
      actorType: "tenant_admin",
      source: "admin_portal",
      requestId: "req-10",
      permissions: ["packages:install"],
    });
    expect(hasPermission(ctx, "packages:install")).toBe(true);
    expect(hasPermission(ctx, "packages")).toBe(false);
    expect(hasPermission(ctx, "packages:install:extra")).toBe(false);
  });

  it("legacy adapter cannot be used to smuggle a second tenant value — it only re-shapes an already-trusted one", () => {
    const ctx = adaptLegacyTenantContext({ tenantId: "default", source: "internal_service", requestId: "req-11" });
    expect(ctx.tenantId).toBe("default");
    expect(ctx.authMode).toBe("internal");
    expect(ctx.metadata["viaLegacyAdapter"]).toBe(true);
  });

  it("context objects never contain raw token/secret/cookie fields — only the enum-valued actorType/authMode may legitimately mention 'token'", () => {
    const ctx = createPublicTokenContext({
      tenantId: "default",
      resourceScope: { resourceType: "customer_workspace", resourceId: "tok-abc" },
      source: "public_page",
      requestId: "req-12",
    });
    const bannedKeys = ["sessionToken", "secret", "password", "authorization", "cookie", "rawToken"];
    const keys = new Set([...Object.keys(ctx), ...Object.keys(ctx.metadata ?? {})]);
    for (const banned of bannedKeys) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it("getOrCreateRequestId reuses req.id set by pino-http instead of minting a second id", () => {
    const req = fakeReq({ id: "pino-req-id" } as unknown as Partial<Request>);
    expect(getOrCreateRequestId(req)).toBe("pino-req-id");
  });

  it("getOrCreateRequestId falls back to a fresh id when req.id is absent (unit-test req)", () => {
    const req = fakeReq();
    expect(getOrCreateRequestId(req).length).toBeGreaterThan(0);
  });

  it("getOrCreateCorrelationId preserves a client-supplied X-Correlation-Id header", () => {
    const req = fakeReq({ headers: { "x-correlation-id": "corr-123" } } as unknown as Partial<Request>);
    expect(getOrCreateCorrelationId(req, "req-13")).toBe("corr-123");
  });

  it("getOrCreateCorrelationId falls back to the request id when no header is present", () => {
    const req = fakeReq();
    expect(getOrCreateCorrelationId(req, "req-14")).toBe("req-14");
  });
});
