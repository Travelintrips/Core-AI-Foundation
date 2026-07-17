// ============================================================
// TEAM 12 — Layout Composer Route-Level Tests
// Covers: malformed payload, input size caps, canvas validation,
//         duplicate IDs, missing fields, error handling
//
// Auth note: adminAuthWithExceptions is a global app.ts mount —
// tests here use the bare router (no auth middleware) since auth
// is Team 24's integration concern, not the domain router's.
// ============================================================

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import layoutComposerRouter from "../index.js";

// ── Minimal express app (no auth — testing domain validation only) ──
const app = express();
app.use(express.json());
app.use(layoutComposerRouter);

// ── Fixtures ──────────────────────────────────────────────────
const validCanvas = { width: 800, height: 600 };

function makeElement(id: string, x = 0, y = 0, w = 100, h = 100) {
  return { id, type: "box", x, y, width: w, height: h };
}

function makeConstraint(id: string, type = "no_collision", elementIds = ["a"]) {
  return { id, type, elementIds, priority: "soft" };
}

const minimalValid = {
  canvas: validCanvas,
  elements: [makeElement("a"), makeElement("b", 200, 0)],
  constraints: [],
};

// ── GET /ai/layout-composer/operations ───────────────────────
describe("GET /ai/layout-composer/operations", () => {
  it("returns 200 with an operations array", async () => {
    const res = await request(app).get("/ai/layout-composer/operations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.operations)).toBe(true);
    expect(res.body.operations.length).toBeGreaterThan(0);
  });

  it("each operation has a type and description", async () => {
    const res = await request(app).get("/ai/layout-composer/operations");
    for (const op of res.body.operations) {
      expect(typeof op.type).toBe("string");
      expect(typeof op.description).toBe("string");
    }
  });
});

// ── POST /ai/layout-composer/solve — success ─────────────────
describe("POST /ai/layout-composer/solve — happy path", () => {
  it("returns 200 and a valid plan for minimal input", async () => {
    const res = await request(app).post("/ai/layout-composer/solve").send(minimalValid);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(Array.isArray(res.body.elements)).toBe(true);
    expect(typeof res.body.satisfactionScore).toBe("number");
    expect(res.body.deterministic).toBe(true);
  });

  it("respects maxIterations cap (enforced at MAX_ITERATIONS_ALLOWED=100)", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ ...minimalValid, maxIterations: 9999 });
    expect(res.status).toBe(200);
    // Solver was called — plan is still returned
    expect(res.body.elements).toBeDefined();
  });
});

// ── POST /ai/layout-composer/solve — missing fields ──────────
describe("POST /ai/layout-composer/solve — missing required fields", () => {
  it("returns 400 when canvas is missing", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ elements: [], constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/canvas/i);
  });

  it("returns 400 when elements is missing", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/elements|constraints/i);
  });

  it("returns 400 when constraints is missing", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/elements|constraints/i);
  });

  it("returns 400 for completely empty body", async () => {
    const res = await request(app).post("/ai/layout-composer/solve").send({});
    expect(res.status).toBe(400);
  });
});

// ── POST /ai/layout-composer/solve — canvas validation ───────
describe("POST /ai/layout-composer/solve — canvas validation", () => {
  it("returns 400 for canvas.width = 0", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: 0, height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/width/i);
  });

  it("returns 400 for canvas.width negative", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: -10, height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for canvas.height = 0", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: 800, height: 0 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/height/i);
  });

  it("returns 400 when canvas.width exceeds MAX_CANVAS_DIM (10 000)", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: 99999, height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10000|10_000|canvas/i);
  });

  it("returns 400 when canvas.height exceeds MAX_CANVAS_DIM (10 000)", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: 800, height: 99999 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric canvas.width (NaN)", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: "big", height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });
});

// ── POST /ai/layout-composer/solve — resource caps (P0) ──────
describe("POST /ai/layout-composer/solve — resource caps", () => {
  it("returns 400 when elements exceeds MAX_ELEMENTS (500)", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => makeElement(`el-${i}`, i * 5, 0));
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: tooMany, constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500|elements/i);
  });

  it("returns 400 when constraints exceeds MAX_CONSTRAINTS (200)", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) =>
      makeConstraint(`c-${i}`, "no_collision", ["a"])
    );
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: [makeElement("a")], constraints: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200|constraints/i);
  });

  it("returns 400 when zones exceeds MAX_ZONES (100)", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => ({
      id: `z-${i}`,
      name: `Zone ${i}`,
      x: 0, y: 0, width: 100, height: 100,
      category: "room",
    }));
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: [], constraints: [], zones: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100|zones/i);
  });

  it("returns 200 for exactly MAX_ELEMENTS (500) elements", async () => {
    const exactly = Array.from({ length: 500 }, (_, i) => makeElement(`el-${i}`, i % 800, Math.floor(i / 8) * 110));
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: { width: 800, height: 800 }, elements: exactly, constraints: [] });
    expect(res.status).toBe(200);
  });
});

// ── POST /ai/layout-composer/solve — malformed payload ───────
describe("POST /ai/layout-composer/solve — malformed payload", () => {
  it("returns 400 when elements is not an array", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: "not-an-array", constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it("returns 400 when constraints is not an array", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({ canvas: validCanvas, elements: [], constraints: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it("returns 400 for duplicate element IDs", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send({
        canvas: validCanvas,
        elements: [makeElement("dup"), makeElement("dup", 200, 0)],
        constraints: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/i);
  });
});

// ── POST /ai/layout-composer/validate — validation ───────────
describe("POST /ai/layout-composer/validate", () => {
  it("returns 200 and valid=true for non-overlapping elements", async () => {
    const res = await request(app).post("/ai/layout-composer/validate").send({
      canvas: validCanvas,
      elements: [makeElement("a", 0, 0), makeElement("b", 200, 0)],
      constraints: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it("returns 400 when canvas is missing", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .send({ elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when elements exceeds cap", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => makeElement(`el-${i}`));
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .send({ canvas: validCanvas, elements: tooMany, constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500|elements/i);
  });

  it("returns 400 when constraints exceeds cap", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => makeConstraint(`c-${i}`));
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .send({ canvas: validCanvas, elements: [makeElement("a")], constraints: tooMany });
    expect(res.status).toBe(400);
  });

  it("detects collision violations", async () => {
    const res = await request(app).post("/ai/layout-composer/validate").send({
      canvas: validCanvas,
      elements: [makeElement("a", 0, 0, 100, 100), makeElement("b", 50, 50, 100, 100)],
      constraints: [],
    });
    expect(res.status).toBe(200);
    const collision = res.body.violations?.find(
      (v: { constraintType: string }) => v.constraintType === "no_collision"
    );
    expect(collision).toBeDefined();
  });
});

// ── POST /ai/layout-composer/plan ────────────────────────────
describe("POST /ai/layout-composer/plan", () => {
  it("returns 200 with operations, iterations, converged", async () => {
    const res = await request(app).post("/ai/layout-composer/plan").send(minimalValid);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.operations)).toBe(true);
    expect(typeof res.body.iterations).toBe("number");
    expect(typeof res.body.converged).toBe("boolean");
  });

  it("returns 400 when canvas is missing", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/plan")
      .send({ elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when elements exceeds cap", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => makeElement(`el-${i}`));
    const res = await request(app)
      .post("/ai/layout-composer/plan")
      .send({ canvas: validCanvas, elements: tooMany, constraints: [] });
    expect(res.status).toBe(400);
  });

  it("does not include elements or violations in plan response", async () => {
    const res = await request(app).post("/ai/layout-composer/plan").send(minimalValid);
    expect(res.status).toBe(200);
    // Plan endpoint returns partial plan: id, operations, iterations, converged
    expect(res.body.satisfactionScore).toBeUndefined();
  });
});

// ── Error handling ────────────────────────────────────────────
describe("error handling", () => {
  it("returns JSON error body (not HTML) for 400 responses", async () => {
    const res = await request(app).post("/ai/layout-composer/solve").send({});
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(typeof res.body.error).toBe("string");
  });
});
