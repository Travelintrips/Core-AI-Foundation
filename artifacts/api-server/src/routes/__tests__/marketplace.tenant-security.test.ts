/**
 * marketplace.tenant-security.test.ts — WP-00 regression + security tests
 * for the tenant-spoofing vulnerability in routes/marketplace.ts.
 *
 * Exercises the real router over HTTP (no supertest dependency — a plain
 * http.Server + fetch) so the tests assert observable behavior: status
 * codes and response bodies, not internal function calls. `req.internalUser`
 * is set by a tiny stand-in middleware to simulate what
 * adminAuthWithExceptions + the session lookup already establish in
 * production before marketplace.ts ever runs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../services/packageManagerService.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/packageManagerService.js")>();
  return {
    ...actual,
    install: vi.fn(async (tenantId: string) => ({ id: 1, tenantId, packageType: "tool", packageId: 1, enabled: true })),
    upgrade: vi.fn(async (tenantId: string) => ({ id: 1, tenantId, packageType: "tool", packageId: 1, installedVersion: "2.0.0" })),
    enable: vi.fn(async (tenantId: string) => ({ id: 1, tenantId, packageType: "tool", packageId: 1, enabled: true })),
    disable: vi.fn(async (tenantId: string) => ({ id: 1, tenantId, packageType: "tool", packageId: 1, enabled: false })),
    uninstall: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ id: 1, healthStatus: "healthy" })),
  };
});

function makeChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  chain["from"] = noop;
  chain["where"] = noop;
  chain["orderBy"] = noop;
  chain["limit"] = noop;
  chain["then"] = (resolve: (v: unknown[]) => void) => Promise.resolve(resolve(result));
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeChain([])),
  },
  aiSkillPackagesTable: { id: "id", category: "category", skillName: "skillName" },
  aiToolPackagesTable: { id: "id", category: "category", toolName: "toolName", healthStatus: "healthStatus", version: "version" },
  aiInstalledPackagesTable: {
    id: "id",
    tenantId: "tenantId",
    packageType: "packageType",
    packageId: "packageId",
    enabled: "enabled",
  },
}));

const { default: marketplaceRouter } = await import("../marketplace.js");
const { install, upgrade } = await import("../../services/packageManagerService.js");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand-in for adminAuthWithExceptions + session lookup: tests toggle
  // req.internalUser via the x-test-internal-user header.
  app.use((req, _res, next) => {
    const raw = req.header("x-test-internal-user");
    if (raw) (req as unknown as { internalUser: unknown }).internalUser = JSON.parse(raw);
    next();
  });
  app.use(marketplaceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
});

const asInternalUser = (role = "manager") => ({ "x-test-internal-user": JSON.stringify({ id: 1, role }) });

describe("marketplace tenant spoofing — WP-00", () => {
  it("happy path: an authenticated request that sends the correct tenantId still works", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asInternalUser() },
      body: JSON.stringify({ tenantId: "default", packageType: "tool", packageId: 1 }),
    });
    expect(res.status).toBe(201);
    expect(install).toHaveBeenCalledWith("default", "tool", 1, {});
  });

  it("an authenticated Tenant A session cannot install into Tenant B by changing body.tenantId", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asInternalUser() },
      body: JSON.stringify({ tenantId: "tenant-b", packageType: "tool", packageId: 1 }),
    });
    expect(res.status).toBe(403);
    expect(install).not.toHaveBeenCalled();
  });

  it("PATCH .../upgrade: a spoofed body.tenantId is rejected, not forwarded to the service layer", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/tool/1/upgrade`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...asInternalUser() },
      body: JSON.stringify({ tenantId: "tenant-b" }),
    });
    expect(res.status).toBe(403);
    expect(upgrade).not.toHaveBeenCalled();
  });

  it("PATCH .../upgrade: matching tenantId in the body still works (regression: existing clients unaffected)", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/tool/1/upgrade`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...asInternalUser() },
      body: JSON.stringify({ tenantId: "default" }),
    });
    expect(res.status).toBe(200);
    expect(upgrade).toHaveBeenCalledWith("default", "tool", 1);
  });

  it("DELETE .../:id: a spoofed query-string tenantId cannot be used to uninstall another tenant's package", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/tool/1?tenantId=tenant-b`, {
      method: "DELETE",
      headers: { ...asInternalUser() },
    });
    expect(res.status).toBe(403);
  });

  it("GET /installed: an arbitrary x-tenant-id header is never trusted on this route", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/installed`, {
      headers: { ...asInternalUser(), "x-tenant-id": "tenant-b" },
    });
    // No query tenantId supplied → zod default "default" == resolved tenant → allowed.
    expect(res.status).toBe(200);
  });

  it("no session at all (internal/system path) still resolves a concrete tenant and serves the request", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/installed`);
    expect(res.status).toBe(200);
  });

  it("mismatch response never reveals the resolved tenant id or internal details in the body", async () => {
    const res = await fetch(`${baseUrl}/ai/marketplace/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...asInternalUser() },
      body: JSON.stringify({ tenantId: "tenant-b", packageType: "tool", packageId: 1 }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "Forbidden" });
  });
});
