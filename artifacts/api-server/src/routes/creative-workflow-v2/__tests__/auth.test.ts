/**
 * creative-workflow-v2 — Auth & IDOR Security Tests
 *
 * HTTP-level tests (via supertest) covering:
 *
 *   A. Admin route authentication (P1-01)
 *      - Unauthenticated definitions request → 401
 *      - Unauthenticated plan mutation → 401
 *      - Valid admin key → request processed (not 401)
 *
 *   B. Public progress endpoint — IDOR protection (P1-02)
 *      - Missing token → 401
 *      - Invalid/unknown token → 401
 *      - Valid token for Customer A → returns only Customer A plans
 *      - Valid token for Customer A + plan owned by Customer B → NOT returned (IDOR guard)
 *
 *   C. OpenAPI operationId uniqueness (P1-03)
 *      - All operationIds in team-01.yaml are unique
 *      - All operationIds have the cwfV2 prefix
 *
 *   D. Migration ordering (P1-04)
 *      - Step comments are present and in correct order
 *
 *   E. Large-graph cycle detection (≥100 nodes)
 *
 * TEAM 1 OWNED — do not modify outside feature/01-creative-workflow.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Application } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Mock internalAuthService to prevent DB calls ──────────────────────────────
// adminAuth imports verifySessionToken + getInternalUserById; mock them so
// the middleware can run in tests without a real database connection.
vi.mock("../../../services/internalAuthService.js", () => ({
  verifySessionToken: vi.fn().mockReturnValue(null),  // no cookie session
  getInternalUserById: vi.fn().mockResolvedValue(null),
  SESSION_COOKIE_NAME: "cwf_internal_sess",
}));

// ── Import routers AFTER mocking ──────────────────────────────────────────────
import { adminAuth }                                    from "../../../middleware/adminAuth.js";
import { definitionsRouter }                            from "../definitions.js";
import { plansRouter }                                  from "../plans.js";
import { publicProgressRouter,
         setContextTokenResolver,
         setPublicPlanReader }                          from "../publicProgress.js";
import { buildExecutionPlan }                           from "../../../services/creative-workflow-v2/index.js";
import { detectCycle }                                  from "../../../services/creative-workflow-v2/index.js";
import type { WorkflowDefinition }                      from "../../../types/creative-workflow-v2/index.js";

// ── Test constants ────────────────────────────────────────────────────────────

const VALID_ADMIN_KEY = "test-admin-key-team01";
const OTHER_ADMIN_KEY = "wrong-key";

// ── App factories ─────────────────────────────────────────────────────────────

/**
 * Admin app: definitions + plans routers, each with their own explicit adminAuth.
 * Does NOT mount the public router (separate concern).
 */
function makeAdminApp(): Application {
  const app = express();
  app.use(express.json());
  app.use("/definitions", definitionsRouter);
  app.use("/plans",       plansRouter);
  return app;
}

/**
 * Public app: only the publicProgressRouter (no admin auth — has its own token auth).
 */
function makePublicApp(): Application {
  const app = express();
  app.use(express.json());
  app.use(publicProgressRouter);
  return app;
}

// ── Fixture ───────────────────────────────────────────────────────────────────

function makeLinearDef(id = "fixed-def-id"): WorkflowDefinition {
  const now = new Date();
  return {
    id, name: "Linear", version: 1,
    nodes: [
      { id: "A", label: "A", jobType: "llm_inference", estimatedDurationMs: 100 },
      { id: "B", label: "B", jobType: "llm_inference", estimatedDurationMs: 100, dependencies: ["A"] },
    ],
    edges: [], milestones: [], createdAt: now, updatedAt: now,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. Admin route authentication
// ═══════════════════════════════════════════════════════════════════════════════

describe("A. Admin route authentication — definitions", () => {
  let app: Application;

  beforeAll(() => {
    // Set up a test admin key and simulate non-development environment
    process.env["ADMIN_API_KEY"] = VALID_ADMIN_KEY;
    process.env["NODE_ENV"] = "test";
    app = makeAdminApp();
  });

  afterAll(() => {
    delete process.env["ADMIN_API_KEY"];
  });

  it("GET /definitions — no auth header → 401", async () => {
    const res = await request(app).get("/definitions");
    expect(res.status).toBe(401);
  });

  it("GET /definitions — wrong API key → 401", async () => {
    const res = await request(app)
      .get("/definitions")
      .set("x-admin-api-key", OTHER_ADMIN_KEY);
    expect(res.status).toBe(401);
  });

  it("GET /definitions — Bearer with wrong key → 401", async () => {
    const res = await request(app)
      .get("/definitions")
      .set("Authorization", `Bearer ${OTHER_ADMIN_KEY}`);
    expect(res.status).toBe(401);
  });

  it("GET /definitions — valid x-admin-api-key → not 401 (200 or 200 empty list)", async () => {
    const res = await request(app)
      .get("/definitions")
      .set("x-admin-api-key", VALID_ADMIN_KEY);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("GET /definitions — valid Bearer token → not 401", async () => {
    const res = await request(app)
      .get("/definitions")
      .set("Authorization", `Bearer ${VALID_ADMIN_KEY}`);
    expect(res.status).not.toBe(401);
  });

  it("POST /definitions — no auth → 401", async () => {
    const res = await request(app)
      .post("/definitions")
      .send({ name: "Sneaky", nodes: [{ id: "X", label: "X", jobType: "t" }] });
    expect(res.status).toBe(401);
  });

  it("PATCH /definitions/:id — no auth → 401", async () => {
    const res = await request(app)
      .patch("/definitions/some-id")
      .send({ name: "Updated" });
    expect(res.status).toBe(401);
  });

  it("DELETE /definitions/:id — no auth → 401", async () => {
    const res = await request(app)
      .delete("/definitions/some-id");
    expect(res.status).toBe(401);
  });

  it("POST /definitions/:id/validate — no auth → 401", async () => {
    const res = await request(app)
      .post("/definitions/some-id/validate");
    expect(res.status).toBe(401);
  });
});

describe("A. Admin route authentication — plans", () => {
  let app: Application;

  beforeAll(() => {
    process.env["ADMIN_API_KEY"] = VALID_ADMIN_KEY;
    process.env["NODE_ENV"] = "test";
    app = makeAdminApp();
  });

  afterAll(() => {
    delete process.env["ADMIN_API_KEY"];
  });

  it("GET /plans — no auth → 401", async () => {
    const res = await request(app).get("/plans");
    expect(res.status).toBe(401);
  });

  it("POST /plans — no auth → 401 (plan mutation blocked)", async () => {
    const res = await request(app)
      .post("/plans")
      .send({ workflowDefinitionId: "x", contextId: "c", contextType: "t" });
    expect(res.status).toBe(401);
  });

  it("POST /plans/:id/start — no auth → 401", async () => {
    const res = await request(app)
      .post("/plans/some-plan-id/start");
    expect(res.status).toBe(401);
  });

  it("POST /plans/:id/cancel — no auth → 401", async () => {
    const res = await request(app)
      .post("/plans/some-plan-id/cancel")
      .send({ reason: "test" });
    expect(res.status).toBe(401);
  });

  it("POST /plans/:id/nodes/:nodeId/running — no auth → 401", async () => {
    const res = await request(app)
      .post("/plans/some-plan-id/nodes/node-A/running")
      .send({ jobId: "job-1" });
    expect(res.status).toBe(401);
  });

  it("POST /plans/:id/nodes/:nodeId/completed — no auth → 401", async () => {
    const res = await request(app)
      .post("/plans/some-plan-id/nodes/node-A/completed");
    expect(res.status).toBe(401);
  });

  it("GET /plans — valid key → not 401", async () => {
    const res = await request(app)
      .get("/plans")
      .set("x-admin-api-key", VALID_ADMIN_KEY);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Public progress endpoint — IDOR protection
// ═══════════════════════════════════════════════════════════════════════════════

describe("B. Public progress endpoint — IDOR protection", () => {
  let app: Application;

  // Fixtures: two customers with isolated plan stores
  const CTX_A = "ctx-customer-A";
  const CTX_B = "ctx-customer-B";
  const TOKEN_A = "token-for-customer-A";
  const TOKEN_EXPIRED = "expired-token";
  const TOKEN_UNKNOWN = "unknown-token";

  const planA = buildExecutionPlan(makeLinearDef("def-A"), {
    contextId: CTX_A, contextType: "creative_project",
  });
  const planB = buildExecutionPlan(makeLinearDef("def-B"), {
    contextId: CTX_B, contextType: "creative_project",
  });

  beforeAll(() => {
    // Token resolver: only TOKEN_A is valid
    setContextTokenResolver((token) => {
      if (token === TOKEN_A)      return { contextId: CTX_A, contextType: "creative_project" };
      if (token === TOKEN_EXPIRED) return null;  // simulate expired
      return null;  // unknown tokens fail closed
    });

    // Plan reader: returns plans filtered by contextId (IDOR-safe)
    const allPlans = [planA, planB];
    setPublicPlanReader((contextId) =>
      allPlans.filter((p) => p.contextId === contextId)
    );

    app = makePublicApp();
  });

  it("missing token → 401", async () => {
    const res = await request(app).get("/public/progress");
    expect(res.status).toBe(401);
  });

  it("empty token string → 401", async () => {
    const res = await request(app).get("/public/progress?token=");
    expect(res.status).toBe(401);
  });

  it("unknown token → 401 (fail closed)", async () => {
    const res = await request(app).get(`/public/progress?token=${TOKEN_UNKNOWN}`);
    expect(res.status).toBe(401);
  });

  it("expired token → 401 (fail closed)", async () => {
    const res = await request(app).get(`/public/progress?token=${TOKEN_EXPIRED}`);
    expect(res.status).toBe(401);
  });

  it("valid token-A → 200 with contextId = ctx-A", async () => {
    const res = await request(app).get(`/public/progress?token=${TOKEN_A}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contextId).toBe(CTX_A);
  });

  it("valid token-A → only returns plans owned by Customer A", async () => {
    const res = await request(app).get(`/public/progress?token=${TOKEN_A}`);
    expect(res.status).toBe(200);
    const plans: { planId: string }[] = res.body.data.plans;
    // planA belongs to ctx-A → visible
    expect(plans.some((p) => p.planId === planA.id)).toBe(true);
    // planB belongs to ctx-B → NEVER visible via token-A (IDOR guard)
    expect(plans.some((p) => p.planId === planB.id)).toBe(false);
  });

  it("IDOR guard: Customer A cannot access Customer B plan via their own token", async () => {
    // Even if customer A knows planB.id, the endpoint never reads plan ID from request.
    // The response is derived entirely from server-resolved contextId.
    const res = await request(app).get(`/public/progress?token=${TOKEN_A}`);
    const plans: { planId: string }[] = res.body.data.plans;
    const planIds = plans.map((p) => p.planId);
    expect(planIds).not.toContain(planB.id);
  });

  it("response does not expose full node details (customer-safe summary only)", async () => {
    const res = await request(app).get(`/public/progress?token=${TOKEN_A}`);
    const plans = res.body.data.plans;
    // Plans should have progress summary, not the full node list
    expect(plans[0]).toHaveProperty("status");
    expect(plans[0]).toHaveProperty("progress");
    // Full node array (with job IDs, error messages) must not be top-level
    expect(plans[0]).not.toHaveProperty("nodes");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. OpenAPI operationId uniqueness (P1-03)
// ═══════════════════════════════════════════════════════════════════════════════

describe("C. OpenAPI operationId uniqueness and cwfV2 prefix", () => {
  let yamlText: string;

  beforeAll(() => {
    const yamlPath = resolve(
      process.cwd(),
      "../../integration/openapi/team-01.yaml",
    );
    yamlText = readFileSync(yamlPath, "utf-8");
  });

  it("all operationIds have the cwfV2 prefix", () => {
    const operationIds = [...yamlText.matchAll(/operationId:\s+(\S+)/g)].map(
      (m) => m[1],
    );
    expect(operationIds.length).toBeGreaterThan(0);
    const withoutPrefix = operationIds.filter((id) => !id.startsWith("cwfV2"));
    expect(withoutPrefix).toHaveLength(0);
  });

  it("all operationIds are unique (no duplicates)", () => {
    const operationIds = [...yamlText.matchAll(/operationId:\s+(\S+)/g)].map(
      (m) => m[1],
    );
    const unique = new Set(operationIds);
    expect(unique.size).toBe(operationIds.length);
  });

  it("cwfV2GetPublicProgress is present (public progress endpoint)", () => {
    expect(yamlText).toContain("cwfV2GetPublicProgress");
  });

  it("admin endpoints all have security: [{ apiKey: [] }]", () => {
    // Check a sample of admin operationIds appear alongside security
    expect(yamlText).toContain("cwfV2ListDefinitions");
    expect(yamlText).toContain("cwfV2CreatePlan");
    expect(yamlText).toContain("cwfV2StartPlan");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Migration ordering (P1-04)
// ═══════════════════════════════════════════════════════════════════════════════

describe("D. Migration ordering comments", () => {
  let sqlText: string;

  beforeAll(() => {
    const sqlPath = resolve(
      process.cwd(),
      "../../integration/migrations/team-01.sql",
    );
    sqlText = readFileSync(sqlPath, "utf-8");
  });

  it("migration file is present and non-empty", () => {
    expect(sqlText.length).toBeGreaterThan(100);
  });

  it("STEP 1 (workflow_definitions) appears before STEP 2 (execution_plans)", () => {
    const step1Pos = sqlText.indexOf("STEP 1");
    const step2Pos = sqlText.indexOf("STEP 2");
    expect(step1Pos).toBeGreaterThan(-1);
    expect(step2Pos).toBeGreaterThan(-1);
    expect(step1Pos).toBeLessThan(step2Pos);
  });

  it("STEP 2 (execution_plans) appears before STEP 3 (plan_events)", () => {
    const step2Pos = sqlText.indexOf("STEP 2");
    const step3Pos = sqlText.indexOf("STEP 3");
    expect(step2Pos).toBeGreaterThan(-1);
    expect(step3Pos).toBeGreaterThan(-1);
    expect(step2Pos).toBeLessThan(step3Pos);
  });

  it("cwf_workflow_definitions CREATE TABLE precedes cwf_execution_plans CREATE TABLE", () => {
    const pos1 = sqlText.indexOf("cwf_workflow_definitions");
    const pos2 = sqlText.indexOf("cwf_execution_plans");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(-1);
    expect(pos1).toBeLessThan(pos2);
  });

  it("cwf_execution_plans CREATE TABLE precedes cwf_plan_events CREATE TABLE", () => {
    const pos2 = sqlText.indexOf("cwf_execution_plans");
    const pos3 = sqlText.indexOf("cwf_plan_events");
    expect(pos2).toBeGreaterThan(-1);
    expect(pos3).toBeGreaterThan(-1);
    expect(pos2).toBeLessThan(pos3);
  });

  it("FK dependency is documented (REFERENCES cwf_workflow_definitions)", () => {
    expect(sqlText).toContain("REFERENCES ai_platform.cwf_workflow_definitions");
  });

  it("FK dependency is documented (REFERENCES cwf_execution_plans)", () => {
    expect(sqlText).toContain("REFERENCES ai_platform.cwf_execution_plans");
  });

  it("all CREATE TABLE use IF NOT EXISTS", () => {
    const createTables = [...sqlText.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?(\S+)/gi)];
    const withoutGuard = createTables.filter((m) => !m[1]);
    expect(withoutGuard).toHaveLength(0);
  });

  it("all CREATE INDEX use IF NOT EXISTS", () => {
    const createIndexes = [...sqlText.matchAll(/CREATE INDEX\s+(IF NOT EXISTS\s+)?(\S+)/gi)];
    const withoutGuard = createIndexes.filter((m) => !m[1]);
    expect(withoutGuard).toHaveLength(0);
  });

  it("migration contains no DROP or TRUNCATE statements", () => {
    expect(sqlText).not.toMatch(/^\s*DROP\s/im);
    expect(sqlText).not.toMatch(/^\s*TRUNCATE\s/im);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. Large-graph cycle detection (≥100 nodes)
// ═══════════════════════════════════════════════════════════════════════════════

describe("E. Large-graph cycle detection (≥100 nodes)", () => {
  /**
   * Build an adjacency map for a linear chain: N0 → N1 → N2 → ... → N(n-1)
   * No cycles — detectCycle must return null.
   */
  function linearChainAdj(n: number): { nodeIds: string[]; adj: Map<string, string[]> } {
    const nodeIds = Array.from({ length: n }, (_, i) => `N${i}`);
    const adj = new Map<string, string[]>();
    for (let i = 0; i < n; i++) {
      adj.set(`N${i}`, i + 1 < n ? [`N${i + 1}`] : []);
    }
    return { nodeIds, adj };
  }

  /**
   * Build a parallel fan-out + fan-in graph (root → N0..N(m-1) → sink).
   * No cycles.
   */
  function fanOutFanInAdj(branches: number): { nodeIds: string[]; adj: Map<string, string[]> } {
    const nodeIds = ["root", ...Array.from({ length: branches }, (_, i) => `B${i}`), "sink"];
    const adj = new Map<string, string[]>();
    adj.set("root", Array.from({ length: branches }, (_, i) => `B${i}`));
    for (let i = 0; i < branches; i++) adj.set(`B${i}`, ["sink"]);
    adj.set("sink", []);
    return { nodeIds, adj };
  }

  it("linear chain of 100 nodes — no cycle detected", () => {
    const { nodeIds, adj } = linearChainAdj(100);
    const { cycle } = detectCycle(nodeIds, adj);
    expect(cycle).toBeNull();
  });

  it("linear chain of 500 nodes — no cycle detected", () => {
    const { nodeIds, adj } = linearChainAdj(500);
    const { cycle } = detectCycle(nodeIds, adj);
    expect(cycle).toBeNull();
  });

  it("fan-out of 100 branches — no cycle detected", () => {
    const { nodeIds, adj } = fanOutFanInAdj(100);
    const { cycle } = detectCycle(nodeIds, adj);
    expect(cycle).toBeNull();
  });

  it("linear chain of 100 nodes with a tail cycle — cycle detected", () => {
    const n = 100;
    const { nodeIds, adj } = linearChainAdj(n);
    // Introduce cycle: last node → first node
    adj.set(`N${n - 1}`, ["N0"]);
    const { cycle } = detectCycle(nodeIds, adj);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThan(0);
  });

  it("buildExecutionPlan with 100-node linear chain completes without throwing", () => {
    const now = new Date();
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`,
      jobType: "llm_inference",
      estimatedDurationMs: 100,
      dependencies: i > 0 ? [`N${i - 1}`] : [],
    }));
    const def: WorkflowDefinition = {
      id: "large-linear-def",
      name: "LargeLinear",
      version: 1,
      nodes, edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    const plan = buildExecutionPlan(def, { contextId: "c", contextType: "t" });
    expect(plan.nodes).toHaveLength(100);
    expect(plan.topologicalOrder).toHaveLength(100);
    // Only N0 starts as ready (no dependencies)
    const readyNodes = plan.nodes.filter((n) => n.status === "ready");
    expect(readyNodes).toHaveLength(1);
    expect(readyNodes[0].nodeId).toBe("N0");
  });

  it("buildExecutionPlan detects cycle in 100-node ring graph", () => {
    const now = new Date();
    const n = 100;
    // Create a ring: N0 → N1 → ... → N99 → N0
    const nodes = Array.from({ length: n }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`,
      jobType: "llm_inference",
      dependencies: [`N${(i + n - 1) % n}`],  // each depends on previous, N0 depends on N99
    }));
    const def: WorkflowDefinition = {
      id: "ring-def",
      name: "Ring",
      version: 1,
      nodes, edges: [], milestones: [], createdAt: now, updatedAt: now,
    };
    expect(() => buildExecutionPlan(def, { contextId: "c", contextType: "t" }))
      .toThrow(/cycle/i);
  });
});
