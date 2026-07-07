/**
 * Phase 6 — Public Client Review endpoints.
 * These routes are mounted under /api/public and bypass admin key auth.
 * They are protected by a per-request review token instead.
 */
import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiAssetsTable,
  creativeAiClientReviewsTable,
  creativeAiClientCommentsTable,
} from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import { hashToken, isReviewValid } from "../services/clientReviewService.js";
import { clientReviewNotificationService } from "../services/clientReviewNotificationService.js";

const router = Router();

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
// Max 20 write actions per IP per 60 seconds.

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── Helper: resolve token → review record ─────────────────────────────────────

async function resolveToken(token: string) {
  const hash = hashToken(token);
  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, hash));
  return review ?? null;
}

// ── GET /api/public/creative-review/:token ─────────────────────────────────────

router.get("/public/creative-review/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const review = await resolveToken(token);

  if (!review) {
    await logAudit("client-review", "invalid_token_access", token.slice(0, 8) + "…", "client_review", "failure");
    res.status(404).json({ error: "Review link not found" });
    return;
  }

  if (review.status === "revoked") {
    res.status(401).json({ error: "This review link has been revoked" });
    return;
  }

  if (new Date() > review.tokenExpiresAt) {
    await logAudit("client-review", "expired_token_access", String(review.id), "client_review", "failure", {
      projectId: review.projectId,
    });
    res.status(401).json({ error: "This review link has expired" });
    return;
  }

  // Mark as viewed only on first access and only from "shared" status
  // Never downgrade a terminal status (approved/rejected/revision_requested)
  const isFirstView = review.status === "shared" && !review.viewedAt;
  if (isFirstView) {
    await db
      .update(creativeAiClientReviewsTable)
      .set({ status: "viewed", viewedAt: new Date() })
      .where(
        and(
          eq(creativeAiClientReviewsTable.id, review.id),
          eq(creativeAiClientReviewsTable.status, "shared"),
        ),
      );

    await clientReviewNotificationService
      .notifyClientViewed(review.projectId, review.id, review.clientName)
      .catch(() => {});
  }

  // Fetch project
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Fetch steps (for copy/caption and creative direction)
  const steps = await db
    .select()
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, project.id))
    .orderBy(creativeProjectStepsTable.createdAt);

  // Fetch assets — strip internal fields (prompt, cost, qcScore, provider details)
  const rawAssets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, review.projectId),
        // Only show completed/approved/needs_revision/rejected assets to client
        // (not pending/generating/failed)
      ),
    )
    .orderBy(creativeAiAssetsTable.createdAt);

  const publicAssets = rawAssets
    .filter((a) => a.imageUrl || ["completed", "approved", "needs_revision", "rejected"].includes(a.status))
    .map((a) => ({
      id: a.id,
      imageUrl: a.imageUrl,
      thumbnailUrl: a.thumbnailUrl,
      aspectRatio: a.aspectRatio,
      status: a.status,
      // prompt, cost, qcScore, provider, model NOT exposed to client
    }));

  // Fetch comments for this review
  const comments = await db
    .select()
    .from(creativeAiClientCommentsTable)
    .where(eq(creativeAiClientCommentsTable.reviewId, review.id))
    .orderBy(creativeAiClientCommentsTable.createdAt);

  // Extract copy output and creative direction from steps (safe to share)
  const copyStep = steps.find((s) => s.stepName === "Copy Production");
  const creativeDirectionStep = steps.find((s) => s.stepName === "Creative Direction");

  res.json({
    reviewId: review.id,
    projectId: review.projectId,
    clientName: review.clientName,
    reviewStatus: isFirstView ? "viewed" : (review.status as string),
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    stylePreference: project.stylePreference,
    goal: project.goal,
    status: project.status,
    copyOutput: (copyStep?.output as Record<string, unknown> | null) ?? null,
    creativeDirection: (creativeDirectionStep?.output as Record<string, unknown> | null) ?? null,
    assets: publicAssets,
    comments: comments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    createdAt: project.createdAt.toISOString(),
  });
});

// ── POST /api/public/creative-review/:token/comment ────────────────────────────

router.post("/public/creative-review/:token/comment", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests, please try again later" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked review link" });
    return;
  }

  const { comment: rawComment, authorName: rawAuthor, assetId, stepId, parentCommentId } =
    (req.body ?? {}) as { comment?: unknown; authorName?: unknown; assetId?: unknown; stepId?: unknown; parentCommentId?: unknown };

  if (!rawComment || typeof rawComment !== "string" || rawComment.trim().length === 0) {
    res.status(400).json({ error: "comment is required" });
    return;
  }
  if (rawComment.length > 2000) {
    res.status(400).json({ error: "comment must be 2000 characters or fewer" });
    return;
  }
  const authorName = typeof rawAuthor === "string" && rawAuthor.trim() ? rawAuthor.trim() : "Client";

  // Sanitize: strip HTML tags from comment
  const sanitized = rawComment.replace(/<[^>]*>/g, "").trim();

  const [comment] = await db
    .insert(creativeAiClientCommentsTable)
    .values({
      reviewId: review.id,
      projectId: review.projectId,
      assetId: typeof assetId === "number" ? assetId : null,
      stepId: typeof stepId === "number" ? stepId : null,
      parentCommentId: typeof parentCommentId === "number" ? parentCommentId : null,
      authorName,
      authorType: "client",
      comment: sanitized,
      status: "open",
    })
    .returning();

  await clientReviewNotificationService
    .notifyCommentAdded(review.projectId, review.id, comment.id, authorName)
    .catch(() => {});

  res.status(201).json({
    ...comment,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  });
});

// ── Terminal statuses — no further transitions allowed ────────────────────────

const TERMINAL_STATUSES = new Set(["approved", "rejected", "revision_requested", "revoked"]);

// ── Helper: extract optional notes from body ──────────────────────────────────

function extractNotes(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const n = (body as Record<string, unknown>).notes;
    if (typeof n === "string" && n.trim().length > 0) {
      return n.slice(0, 2000).replace(/<[^>]*>/g, "").trim();
    }
  }
  return undefined;
}

// ── POST /api/public/creative-review/:token/approve ────────────────────────────

router.post("/public/creative-review/:token/approve", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked review link" });
    return;
  }

  if (TERMINAL_STATUSES.has(review.status)) {
    res.status(409).json({ error: `Review is already in a terminal state: ${review.status}` });
    return;
  }

  const notes = extractNotes(req.body);

  await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(
      and(
        eq(creativeAiClientReviewsTable.id, review.id),
        sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revision_requested','revoked')`,
      ),
    );

  if (notes) {
    await db.insert(creativeAiClientCommentsTable).values({
      reviewId: review.id,
      projectId: review.projectId,
      authorName: review.clientName,
      authorType: "client",
      comment: `✅ Approved: ${notes}`,
      status: "open",
    });
  }

  await clientReviewNotificationService
    .notifyClientApproved(review.projectId, review.id, review.clientName, notes)
    .catch(() => {});

  res.json({ success: true, status: "approved", message: "Project approved successfully" });
});

// ── POST /api/public/creative-review/:token/reject ─────────────────────────────

router.post("/public/creative-review/:token/reject", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked review link" });
    return;
  }

  if (TERMINAL_STATUSES.has(review.status)) {
    res.status(409).json({ error: `Review is already in a terminal state: ${review.status}` });
    return;
  }

  const notes = extractNotes(req.body);

  await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(
      and(
        eq(creativeAiClientReviewsTable.id, review.id),
        sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revision_requested','revoked')`,
      ),
    );

  if (notes) {
    await db.insert(creativeAiClientCommentsTable).values({
      reviewId: review.id,
      projectId: review.projectId,
      authorName: review.clientName,
      authorType: "client",
      comment: `❌ Rejected: ${notes}`,
      status: "open",
    });
  }

  await clientReviewNotificationService
    .notifyClientRejected(review.projectId, review.id, review.clientName, notes)
    .catch(() => {});

  res.json({ success: true, status: "rejected", message: "Project rejected" });
});

// ── POST /api/public/creative-review/:token/request-revision ───────────────────

router.post("/public/creative-review/:token/request-revision", async (req, res): Promise<void> => {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";
  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { token } = req.params as { token: string };
  const review = await resolveToken(token);
  if (!review || !isReviewValid(review)) {
    res.status(401).json({ error: "Invalid, expired, or revoked review link" });
    return;
  }

  if (TERMINAL_STATUSES.has(review.status)) {
    res.status(409).json({ error: `Review is already in a terminal state: ${review.status}` });
    return;
  }

  const notes = extractNotes(req.body);

  await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "revision_requested", revisionRequestedAt: new Date() })
    .where(
      and(
        eq(creativeAiClientReviewsTable.id, review.id),
        sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revision_requested','revoked')`,
      ),
    );

  if (notes) {
    await db.insert(creativeAiClientCommentsTable).values({
      reviewId: review.id,
      projectId: review.projectId,
      authorName: review.clientName,
      authorType: "client",
      comment: `🔄 Revision requested: ${notes}`,
      status: "open",
    });
  }

  await clientReviewNotificationService
    .notifyRevisionRequested(review.projectId, review.id, review.clientName, notes)
    .catch(() => {});

  res.json({ success: true, status: "revision_requested", message: "Revision request submitted" });
});

export default router;
