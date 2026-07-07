import { Router } from "express";
import { eq, desc, and, count, avg, sql } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  creativeAiClientCommentsTable,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import {
  generateReviewToken,
  DEFAULT_EXPIRY_DAYS,
} from "../services/clientReviewService.js";
import { clientReviewNotificationService } from "../services/clientReviewNotificationService.js";

const router = Router();

// ── Admin: Create a review link ────────────────────────────────────────────────

/** POST /api/creative-ai/projects/:id/client-review-link */
router.post("/creative-ai/projects/:id/client-review-link", async (req, res): Promise<void> => {
  const projectId = req.params.id as string;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const { clientName, clientEmail, clientPhone, expiresInDays } = (req.body ?? {}) as {
    clientName?: unknown;
    clientEmail?: unknown;
    clientPhone?: unknown;
    expiresInDays?: unknown;
  };

  if (!clientName || typeof clientName !== "string" || clientName.trim().length === 0) {
    res.status(400).json({ error: "clientName is required" });
    return;
  }

  const parsedDays = expiresInDays != null ? parseInt(String(expiresInDays), 10) : DEFAULT_EXPIRY_DAYS;
  if (isNaN(parsedDays) || parsedDays < 1 || parsedDays > 90) {
    res.status(400).json({ error: "expiresInDays must be between 1 and 90" });
    return;
  }
  const { plaintext, hash } = generateReviewToken();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + parsedDays);

  const [review] = await db
    .insert(creativeAiClientReviewsTable)
    .values({
      projectId,
      clientName: clientName.trim(),
      clientEmail: (typeof clientEmail === "string" && clientEmail.trim()) ? clientEmail.trim() : null,
      clientPhone: (typeof clientPhone === "string" && clientPhone.trim()) ? clientPhone.trim() : null,
      reviewTokenHash: hash,
      tokenExpiresAt: expiresAt,
      status: "shared",
      sharedAt: new Date(),
    })
    .returning();

  await clientReviewNotificationService
    .notifyReviewLinkCreated(projectId, review.id, clientName)
    .catch(() => {});

  res.status(201).json({
    ...review,
    token: plaintext, // Only shown once — client must save this
    tokenExpiresAt: review.tokenExpiresAt.toISOString(),
    sharedAt: review.sharedAt?.toISOString() ?? null,
    viewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    revisionRequestedAt: null,
    revokedAt: null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  });
});

// ── Admin: List reviews for a project ─────────────────────────────────────────

/** GET /api/creative-ai/projects/:id/client-reviews */
router.get("/creative-ai/projects/:id/client-reviews", async (req, res): Promise<void> => {
  const projectId = req.params.id as string;

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const reviews = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.projectId, projectId))
    .orderBy(desc(creativeAiClientReviewsTable.createdAt));

  // Mark expired reviews
  const now = new Date();
  const serialized = reviews.map((r) => {
    const effectiveStatus =
      r.status === "shared" && now > r.tokenExpiresAt ? "expired" : r.status;
    return {
      ...r,
      status: effectiveStatus,
      tokenExpiresAt: r.tokenExpiresAt.toISOString(),
      sharedAt: r.sharedAt?.toISOString() ?? null,
      viewedAt: r.viewedAt?.toISOString() ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectedAt: r.rejectedAt?.toISOString() ?? null,
      revisionRequestedAt: r.revisionRequestedAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  // Attach comment counts
  const withComments = await Promise.all(
    serialized.map(async (r) => {
      const [{ value: commentCount }] = await db
        .select({ value: count() })
        .from(creativeAiClientCommentsTable)
        .where(eq(creativeAiClientCommentsTable.reviewId, r.id));
      return { ...r, commentCount };
    }),
  );

  res.json(withComments);
});

// ── Admin: Revoke a review link ────────────────────────────────────────────────

/** PATCH /api/creative-ai/client-reviews/:reviewId/revoke */
router.patch("/creative-ai/client-reviews/:reviewId/revoke", async (req, res): Promise<void> => {
  const reviewId = parseInt(req.params.reviewId as string, 10);
  if (isNaN(reviewId)) {
    res.status(400).json({ error: "Invalid review ID" });
    return;
  }

  const [review] = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(creativeAiClientReviewsTable.id, reviewId),
        // Can only revoke non-terminal statuses
        sql`${creativeAiClientReviewsTable.status} NOT IN ('revoked','approved','rejected')`,
      ),
    )
    .returning();

  if (!review) {
    res.status(404).json({ error: "Review not found or cannot be revoked" });
    return;
  }

  await logAudit("client-review", "review_revoked", String(review.id), "client_review", "success", {
    projectId: review.projectId,
    clientName: review.clientName,
  }).catch(() => {});

  res.json({
    ...review,
    tokenExpiresAt: review.tokenExpiresAt.toISOString(),
    sharedAt: review.sharedAt?.toISOString() ?? null,
    viewedAt: review.viewedAt?.toISOString() ?? null,
    approvedAt: review.approvedAt?.toISOString() ?? null,
    rejectedAt: review.rejectedAt?.toISOString() ?? null,
    revisionRequestedAt: review.revisionRequestedAt?.toISOString() ?? null,
    revokedAt: review.revokedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  });
});

// ── Admin: Get review comments ─────────────────────────────────────────────────

/** GET /api/creative-ai/projects/:id/review-comments */
router.get("/creative-ai/projects/:id/review-comments", async (req, res): Promise<void> => {
  const projectId = req.params.id as string;

  const comments = await db
    .select()
    .from(creativeAiClientCommentsTable)
    .where(eq(creativeAiClientCommentsTable.projectId, projectId))
    .orderBy(creativeAiClientCommentsTable.createdAt);

  res.json(
    comments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  );
});

// ── Admin: Client Review Analytics ────────────────────────────────────────────

/** GET /api/creative-ai/analytics/client-reviews */
router.get("/creative-ai/analytics/client-reviews", async (_req, res): Promise<void> => {
  const reviews = await db.select().from(creativeAiClientReviewsTable);

  const total = reviews.length;
  const viewed = reviews.filter((r) => r.viewedAt).length;
  const approved = reviews.filter((r) => r.status === "approved").length;
  const revisionRequested = reviews.filter((r) => r.status === "revision_requested").length;

  // Average time from sharedAt → approvedAt (hours)
  const approvedWithTimes = reviews.filter((r) => r.status === "approved" && r.sharedAt && r.approvedAt);
  const avgTimeToApprovalHours =
    approvedWithTimes.length > 0
      ? approvedWithTimes.reduce((acc, r) => {
          const ms = r.approvedAt!.getTime() - r.sharedAt!.getTime();
          return acc + ms / (1000 * 60 * 60);
        }, 0) / approvedWithTimes.length
      : null;

  res.json({
    totalShared: total,
    viewedRate: total > 0 ? viewed / total : 0,
    approvalRate: total > 0 ? approved / total : 0,
    revisionRate: total > 0 ? revisionRequested / total : 0,
    avgTimeToApprovalHours,
  });
});

export default router;
