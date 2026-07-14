/**
 * tenantResolution.test.ts — WP-00 baseline security regression tests.
 *
 * These assert OBSERVABLE behavior (what tenant gets used, what gets
 * rejected, what gets logged) rather than internal implementation details.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request } from "express";

vi.mock("../../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../../lib/logger.js";
import {
  DEFAULT_TENANT_ID,
  TenantMismatchError,
  assertClientTenantNotSpoofed,
  resolveAuthenticatedTenantContext,
  resolvePublicRequestTenantId,
} from "../tenantResolution.js";

function fakeReq(overrides: Record<string, unknown> = {}): Request {
  return { headers: {}, ...overrides } as unknown as Request;
}

describe("resolveAuthenticatedTenantContext", () => {
  it("Tenant A session cannot be redirected to another tenant by changing req.body.tenantId — tenant always resolves to the server-known tenant", () => {
    const req = fakeReq({ internalUser: { id: 7, role: "manager" }, body: { tenantId: "tenant-b" } });
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(ctx.actorType).toBe("tenant_admin");
  });

  it("a query-string tenantId cannot change the resolved tenant either", () => {
    const req = fakeReq({ internalUser: { id: 7, role: "manager" }, query: { tenantId: "tenant-b" } });
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("an arbitrary x-tenant-id header is never consulted", () => {
    const req = fakeReq({
      internalUser: { id: 7, role: "manager" },
      headers: { "x-tenant-id": "tenant-b" },
    });
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("owner/admin roles resolve to platform_admin actor type but do not change the tenant", () => {
    const req = fakeReq({ internalUser: { id: 1, role: "owner" } });
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.isPlatformAdmin).toBe(true);
    expect(ctx.actorType).toBe("platform_admin");
    expect(ctx.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("no session (ADMIN_API_KEY / internal path) still resolves a concrete tenant, never null, for a tenant-owned route", () => {
    const req = fakeReq();
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(ctx.actorType).toBe("system");
    expect(ctx.authMode).toBe("system");
  });

  it("request id is preserved from an existing req.id (pino-http) rather than minted twice", () => {
    const req = fakeReq({ id: "pino-id-99" });
    const ctx = resolveAuthenticatedTenantContext(req);
    expect(ctx.requestId).toBe("pino-id-99");
  });
});

describe("assertClientTenantNotSpoofed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a matching client-supplied tenantId is a no-op (existing happy path keeps working)", () => {
    const req = fakeReq();
    expect(() => assertClientTenantNotSpoofed("default", "default", req, "TEST")).not.toThrow();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("an absent client tenantId is a no-op", () => {
    const req = fakeReq();
    expect(() => assertClientTenantNotSpoofed(undefined, "default", req, "TEST")).not.toThrow();
    expect(() => assertClientTenantNotSpoofed("", "default", req, "TEST")).not.toThrow();
  });

  it("Tenant A's request cannot claim to be Tenant B by sending a different tenantId — it is rejected", () => {
    const req = fakeReq();
    expect(() => assertClientTenantNotSpoofed("tenant-b", "default", req, "TEST")).toThrow(TenantMismatchError);
  });

  it("mismatch is logged with a structured, secret-free event and no raw token/body", () => {
    const req = fakeReq({ headers: { authorization: "Bearer super-secret-token" } });
    try {
      assertClientTenantNotSpoofed("tenant-b", "default", req, "PATCH /ai/marketplace/:packageType/:id/upgrade");
    } catch {
      // expected
    }
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload] = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [Record<string, unknown>, string];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toMatch(/authorization/i);
    expect(payload["event"]).toBe("tenant_mismatch_blocked");
    expect(payload["resolvedTenantId"]).toBe("default");
  });

  it("does not throw when the logger itself fails — logging failure must never break the request", () => {
    (logger.warn as unknown as { mockImplementation: (fn: () => void) => void }).mockImplementation(() => {
      throw new Error("logger down");
    });
    const req = fakeReq();
    // The mismatch itself should still be signaled via TenantMismatchError,
    // not swallowed by (or replaced with) a logging failure.
    expect(() => assertClientTenantNotSpoofed("tenant-b", "default", req, "TEST")).toThrow(TenantMismatchError);
  });
});

describe("resolvePublicRequestTenantId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a public route ignores a client-supplied tenantId and always returns the canonical value", () => {
    const req = fakeReq();
    const result = resolvePublicRequestTenantId("attacker-supplied-tenant", req, "TEST", null);
    expect(result).toBeNull();
  });

  it("logs (but never throws) when a public route receives a divergent tenantId", () => {
    const req = fakeReq();
    expect(() => resolvePublicRequestTenantId("attacker-supplied-tenant", req, "TEST", null)).not.toThrow();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("does not log when no tenantId was supplied at all", () => {
    const req = fakeReq();
    resolvePublicRequestTenantId(undefined, req, "TEST", null);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
