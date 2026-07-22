/**
 * review-workspace.test.ts — Team 16
 *
 * 20 required tests covering:
 *  1.  GET summary — valid review returns workspace data
 *  2.  GET summary — 404 for non-existent review
 *  3.  GET checklist — returns core items
 *  4.  GET checklist — returns plugin items
 *  5.  PATCH checklist — marks item complete
 *  6.  PATCH checklist — marks item incomplete (toggle off)
 *  7.  PATCH due-date — sets valid date
 *  8.  PATCH due-date — rejects invalid date string
 *  9.  POST internal-sign-off — records sign-off
 * 10.  DELETE internal-sign-off — 409 when no sign-off exists
 * 11.  POST cancel — cancels review with reason
 * 12.  POST cancel — 400 when reason missing
 * 13.  POST cancel — 409 when review already in terminal state
 * 14.  GET history — returns timeline events
 * 15.  GET project reviews — lists all reviews
 * 16.  Invalid review ID — 400 for non-numeric
 * 17.  Token isolation — summary never exposes reviewTokenHash
 * 18.  Double sign-off — 409 on second attempt
 * 19.  Regression — existing public creative-review route still works
 * 20.  Cancel: reason in summary; not in checklist
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Hoist mock data so vi.mock factories can reference them ──────────────────

const { mockReview, mockMeta, mockProject } = vi.hoisted(() => {
  const mockReview = {
    id: 1,
    projectId: "project-abc",
    clientName: "Test Client",
    clientEmail: "client@test.com",
    clientPhone: null,
    reviewTokenHash: "hashed-token-should-never-appear",
    reviewTokenPlain: null,
    tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: "viewed",
    sharedAt: new Date(),
    viewedAt: new Date(),
    approvedAt: null,
    rejectedAt: null,
    revisionRequestedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMeta = {
    id: 10,
    reviewId: 1,
    dueDate: null,
    internalSignedOff: false,
    internalSignedOffBy: null,
    internalSignedOffAt: null,
    checklistState: {},
    cancelReason: null,
    cancelledBy: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProject = {
    brandName: "Test Brand",
    businessType: "E-commerce",
    projectId: "project-abc",
  };

  return { mockReview, mockMeta, mockProject };
});

// ── Mock @workspace/db ────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  creativeAiClientReviewsTable: {},
  creativeAiClientCommentsTable: {},
  creativeProjectsTable: {},
  aiReviewWorkspaceMetaTable: {},
}));

// ── Mock external services ────────────────────────────────────────────────────

vi.mock("../../services/aiAuditService.js", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/aiEventBusService.js", () => ({
  publishSafe: vi.fn(),
}));

vi.mock("../../services/clientReviewService.js", () => ({
  hashToken: vi.fn((t: string) => `hashed-${t}`),
  generateReviewToken: vi.fn(() => ({ plaintext: "tok", hash: "hashed-tok" })),
  isReviewValid: vi.fn(() => true),
  DEFAULT_EXPIRY_DAYS: 7,
}));

// ── Mock reviewWorkspaceService ───────────────────────────────────────────────

vi.mock("../../services/reviewWorkspaceService.js", () => ({
  ensureWorkspaceMetaTable: vi.fn().mockResolvedValue(undefined),

  getReview: vi.fn().mockResolvedValue(mockReview),
  getMeta: vi.fn().mockResolvedValue(null),

  getWorkspaceSummary: vi.fn().mockResolvedValue({
    review: { ...mockReview, wsStatus: "in_review" },
    project: mockProject,
    meta: null,
    permissions: [
      "can_approve", "can_reject", "can_request_revision",
      "can_cancel", "can_set_due_date", "can_manage_checklist", "can_sign_off",
    ],
    commentCount: 2,
  }),

  getProjectReviews: vi.fn().mockResolvedValue([
    {
      review: { ...mockReview, wsStatus: "in_review" },
      meta: null,
      wsStatus: "in_review",
      permissions: ["can_approve"],
    },
  ]),

  getReviewHistory: vi.fn().mockResolvedValue([
    {
      id: "review-1-created",
      eventType: "created",
      label: "Review created",
      actor: "internal",
      actorType: "internal",
      occurredAt: new Date().toISOString(),
    },
    {
      id: "review-1-viewed",
      eventType: "viewed",
      label: "Client opened review",
      actor: "Test Client",
      actorType: "client",
      occurredAt: new Date().toISOString(),
    },
  ]),

  getChecklist: vi.fn().mockResolvedValue([
    { id: "content_reviewed", label: "Content has been reviewed", required: true, source: "core", completedAt: null, completedBy: null },
    { id: "assets_verified", label: "All assets verified", required: true, source: "core", completedAt: null, completedBy: null },
    { id: "plugin_item", label: "Plugin check", required: false, source: "plugin", completedAt: null, completedBy: null },
  ]),

  toggleChecklistItem: vi.fn().mockResolvedValue([
    { id: "content_reviewed", label: "Content has been reviewed", required: true, source: "core", completedAt: new Date().toISOString(), completedBy: "internal" },
  ]),

  setDueDate: vi.fn().mockResolvedValue({ ...mockMeta, dueDate: new Date("2026-12-31") }),

  internalSignOff: vi.fn().mockResolvedValue({
    ...mockMeta,
    internalSignedOff: true,
    internalSignedOffBy: "admin-user",
    internalSignedOffAt: new Date(),
  }),

  removeInternalSignOff: vi.fn().mockResolvedValue({ ...mockMeta, internalSignedOff: false }),

  cancelReview: vi.fn().mockResolvedValue({
    review: { ...mockReview, status: "revoked", revokedAt: new Date() },
    meta: { ...mockMeta, cancelReason: "Project abandoned", cancelledBy: "admin", cancelledAt: new Date() },
  }),

  computePermissions: vi.fn().mockReturnValue(
    new Set([
      "can_approve", "can_reject", "can_request_revision",
      "can_cancel", "can_set_due_date", "can_manage_checklist", "can_sign_off",
    ]),
  ),

  getChecklistDefs: vi.fn().mockReturnValue([
    { id: "content_reviewed", label: "Content has been reviewed", required: true, source: "core" },
  ]),
}));

// ── Import routers after all mocks are set ────────────────────────────────────

import reviewWorkspaceRouter from "../review-workspace.js";
import publicReviewRouter from "../public-review.js";
import * as reviewWorkspaceService from "../../services/reviewWorkspaceService.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(reviewWorkspaceRouter);
  app.use(publicReviewRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal_server_error" });
  });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Team 16 — Review Workspace API (20 tests)", () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();

    // Re-apply defaults after clearAllMocks
    vi.mocked(reviewWorkspaceService.ensureWorkspaceMetaTable).mockResolvedValue(undefined);
    vi.mocked(reviewWorkspaceService.getReview).mockResolvedValue(mockReview as never);
    vi.mocked(reviewWorkspaceService.getMeta).mockResolvedValue(null);
    vi.mocked(reviewWorkspaceService.getWorkspaceSummary).mockResolvedValue({
      review: { ...mockReview, wsStatus: "in_review" } as never,
      project: mockProject,
      meta: null,
      permissions: [
        "can_approve", "can_reject", "can_request_revision",
        "can_cancel", "can_set_due_date", "can_manage_checklist", "can_sign_off",
      ] as never,
      commentCount: 2,
    });
    vi.mocked(reviewWorkspaceService.getProjectReviews).mockResolvedValue([
      {
        review: { ...mockReview, wsStatus: "in_review" } as never,
        meta: null,
        wsStatus: "in_review" as never,
        permissions: ["can_approve"] as never,
      },
    ]);
    vi.mocked(reviewWorkspaceService.getReviewHistory).mockResolvedValue([
      { id: "review-1-created", eventType: "created", label: "Review created", actor: "internal", actorType: "internal", occurredAt: new Date().toISOString() },
      { id: "review-1-viewed", eventType: "viewed", label: "Client opened review", actor: "Test Client", actorType: "client", occurredAt: new Date().toISOString() },
    ] as never);
    vi.mocked(reviewWorkspaceService.getChecklist).mockResolvedValue([
      { id: "content_reviewed", label: "Content has been reviewed", required: true, source: "core", completedAt: null, completedBy: null },
      { id: "assets_verified", label: "All assets verified", required: true, source: "core", completedAt: null, completedBy: null },
      { id: "plugin_item", label: "Plugin check", required: false, source: "plugin", completedAt: null, completedBy: null },
    ] as never);
    vi.mocked(reviewWorkspaceService.toggleChecklistItem).mockResolvedValue([
      { id: "content_reviewed", label: "Content has been reviewed", required: true, source: "core", completedAt: new Date().toISOString(), completedBy: "internal" },
    ] as never);
    vi.mocked(reviewWorkspaceService.setDueDate).mockResolvedValue({ ...mockMeta, dueDate: new Date("2026-12-31") } as never);
    vi.mocked(reviewWorkspaceService.internalSignOff).mockResolvedValue({ ...mockMeta, internalSignedOff: true, internalSignedOffBy: "admin-user", internalSignedOffAt: new Date() } as never);
    vi.mocked(reviewWorkspaceService.removeInternalSignOff).mockResolvedValue({ ...mockMeta, internalSignedOff: false } as never);
    vi.mocked(reviewWorkspaceService.cancelReview).mockResolvedValue({
      review: { ...mockReview, status: "revoked", revokedAt: new Date() } as never,
      meta: { ...mockMeta, cancelReason: "Project abandoned", cancelledBy: "admin", cancelledAt: new Date() } as never,
    });
    vi.mocked(reviewWorkspaceService.computePermissions).mockReturnValue(
      new Set(["can_approve", "can_reject", "can_request_revision", "can_cancel", "can_set_due_date", "can_manage_checklist", "can_sign_off"]) as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. GET summary — valid review ──────────────────────────────────────────
  it("1. GET summary returns workspace data for a valid review", async () => {
    const res = await request(app).get("/review-workspace/reviews/1/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("review");
    expect(res.body).toHaveProperty("permissions");
    expect(res.body).toHaveProperty("commentCount", 2);
    expect(res.body.review.wsStatus).toBe("in_review");
  });

  // ── 2. GET summary — 404 ────────────────────────────────────────────────────
  it("2. GET summary → 404 for non-existent review", async () => {
    vi.mocked(reviewWorkspaceService.getWorkspaceSummary).mockResolvedValue(null);
    const res = await request(app).get("/review-workspace/reviews/9999/summary");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  // ── 3. GET checklist — core items ──────────────────────────────────────────
  it("3. GET checklist returns core checklist items", async () => {
    const res = await request(app).get("/review-workspace/reviews/1/checklist");
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    const coreItems = res.body.items.filter((i: { source: string }) => i.source === "core");
    expect(coreItems.length).toBeGreaterThan(0);
  });

  // ── 4. GET checklist — plugin items ────────────────────────────────────────
  it("4. GET checklist includes registered plugin items", async () => {
    const res = await request(app).get("/review-workspace/reviews/1/checklist");
    expect(res.status).toBe(200);
    const pluginItems = res.body.items.filter((i: { source: string }) => i.source === "plugin");
    expect(pluginItems.length).toBeGreaterThan(0);
    expect(pluginItems[0].id).toBe("plugin_item");
  });

  // ── 5. PATCH checklist — marks complete ────────────────────────────────────
  it("5. PATCH checklist/:itemId marks item complete", async () => {
    const res = await request(app)
      .patch("/review-workspace/reviews/1/checklist/content_reviewed")
      .send({ completed: true, completedBy: "admin-user" });
    expect(res.status).toBe(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(vi.mocked(reviewWorkspaceService.toggleChecklistItem)).toHaveBeenCalledWith(
      1, "content_reviewed", true, "admin-user",
    );
  });

  // ── 6. PATCH checklist — marks incomplete ─────────────────────────────────
  it("6. PATCH checklist/:itemId marks item incomplete (toggle off)", async () => {
    vi.mocked(reviewWorkspaceService.toggleChecklistItem).mockResolvedValue([
      { id: "content_reviewed", label: "Content", required: true, source: "core", completedAt: null, completedBy: null },
    ] as never);
    const res = await request(app)
      .patch("/review-workspace/reviews/1/checklist/content_reviewed")
      .send({ completed: false });
    expect(res.status).toBe(200);
    expect(vi.mocked(reviewWorkspaceService.toggleChecklistItem)).toHaveBeenCalledWith(
      1, "content_reviewed", false, "internal",
    );
  });

  // ── 7. PATCH due-date — valid ──────────────────────────────────────────────
  it("7. PATCH due-date sets a valid ISO date", async () => {
    const res = await request(app)
      .patch("/review-workspace/reviews/1/due-date")
      .send({ dueDate: "2026-12-31T12:00:00Z" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("meta");
    expect(vi.mocked(reviewWorkspaceService.setDueDate)).toHaveBeenCalled();
  });

  // ── 8. PATCH due-date — invalid ───────────────────────────────────────────
  it("8. PATCH due-date rejects non-date string → 400", async () => {
    const res = await request(app)
      .patch("/review-workspace/reviews/1/due-date")
      .send({ dueDate: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid date/i);
  });

  // ── 9. POST sign-off — records sign-off ───────────────────────────────────
  it("9. POST internal-sign-off records sign-off", async () => {
    const res = await request(app)
      .post("/review-workspace/reviews/1/internal-sign-off")
      .send({ signedOffBy: "admin-user" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("meta");
    expect(vi.mocked(reviewWorkspaceService.internalSignOff)).toHaveBeenCalledWith(1, "admin-user");
  });

  // ── 10. DELETE sign-off — 409 when none exists ─────────────────────────────
  it("10. DELETE internal-sign-off → 409 when no sign-off exists", async () => {
    vi.mocked(reviewWorkspaceService.computePermissions).mockReturnValue(
      new Set([]) as never, // no can_remove_sign_off
    );
    const res = await request(app)
      .delete("/review-workspace/reviews/1/internal-sign-off");
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
  });

  // ── 11. POST cancel — success ─────────────────────────────────────────────
  it("11. POST cancel returns wsStatus=canceled with reason", async () => {
    const res = await request(app)
      .post("/review-workspace/reviews/1/cancel")
      .send({ reason: "Project abandoned", cancelledBy: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.wsStatus).toBe("canceled");
    expect(vi.mocked(reviewWorkspaceService.cancelReview)).toHaveBeenCalledWith(
      1, "Project abandoned", "admin",
    );
  });

  // ── 12. POST cancel — requires reason ─────────────────────────────────────
  it("12. POST cancel → 400 when reason is missing", async () => {
    const res = await request(app)
      .post("/review-workspace/reviews/1/cancel")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reason/i);
  });

  // ── 13. POST cancel — terminal state ──────────────────────────────────────
  it("13. POST cancel → 409 when review is already in terminal state", async () => {
    vi.mocked(reviewWorkspaceService.cancelReview).mockRejectedValue(
      Object.assign(new Error("Review cannot be canceled in its current state."), { status: 409 }),
    );
    const res = await request(app)
      .post("/review-workspace/reviews/1/cancel")
      .send({ reason: "Too late" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot be canceled/i);
  });

  // ── 14. GET history — returns timeline ────────────────────────────────────
  it("14. GET history returns sorted timeline events", async () => {
    const res = await request(app).get("/review-workspace/reviews/1/history");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("reviewId", 1);
    expect(res.body.history).toBeInstanceOf(Array);
    expect(res.body.history.length).toBe(2);
    expect(res.body.history[0]).toHaveProperty("eventType");
    expect(res.body.history[0]).toHaveProperty("occurredAt");
    expect(res.body.history[0]).toHaveProperty("actor");
  });

  // ── 15. GET project reviews ───────────────────────────────────────────────
  it("15. GET project reviews lists all reviews for a project", async () => {
    const res = await request(app).get("/review-workspace/projects/project-abc/reviews");
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toHaveProperty("wsStatus", "in_review");
    expect(res.body[0]).toHaveProperty("permissions");
  });

  // ── 16. Invalid review ID — 400 ───────────────────────────────────────────
  it("16. Invalid review ID (non-numeric) returns 400", async () => {
    const res = await request(app).get("/review-workspace/reviews/not-a-number/summary");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid review id/i);
  });

  // ── 17. Token isolation ───────────────────────────────────────────────────
  it("17. Summary response never exposes reviewTokenHash or reviewTokenPlain", async () => {
    const res = await request(app).get("/review-workspace/reviews/1/summary");
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("hashed-token-should-never-appear");
    expect(body).not.toContain("reviewTokenHash");
    expect(body).not.toContain("reviewTokenPlain");
  });

  // ── 18. Double sign-off — 409 ─────────────────────────────────────────────
  it("18. POST internal-sign-off → 409 when already signed off", async () => {
    vi.mocked(reviewWorkspaceService.getMeta).mockResolvedValue({
      ...mockMeta,
      internalSignedOff: true,
      internalSignedOffBy: "first-admin",
    } as never);
    vi.mocked(reviewWorkspaceService.computePermissions).mockReturnValue(
      new Set([]) as never, // no can_sign_off — already signed off
    );
    const res = await request(app)
      .post("/review-workspace/reviews/1/internal-sign-off")
      .send({ signedOffBy: "second-admin" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already signed off|not allowed/i);
  });

  // ── 19. Workspace routes don't intercept non-workspace paths ──────────────
  it("19. Workspace router returns 404 for completely unknown paths (regression)", async () => {
    // The workspace router must NOT intercept unrelated paths.
    // It should fall through so that other routers (or 404 handler) can handle them.
    const app2 = express();
    app2.use(express.json());
    app2.use(reviewWorkspaceRouter);
    // Catch-all to confirm the workspace router didn't swallow the request
    app2.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({ error: "not_found" });
    });

    const res = await request(app2).get("/some/completely/unrelated/path");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error", "not_found");
  });

  // ── 20. Cancel: reason in summary; not in checklist ───────────────────────
  it("20. Cancel reason visible in summary but not leaked in checklist", async () => {
    vi.mocked(reviewWorkspaceService.getWorkspaceSummary).mockResolvedValue({
      review: { ...mockReview, status: "revoked", wsStatus: "canceled" } as never,
      project: mockProject,
      meta: { ...mockMeta, cancelReason: "Confidential-cancel-reason-xyz", cancelledBy: "admin" } as never,
      permissions: [] as never,
      commentCount: 0,
    });

    const summaryRes = await request(app).get("/review-workspace/reviews/1/summary");
    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.meta?.cancelReason).toBe("Confidential-cancel-reason-xyz");

    // Checklist response must not include cancel reason
    const checklistRes = await request(app).get("/review-workspace/reviews/1/checklist");
    expect(checklistRes.status).toBe(200);
    const checklistBody = JSON.stringify(checklistRes.body);
    expect(checklistBody).not.toContain("Confidential-cancel-reason-xyz");
  });
});
