/**
 * Design Blueprint Routes — HTTP-level tests (Team 7 Remediation)
 *
 * Validates:
 *  - P0: Router-level auth — unauthenticated requests return 401 on all
 *    mutation routes; read routes also require auth (admin-only domain).
 *  - P1: Malformed body rejected with 400/422 at route layer.
 *  - P1: Pagination boundary: limit is coerced and capped by zod schema.
 *  - P1: Idempotency: normalizing the same payload twice yields the same result.
 *  - P1: Error handling: unknown blueprint IDs return 404, not 500.
 *
 * Uses supertest (already installed for health.test.ts).
 * The adminAuth middleware is mocked so tests are environment-agnostic
 * (no ADMIN_API_KEY secret needed in CI).
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock adminAuth to simulate auth gate ─────────────────────────────────────
// Real adminAuth needs DB (session lookup). We mock it so tests verify
// the router wires the middleware, not adminAuth's own internals.
// When Authorization header is "Bearer test-key" → allow.
// Otherwise → 401.
vi.mock("../../middleware/adminAuth.js", () => ({
  adminAuth: vi.fn((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers["authorization"] as string | undefined;
    if (authHeader === "Bearer test-key") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized: invalid or missing admin API key" });
    }
  }),
  adminAuthWithExceptions: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next()),
  requireAdminApiKey: vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next()),
}));

const { default: blueprintsRouter } = await import("../design-blueprints/index.js");

const app = express();
app.use(express.json());
app.use(blueprintsRouter);

const AUTH = { Authorization: "Bearer test-key" };

// ── P0: Unauthorized access ───────────────────────────────────────────────────

describe("P0 — router-level auth: unauthenticated requests are rejected", () => {
  it("GET /ai/design-blueprints without auth → 401", async () => {
    const res = await request(app).get("/ai/design-blueprints");
    expect(res.status).toBe(401);
  });

  it("GET /ai/design-blueprints/stats without auth → 401", async () => {
    const res = await request(app).get("/ai/design-blueprints/stats");
    expect(res.status).toBe(401);
  });

  it("POST /ai/design-blueprints without auth → 401 (not 400/500)", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints")
      .send({ name: "X" });
    expect(res.status).toBe(401);
  });

  it("PATCH /ai/design-blueprints/:id without auth → 401", async () => {
    const res = await request(app)
      .patch("/ai/design-blueprints/bp-graphic-design-v1")
      .send({ name: "Hacked" });
    expect(res.status).toBe(401);
  });

  it("POST /ai/design-blueprints/:id/deprecate without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/bp-graphic-design-v1/deprecate");
    expect(res.status).toBe(401);
  });

  it("POST /ai/design-blueprints/validate without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/validate")
      .send({});
    expect(res.status).toBe(401);
  });

  it("POST /ai/design-blueprints/check-compatibility without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/check-compatibility")
      .send({ blueprintId: "bp-graphic-design-v1", schemaVersion: "1.0" });
    expect(res.status).toBe(401);
  });

  it("POST /ai/design-blueprints/normalize without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/normalize")
      .send({});
    expect(res.status).toBe(401);
  });
});

// ── Authenticated read paths ───────────────────────────────────────────────────

describe("authenticated — read routes succeed", () => {
  it("GET /ai/design-blueprints returns blueprint list", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blueprints)).toBe(true);
    expect(res.body.blueprints.length).toBeGreaterThanOrEqual(6);
  });

  it("GET /ai/design-blueprints/stats returns stats object", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/stats")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe("number");
    expect(typeof res.body.builtin).toBe("number");
    expect(res.body.builtin).toBe(6);
  });

  it("GET /ai/design-blueprints/:id returns a known blueprint by id", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/bp-graphic-design-v1")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("bp-graphic-design-v1");
    expect(res.body.domain).toBe("graphic_design");
  });

  it("GET /ai/design-blueprints/:id returns 404 for unknown id", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/bp-does-not-exist-xyz")
      .set(AUTH);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("GET /ai/design-blueprints/:id also accepts slug", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/graphic-design-standard")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("graphic-design-standard");
  });

  it("GET /ai/design-blueprints/domain/:domain filters correctly", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/domain/presentation")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe("presentation");
    expect(res.body.blueprints.every((b: { domain: string }) => b.domain === "presentation")).toBe(true);
  });

  it("GET /ai/design-blueprints/domain/:domain returns 400 for invalid domain", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints/domain/underwater-basket-weaving")
      .set(AUTH);
    expect(res.status).toBe(400);
  });
});

// ── P1: Pagination boundary ───────────────────────────────────────────────────

describe("P1 — pagination boundaries enforced at route layer", () => {
  it("limit defaults to 50 when not supplied", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints")
      .set(AUTH);
    expect(res.status).toBe(200);
    // With 6 built-ins, response.total should match array length
    expect(res.body.blueprints.length).toBe(res.body.total);
  });

  it("limit=2 returns at most 2 blueprints", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints?limit=2")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.blueprints.length).toBeLessThanOrEqual(2);
  });

  it("limit=0 is rejected with 400 (below min=1)", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints?limit=0")
      .set(AUTH);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("limit=201 is rejected with 400 (above max=200)", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints?limit=201")
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it("offset paginates correctly", async () => {
    const page1 = await request(app)
      .get("/ai/design-blueprints?limit=2&offset=0")
      .set(AUTH);
    const page2 = await request(app)
      .get("/ai/design-blueprints?limit=2&offset=2")
      .set(AUTH);
    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.blueprints[0].id).not.toBe(page2.body.blueprints[0]?.id);
  });
});

// ── P1: Malformed body ────────────────────────────────────────────────────────

describe("P1 — malformed body is rejected cleanly (not 500)", () => {
  it("POST /ai/design-blueprints with non-object body → 400", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints")
      .set(AUTH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify("not-an-object"));
    // Express json() parses strings to string — route guard catches non-object
    expect([400, 422]).toContain(res.status);
  });

  it("POST /ai/design-blueprints with empty body → 422 validation failure (not 500)", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty("issues");
  });

  it("PATCH /ai/design-blueprints/:id with non-object body → 400", async () => {
    const res = await request(app)
      .patch("/ai/design-blueprints/bp-does-not-exist")
      .set(AUTH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify("bad"));
    expect([400, 422]).toContain(res.status);
  });

  it("POST /ai/design-blueprints/check-compatibility with missing required fields → 400", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/check-compatibility")
      .set(AUTH)
      .send({ blueprintId: "" }); // missing schemaVersion, empty blueprintId
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("details");
  });

  it("POST /ai/design-blueprints/validate with non-blueprint object → 422", async () => {
    // Valid JSON object, but fails blueprint structural validation → 422
    const res = await request(app)
      .post("/ai/design-blueprints/validate")
      .set(AUTH)
      .send({ notABlueprint: true, randomField: 42 });
    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("GET /ai/design-blueprints with invalid domain filter → 400", async () => {
    const res = await request(app)
      .get("/ai/design-blueprints?domain=not-a-domain")
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it("GET /ai/design-blueprints with non-numeric limit → 400 or coerced", async () => {
    // "abc" can't be coerced to number — zod rejects
    const res = await request(app)
      .get("/ai/design-blueprints?limit=abc")
      .set(AUTH);
    // zod coerce.number() on "abc" → NaN → fails int check → 400
    expect(res.status).toBe(400);
  });
});

// ── P1: Mutation routes — not-found and builtin-immutability ─────────────────

describe("P1 — mutation routes behave correctly on edge cases", () => {
  it("PATCH unknown id → 404", async () => {
    const res = await request(app)
      .patch("/ai/design-blueprints/bp-nonexistent-xyz")
      .set(AUTH)
      .send({ name: "Updated" });
    expect(res.status).toBe(404);
  });

  it("POST /:id/deprecate on unknown id → 404", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/bp-nonexistent-xyz/deprecate")
      .set(AUTH);
    expect(res.status).toBe(404);
  });

  it("POST /:id/deprecate on builtin id → 403", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/bp-graphic-design-v1/deprecate")
      .set(AUTH);
    expect(res.status).toBe(403);
  });
});

// ── P1: Idempotency — normalize twice = same result ──────────────────────────

describe("P1 — normalize is idempotent", () => {
  it("normalizing the same payload twice yields identical blueprint", async () => {
    const target = (await request(app).get("/ai/design-blueprints/bp-graphic-design-v1").set(AUTH)).body;
    const r1 = await request(app).post("/ai/design-blueprints/normalize").set(AUTH).send(target);
    const r2 = await request(app).post("/ai/design-blueprints/normalize").set(AUTH).send(r1.body.blueprint);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Second normalization should produce no additional changes
    expect(r2.body.changes).toHaveLength(0);
  });
});

// ── P1: Compatibility check — not-found path ─────────────────────────────────

describe("P1 — check-compatibility error handling", () => {
  it("unknown blueprintId → 404 with issue list", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/check-compatibility")
      .set(AUTH)
      .send({ blueprintId: "bp-nonexistent", schemaVersion: "1.0" });
    expect(res.status).toBe(404);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it("valid request returns compatibility result", async () => {
    const res = await request(app)
      .post("/ai/design-blueprints/check-compatibility")
      .set(AUTH)
      .send({
        blueprintId: "bp-graphic-design-v1",
        schemaVersion: "1.0",
        componentTypes: ["rich-text-editor", "image-picker"],
        slotTypesFilled: { text: 1, image: 1 },
      });
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(true);
  });
});
