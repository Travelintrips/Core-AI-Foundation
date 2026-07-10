/**
 * Public review endpoints — token-authenticated, no admin key required.
 * All paths start with /public/creative-review/ which falls under
 * PUBLIC_PATH_PREFIXES in adminAuth.ts.
 */

import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  creativeAiAssetsTable,
  creativeAiClientCommentsTable,
} from "@workspace/db";
import { hashToken } from "../services/clientReviewService.js";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";

const router = Router();

// ── Shared helper: render an agent's structured JSON output as plain text ─────
// The copywriter/creative-director agents return nested JSON objects (e.g.
// { tagline, headline: { primary, alternatives }, ... }), not flat strings.
// Rendering an object directly as a React child crashes the client, so we
// flatten it into readable plain text here instead.
function formatAgentOutput(data: unknown, indent = ""): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (Array.isArray(data)) {
    return data
      .map((item) => `${indent}- ${typeof item === "object" && item !== null ? formatAgentOutput(item, indent + "  ") : String(item)}`)
      .join("\n");
  }
  if (typeof data === "object") {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (value !== null && typeof value === "object") {
          return `${indent}${label}:\n${formatAgentOutput(value, indent + "  ")}`;
        }
        return `${indent}${label}: ${String(value ?? "—")}`;
      })
      .join("\n");
  }
  return String(data);
}

// ── Shared helper: look up AND validate a review record by plain-text token ───

type ReviewValidationError =
  | { ok: false; status: number; error: string }
  | { ok: true; review: NonNullable<Awaited<ReturnType<typeof rawFindReview>>> };

async function rawFindReview(token: string) {
  const tokenHash = hashToken(token);
  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, tokenHash));
  return review ?? null;
}

/** Resolve token → review, enforcing all validity checks in one place. */
async function resolveToken(token: string): Promise<ReviewValidationError> {
  if (!token || token.length < 10) {
    return { ok: false, status: 404, error: "Review not found or link has expired." };
  }
  const review = await rawFindReview(token);
  if (!review) {
    return { ok: false, status: 404, error: "Review not found or link has expired." };
  }
  if (review.status === "revoked") {
    return { ok: false, status: 410, error: "This review link has been revoked." };
  }
  if (new Date() > review.tokenExpiresAt) {
    return { ok: false, status: 410, error: "This review link has expired. Please contact us for a new link." };
  }
  return { ok: true, review };
}

// Statuses after which no client action (approve / reject / revision) is allowed
const TERMINAL = new Set(["approved", "rejected", "revoked"]);
// Statuses from which approve/reject/revision are allowed
const ACTIONABLE = ["shared", "viewed"] as const;

// ── GET /api/public/creative-review/:token ────────────────────────────────────

router.get("/public/creative-review/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  // Mark as viewed (idempotent — only transition from shared)
  if (review.status === "shared") {
    await db
      .update(creativeAiClientReviewsTable)
      .set({ status: "viewed", viewedAt: new Date() })
      .where(and(
        eq(creativeAiClientReviewsTable.id, review.id),
        eq(creativeAiClientReviewsTable.status, "shared"),
      ));
    review.status = "viewed";
    review.viewedAt = new Date();
  }

  // Fetch project
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  // Fetch assets (only completed ones with an imageUrl)
  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, review.projectId),
        eq(creativeAiAssetsTable.status, "completed")
      )
    );

  // Fetch comments for this review
  const comments = await db
    .select()
    .from(creativeAiClientCommentsTable)
    .where(eq(creativeAiClientCommentsTable.reviewId, review.id))
    .orderBy(creativeAiClientCommentsTable.createdAt);

  // Fire-and-forget audit + event
  logAudit("public-review", "public.review.viewed", String(review.id), "creative_ai_client_review", "success", { clientName: review.clientName, projectId: review.projectId });
  publishSafe({
    eventType: "customer.review.viewed",
    sourceModule: "public-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId },
  });

  const result = project.result as Record<string, unknown> | null;

  res.json({
    reviewId: review.id,
    projectId: review.projectId,
    clientName: review.clientName,
    reviewStatus: review.status,
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    stylePreference: project.stylePreference ?? undefined,
    goal: project.goal,
    status: project.status,
    copyOutput: formatAgentOutput(result?.copyOutput ?? result?.copy ?? null) || null,
    creativeDirection: formatAgentOutput(result?.creativeDirection ?? result?.direction ?? null) || null,
    assets: assets
      .filter((a) => !!a.imageUrl)
      .map((a) => ({
        id: a.id,
        imageUrl: a.imageUrl!,
        thumbnailUrl: a.thumbnailUrl ?? undefined,
        aspectRatio: a.aspectRatio ?? "1:1",
        status: a.status,
      })),
    comments: comments.map((c) => ({
      id: c.id,
      reviewId: c.reviewId,
      projectId: c.projectId,
      assetId: c.assetId ?? undefined,
      authorName: c.authorName,
      authorType: c.authorType as "client" | "internal" | "agent",
      comment: c.comment,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    createdAt: review.createdAt.toISOString(),
  });
});

// ── POST /api/public/creative-review/:token/comment ───────────────────────────

router.post("/public/creative-review/:token/comment", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { comment, authorName, assetId } = (req.body ?? {}) as {
    comment?: unknown;
    authorName?: unknown;
    assetId?: unknown;
  };

  if (!comment || typeof comment !== "string" || !comment.trim()) {
    res.status(400).json({ error: "comment is required" });
    return;
  }
  if (!authorName || typeof authorName !== "string" || !authorName.trim()) {
    res.status(400).json({ error: "authorName is required" });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  // Validate assetId ownership if provided
  let resolvedAssetId: number | null = null;
  if (typeof assetId === "number") {
    const [asset] = await db
      .select({ id: creativeAiAssetsTable.id })
      .from(creativeAiAssetsTable)
      .where(and(
        eq(creativeAiAssetsTable.id, assetId),
        eq(creativeAiAssetsTable.projectId, review.projectId),
      ));
    if (!asset) {
      res.status(400).json({ error: "Invalid assetId for this review." });
      return;
    }
    resolvedAssetId = asset.id;
  }

  const [inserted] = await db
    .insert(creativeAiClientCommentsTable)
    .values({
      reviewId: review.id,
      projectId: review.projectId,
      assetId: resolvedAssetId,
      authorName: authorName.trim(),
      authorType: "client",
      comment: comment.trim(),
      status: "open",
    })
    .returning();

  res.status(201).json({
    id: inserted.id,
    reviewId: inserted.reviewId,
    projectId: inserted.projectId,
    assetId: inserted.assetId ?? undefined,
    authorName: inserted.authorName,
    authorType: inserted.authorType as "client" | "internal" | "agent",
    comment: inserted.comment,
    status: inserted.status,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
  });
});

// ── POST /api/public/creative-review/:token/approve ───────────────────────────

router.post("/public/creative-review/:token/approve", async (req, res): Promise<void> => {
  const { token } = req.params;

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (!ACTIONABLE.includes(review.status as typeof ACTIONABLE[number])) {
    res.status(409).json({ error: `Review cannot be approved in its current state (${review.status}).` });
    return;
  }

  // Race-safe: only update if still in an actionable status
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      inArray(creativeAiClientReviewsTable.status, [...ACTIONABLE]),
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  logAudit("public-review", "public.review.approved", String(review.id), "creative_ai_client_review", "success", { projectId: review.projectId });
  publishSafe({
    eventType: "customer.review.approved",
    sourceModule: "public-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId },
  });

  res.json({ success: true, status: "approved" });
});

// ── POST /api/public/creative-review/:token/reject ────────────────────────────

router.post("/public/creative-review/:token/reject", async (req, res): Promise<void> => {
  const { token } = req.params;

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (!ACTIONABLE.includes(review.status as typeof ACTIONABLE[number])) {
    res.status(409).json({ error: `Review cannot be rejected in its current state (${review.status}).` });
    return;
  }

  // Race-safe: only update if still in an actionable status
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      inArray(creativeAiClientReviewsTable.status, [...ACTIONABLE]),
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  logAudit("public-review", "public.review.rejected", String(review.id), "creative_ai_client_review", "success", { projectId: review.projectId });
  publishSafe({
    eventType: "customer.review.rejected",
    sourceModule: "public-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId },
  });

  res.json({ success: true, status: "rejected" });
});

// ── POST /api/public/creative-review/:token/request-revision ─────────────────

router.post("/public/creative-review/:token/request-revision", async (req, res): Promise<void> => {
  const { token } = req.params;
  const { notes } = (req.body ?? {}) as { notes?: unknown };

  if (!notes || typeof notes !== "string" || !notes.trim()) {
    res.status(400).json({ error: "notes are required to request a revision." });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (!ACTIONABLE.includes(review.status as typeof ACTIONABLE[number])) {
    res.status(409).json({
      error: review.status === "revision_requested"
        ? "A revision is already in progress."
        : `Review cannot be revised in its current state (${review.status}).`,
    });
    return;
  }

  // Race-safe: only update if still in an actionable status
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "revision_requested", revisionRequestedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      inArray(creativeAiClientReviewsTable.status, [...ACTIONABLE]),
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  // Save revision notes as a client comment for the team to see
  await db.insert(creativeAiClientCommentsTable).values({
    reviewId: review.id,
    projectId: review.projectId,
    authorName: review.clientName,
    authorType: "client",
    comment: `[Revision Request] ${notes.trim()}`,
    status: "open",
  });

  logAudit("public-review", "public.review.revision_requested", String(review.id), "creative_ai_client_review", "success", { projectId: review.projectId, notes: notes.trim() });
  publishSafe({
    eventType: "customer.review.revision_requested",
    sourceModule: "public-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId, notes: notes.trim() },
  });

  res.json({ success: true, status: "revision_requested" });
});

export default router;
