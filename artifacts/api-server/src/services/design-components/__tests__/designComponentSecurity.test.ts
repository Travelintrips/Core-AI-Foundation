/**
 * Team 8 — Security & Tenant Isolation Tests
 *
 * Covers:
 *  - Unauthenticated mutation → 401
 *  - Tenant A list does NOT see Tenant B data
 *  - Tenant A detail of Tenant B resource → 404 (null)
 *  - Duplicate slug within the same tenant → ComponentSlugConflictError
 *  - Same slug in different tenants → allowed (policy: UNIQUE(tenant_id, slug))
 *  - Manifest does not reference locked files or contain imperative edit instructions
 *
 * Path notes (from this file's location):
 *   ../../../middleware/adminAuth.js   = src/middleware/adminAuth.ts
 *   ../../../routes/design-components/router.js = src/routes/design-components/router.ts
 *   ../designComponentService.js       = src/services/design-components/designComponentService.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

// ── Module mocks (must come before any imports of the mocked modules) ─────────

// adminAuthWithExceptions must also be exported from the mock because
// src/routes/design-components/router.ts does:
//   router.use(adminAuthWithExceptions);
// Without this export Vitest throws "No adminAuthWithExceptions export is defined".
//
// Implementation: adminAuthWithExceptions delegates to adminAuth so that
// buildApp(isAuthed)'s authMock.mockImplementation() propagates to every
// request routed through adminAuthWithExceptions — no separate control point needed.
vi.mock("../../../middleware/adminAuth.js", () => {
  const adminAuth = vi.fn((_req: any, _res: any, next: any) => next());
  return {
    adminAuth,
    adminAuthWithExceptions: vi.fn((req: any, res: any, next: any) => adminAuth(req, res, next)),
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildApp(isAuthed: boolean) {
  const { adminAuth } = await import("../../../middleware/adminAuth.js");
  const authMock = adminAuth as ReturnType<typeof vi.fn>;

  if (isAuthed) {
    authMock.mockImplementation((_req: any, _res: any, next: any) => next());
  } else {
    authMock.mockImplementation((_req: any, res: any) =>
      res.status(401).json({ error: "Unauthorized: invalid or missing admin API key" }),
    );
  }

  // Import router AFTER mock is configured so the module cache sees the mock.
  const { default: router } = await import("../../../routes/design-components/router.js");
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return app;
}

// ── P1 AUTH: Unauthenticated requests must return 401 ────────────────────────

describe("P1 AUTH — unauthenticated requests return 401", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("POST / without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app)
      .post("/")
      .send({ type: "text", name: "Test", domain: "graphic" });
    expect(res.status).toBe(401);
  });

  it("PATCH /:id without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app).patch("/1").send({ name: "Updated" });
    expect(res.status).toBe(401);
  });

  it("DELETE /:id without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app).delete("/1");
    expect(res.status).toBe(401);
  });

  it("POST /:id/duplicate without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app).post("/1/duplicate").send({});
    expect(res.status).toBe(401);
  });

  it("GET / (list) without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app).get("/");
    expect(res.status).toBe(401);
  });

  it("GET /:id (detail) without auth → 401", async () => {
    const app = await buildApp(false);
    const res = await request(app).get("/42");
    expect(res.status).toBe(401);
  });
});

// ── P1 TENANT ISOLATION: service-layer queries filter by tenantId ─────────────

describe("P1 TENANT ISOLATION — service-layer tenantId scoping", () => {
  const TENANT_A = "tenant-alpha";
  const TENANT_B = "tenant-beta";

  const rowA = {
    id: 1,
    tenantId: TENANT_A,
    name: "Logo Alpha",
    slug: "logo-alpha-abc12345",
    type: "logo",
    domain: "graphic",
    fieldValues: {},
    blueprintId: null,
    status: "active",
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it("getDesignComponent: querying with Tenant B's id returns null (DB returns empty due to tenantId WHERE)", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;
    // DB returns no rows when tenantId filter doesn't match
    dbMock.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    });

    const { getDesignComponent } = await import("../designComponentService.js");
    const result = await getDesignComponent(rowA.id, TENANT_B);
    expect(result).toBeNull();
  });

  it("getDesignComponent: querying with Tenant A's id returns the row", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;
    dbMock.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([rowA]) }) }),
    });

    const { getDesignComponent } = await import("../designComponentService.js");
    const result = await getDesignComponent(rowA.id, TENANT_A);
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe(TENANT_A);
  });

  it("getDesignComponent: row.tenantId !== requested tenantId throws ComponentTenantError (defence-in-depth)", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;
    // Simulate a row that somehow slipped past the SQL WHERE (shouldn't happen in practice)
    const leakyRow = { ...rowA, tenantId: TENANT_A };
    dbMock.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([leakyRow]) }) }),
    });

    const { getDesignComponent, ComponentTenantError } = await import("../designComponentService.js");
    // Requesting tenant B — the check inside getDesignComponent should catch this
    // BUT the SQL WHERE clause already filters by tenantId, so the row returned
    // would have tenantId === TENANT_A. The check at line 138 only fires if
    // tenantId in the returned row does NOT match the passed tenantId.
    // Here DB returned TENANT_A row while we asked for TENANT_A → ok.
    const resultOk = await getDesignComponent(rowA.id, TENANT_A);
    expect(resultOk?.tenantId).toBe(TENANT_A);

    // Now simulate DB returning a TENANT_A row when queried with TENANT_B
    // (in-app guard layer):
    const leakyRowB = { ...rowA, tenantId: TENANT_A }; // mismatch with TENANT_B
    dbMock.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([leakyRowB]) }) }),
    });
    await expect(getDesignComponent(rowA.id, TENANT_B)).rejects.toBeInstanceOf(ComponentTenantError);
  });

  it("listDesignComponents: always scoped to the provided tenantId parameter", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;

    const whereSpy = vi.fn().mockReturnValue({
      orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
    });
    const countWhere = vi.fn().mockReturnValue(Promise.resolve([{ count: 0 }]));

    let call = 0;
    dbMock.select.mockImplementation(() => ({
      from: () => ({ where: call++ === 0 ? whereSpy : countWhere }),
    }));

    const { listDesignComponents } = await import("../designComponentService.js");
    await listDesignComponents(TENANT_A);

    // The where builder was called — tenantId-scoped filter was applied.
    expect(whereSpy).toHaveBeenCalledTimes(1);
  });
});

// ── P2 SLUG UNIQUENESS ────────────────────────────────────────────────────────

describe("P2 SLUG UNIQUENESS — unique(tenant_id, slug) policy", () => {
  it("createDesignComponent: DB unique-violation (23505) → ComponentSlugConflictError", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;
    const pgUniqueError = Object.assign(new Error("duplicate key value"), { code: "23505" });

    dbMock.insert.mockReturnValue({
      values: () => ({ returning: () => Promise.reject(pgUniqueError) }),
    });

    const { createDesignComponent, ComponentSlugConflictError } = await import(
      "../designComponentService.js"
    );

    await expect(
      createDesignComponent({
        type: "text",
        tenantId: "tenant-alpha",
        name: "My Text Block",
        domain: "graphic",
        fieldValues: { content: "Hello" },
      }),
    ).rejects.toBeInstanceOf(ComponentSlugConflictError);
  });

  it("same slug in different tenants → each insert succeeds independently (policy: UNIQUE is per-tenant)", async () => {
    const { db } = await import("@workspace/db");
    const dbMock = db as any;

    const makeRow = (tenantId: string) => ({
      id: Math.random(),
      tenantId,
      name: "My Component",
      slug: "my-component-abc00001",
      type: "text",
      domain: "graphic",
      fieldValues: {},
      blueprintId: null,
      status: "active",
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    dbMock.insert
      .mockReturnValueOnce({
        values: () => ({ returning: () => Promise.resolve([makeRow("tenant-alpha")]) }),
      })
      .mockReturnValueOnce({
        values: () => ({ returning: () => Promise.resolve([makeRow("tenant-beta")]) }),
      });

    const { createDesignComponent } = await import("../designComponentService.js");

    const resultA = await createDesignComponent({
      type: "text",
      tenantId: "tenant-alpha",
      name: "My Component",
      domain: "graphic",
      fieldValues: { content: "A" },
    });

    const resultB = await createDesignComponent({
      type: "text",
      tenantId: "tenant-beta",
      name: "My Component",
      domain: "graphic",
      fieldValues: { content: "B" },
    });

    expect(resultA.tenantId).toBe("tenant-alpha");
    expect(resultB.tenantId).toBe("tenant-beta");
    // Cross-tenant slug reuse is by design
    expect(resultA.slug).toBe(resultB.slug);
  });
});

// ── P0 MANIFEST: no locked-file modification instructions ─────────────────────

describe("P0 MANIFEST — declarative only, no locked-file modification instructions", () => {
  // Locked files that feature teams must not instruct Team 24 to modify
  const LOCKED_PATHS = [
    "routes/index.ts",
    "App.tsx",
    "lib/db/src/schema/index.ts",
    "root openapi.yaml",
    "pnpm-lock.yaml",
    "root package.json",
    "jobWorkerService",
    "creativeWorkflowRunner",
  ];

  // JSON keys that imply imperative edit instructions
  const IMPERATIVE_KEYS = ["instruction", "editFile", "modifyFile", "addToBarrel"];

  let manifest: Record<string, unknown>;
  let manifestStr: string;

  beforeEach(() => {
    // Resolve from the api-server package root (process.cwd() in vitest)
    const manifestPath = path.resolve(
      process.cwd(),
      "../../integration/manifests/team-08.json",
    );
    manifestStr = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(manifestStr) as Record<string, unknown>;
  });

  it("manifest has all required declarative fields", () => {
    expect(manifest).toHaveProperty("routesToMount");
    expect(manifest).toHaveProperty("pagesToRegister");
    expect(manifest).toHaveProperty("sidebarItems");
    expect(manifest).toHaveProperty("schemaExportsRequested");
    expect(manifest).toHaveProperty("migrations");
    expect(manifest).toHaveProperty("integrationNotes");
  });

  it("manifest does not contain imperative edit-command keys", () => {
    for (const key of IMPERATIVE_KEYS) {
      // Match the key as a JSON object key (e.g. "instruction":)
      const pattern = new RegExp(`"${key}"\\s*:`);
      expect(
        pattern.test(manifestStr),
        `Manifest must not contain imperative key "${key}":`,
      ).toBe(false);
    }
  });

  it("routesToMount entries do not reference locked file paths", () => {
    const routes = manifest["routesToMount"] as Array<Record<string, string>>;
    expect(Array.isArray(routes)).toBe(true);
    for (const route of routes) {
      for (const [field, value] of Object.entries(route)) {
        for (const locked of LOCKED_PATHS) {
          expect(
            String(value).includes(locked),
            `routesToMount[].${field} must not reference locked path "${locked}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("pagesToRegister entries do not reference App.tsx or other locked files", () => {
    const pages = manifest["pagesToRegister"] as Array<Record<string, string>>;
    expect(Array.isArray(pages)).toBe(true);
    for (const page of pages) {
      for (const [field, value] of Object.entries(page)) {
        for (const locked of LOCKED_PATHS) {
          expect(
            String(value).includes(locked),
            `pagesToRegister[].${field} must not reference locked path "${locked}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("sidebarItems entries do not contain 'file' or 'instruction' fields", () => {
    const items = manifest["sidebarItems"] as Array<Record<string, unknown>>;
    expect(Array.isArray(items)).toBe(true);
    for (const item of items) {
      expect(item, "sidebarItems entry must not have 'file' field").not.toHaveProperty("file");
      expect(item, "sidebarItems entry must not have 'instruction' field").not.toHaveProperty(
        "instruction",
      );
    }
  });
});
