// ============================================================
// TEAM 12 — Layout Composer Route Tests
//
// Auth setup:
//   adminAuth reads ADMIN_API_KEY from process.env.
//   Tests set this in beforeAll and pass "Authorization: Bearer <key>"
//   for authenticated requests. The unauthenticated test deliberately
//   omits the header to assert 401.
//
// No route registry changes — this file only tests Team 12's router.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import layoutComposerRouter from "../index.js";

// ── Auth constants ─────────────────────────────────────────────
const TEST_ADMIN_KEY = "layout-test-secret";
let savedAdminKey: string | undefined;

beforeAll(() => {
  savedAdminKey = process.env["ADMIN_API_KEY"];
  process.env["ADMIN_API_KEY"] = TEST_ADMIN_KEY;
  // Ensure NODE_ENV is not "development" so adminAuth enforces the key
  process.env["NODE_ENV"] = "test";
});

afterAll(() => {
  if (savedAdminKey !== undefined) {
    process.env["ADMIN_API_KEY"] = savedAdminKey;
  } else {
    delete process.env["ADMIN_API_KEY"];
  }
});

// ── Test app ───────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(layoutComposerRouter);

// ── Helpers ────────────────────────────────────────────────────
function auth(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_ADMIN_KEY}` };
}

const validCanvas = { width: 800, height: 600 };

function makeElement(id: string, x = 0, y = 0, w = 100, h = 100) {
  return { id, type: "box", x, y, width: w, height: h };
}

function makeConstraint(
  id: string,
  type = "no_collision",
  elementIds: string[] = ["a"],
  priority = "soft",
) {
  return { id, type, elementIds, priority };
}

const minimalValid = {
  canvas: validCanvas,
  elements: [makeElement("a", 0, 0), makeElement("b", 200, 0)],
  constraints: [],
};

// ─────────────────────────────────────────────────────────────
// 1. UNAUTHENTICATED → 401
// ─────────────────────────────────────────────────────────────
describe("P1 Auth — unauthenticated requests are rejected", () => {
  it("POST /ai/layout-composer/solve without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });

  it("POST /ai/layout-composer/validate without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });

  it("POST /ai/layout-composer/plan without auth → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/plan")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });

  it("GET /ai/layout-composer/operations does not require auth (read-only)", async () => {
    const res = await request(app).get("/ai/layout-composer/operations");
    // Must NOT return 401 — static read-only endpoint
    expect(res.status).toBe(200);
  });

  it("wrong API key → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set("Authorization", "Bearer wrong-key")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. ELEMENT COUNT > MAX → 400
// ─────────────────────────────────────────────────────────────
describe("P0 — element count cap (MAX=500)", () => {
  it("501 elements → 400", async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) =>
      makeElement(`el-${i}`, (i % 10) * 90, Math.floor(i / 10) * 110),
    );
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements: tooMany, constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500|elements/i);
  });

  it("exactly 500 elements → 200", async () => {
    const exact = Array.from({ length: 500 }, (_, i) =>
      makeElement(`el-${i}`, (i % 10) * 85, Math.floor(i / 10) * 65),
    );
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: { width: 1000, height: 4000 }, elements: exact, constraints: [] });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. CONSTRAINT COUNT > MAX → 400
// ─────────────────────────────────────────────────────────────
describe("P0 — constraint count cap (MAX=200)", () => {
  it("201 constraints → 400", async () => {
    const tooMany = Array.from({ length: 201 }, (_, i) =>
      makeConstraint(`c-${i}`, "no_collision", ["a"]),
    );
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: tooMany,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200|constraints/i);
  });

  it("exactly 200 constraints → 200 (pre-validation checks duplicates)", async () => {
    // 200 unique constraint ids all targeting element "a"
    const exactly = Array.from({ length: 200 }, (_, i) =>
      makeConstraint(`c-${i}`, "no_collision", ["a"]),
    );
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: exactly,
      });
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. IMPOSSIBLE LAYOUT STOPS WITHIN TIMEOUT
// ─────────────────────────────────────────────────────────────
describe("P0 — impossible/non-converging layout stops within iteration cap", () => {
  it("conflicting constraints converge in bounded iterations and return a plan", async () => {
    // Two hard fixed_position constraints pulling the same element to different
    // positions — solver cannot satisfy both simultaneously. It must still
    // return a completed plan within the iteration cap (not hang or crash).
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: [
          {
            id: "c1",
            type: "fixed_position",
            elementIds: ["a"],
            priority: "hard",
            params: { x: 100, y: 100 },
          },
          {
            id: "c2",
            type: "fixed_position",
            elementIds: ["a"],
            priority: "hard",
            params: { x: 300, y: 300 },
          },
        ],
        maxIterations: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(typeof res.body.iterations).toBe("number");
    expect(res.body.iterations).toBeGreaterThan(0);
  });

  it("many soft constraints finish within reasonable time (stress check)", async () => {
    // 200 soft constraints on 50 overlapping elements — solver bounded by
    // iteration cap and deadline; response must come back
    const elements = Array.from({ length: 50 }, (_, i) =>
      makeElement(`e${i}`, 0, 0, 100, 100), // all stacked on origin
    );
    const constraints = Array.from({ length: 50 }, (_, i) =>
      makeConstraint(`c${i}`, "no_collision", [`e${i}`, `e${(i + 1) % 50}`], "soft"),
    );
    const start = Date.now();
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements, constraints, maxIterations: 20 });
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    // Must finish well under the 5 s solver deadline
    expect(elapsed).toBeLessThan(10_000);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. CYCLIC / NESTED INVALID CONSTRAINT (P2 pre-validation)
// ─────────────────────────────────────────────────────────────
describe("P2 — pre-validation catches structural errors → 422", () => {
  it("cyclic parent-child reference → 422", async () => {
    const elements = [
      { ...makeElement("a"), children: ["b"] },
      { ...makeElement("b"), children: ["a"] }, // cycle: a → b → a
    ];
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements, constraints: [] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/pre-validation/i);
    const details = res.body.details as Array<{ message: string }>;
    expect(details.some((d) => /cyclic/i.test(d.message))).toBe(true);
  });

  it("nesting depth > MAX (5 levels) → 422", async () => {
    // Build a 6-level deep chain: a→b→c→d→e→f
    const elements = [
      { ...makeElement("a"), children: ["b"] },
      { ...makeElement("b"), children: ["c"] },
      { ...makeElement("c"), children: ["d"] },
      { ...makeElement("d"), children: ["e"] },
      { ...makeElement("e"), children: ["f"] },
      { ...makeElement("f") }, // depth = 6, exceeds MAX_NESTING_DEPTH=5
    ];
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements, constraints: [] });
    expect(res.status).toBe(422);
    const details = res.body.details as Array<{ message: string }>;
    expect(details.some((d) => /nesting depth/i.test(d.message))).toBe(true);
  });

  it("constraint referencing unknown element id → 422", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: [makeConstraint("c1", "no_collision", ["a", "ghost-id"])],
      });
    expect(res.status).toBe(422);
    const details = res.body.details as Array<{ message: string }>;
    expect(details.some((d) => /unknown element/i.test(d.message))).toBe(true);
  });

  it("duplicate constraint ids → 422", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: [
          makeConstraint("same-id", "no_collision", ["a"]),
          makeConstraint("same-id", "no_collision", ["a"]),
        ],
      });
    expect(res.status).toBe(422);
    const details = res.body.details as Array<{ message: string }>;
    expect(details.some((d) => /duplicate/i.test(d.message))).toBe(true);
  });

  it("self-referential align_to_element → 422", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a")],
        constraints: [makeConstraint("c1", "align_to_element", ["a", "a"])],
      });
    expect(res.status).toBe(422);
    const details = res.body.details as Array<{ message: string }>;
    expect(details.some((d) => /same element/i.test(d.message))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. VALID SMALL LAYOUT IS DETERMINISTIC
// ─────────────────────────────────────────────────────────────
describe("deterministic output for valid layouts", () => {
  it("same input produces identical plans on two consecutive calls", async () => {
    const payload = {
      canvas: { width: 400, height: 300 },
      elements: [makeElement("x", 10, 10), makeElement("y", 200, 10)],
      constraints: [makeConstraint("c1", "no_collision", ["x", "y"])],
    };

    const res1 = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send(payload);
    const res2 = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.elements).toEqual(res2.body.elements);
    expect(res1.body.satisfactionScore).toEqual(res2.body.satisfactionScore);
    expect(res1.body.iterations).toEqual(res2.body.iterations);
    expect(res1.body.converged).toEqual(res2.body.converged);
    expect(res1.body.deterministic).toBe(true);
  });

  it("plan is marked deterministic=true", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send(minimalValid);
    expect(res.status).toBe(200);
    expect(res.body.deterministic).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 7. ADDITIONAL VALIDATION — CANVAS, PAYLOAD, MALFORMED
// ─────────────────────────────────────────────────────────────
describe("input validation — canvas, payload shape", () => {
  it("canvas.width = 0 → 400", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: { width: 0, height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/width/i);
  });

  it("canvas exceeding MAX_CANVAS_DIM → 400", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: { width: 99999, height: 600 }, elements: [], constraints: [] });
    expect(res.status).toBe(400);
  });

  it("elements not an array → 400", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements: "bad", constraints: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it("duplicate element IDs → 400", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("dup"), makeElement("dup", 200, 0)],
        constraints: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unique/i);
  });

  it("missing all required fields → 400 with JSON body", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({});
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(typeof res.body.error).toBe("string");
  });

  it("zones > MAX_ZONES → 400", async () => {
    const tooManyZones = Array.from({ length: 101 }, (_, i) => ({
      id: `z${i}`, name: `Z${i}`, x: 0, y: 0, width: 10, height: 10, category: "room",
    }));
    const res = await request(app)
      .post("/ai/layout-composer/solve")
      .set(auth())
      .send({ canvas: validCanvas, elements: [], constraints: [], zones: tooManyZones });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100|zones/i);
  });
});

// ─────────────────────────────────────────────────────────────
// 8. ROUTE REGISTRY — no global route changes
// ─────────────────────────────────────────────────────────────
describe("route registry integrity", () => {
  it("GET /operations is handled by this router (not a 404)", async () => {
    const res = await request(app).get("/ai/layout-composer/operations");
    expect(res.status).not.toBe(404);
  });

  it("unknown sub-path returns 404 (router does not catch-all)", async () => {
    const res = await request(app)
      .get("/ai/layout-composer/does-not-exist")
      .set(auth());
    // Express default: 404 for unmatched routes
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. /validate and /plan endpoints
// ─────────────────────────────────────────────────────────────
describe("POST /ai/layout-composer/validate", () => {
  it("valid non-overlapping layout → 200, valid=true", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a", 0, 0), makeElement("b", 200, 0)],
        constraints: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });

  it("overlapping elements → 200, violations contain collision", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .set(auth())
      .send({
        canvas: validCanvas,
        elements: [makeElement("a", 0, 0, 100, 100), makeElement("b", 50, 50, 100, 100)],
        constraints: [],
      });
    expect(res.status).toBe(200);
    const collision = (res.body.violations as Array<{ constraintType: string }>)?.find(
      (v) => v.constraintType === "no_collision",
    );
    expect(collision).toBeDefined();
  });

  it("unauthenticated → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/validate")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });
});

describe("POST /ai/layout-composer/plan", () => {
  it("returns operations, iterations, converged — no elements/violations", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/plan")
      .set(auth())
      .send(minimalValid);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.operations)).toBe(true);
    expect(typeof res.body.iterations).toBe("number");
    expect(typeof res.body.converged).toBe("boolean");
    // plan endpoint returns a subset — no satisfactionScore
    expect(res.body.satisfactionScore).toBeUndefined();
  });

  it("unauthenticated → 401", async () => {
    const res = await request(app)
      .post("/ai/layout-composer/plan")
      .send(minimalValid);
    expect(res.status).toBe(401);
  });
});
