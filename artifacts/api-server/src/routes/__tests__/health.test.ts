/**
 * WP-14 Regression: Health Check Endpoints
 *
 * Verifies that:
 *   1. GET /healthz returns HTTP 200 + { status: "ok" } (liveness)
 *   2. GET /healthz/full returns HTTP 200 or 503 with structured payload
 *   3. Health endpoints do NOT require the admin API key
 *   4. Response contains expected fields
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import healthRouter from "../health.js";

// ── Mock @workspace/db pool ───────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const mockQuery = vi.fn().mockResolvedValue({
    rows: [{ schema_ok: true }],
  });
  return {
    pool: {
      query: mockQuery,
      totalCount: 2,
      idleCount: 1,
      waitingCount: 0,
    },
  };
});

// ── Mock @workspace/api-zod ───────────────────────────────────────────────────
vi.mock("@workspace/api-zod", () => ({
  HealthCheckResponse: {
    parse: (data: unknown) => data,
  },
}));

// ── Test app ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(healthRouter);

describe("GET /healthz — liveness probe", () => {
  it("returns HTTP 200", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await request(app).get("/healthz");
    expect(res.body).toMatchObject({ status: "ok" });
  });

  it("does not require an auth header", async () => {
    const res = await request(app).get("/healthz");
    // Must not return 401 — health check is public
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("GET /healthz/full — readiness probe", () => {
  it("returns HTTP 200 when DB is reachable", async () => {
    const res = await request(app).get("/healthz/full");
    expect(res.status).toBe(200);
  });

  it("returns structured payload with expected top-level keys", async () => {
    const res = await request(app).get("/healthz/full");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("memory");
    expect(res.body).toHaveProperty("checks");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("includes db and schema checks", async () => {
    const res = await request(app).get("/healthz/full");
    expect(res.body.checks).toHaveProperty("db");
    expect(res.body.checks).toHaveProperty("schema");
    expect(["ok", "fail"]).toContain(res.body.checks.db.status);
  });

  it("reports overall status as ok or degraded when DB succeeds", async () => {
    const res = await request(app).get("/healthz/full");
    expect(["ok", "degraded"]).toContain(res.body.status);
  });

  it("does not require an auth header", async () => {
    const res = await request(app).get("/healthz/full");
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("returns HTTP 503 when DB is unreachable", async () => {
    const { pool } = await import("@workspace/db");
    const mockPool = pool as { query: ReturnType<typeof vi.fn> };
    mockPool.query.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/healthz/full");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("fail");
    expect(res.body.checks.db.status).toBe("fail");
  });

  it("returns bounded degraded diagnostics when DB probe exceeds the hosting budget", async () => {
    const { pool } = await import("@workspace/db");
    const mockPool = pool as { query: ReturnType<typeof vi.fn> };
    const previousTimeout = process.env["HEALTHZ_DB_TIMEOUT_MS"];
    process.env["HEALTHZ_DB_TIMEOUT_MS"] = "250";
    mockPool.query.mockImplementationOnce(() => new Promise(() => {}));

    const started = Date.now();
    const res = await request(app).get("/healthz/full");
    const elapsedMs = Date.now() - started;

    if (previousTimeout === undefined) delete process.env["HEALTHZ_DB_TIMEOUT_MS"];
    else process.env["HEALTHZ_DB_TIMEOUT_MS"] = previousTimeout;

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.db.status).toBe("fail");
    expect(res.body.checks.db.detail).toContain("timed out");
    expect(res.body.checks.schema.detail).toContain("timed out");
    expect(elapsedMs).toBeLessThan(1_500);
  });

  it("uptime is a non-negative number", async () => {
    const res = await request(app).get("/healthz/full");
    expect(res.body.uptime.ms).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.uptime.human).toBe("string");
  });

  it("memory fields are present and numeric", async () => {
    const res = await request(app).get("/healthz/full");
    expect(typeof res.body.memory.heapUsedMb).toBe("number");
    expect(typeof res.body.memory.rssMb).toBe("number");
    expect(res.body.memory.heapUsedMb).toBeGreaterThanOrEqual(0);
  });
});
