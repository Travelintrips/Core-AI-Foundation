/**
 * Team 16 — Design Review and Approval Workspace
 *
 * Universal workspace for internal + client review management.
 * All routes are admin-authenticated. Public review flow is unchanged
 * (public-review.ts and cp-review.ts are untouched).
 *
 * Mount: router.use(reviewWorkspaceRouter) in routes/index.ts
 * Prefix: /review-workspace/...
 */

import { Router } from "express";
import {
  ensureWorkspaceMetaTable,
  getReview,
  getMeta,
  getWorkspaceSummary,
  getProjectReviews,
  getReviewHistory,
  getChecklist,
  toggleChecklistItem,
  setDueDate,
  internalSignOff,
  removeInternalSignOff,
  cancelReview,
  computePermissions,
} from "../services/reviewWorkspaceService.js";
import { clientReviewLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// ── Ensure DB schema exists on module load ────────────────────────────────────
ensureWorkspaceMetaTable().catch((err: unknown) => {
  console.error("[review-workspace] Schema ensure failed:", err);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeReview(r: NonNullable<ReturnType<typeof getReview> extends Promise<infer T> ? T : never>) {
  return {
    ...r,
    tokenExpiresAt: r.tokenExpiresAt.toISOString(),
    sharedAt: r.sharedAt?.toISOString() ?? null,
    viewedAt: r.viewedAt?.toISOString() ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    rejectedAt: r.rejectedAt?.toISOString() ?? null,
    revisionRequestedAt: r.revisionRequestedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    // Never expose token hash or plaintext token
    reviewTokenHash: undefined,
    reviewTokenPlain: undefined,
  };
}

function serializeMeta(m: NonNullable<Awaited<ReturnType<typeof getMeta>>>) {
  return {
    id: m.id,
    reviewId: m.reviewId,
    dueDate: m.dueDate?.toISOString() ?? null,
    internalSignedOff: m.internalSignedOff,
    internalSignedOffBy: m.internalSignedOffBy ?? null,
    internalSignedOffAt: m.internalSignedOffAt?.toISOString() ?? null,
    checklistState: m.checklistState,
    cancelReason: m.cancelReason ?? null,
    cancelledBy: m.cancelledBy ?? null,
    cancelledAt: m.cancelledAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

// ── GET /review-workspace/projects/:projectId/reviews ─────────────────────────

router.get("/review-workspace/projects/:projectId/reviews", clientReviewLimiter, async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  try {
    const entries = await getProjectReviews(projectId);
    res.json(
      entries.map(({ review, meta, wsStatus, permissions }) => ({
        review: serializeReview(review),
        meta: meta ? serializeMeta(meta) : null,
        wsStatus,
        permissions,
      })),
    );
  } catch (err) {
    console.error("[review-workspace] getProjectReviews error:", err);
    res.status(500).json({ error: "Failed to list project reviews" });
  }
});

// ── GET /review-workspace/reviews/:reviewId/summary ──────────────────────────

router.get("/review-workspace/reviews/:reviewId/summary", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  try {
    const summary = await getWorkspaceSummary(reviewId);
    if (!summary) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    res.json({
      review: serializeReview(summary.review),
      project: summary.project,
      meta: summary.meta ? serializeMeta(summary.meta) : null,
      permissions: summary.permissions,
      commentCount: summary.commentCount,
    });
  } catch (err) {
    console.error("[review-workspace] getWorkspaceSummary error:", err);
    res.status(500).json({ error: "Failed to load workspace summary" });
  }
});

// ── GET /review-workspace/reviews/:reviewId/history ──────────────────────────

router.get("/review-workspace/reviews/:reviewId/history", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    const history = await getReviewHistory(reviewId);
    res.json({ reviewId, history });
  } catch (err) {
    console.error("[review-workspace] getReviewHistory error:", err);
    res.status(500).json({ error: "Failed to load review history" });
  }
});

// ── GET /review-workspace/reviews/:reviewId/checklist ────────────────────────

router.get("/review-workspace/reviews/:reviewId/checklist", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }
    const domain = typeof req.query["domain"] === "string" ? req.query["domain"] : undefined;
    const items = await getChecklist(reviewId, domain);
    res.json({ reviewId, items });
  } catch (err) {
    console.error("[review-workspace] getChecklist error:", err);
    res.status(500).json({ error: "Failed to load checklist" });
  }
});

// ── PATCH /review-workspace/reviews/:reviewId/checklist/:itemId ──────────────

router.patch("/review-workspace/reviews/:reviewId/checklist/:itemId", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  const itemId = req.params["itemId"] as string;
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  const { completed, completedBy } = (req.body ?? {}) as {
    completed?: unknown;
    completedBy?: unknown;
  };

  if (typeof completed !== "boolean") {
    res.status(400).json({ error: "completed (boolean) is required" });
    return;
  }
  const actor = typeof completedBy === "string" && completedBy.trim() ? completedBy.trim() : "internal";

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    // Check permission to manage checklist
    const meta = await getMeta(reviewId);
    const perms = computePermissions(review, meta);
    if (!perms.has("can_manage_checklist")) {
      res.status(409).json({ error: "Checklist cannot be modified in the current review state." });
      return;
    }

    const items = await toggleChecklistItem(reviewId, itemId, completed, actor);
    res.json({ reviewId, items });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400) {
      res.status(400).json({ error: e.message ?? "Invalid checklist item" });
      return;
    }
    console.error("[review-workspace] toggleChecklistItem error:", err);
    res.status(500).json({ error: "Failed to update checklist" });
  }
});

// ── PATCH /review-workspace/reviews/:reviewId/due-date ───────────────────────

router.patch("/review-workspace/reviews/:reviewId/due-date", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  const { dueDate } = (req.body ?? {}) as { dueDate?: unknown };

  let parsedDate: Date | null = null;
  if (dueDate !== null && dueDate !== undefined) {
    if (typeof dueDate !== "string") {
      res.status(400).json({ error: "dueDate must be an ISO date string or null" });
      return;
    }
    parsedDate = new Date(dueDate);
    if (isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: "dueDate is not a valid date" });
      return;
    }
  }

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const meta = await getMeta(reviewId);
    const perms = computePermissions(review, meta);
    if (!perms.has("can_set_due_date")) {
      res.status(409).json({ error: "Due date cannot be set in the current review state." });
      return;
    }

    const updatedMeta = await setDueDate(reviewId, parsedDate);
    res.json({ reviewId, meta: serializeMeta(updatedMeta) });
  } catch (err) {
    console.error("[review-workspace] setDueDate error:", err);
    res.status(500).json({ error: "Failed to set due date" });
  }
});

// ── POST /review-workspace/reviews/:reviewId/internal-sign-off ───────────────

router.post("/review-workspace/reviews/:reviewId/internal-sign-off", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  const { signedOffBy } = (req.body ?? {}) as { signedOffBy?: unknown };
  if (!signedOffBy || typeof signedOffBy !== "string" || !signedOffBy.trim()) {
    res.status(400).json({ error: "signedOffBy is required" });
    return;
  }

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const meta = await getMeta(reviewId);
    const perms = computePermissions(review, meta);
    if (!perms.has("can_sign_off")) {
      res.status(409).json({
        error: meta?.internalSignedOff
          ? "Review is already signed off."
          : "Internal sign-off is not allowed in the current review state.",
      });
      return;
    }

    const updatedMeta = await internalSignOff(reviewId, signedOffBy.trim());
    res.json({ reviewId, meta: serializeMeta(updatedMeta) });
  } catch (err) {
    console.error("[review-workspace] internalSignOff error:", err);
    res.status(500).json({ error: "Failed to record sign-off" });
  }
});

// ── DELETE /review-workspace/reviews/:reviewId/internal-sign-off ─────────────

router.delete("/review-workspace/reviews/:reviewId/internal-sign-off", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  try {
    const review = await getReview(reviewId);
    if (!review) {
      res.status(404).json({ error: "Review not found" });
      return;
    }

    const meta = await getMeta(reviewId);
    const perms = computePermissions(review, meta);
    if (!perms.has("can_remove_sign_off")) {
      res.status(409).json({ error: "No sign-off to remove, or sign-off cannot be removed in the current state." });
      return;
    }

    const updatedMeta = await removeInternalSignOff(reviewId);
    res.json({ reviewId, meta: serializeMeta(updatedMeta) });
  } catch (err) {
    console.error("[review-workspace] removeInternalSignOff error:", err);
    res.status(500).json({ error: "Failed to remove sign-off" });
  }
});

// ── POST /review-workspace/reviews/:reviewId/cancel ──────────────────────────

router.post("/review-workspace/reviews/:reviewId/cancel", clientReviewLimiter, async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  const { reason, cancelledBy } = (req.body ?? {}) as {
    reason?: unknown;
    cancelledBy?: unknown;
  };

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required to cancel a review" });
    return;
  }
  const actor = typeof cancelledBy === "string" && cancelledBy.trim() ? cancelledBy.trim() : "internal";

  try {
    const { review, meta } = await cancelReview(reviewId, reason.trim(), actor);
    res.json({
      success: true,
      wsStatus: "canceled",
      review: serializeReview(review),
      meta: serializeMeta(meta),
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 409) {
      res.status(409).json({ error: e.message ?? "Cannot cancel review" });
      return;
    }
    console.error("[review-workspace] cancelReview error:", err);
    res.status(500).json({ error: "Failed to cancel review" });
  }
});

export default router;
