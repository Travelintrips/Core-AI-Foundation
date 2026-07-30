/**
 * provider-health.test.ts
 *
 * Tests for provider health check logic and routes:
 *
 * Unit tests — runHealthCheck (providerHealthService):
 *   1.  key-not-configured: increments consecutiveFailures, does NOT call fetch
 *   2.  key-not-configured: sets lastCheckedAt, keeps lastSuccessAt unchanged
 *   3.  key-not-configured: returns keyConfigured=false and meaningful error
 *   4.  ping success: resets consecutiveFailures to 0
 *   5.  ping success: updates lastSuccessAt and lastCheckedAt
 *   6.  ping success: returns pingOk=true and correct httpStatus
 *   7.  ping failure: increments consecutiveFailures
 *   8.  ping failure: does NOT update lastSuccessAt
 *   9.  ping failure: returns pingOk=false with error string
 *  10.  provider not found: returns notFound sentinel
 *
 * Route integration tests — POST /ai/providers/:id/health-check:
 *  11.  404 when provider not found
 *  12.  400 for non-numeric id
 *  13.  200 with health result on success
 *  14.  result contains all required diagnostic fields
 *
 * Route integration tests — POST /ai/providers/health-check-all:
 *  15.  200 with array of results
 *  16.  filters out notFound sentinels from response
 *  17.  returns empty array when no providers exist
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoist mock data ───────────────────────────────────────────────────────────

const { mockProvider } = vi.hoisted(() => {
  const mockProvider = {
    id: 42,
    slug: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
    isActive: true,
    consecutiveFailures: 0,
    lastCheckedAt: null as Date | null,
    lastSuccessAt: null as Date | null,
    metadata: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
  return { mockProvider };
});

// ── DB mock helpers ───────────────────────────────────────────────────────────

const mockDbUpdate = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock("@workspace/db", () => {
  // Fluent builder for select
  const makeSelectBuilder = (rows: unknown[]) => {
    const builder = {
      from: () => builder,
      where: () => builder,
      limit: () => Promise.resolve(rows),
    };
    return builder;
  };

  // Fluent builder for update
  const makeUpdateBuilder = () => {
    const builder = {
      set: () => builder,
      where: () => Promise.resolve(),
    };
    return builder;
  };

  return {
    db: {
      select: (...args: unknown[]) => mockDbSelect(...args),
      update: (...args: unknown[]) => mockDbUpdate(...args),
      insert: (...args: unknown[]) => mockDbInsert(...args),
      delete: (...args: unknown[]) => mockDbDelete(...args),
    },
    aiProvidersTable: { id: "id", slug: "slug" },
    aiModelsTable: {},
    aiAuditLogsTable: {},
    aiProviderHealthLogsTable: { providerId: "providerId", checkedAt: "checkedAt" },
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  };
});

// ── Audit mock ────────────────────────────────────────────────────────────────

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// ── Admin auth mock (registry router is protected) ────────────────────────────

vi.mock("../../middleware/adminAuth.js", () => ({
  adminAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  adminAuthWithExceptions: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── SSRF guard mock ───────────────────────────────────────────────────────────

vi.mock("../../middleware/ssrfGuard.js", () => ({
  ssrfGuard: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ── api-zod mock (pass-through) ───────────────────────────────────────────────

vi.mock("@workspace/api-zod", () => {
  const passThrough = { parse: (x: unknown) => x, safeParse: (x: unknown) => ({ success: true, data: x }) };
  return {
    CreateProviderBody: passThrough,
    UpdateProviderBody: passThrough,
    GetProviderParams: passThrough,
    UpdateProviderParams: passThrough,
    DeleteProviderParams: passThrough,
    ListProvidersResponse: passThrough,
    CreateProviderResponse: passThrough,
    GetProviderResponse: passThrough,
    UpdateProviderResponse: passThrough,
    DeleteProviderResponse: passThrough,
    ListModelsQueryParams: { safeParse: (x: unknown) => ({ success: true, data: x }) },
    CreateModelBody: passThrough,
    UpdateModelBody: passThrough,
    GetModelParams: passThrough,
    UpdateModelParams: passThrough,
    DeleteModelParams: passThrough,
    ListModelsResponse: passThrough,
    CreateModelResponse: passThrough,
    GetModelResponse: passThrough,
    UpdateModelResponse: passThrough,
    DeleteModelResponse: passThrough,
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSelectThatReturns(rows: unknown[]) {
  const builder = {
    from: () => builder,
    where: () => builder,
    limit: () => Promise.resolve(rows),
  };
  mockDbSelect.mockReturnValue(builder);
}

function makeUpdateThatResolves() {
  const builder = {
    set: () => builder,
    where: () => Promise.resolve(),
  };
  mockDbUpdate.mockReturnValue(builder);
}

function makeInsertThatResolves() {
  const builder = {
    values: () => Promise.resolve(),
  };
  mockDbInsert.mockReturnValue(builder);
}

function makeDeleteThatResolves() {
  const builder = {
    where: () => Promise.resolve(),
  };
  mockDbDelete.mockReturnValue(builder);
}

// ── Unit tests: runHealthCheck ────────────────────────────────────────────────

describe("runHealthCheck — unit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env key to absent by default
    delete process.env["OPENAI_API_KEY"];
    makeUpdateThatResolves();
    makeInsertThatResolves();
    makeDeleteThatResolves();
  });

  it("(1) key-not-configured: does not call fetch", async () => {
    makeSelectThatReturns([{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY" }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    await runHealthCheck(42);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("(2) key-not-configured: updates lastCheckedAt in DB", async () => {
    makeSelectThatReturns([{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY", consecutiveFailures: 0 }]);
    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setMock });

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    await runHealthCheck(42);

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastCheckedAt: expect.any(Date) }),
    );
  });

  it("(3) key-not-configured: returns keyConfigured=false with error message", async () => {
    makeSelectThatReturns([{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY" }]);
    makeUpdateThatResolves();

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    expect("notFound" in result).toBe(false);
    if (!("notFound" in result)) {
      expect(result.keyConfigured).toBe(false);
      expect(result.pingOk).toBe(false);
      expect(result.error).toContain("OPENAI_API_KEY");
    }
  });

  it("(4) ping success: resets consecutiveFailures to 0", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 5 }]);

    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setMock });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 0 }),
    );
    if (!("notFound" in result)) {
      expect(result.consecutiveFailures).toBe(0);
    }
  });

  it("(5) ping success: updates lastSuccessAt and lastCheckedAt in DB", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 0 }]);

    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setMock });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    await runHealthCheck(42);

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCheckedAt: expect.any(Date),
        lastSuccessAt: expect.any(Date),
      }),
    );
  });

  it("(6) ping success: returns pingOk=true and correct httpStatus", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 0 }]);
    makeUpdateThatResolves();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    expect("notFound" in result).toBe(false);
    if (!("notFound" in result)) {
      expect(result.pingOk).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(result.keyConfigured).toBe(true);
    }
  });

  it("(7) ping failure: increments consecutiveFailures", async () => {
    process.env["OPENAI_API_KEY"] = "sk-bad-key";
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 2 }]);

    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setMock });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveFailures: 3 }),
    );
    if (!("notFound" in result)) {
      expect(result.consecutiveFailures).toBe(3);
    }
  });

  it("(8) ping failure: does NOT update lastSuccessAt (keeps existing value)", async () => {
    process.env["OPENAI_API_KEY"] = "sk-bad-key";
    const existingSuccessAt = new Date("2024-06-01T00:00:00Z");
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 1, lastSuccessAt: existingSuccessAt }]);

    const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDbUpdate.mockReturnValue({ set: setMock });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Service Unavailable", { status: 503 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    // lastSuccessAt must not change to now on failure
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastSuccessAt: existingSuccessAt }),
    );
    if (!("notFound" in result)) {
      expect(result.lastSuccessAt).toEqual(existingSuccessAt);
      expect(result.pingOk).toBe(false);
    }
  });

  it("(9) ping failure: returns pingOk=false with error string", async () => {
    process.env["OPENAI_API_KEY"] = "sk-bad-key";
    makeSelectThatReturns([{ ...mockProvider, consecutiveFailures: 0 }]);
    makeUpdateThatResolves();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(42);

    expect("notFound" in result).toBe(false);
    if (!("notFound" in result)) {
      expect(result.pingOk).toBe(false);
      expect(result.httpStatus).toBe(401);
      expect(result.error).toContain("401");
    }
  });

  it("(10) provider not found: returns notFound sentinel", async () => {
    makeSelectThatReturns([]);

    const { runHealthCheck } = await import("../../services/providerHealthService.js");
    const result = await runHealthCheck(9999);

    expect("notFound" in result).toBe(true);
    if ("notFound" in result) {
      expect(result.error).toMatch(/not found/i);
    }
  });
});

// ── Route integration tests ───────────────────────────────────────────────────

// Import the router after mocks are set up
async function buildApp() {
  const { default: registryRouter } = await import("../registry.js");
  const app = express();
  app.use(express.json());
  app.use(registryRouter);
  return app;
}

describe("POST /ai/providers/:id/health-check — route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["OPENAI_API_KEY"];
    makeUpdateThatResolves();
    makeInsertThatResolves();
    makeDeleteThatResolves();
  });

  it("(11) 404 when provider not found", async () => {
    makeSelectThatReturns([]);
    const app = await buildApp();
    const res = await request(app).post("/ai/providers/9999/health-check");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("(12) 400 for non-numeric id", async () => {
    const app = await buildApp();
    const res = await request(app).post("/ai/providers/not-a-number/health-check");
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("(13) 200 with health result on key-not-configured", async () => {
    makeSelectThatReturns([{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY" }]);
    const app = await buildApp();
    const res = await request(app).post("/ai/providers/42/health-check");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("providerId", 42);
  });

  it("(14) result contains all required diagnostic fields", async () => {
    makeSelectThatReturns([{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY" }]);
    const app = await buildApp();
    const res = await request(app).post("/ai/providers/42/health-check");
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty("providerId");
    expect(body).toHaveProperty("slug");
    expect(body).toHaveProperty("keyConfigured");
    expect(body).toHaveProperty("pingOk");
    expect(body).toHaveProperty("consecutiveFailures");
    expect(body).toHaveProperty("lastCheckedAt");
    expect(body).toHaveProperty("isActive");
    expect(body).toHaveProperty("envVar");
  });
});

describe("POST /ai/providers/health-check-all — route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["OPENAI_API_KEY"];
    makeInsertThatResolves();
    makeDeleteThatResolves();
  });

  /**
   * Build a select mock that handles two distinct call patterns used by
   * providerHealthService:
   *
   *  1. runAllHealthChecks: `await db.select({id}).from(table)`
   *     — awaited directly on `.from()` result (thenable, no `.limit()`)
   *
   *  2. runHealthCheck per-provider: `db.select().from(table).where(...).limit(1)`
   *     — resolved via `.limit()`
   */
  function mockSelectSequence(allIds: { id: number }[], perProviderRows: unknown[]) {
    let called = false;
    mockDbSelect.mockImplementation(() => {
      if (!called) {
        // First invocation: runAllHealthChecks listing IDs — must be thenable
        called = true;
        const p = Promise.resolve(allIds);
        return {
          from: () => p,
        };
      }
      // Subsequent invocations: runHealthCheck per provider
      const builder: Record<string, unknown> = {};
      builder["from"] = () => builder;
      builder["where"] = () => builder;
      builder["limit"] = () => Promise.resolve(perProviderRows);
      return builder;
    });
  }

  it("(15) 200 with array of results", async () => {
    mockSelectSequence([{ id: 42 }], [{ ...mockProvider, apiKeyEnvVar: "OPENAI_API_KEY" }]);
    makeUpdateThatResolves();

    const app = await buildApp();
    const res = await request(app).post("/ai/providers/health-check-all");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("(16) filters out notFound sentinels from response", async () => {
    // Provider id=99 exists in the list but is gone when health-check runs
    mockSelectSequence([{ id: 99 }], []); // empty per-provider → notFound sentinel

    const app = await buildApp();
    const res = await request(app).post("/ai/providers/health-check-all");
    expect(res.status).toBe(200);
    // The notFound sentinel must be stripped by the route handler
    const results = res.body as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(r).not.toHaveProperty("notFound");
    }
    // Array must be empty (one provider, but filtered out)
    expect(results).toHaveLength(0);
  });

  it("(17) returns empty array when no providers exist", async () => {
    mockSelectSequence([], []);

    const app = await buildApp();
    const res = await request(app).post("/ai/providers/health-check-all");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
