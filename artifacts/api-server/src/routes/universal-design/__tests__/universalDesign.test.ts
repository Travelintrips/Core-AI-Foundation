/**
 * Team 10 — Universal Design API: Tests
 *
 * Coverage (per spec TEST WAJIB):
 *   1.  get project authorized (admin)
 *   2.  cross-tenant denied (non-admin, no token)
 *   3.  missing auth (no key, no token) — initialize + review require admin
 *   4.  invalid brief (missing fields, wrong type)
 *   5.  unsupported plugin/workflow (unknown pluginId / command)
 *   6.  duplicate idempotency key (command conflict)
 *   7.  safe manifest projection (no internal fields)
 *   8.  artifact pagination
 *   9.  lifecycle conflict (re-initialize active project)
 *   10. public review security regression (token hash never exposed)
 *   11. internal field redaction (event actor, metadata)
 *
 * Architecture: we mock the facade (universalDesignFacade) and pluginRegistry so
 * tests are unit-scoped to the route layer only — no DB dependency needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Facade mock — must be declared before static imports ──────────────────────

const mockManifest = {
  pluginId: "fashion",
  name: "Fashion & Apparel Design",
  domain: "fashion",
  version: "1.0.0",
  briefSchemaRef: "brief-schema://fashion/v1",
  workflowId: "fashion-design-workflow-v1",
  capabilities: { moodboard: true, techPack: true },
  artifactTypes: [
    { type: "moodboard", label: "Moodboard" },
    { type: "technical_drawing", label: "Technical Drawing" },
  ],
  stages: [
    { stageId: "brief", label: "Brief", order: 0 },
    { stageId: "concept", label: "Concept", order: 1 },
  ],
};

const mockProjectOverview = {
  id: 42,
  name: "Test Project — Fashion",
  description: "A test project",
  pluginId: "fashion",
  status: "draft",
  currentStage: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  thumbnailUrl: null,
  tags: ["fashion"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const mockConfig = {
  projectId: 42,
  pluginId: "fashion",
  manifest: mockManifest,
  briefSchemaVersion: "v1",
  workflowStatus: "draft",
  currentStage: null,
};

const mockPaginated = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  hasMore: false,
};

// vi.mock is hoisted — these factories run before any imports
vi.mock("../pluginRegistry.js", () => ({
  getPluginManifest: vi.fn((pluginId: string) =>
    pluginId === "fashion" ? mockManifest : null,
  ),
  listPluginIds: vi.fn(() => ["fashion", "interior", "packaging", "branding", "graphic"]),
  inferPluginId: vi.fn(() => "fashion"),
}));

vi.mock("../universalDesignFacade.js", () => ({
  resolvePluginManifest: vi.fn((pluginId: string) =>
    pluginId === "fashion" ? mockManifest : null,
  ),
  getProjectConfig: vi.fn(async (id: number) =>
    id === 42 ? mockConfig : null,
  ),
  getProjectOverview: vi.fn(async (id: number) =>
    id === 42 ? { ...mockProjectOverview } : null,
  ),
  submitBrief: vi.fn(async (projectId: number, fields: Record<string, unknown>, idempotencyKey?: string) => {
    if (projectId !== 42) return null;
    return {
      briefId: "brief-uuid-1234",
      projectId,
      pluginId: "fashion",
      status: "saved",
      version: 1,
      savedAt: "2026-01-01T00:00:00.000Z",
    };
  }),
  initializeWorkflow: vi.fn(async (projectId: number) => {
    if (projectId !== 42) return null;
    return {
      projectId,
      workflowId: "fashion-design-workflow-v1",
      status: "initialized",
      jobId: null,
      message: "Workflow initialized successfully",
    };
  }),
  executeCommand: vi.fn(async (projectId: number, command: string, _payload: unknown, idempotencyKey: string) => {
    if (projectId !== 42) return null;
    const VALID = ["regenerate_element","apply_style","export_pdf","export_zip",
      "apply_brand_dna","lock_element","unlock_element","advance_stage","revert_stage","request_revision"];
    if (!VALID.includes(command)) {
      return { accepted: false, commandId: "cmd-1", idempotencyKey, status: "rejected", conflictReason: `Command '${command}' is not supported` };
    }
    return { accepted: true, commandId: "cmd-1", idempotencyKey, status: "accepted", resultSummary: {} };
  }),
  listStages: vi.fn(async (projectId: number, page: number, pageSize: number) => {
    if (projectId !== 42) return null;
    return {
      ...mockPaginated,
      items: [
        { stageId: "brief", label: "Brief", order: 0, status: "active", startedAt: null, completedAt: null },
        { stageId: "concept", label: "Concept", order: 1, status: "pending", startedAt: null, completedAt: null },
      ],
      total: 2,
      page,
      pageSize,
      hasMore: false,
    };
  }),
  listArtifacts: vi.fn(async (projectId: number, page: number, pageSize: number) => {
    if (projectId !== 42) return null;
    return { ...mockPaginated, page, pageSize };
  }),
  listProjectEvents: vi.fn(async (projectId: number, page: number, pageSize: number) => {
    if (projectId !== 42) return null;
    return { ...mockPaginated, page, pageSize };
  }),
  requestReview: vi.fn(async (projectId: number) => {
    if (projectId !== 42) return null;
    return {
      reviewId: 99,
      reviewToken: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      reviewUrl: null,
      status: "created",
      message: "Review link created.",
    };
  }),
  checkProjectAccess: vi.fn((_projectId: number, isAdmin: boolean, _token?: string) =>
    isAdmin ? null : "Access denied: provide a valid X-Design-Access-Token or admin credentials",
  ),
}));

// ── Static import after mocks ─────────────────────────────────────────────────

import universalDesignRouter from "../index.js";
import * as facade from "../universalDesignFacade.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_KEY = "test-admin-key-42";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).session = {};
    next();
  });
  app.use(universalDesignRouter);
  return app;
}

function adminHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${ADMIN_KEY}` };
}

beforeEach(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  vi.clearAllMocks();

  // Re-apply default mock implementations after clearAllMocks
  vi.mocked(facade.resolvePluginManifest).mockImplementation((pluginId) =>
    pluginId === "fashion" ? mockManifest : null,
  );
  vi.mocked(facade.getProjectConfig).mockImplementation(async (id) =>
    id === 42 ? mockConfig : null,
  );
  vi.mocked(facade.getProjectOverview).mockImplementation(async (id) =>
    id === 42 ? { ...mockProjectOverview } : null,
  );
  vi.mocked(facade.submitBrief).mockImplementation(async (projectId) => {
    if (projectId !== 42) return null;
    return { briefId: "brief-uuid-1234", projectId, pluginId: "fashion", status: "saved", version: 1, savedAt: "2026-01-01T00:00:00.000Z" };
  });
  vi.mocked(facade.initializeWorkflow).mockImplementation(async (projectId) => {
    if (projectId !== 42) return null;
    return { projectId, workflowId: "fashion-design-workflow-v1", status: "initialized", jobId: null, message: "Workflow initialized successfully" };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (facade.executeCommand as any).mockImplementation(async (projectId: number, command: string, _payload: unknown, idempotencyKey: string) => {
    if (projectId !== 42) return null;
    const VALID = ["regenerate_element","apply_style","export_pdf","export_zip","apply_brand_dna","lock_element","unlock_element","advance_stage","revert_stage","request_revision"];
    if (!VALID.includes(command)) {
      return { accepted: false, commandId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", idempotencyKey, status: "rejected", conflictReason: `Command '${command}' is not supported` };
    }
    return { accepted: true, commandId: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", idempotencyKey, status: "accepted", resultSummary: {} };
  });
  vi.mocked(facade.listStages).mockImplementation(async (projectId, page, pageSize) => {
    if (projectId !== 42) return null;
    return { items: [{ stageId: "brief", label: "Brief", order: 0, status: "active", startedAt: null, completedAt: null }], total: 1, page, pageSize, hasMore: false };
  });
  vi.mocked(facade.listArtifacts).mockImplementation(async (projectId, page, pageSize) => {
    if (projectId !== 42) return null;
    return { items: [], total: 0, page, pageSize, hasMore: false };
  });
  vi.mocked(facade.listProjectEvents).mockImplementation(async (projectId, page, pageSize) => {
    if (projectId !== 42) return null;
    return { items: [], total: 0, page, pageSize, hasMore: false };
  });
  vi.mocked(facade.requestReview).mockImplementation(async (projectId) => {
    if (projectId !== 42) return null;
    return { reviewId: 99, reviewToken: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", reviewUrl: null, status: "created", message: "Review link created." };
  });
  vi.mocked(facade.checkProjectAccess).mockImplementation((_id, isAdmin, _token) =>
    isAdmin ? null : "Access denied: provide a valid X-Design-Access-Token or admin credentials",
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5 & 7 — Plugin manifest (public, no auth)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/plugins/:pluginId/manifest", () => {
  it("(public) returns manifest for known plugin without any auth header", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/plugins/fashion/manifest");
    expect(res.status).toBe(200);
    expect(res.body.pluginId).toBe("fashion");
    expect(res.body.artifactTypes).toBeInstanceOf(Array);
    expect(res.body.stages).toBeInstanceOf(Array);
  });

  it("(5) returns 404 PLUGIN_NOT_SUPPORTED for unknown plugin", async () => {
    vi.mocked(facade.resolvePluginManifest).mockReturnValue(null);
    const res = await request(buildApp()).get("/ai/design/v1/plugins/unknown-domain/manifest");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLUGIN_NOT_SUPPORTED");
  });

  it("(7) safe projection: no internal engine IDs, AI model names, or storage paths", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/plugins/fashion/manifest");
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/internalEngineId|aiModel|storagePath|apiKey/i);
    expect(res.body.workflowId).toBeDefined();
  });

  it("propagates X-Correlation-Id to response", async () => {
    const res = await request(buildApp())
      .get("/ai/design/v1/plugins/fashion/manifest")
      .set("X-Correlation-Id", "corr-abc-123");
    expect(res.headers["x-correlation-id"]).toBe("corr-abc-123");
  });

  it("validates pluginId format — rejects uppercase letters", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/plugins/Fashion/manifest");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates pluginId format — rejects underscore characters", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/plugins/bad_id/manifest");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates pluginId max length (64 chars)", async () => {
    const longId = "a".repeat(65);
    const res = await request(buildApp()).get(`/ai/design/v1/plugins/${longId}/manifest`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1, 2, 3 — Project overview
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/projects/:id", () => {
  it("(1) returns project overview when valid admin key present", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
    expect(res.body.name).toBe("Test Project — Fashion");
  });

  it("(1) safe projection: canvasState JSONB is never included in overview response", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("canvasState");
  });

  it("(2) returns 403 FORBIDDEN when no admin key and no design access token", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("(3) returns 403 FORBIDDEN when Authorization header has wrong key", async () => {
    const res = await request(buildApp())
      .get("/ai/design/v1/projects/42")
      .set("Authorization", "Bearer totally-wrong-key");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 NOT_FOUND when project does not exist", async () => {
    vi.mocked(facade.getProjectOverview).mockResolvedValue(null);
    const res = await request(buildApp()).get("/ai/design/v1/projects/9999").set(adminHeaders());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("validates id is numeric — rejects non-numeric id", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/abc").set(adminHeaders());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Config endpoint
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/projects/:id/config", () => {
  it("returns config with embedded manifest", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/config").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(42);
    expect(res.body.manifest).toBeDefined();
    expect(res.body.manifest.pluginId).toBe("fashion");
    expect(res.body.briefSchemaVersion).toBe("v1");
  });

  it("returns 403 for unauthenticated request", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/config");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4 — Brief: validation errors
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /ai/design/v1/projects/:id/brief", () => {
  it("(4) returns 400 VALIDATION_ERROR when fields is absent", async () => {
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/42/brief")
      .set(adminHeaders())
      .send({ idempotencyKey: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("(4) returns 400 VALIDATION_ERROR when fields is a string, not object", async () => {
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/42/brief")
      .set(adminHeaders())
      .send({ fields: "not-an-object" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("(4) returns 400 VALIDATION_ERROR when idempotencyKey is not a UUID", async () => {
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/42/brief")
      .set(adminHeaders())
      .send({ fields: { style: "bold" }, idempotencyKey: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("(2) returns 403 FORBIDDEN when no credentials", async () => {
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/42/brief")
      .send({ fields: { style: "clean" } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("accepts valid brief and returns save confirmation", async () => {
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/42/brief")
      .set(adminHeaders())
      .send({ fields: { style: "minimalist", targetAudience: "youth" } });
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe(42);
    expect(["saved", "updated"]).toContain(res.body.status);
    expect(typeof res.body.briefId).toBe("string");
    expect(typeof res.body.version).toBe("number");
  });

  it("returns 404 when project not found", async () => {
    vi.mocked(facade.submitBrief).mockResolvedValue(null);
    const res = await request(buildApp())
      .put("/ai/design/v1/projects/9999/brief")
      .set(adminHeaders())
      .send({ fields: { style: "classic" } });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5, 6 — Commands: unsupported + idempotency conflict
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /ai/design/v1/projects/:id/commands", () => {
  it("(5) returns 422 PLUGIN_NOT_SUPPORTED for unrecognized command", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/commands")
      .set(adminHeaders())
      .send({ command: "nuke_database", idempotencyKey: "c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PLUGIN_NOT_SUPPORTED");
  });

  it("(6) first accepted call returns 202", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/commands")
      .set(adminHeaders())
      .send({ command: "apply_style", idempotencyKey: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("accepted");
    expect(res.body.commandId).toBeDefined();
  });

  it("(6) duplicate idempotency key → facade returns conflict → 409", async () => {
    vi.mocked(facade.executeCommand).mockResolvedValue({
      accepted: false,
      commandId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" as `${string}-${string}-${string}-${string}-${string}`,
      idempotencyKey: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      status: "conflict" as unknown as "rejected",
      conflictReason: "Duplicate idempotency key",
    });
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/commands")
      .set(adminHeaders())
      .send({ command: "apply_style", idempotencyKey: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("requires idempotencyKey — returns 400 when missing", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/commands")
      .set(adminHeaders())
      .send({ command: "apply_style" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when project not found", async () => {
    vi.mocked(facade.executeCommand).mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/commands")
      .set(adminHeaders())
      .send({ command: "apply_style", idempotencyKey: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8 — Artifact pagination
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/projects/:id/artifacts", () => {
  it("(8) returns paginated response structure", async () => {
    const res = await request(buildApp())
      .get("/ai/design/v1/projects/42/artifacts?page=1&pageSize=10")
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("items");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("pageSize");
    expect(res.body).toHaveProperty("hasMore");
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(10);
  });

  it("(8) pageSize is capped at 100 by Zod schema even if client sends 999", async () => {
    vi.mocked(facade.listArtifacts).mockImplementation(async (_, page, pageSize) => ({
      items: [], total: 0, page, pageSize, hasMore: false,
    }));
    const res = await request(buildApp())
      .get("/ai/design/v1/projects/42/artifacts?page=1&pageSize=999")
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(100);
  });

  it("(8) items array never contains raw storage paths", async () => {
    vi.mocked(facade.listArtifacts).mockResolvedValue({
      items: [{ id: 1, type: "canvas_version", label: "v1", version: 1, url: null, thumbnailUrl: null, status: "available", mimeType: null, createdAt: "2026-01-01T00:00:00.000Z" }],
      total: 1, page: 1, pageSize: 20, hasMore: false,
    });
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/artifacts").set(adminHeaders());
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ai_platform\//);
    expect(body).not.toMatch(/storage\/v1\/object\/authenticated/);
  });

  it("returns 403 FORBIDDEN for unauthenticated request", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/artifacts");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9 — Lifecycle conflict: re-initialize active project
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /ai/design/v1/projects/:id/initialize", () => {
  it("(9) returns 200 already_running when facade says already running", async () => {
    vi.mocked(facade.initializeWorkflow).mockResolvedValue({
      projectId: 42, workflowId: "fashion-design-workflow-v1",
      status: "already_running", jobId: null, message: "Workflow is already running for this project",
    });
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .set(adminHeaders())
      .send({ workflowId: "fashion-design-workflow-v1" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("already_running");
    expect(res.body.message).toMatch(/already running/i);
  });

  it("(9) returns 201 initialized for a fresh project", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .set(adminHeaders())
      .send({ workflowId: "fashion-design-workflow-v1" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("initialized");
  });

  it("(3) returns 401 UNAUTHORIZED when no admin credentials", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .send({ workflowId: "fashion-design-workflow-v1" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("validates workflowId is required", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .set(adminHeaders())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates priority enum — rejects invalid value", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .set(adminHeaders())
      .send({ workflowId: "fashion-design-workflow-v1", priority: "ultra" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10 — Review: security regression (token hash never exposed)
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /ai/design/v1/projects/:id/review", () => {
  it("(10) creates review link and returns plain token — never the hash", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .set(adminHeaders())
      .send({ type: "approval", clientEmail: "client@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.reviewToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(res.body.reviewId).toBe(99);
    const body = JSON.stringify(res.body);
    // Hash must never appear in the response
    expect(body).not.toMatch(/[Hh]ash|sha256/);
  });

  it("(10) returns 401 UNAUTHORIZED for non-admin (review token is sensitive)", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .send({ type: "approval" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("validates type enum — rejects unknown review type", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .set(adminHeaders())
      .send({ type: "refund" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates notes max length (2000 chars)", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .set(adminHeaders())
      .send({ type: "revision", notes: "x".repeat(2001) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates clientEmail format when provided", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .set(adminHeaders())
      .send({ type: "approval", clientEmail: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when project not found", async () => {
    vi.mocked(facade.requestReview).mockResolvedValue(null);
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/review")
      .set(adminHeaders())
      .send({ type: "approval" });
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11 — Internal field redaction in event feed
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/projects/:id/events", () => {
  it("(11) never exposes raw email address in actorRole", async () => {
    vi.mocked(facade.listProjectEvents).mockResolvedValue({
      items: [
        { eventId: "1", eventType: "submit_brief", actorRole: "admin", summary: "Brief submitted", metadata: null, occurredAt: "2026-01-01T00:00:00.000Z" },
      ],
      total: 1, page: 1, pageSize: 20, hasMore: false,
    });
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/events").set(adminHeaders());
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/@/);
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      if (item.actorRole !== null) {
        expect(String(item.actorRole)).not.toMatch(/@/);
      }
    }
  });

  it("(11) metadata field is null in response (internal fields stripped at facade level)", async () => {
    vi.mocked(facade.listProjectEvents).mockResolvedValue({
      items: [
        { eventId: "1", eventType: "initialize_workflow", actorRole: "admin", summary: "Workflow initialized", metadata: null, occurredAt: "2026-01-01T00:00:00.000Z" },
      ],
      total: 1, page: 1, pageSize: 20, hasMore: false,
    });
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/events").set(adminHeaders());
    expect(res.status).toBe(200);
    for (const item of res.body.items as Array<Record<string, unknown>>) {
      expect(item.metadata).toBeNull();
    }
  });

  it("returns paginated structure with correct page/pageSize", async () => {
    const res = await request(buildApp())
      .get("/ai/design/v1/projects/42/events?page=2&pageSize=5")
      .set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.pageSize).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stages
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /ai/design/v1/projects/:id/stages", () => {
  it("returns stage list for the project's plugin domain", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/stages").set(adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const stage of res.body.items as Array<Record<string, unknown>>) {
      expect(stage).toHaveProperty("stageId");
      expect(stage).toHaveProperty("label");
      expect(stage).toHaveProperty("status");
    }
  });

  it("returns 403 for unauthenticated request", async () => {
    const res = await request(buildApp()).get("/ai/design/v1/projects/42/stages");
    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B2 — Session-based admin auth (req.internalUser replaces req.session)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds an app that simulates adminAuth having run and validated a session
 * cookie — i.e. req.internalUser is populated, no API key header needed.
 */
function buildAppWithInternalUser() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).internalUser = {
      id: 1,
      email: "admin@cstlogistic.co.id",
      role: "superadmin",
      accountType: "internal",
      status: "active",
    };
    next();
  });
  app.use(universalDesignRouter);
  return app;
}

describe("B2 — Session-based admin (req.internalUser)", () => {
  it("(session admin valid → berhasil) session admin can initialize workflow without API key", async () => {
    const res = await request(buildAppWithInternalUser())
      .post("/ai/design/v1/projects/42/initialize")
      .send({ workflowId: "fashion-design-workflow-v1" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("initialized");
  });

  it("(session admin valid → berhasil) session admin can create review link without API key", async () => {
    const res = await request(buildAppWithInternalUser())
      .post("/ai/design/v1/projects/42/review")
      .send({ type: "approval", clientEmail: "client@example.com" });
    expect(res.status).toBe(201);
    expect(res.body.reviewToken).toBeDefined();
  });

  it("(session admin valid → berhasil) session admin can read project overview without API key", async () => {
    const res = await request(buildAppWithInternalUser())
      .get("/ai/design/v1/projects/42");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });

  it("(tanpa session → 401) no internalUser, no API key → initialize returns 401", async () => {
    const res = await request(buildApp())
      .post("/ai/design/v1/projects/42/initialize")
      .send({ workflowId: "fashion-design-workflow-v1" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("(user non-admin → 403) no credentials → project overview returns 403 FORBIDDEN", async () => {
    const res = await request(buildApp())
      .get("/ai/design/v1/projects/42");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("(security regression) req.session.userId/role is NOT trusted — must not grant admin access", async () => {
    // Old code checked req.session.userId && req.session.role === "admin".
    // This test verifies that raw session data injected without going through
    // adminAuth does not grant admin access after the B2 fix.
    const appOldStyleSession = express();
    appOldStyleSession.use(express.json());
    appOldStyleSession.use((req, _res, next) => {
      // Inject raw session like the old pattern — this must NOT grant admin access
      (req as unknown as Record<string, unknown>).session = { userId: 999, role: "admin" };
      next();
    });
    appOldStyleSession.use(universalDesignRouter);

    const res = await request(appOldStyleSession)
      .post("/ai/design/v1/projects/42/initialize")
      .send({ workflowId: "fashion-design-workflow-v1" });
    // Without req.internalUser or a valid API key, must be rejected
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
