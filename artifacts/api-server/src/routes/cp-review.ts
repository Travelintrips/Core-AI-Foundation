/**
 * cp-review.ts — Company Profile V4.2C
 * Customer Review Experience — enterprise-grade PDF review, comments, versioning.
 *
 * Public routes (/public/cp-review/*) — token-authenticated, no admin key.
 * Admin routes (/cp-review/admin/*) — admin key required.
 *
 * REUSES:
 *   - creative_ai_client_reviews token system (clientReviewService)
 *   - creative_ai_client_comments (existing flat comments)
 *   - Event bus (publishSafe)
 *   - Signed URL / storage patterns
 *   - Existing approval flow (approve/reject/request-revision)
 *
 * NEW:
 *   - cp_page_comments (page + section + thread)
 *   - cp_document_versions (version history + QC)
 *   - PDF watermark (server-rendered via pdf-lib)
 *   - Version compare (section-level diff)
 *   - Review dashboard KPIs
 */

import { Router } from "express";
import { eq, and, inArray, sql, desc, count } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  creativeAiAssetsTable,
  cpPageCommentsTable,
  cpDocumentVersionsTable,
  aiServiceRequestsTable,
  type CpPageComment,
} from "@workspace/db";
import { hashToken } from "../services/clientReviewService.js";
import { logAudit } from "../services/aiAuditService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { stampWatermark, shouldWatermark } from "../services/cpWatermarkService.js";
import {
  snapshotDocumentVersion,
  listVersionsForProject,
  getVersionByNumber,
  diffVersionSections,
  approveVersion,
} from "../services/cpVersionService.js";
import { scoreFromAssetMetadata } from "../services/companyProfileQcService.js";

const router = Router();

// ── Shared constants ──────────────────────────────────────────────────────────

const TERMINAL    = new Set(["approved", "rejected", "revoked"]);
const ACTIONABLE  = ["shared", "viewed", "revision_requested"] as const;
const PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;

// ── Helper: resolve + validate review token ───────────────────────────────────

type ResolvedReview = {
  ok: true;
  review: Awaited<ReturnType<typeof findReview>>;
} | { ok: false; status: number; error: string };

async function findReview(token: string) {
  const [row] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.reviewTokenHash, hashToken(token)));
  return row ?? null;
}

async function resolveToken(token: string): Promise<ResolvedReview> {
  if (!token || token.length < 10)
    return { ok: false, status: 404, error: "Review not found or link has expired." };
  const review = await findReview(token);
  if (!review)
    return { ok: false, status: 404, error: "Review not found or link has expired." };
  if (review.status === "revoked")
    return { ok: false, status: 410, error: "This review link has been revoked." };
  if (new Date() > review.tokenExpiresAt)
    return { ok: false, status: 410, error: "This review link has expired. Please contact us for a new link." };
  return { ok: true, review };
}

/** Serialize a CpPageComment for API responses. */
function serializeComment(c: CpPageComment) {
  return {
    id:                c.id,
    reviewId:          c.reviewId,
    projectId:         c.projectId,
    documentVersionId: c.documentVersionId ?? undefined,
    parentCommentId:   c.parentCommentId   ?? undefined,
    pageNumber:        c.pageNumber        ?? undefined,
    positionX:         c.positionX         ?? undefined,
    positionY:         c.positionY         ?? undefined,
    sectionId:         c.sectionId         ?? undefined,
    comment:           c.comment,
    authorName:        c.authorName,
    authorType:        c.authorType as "client" | "admin",
    priority:          c.priority,
    status:            c.status,
    resolvedBy:        c.resolvedBy        ?? undefined,
    resolvedAt:        c.resolvedAt?.toISOString() ?? undefined,
    createdAt:         c.createdAt.toISOString(),
    updatedAt:         c.updatedAt.toISOString(),
  };
}

// ── Helper: get latest Company Profile asset for a project ────────────────────

async function getLatestCpAsset(projectId: string) {
  const [asset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, projectId),
        eq(creativeAiAssetsTable.assetType, "document"),
        inArray(creativeAiAssetsTable.status, ["completed", "approved"]),
      ),
    )
    .orderBy(desc(creativeAiAssetsTable.version), desc(creativeAiAssetsTable.createdAt))
    .limit(1);
  return asset ?? null;
}

// ── Helper: determine filesUnlocked status ────────────────────────────────────

async function getFilesUnlocked(projectId: string): Promise<boolean> {
  // Primary source of truth: creative_projects.files_unlocked (kept in sync by the
  // payment-verification flow — see dual-commercial-flow).
  const [project] = await db
    .select({ filesUnlocked: creativeProjectsTable.filesUnlocked })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (project?.filesUnlocked) return true;

  // Fallback: look up the service request for this project.
  // created_project_id stores the client-facing project UUID directly (text), not the row id.
  const [sr] = await db
    .select({ status: aiServiceRequestsTable.status })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.createdProjectId, projectId))
    .limit(1);

  // filesUnlocked when service request is in completed/files_unlocked status
  if (!sr) return false;
  return ["completed", "files_unlocked", "delivered"].includes(sr.status);
}

// ============================================================================
// PUBLIC ROUTES — /public/cp-review/:token
// ============================================================================

// ── GET /public/cp-review/:token — CP review context ─────────────────────────

router.get("/public/cp-review/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  // Mark viewed
  if (review.status === "shared") {
    await db
      .update(creativeAiClientReviewsTable)
      .set({ status: "viewed", viewedAt: new Date() })
      .where(and(
        eq(creativeAiClientReviewsTable.id, review.id),
        eq(creativeAiClientReviewsTable.status, "shared"),
      ));
  }

  // Fetch project
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId));

  if (!project) { res.status(404).json({ error: "Project not found." }); return; }

  // Load asset + QC in parallel with versions + filesUnlocked
  const [asset, versions, filesUnlocked, comments] = await Promise.all([
    getLatestCpAsset(review.projectId),
    listVersionsForProject(review.projectId),
    getFilesUnlocked(review.projectId),
    db
      .select()
      .from(cpPageCommentsTable)
      .where(eq(cpPageCommentsTable.reviewId, review.id))
      .orderBy(cpPageCommentsTable.createdAt),
  ]);

  const meta = (asset?.metadata ?? {}) as Record<string, unknown>;
  const qcResult = asset ? scoreFromAssetMetadata(meta) : null;
  const report = (meta["generationReport"] ?? {}) as Record<string, unknown>;
  const watermarked = shouldWatermark({ filesUnlocked });

  // Stats
  const totalComments   = comments.length;
  const resolvedComments = comments.filter((c) => c.status === "resolved").length;
  const pendingComments  = totalComments - resolvedComments;

  publishSafe({
    eventType: "customer.cp_review.viewed",
    sourceModule: "cp-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId },
  });

  res.json({
    reviewId:      review.id,
    projectId:     review.projectId,
    clientName:    review.clientName,
    reviewStatus:  review.status,
    brandName:     project.brandName,
    businessType:  project.businessType,
    // Document
    documentReady:   !!asset,
    documentVersion: asset?.version ?? null,
    documentUrl:     watermarked ? null : (asset?.imageUrl ?? null),
    watermarked,
    filesUnlocked,
    pageCount: (meta["pageCount"] as number | undefined) ?? null,
    sectionsIncluded: Array.isArray(report["sectionsIncluded"]) ? report["sectionsIncluded"] : [],
    sectionsSkipped: Array.isArray(report["sectionsSkipped"])
      ? (report["sectionsSkipped"] as Array<{ sectionId: string }>).map((s) => s.sectionId)
      : [],
    packageLevel:  (report["packageLevel"] as string | undefined) ?? null,
    pageTarget:    (report["pageTarget"] as number | undefined) ?? null,
    // QC
    qcScore:       qcResult?.qcScore ?? null,
    qcPassed:      qcResult?.passed ?? null,
    qcDimensions:  qcResult?.dimensions ?? null,
    qcWarnings:    qcResult?.warnings ?? [],
    // Versions
    currentVersion: versions[0] ?? null,
    totalVersions:  versions.length,
    // Comments
    totalComments,
    resolvedComments,
    pendingComments,
    comments:       comments.map(serializeComment),
    // Timeline
    createdAt:     review.createdAt.toISOString(),
    sharedAt:      review.sharedAt?.toISOString() ?? null,
    approvedAt:    review.approvedAt?.toISOString() ?? null,
    rejectedAt:    review.rejectedAt?.toISOString() ?? null,
    revisionRequestedAt: review.revisionRequestedAt?.toISOString() ?? null,
  });
});

// ── GET /public/cp-review/:token/pdf — serve PDF (watermarked or clean) ──────
//
// Watermarked: returned as PDF bytes (Content-Disposition: inline)
// Clean:       redirect to the signed Supabase URL

router.get("/public/cp-review/:token/pdf", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [asset, filesUnlocked] = await Promise.all([
    getLatestCpAsset(review.projectId),
    getFilesUnlocked(review.projectId),
  ]);

  if (!asset || !asset.imageUrl) {
    res.status(404).json({ error: "No PDF document available yet." });
    return;
  }

  const watermarked = shouldWatermark({ filesUnlocked });

  if (!watermarked) {
    // Redirect to the clean Supabase signed URL
    res.redirect(302, asset.imageUrl);
    return;
  }

  // Serve a server-rendered watermarked PDF
  try {
    const pdfBytes = await stampWatermark(asset.imageUrl);
    res.set({
      "Content-Type":        "application/pdf",
      "Content-Disposition": 'inline; filename="preview-watermarked.pdf"',
      "Content-Length":      String(pdfBytes.length),
      "Cache-Control":       "private, no-store",
      "X-Watermarked":       "true",
    });
    res.send(pdfBytes);
  } catch (err) {
    // SECURITY: never fall back to the clean/unwatermarked source when the
    // document is supposed to be locked — that would leak the full-resolution
    // file to a client who hasn't paid/been approved. Fail closed instead.
    res.status(502).json({ error: "Unable to prepare a watermarked preview right now. Please try again shortly." });
  }
});

// ── GET /public/cp-review/:token/versions — version history ──────────────────

router.get("/public/cp-review/:token/versions", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const versions = await listVersionsForProject(review.projectId);

  res.json(
    versions.map((v) => ({
      id:             v.id,
      version:        v.version,
      versionLabel:   v.versionLabel,
      reason:         v.reason ?? null,
      revisionNotes:  v.revisionNotes ?? null,
      sectionsIncluded: Array.isArray(v.sectionsJson) ? v.sectionsJson : [],
      qcScore:        v.qcScore ?? null,
      qcPassed:       v.qcPassed ?? null,
      qcDimensions:   v.qcDimensionsJson ?? null,
      approved:       v.approved,
      approvedAt:     v.approvedAt?.toISOString() ?? null,
      approvedBy:     v.approvedBy ?? null,
      sentForReviewAt: v.sentForReviewAt?.toISOString() ?? null,
      createdBy:      v.createdBy ?? null,
      createdAt:      v.createdAt.toISOString(),
    })),
  );
});

// ── GET /public/cp-review/:token/versions/compare?v1=1&v2=2 ──────────────────

router.get("/public/cp-review/:token/versions/compare", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const v1Num = parseInt(String(req.query["v1"] ?? ""), 10);
  const v2Num = parseInt(String(req.query["v2"] ?? ""), 10);

  if (isNaN(v1Num) || isNaN(v2Num) || v1Num === v2Num) {
    res.status(400).json({ error: "Provide distinct v1 and v2 version numbers as query params." });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [ver1, ver2] = await Promise.all([
    getVersionByNumber(review.projectId, v1Num),
    getVersionByNumber(review.projectId, v2Num),
  ]);

  if (!ver1) { res.status(404).json({ error: `Version ${v1Num} not found.` }); return; }
  if (!ver2) { res.status(404).json({ error: `Version ${v2Num} not found.` }); return; }

  const diff = diffVersionSections(ver1, ver2);

  res.json({
    v1: { version: ver1.version, versionLabel: ver1.versionLabel, qcScore: ver1.qcScore },
    v2: { version: ver2.version, versionLabel: ver2.versionLabel, qcScore: ver2.qcScore },
    diff: {
      added:        diff.added,       // sections new in v2
      removed:      diff.removed,     // sections dropped from v1
      unchanged:    diff.unchanged,   // sections present in both
      totalChanged: diff.added.length + diff.removed.length,
    },
  });
});

// ── GET /public/cp-review/:token/comments — list page/section comments ────────

router.get("/public/cp-review/:token/comments", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const { page, section, status } = req.query as {
    page?: string;
    section?: string;
    status?: string;
  };

  // Build filter conditions
  const conditions = [eq(cpPageCommentsTable.reviewId, review.id)];

  if (page) {
    const pageNum = parseInt(page, 10);
    if (!isNaN(pageNum)) conditions.push(eq(cpPageCommentsTable.pageNumber, pageNum));
  }
  if (section) {
    conditions.push(eq(cpPageCommentsTable.sectionId, section));
  }
  if (status && ["open", "resolved", "archived"].includes(status)) {
    conditions.push(eq(cpPageCommentsTable.status, status));
  }

  const comments = await db
    .select()
    .from(cpPageCommentsTable)
    .where(and(...conditions))
    .orderBy(cpPageCommentsTable.createdAt);

  // Build tree (top-level + replies)
  const top   = comments.filter((c) => !c.parentCommentId);
  const reply = comments.filter((c) => !!c.parentCommentId);

  const tree = top.map((c) => ({
    ...serializeComment(c),
    replies: reply.filter((r) => r.parentCommentId === c.id).map(serializeComment),
  }));

  res.json({
    total:    comments.length,
    open:     comments.filter((c) => c.status === "open").length,
    resolved: comments.filter((c) => c.status === "resolved").length,
    comments: tree,
  });
});

// ── POST /public/cp-review/:token/comments — add comment ─────────────────────

router.post("/public/cp-review/:token/comments", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const {
    comment,
    authorName,
    pageNumber,
    positionX,
    positionY,
    sectionId,
    parentCommentId,
    priority,
    documentVersionId,
  } = (req.body ?? {}) as {
    comment?:           unknown;
    authorName?:        unknown;
    pageNumber?:        unknown;
    positionX?:         unknown;
    positionY?:         unknown;
    sectionId?:         unknown;
    parentCommentId?:   unknown;
    priority?:          unknown;
    documentVersionId?: unknown;
  };

  if (!comment || typeof comment !== "string" || !comment.trim())
    { res.status(400).json({ error: "comment is required" }); return; }
  if (!authorName || typeof authorName !== "string" || !authorName.trim())
    { res.status(400).json({ error: "authorName is required" }); return; }

  const parsedPage    = typeof pageNumber === "number" ? pageNumber : null;
  const parsedX       = typeof positionX  === "number" ? positionX  : null;
  const parsedY       = typeof positionY  === "number" ? positionY  : null;
  const parsedSection = typeof sectionId  === "string" && sectionId.trim() ? sectionId.trim() : null;
  const parsedParent  = typeof parentCommentId === "number" ? parentCommentId : null;
  const parsedPri     = typeof priority === "string" && (PRIORITY_VALUES as readonly string[]).includes(priority)
    ? priority : "normal";
  const parsedVersion = typeof documentVersionId === "number" ? documentVersionId : null;

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  // Validate parent comment belongs to this review
  if (parsedParent !== null) {
    const [parent] = await db
      .select({ id: cpPageCommentsTable.id })
      .from(cpPageCommentsTable)
      .where(and(
        eq(cpPageCommentsTable.id, parsedParent),
        eq(cpPageCommentsTable.reviewId, review.id),
      ))
      .limit(1);
    if (!parent) { res.status(400).json({ error: "Invalid parentCommentId for this review." }); return; }
  }

  const [inserted] = await db
    .insert(cpPageCommentsTable)
    .values({
      reviewId:          review.id,
      projectId:         review.projectId,
      documentVersionId: parsedVersion,
      parentCommentId:   parsedParent,
      pageNumber:        parsedPage,
      positionX:         parsedX,
      positionY:         parsedY,
      sectionId:         parsedSection,
      comment:           comment.trim(),
      authorName:        (authorName as string).trim(),
      authorType:        "client",
      priority:          parsedPri,
      status:            "open",
    })
    .returning();

  publishSafe({
    eventType: "customer.cp_review.comment_added",
    sourceModule: "cp-review",
    sourceId: String(review.id),
    payload: {
      reviewId: review.id,
      projectId: review.projectId,
      commentId: inserted.id,
      pageNumber: parsedPage,
      sectionId:  parsedSection,
    },
  });

  res.status(201).json(serializeComment(inserted));
});

// ── PATCH /public/cp-review/:token/comments/:id — edit/resolve/reopen ─────────

router.patch("/public/cp-review/:token/comments/:id", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const commentId = parseInt(req.params["id"] as string, 10);
  if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment ID" }); return; }

  const { comment, status } = (req.body ?? {}) as { comment?: unknown; status?: unknown };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  // Load existing comment — must belong to this review
  const [existing] = await db
    .select()
    .from(cpPageCommentsTable)
    .where(and(
      eq(cpPageCommentsTable.id, commentId),
      eq(cpPageCommentsTable.reviewId, review.id),
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Comment not found." }); return; }

  // Customers can only edit/delete their own (client) comments
  if (existing.authorType !== "client") {
    res.status(403).json({ error: "You can only modify your own comments." });
    return;
  }

  const updates: Partial<typeof cpPageCommentsTable.$inferInsert> = {};

  if (typeof comment === "string" && comment.trim()) {
    if (existing.status !== "open")
      { res.status(409).json({ error: "Cannot edit a resolved or archived comment." }); return; }
    updates.comment = comment.trim();
  }

  if (typeof status === "string") {
    if (!["open", "resolved", "archived"].includes(status))
      { res.status(400).json({ error: "status must be open, resolved, or archived" }); return; }
    updates.status = status;
    if (status === "resolved") {
      updates.resolvedBy = review.clientName;
      updates.resolvedAt = new Date();
    }
    if (status === "open") {
      updates.resolvedBy = null;
      updates.resolvedAt = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide comment or status to update." });
    return;
  }

  const [updated] = await db
    .update(cpPageCommentsTable)
    .set(updates)
    .where(eq(cpPageCommentsTable.id, commentId))
    .returning();

  if (updates.status === "resolved") {
    publishSafe({
      eventType: "customer.cp_review.comment_resolved",
      sourceModule: "cp-review",
      sourceId: String(review.id),
      payload: { reviewId: review.id, commentId },
    });
  }

  res.json(serializeComment(updated));
});

// ── DELETE /public/cp-review/:token/comments/:id — delete own open comment ───

router.delete("/public/cp-review/:token/comments/:id", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const commentId = parseInt(req.params["id"] as string, 10);
  if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment ID" }); return; }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [existing] = await db
    .select()
    .from(cpPageCommentsTable)
    .where(and(
      eq(cpPageCommentsTable.id, commentId),
      eq(cpPageCommentsTable.reviewId, review.id),
    ))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Comment not found." }); return; }
  if (existing.authorType !== "client")
    { res.status(403).json({ error: "You can only delete your own comments." }); return; }
  if (existing.status !== "open")
    { res.status(409).json({ error: "Only open comments can be deleted." }); return; }

  await db.delete(cpPageCommentsTable).where(eq(cpPageCommentsTable.id, commentId));

  res.json({ success: true, deleted: commentId });
});

// ── POST /public/cp-review/:token/reject — reject with required reason ────────

router.post("/public/cp-review/:token/reject", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const { reason } = (req.body ?? {}) as { reason?: unknown };

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required to reject the document." });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (TERMINAL.has(review.status)) {
    res.status(409).json({ error: `Review is already in a final state (${review.status}).` });
    return;
  }

  // CAS update — atomic reject
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "rejected", rejectedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revoked')`,
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  // Save rejection reason as a high-priority comment for the team
  await db.insert(cpPageCommentsTable).values({
    reviewId:  review.id,
    projectId: review.projectId,
    comment:   `[Rejection] ${reason.trim()}`,
    authorName: review.clientName,
    authorType: "client",
    priority:   "urgent",
    status:     "open",
  });

  logAudit("cp-review", "cp_review.rejected", String(review.id), "creative_ai_client_review", "success", {
    projectId: review.projectId,
    reason: reason.trim(),
  });

  publishSafe({
    eventType: "customer.cp_review.rejected",
    sourceModule: "cp-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId, reason: reason.trim() },
  });

  res.json({ success: true, status: "rejected" });
});

// ── GET /public/cp-review/:token/timeline — full event timeline ───────────────

router.get("/public/cp-review/:token/timeline", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [versions, comments] = await Promise.all([
    listVersionsForProject(review.projectId),
    db
      .select()
      .from(cpPageCommentsTable)
      .where(eq(cpPageCommentsTable.reviewId, review.id))
      .orderBy(cpPageCommentsTable.createdAt),
  ]);

  // Build a chronological event list
  type TimelineEvent = {
    type: string;
    label: string;
    actor: string | null;
    meta?: Record<string, unknown>;
    timestamp: string;
  };

  const events: TimelineEvent[] = [];

  // Review lifecycle milestones
  if (review.createdAt) {
    events.push({ type: "review_created", label: "Review link created", actor: null, timestamp: review.createdAt.toISOString() });
  }
  if (review.sharedAt) {
    events.push({ type: "review_shared", label: "Document sent for review", actor: null, timestamp: review.sharedAt.toISOString() });
  }
  if (review.viewedAt) {
    events.push({ type: "review_viewed", label: "Customer opened review", actor: review.clientName, timestamp: review.viewedAt.toISOString() });
  }
  if (review.revisionRequestedAt) {
    events.push({ type: "revision_requested", label: "Revision requested", actor: review.clientName, timestamp: review.revisionRequestedAt.toISOString() });
  }
  if (review.approvedAt) {
    events.push({ type: "approved", label: "Document approved by customer", actor: review.clientName, timestamp: review.approvedAt.toISOString() });
  }
  if (review.rejectedAt) {
    events.push({ type: "rejected", label: "Document rejected", actor: review.clientName, timestamp: review.rejectedAt.toISOString() });
  }

  // Version snapshots
  for (const v of versions) {
    events.push({
      type: "version_created",
      label: `Version ${v.versionLabel ?? `v${v.version}`} created`,
      actor: v.createdBy ?? null,
      meta: { version: v.version, versionLabel: v.versionLabel, qcScore: v.qcScore },
      timestamp: v.createdAt.toISOString(),
    });
    if (v.approvedAt) {
      events.push({
        type: "version_approved",
        label: `Version ${v.versionLabel ?? `v${v.version}`} approved`,
        actor: v.approvedBy ?? review.clientName,
        meta: { version: v.version },
        timestamp: v.approvedAt.toISOString(),
      });
    }
  }

  // Comments
  for (const c of comments) {
    if (c.parentCommentId === null || c.parentCommentId === undefined) {
      events.push({
        type: "comment_added",
        label: c.comment.length > 60 ? `${c.comment.slice(0, 60)}…` : c.comment,
        actor: c.authorName,
        meta: { commentId: c.id, priority: c.priority, pageNumber: c.pageNumber ?? null, sectionId: c.sectionId ?? null },
        timestamp: c.createdAt.toISOString(),
      });
    }
    if (c.resolvedAt) {
      events.push({
        type: "comment_resolved",
        label: "Comment resolved",
        actor: c.resolvedBy ?? null,
        meta: { commentId: c.id },
        timestamp: c.resolvedAt.toISOString(),
      });
    }
  }

  // Sort by timestamp
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  res.json({
    reviewId: review.id,
    projectId: review.projectId,
    reviewStatus: review.status,
    totalEvents: events.length,
    events,
  });
});

// ── GET /public/cp-review/:token/stats — review KPIs alias (stats) ───────────
// (forwards to dashboard data shape but named /stats per spec)

router.get("/public/cp-review/:token/stats", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [comments, versions, asset, filesUnlocked] = await Promise.all([
    db.select().from(cpPageCommentsTable).where(eq(cpPageCommentsTable.reviewId, review.id)),
    listVersionsForProject(review.projectId),
    getLatestCpAsset(review.projectId),
    getFilesUnlocked(review.projectId),
  ]);

  const meta      = (asset?.metadata ?? {}) as Record<string, unknown>;
  const qcResult  = asset ? scoreFromAssetMetadata(meta) : null;
  const latestVer = versions[0];

  const totalComments    = comments.length;
  const openComments     = comments.filter((c) => c.status === "open").length;
  const resolvedComments = comments.filter((c) => c.status === "resolved").length;
  const highPriority     = comments.filter((c) => c.status === "open" && (c.priority === "high" || c.priority === "urgent")).length;
  const byPage: Record<number, number> = {};
  const bySection: Record<string, number> = {};
  for (const c of comments) {
    if (c.pageNumber !== null && c.pageNumber !== undefined) {
      byPage[c.pageNumber] = (byPage[c.pageNumber] ?? 0) + 1;
    }
    if (c.sectionId) {
      bySection[c.sectionId] = (bySection[c.sectionId] ?? 0) + 1;
    }
  }

  res.json({
    reviewId: review.id,
    reviewStatus: review.status,
    currentVersion: latestVer?.versionLabel ?? null,
    totalVersions: versions.length,
    totalComments,
    openComments,
    resolvedComments,
    highPriorityPending: highPriority,
    commentsByPage: byPage,
    commentsBySection: bySection,
    qcScore:    qcResult?.qcScore ?? null,
    qcPassed:   qcResult?.passed  ?? null,
    filesUnlocked,
    approvedAt: review.approvedAt?.toISOString() ?? null,
  });
});

// ── GET /public/cp-review/:token/versions/:versionId — single version detail ──

router.get("/public/cp-review/:token/versions/:versionId", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const versionNum = parseInt(req.params["versionId"] as string, 10);
  if (isNaN(versionNum)) { res.status(400).json({ error: "Invalid version number" }); return; }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const v = await getVersionByNumber(review.projectId, versionNum);
  if (!v) { res.status(404).json({ error: `Version ${versionNum} not found.` }); return; }

  res.json({
    id:              v.id,
    version:         v.version,
    versionLabel:    v.versionLabel,
    reason:          v.reason ?? null,
    revisionNotes:   v.revisionNotes ?? null,
    sectionsIncluded: Array.isArray(v.sectionsJson) ? v.sectionsJson : [],
    qcScore:         v.qcScore ?? null,
    qcPassed:        v.qcPassed ?? null,
    qcDimensions:    v.qcDimensionsJson ?? null,
    approved:        v.approved,
    approvedAt:      v.approvedAt?.toISOString() ?? null,
    approvedBy:      v.approvedBy ?? null,
    sentForReviewAt: v.sentForReviewAt?.toISOString() ?? null,
    createdBy:       v.createdBy ?? null,
    createdAt:       v.createdAt.toISOString(),
  });
});

// ── POST /public/cp-review/:token/approve — approve with checkbox ─────────────

router.post("/public/cp-review/:token/approve", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const { confirmed } = (req.body ?? {}) as { confirmed?: unknown };

  if (confirmed !== true) {
    res.status(400).json({ error: "confirmed must be true. Customer must check the approval checkbox." });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (TERMINAL.has(review.status)) {
    res.status(409).json({ error: `Review is already in a final state (${review.status}).` });
    return;
  }

  // CAS update
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "approved", approvedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revoked')`,
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  // Mark the latest document version as approved
  await approveVersion(review.projectId, await (async () => {
    const versions = await listVersionsForProject(review.projectId);
    return versions[0]?.version ?? 1;
  })(), review.clientName);

  logAudit("cp-review", "cp_review.approved", String(review.id), "creative_ai_client_review", "success", {
    projectId: review.projectId,
    clientName: review.clientName,
    confirmed: true,
  });

  publishSafe({
    eventType: "customer.cp_review.approved",
    sourceModule: "cp-review",
    sourceId: String(review.id),
    payload: { reviewId: review.id, projectId: review.projectId, clientName: review.clientName },
  });

  res.json({ success: true, status: "approved" });
});

// ── POST /public/cp-review/:token/request-revision — structured revision ──────

router.post("/public/cp-review/:token/request-revision", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const {
    notes,
    selectedPages,
    selectedSections,
    priority,
  } = (req.body ?? {}) as {
    notes?:             unknown;
    selectedPages?:     unknown;
    selectedSections?:  unknown;
    priority?:          unknown;
  };

  if (!notes || typeof notes !== "string" || !notes.trim()) {
    res.status(400).json({ error: "notes are required to request a revision." });
    return;
  }

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  if (TERMINAL.has(review.status)) {
    res.status(409).json({ error: `Review is already in a final state (${review.status}).` });
    return;
  }

  // CAS update — allow re-requesting revision even if already in revision_requested
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "revision_requested", revisionRequestedAt: new Date() })
    .where(and(
      eq(creativeAiClientReviewsTable.id, review.id),
      sql`${creativeAiClientReviewsTable.status} NOT IN ('approved','rejected','revoked')`,
    ))
    .returning({ id: creativeAiClientReviewsTable.id });

  if (updated.length === 0) {
    res.status(409).json({ error: "Review state changed concurrently. Please refresh and try again." });
    return;
  }

  // Parse structured selections
  const pages    = Array.isArray(selectedPages)    ? (selectedPages    as unknown[]).filter((p): p is number => typeof p === "number") : [];
  const sections = Array.isArray(selectedSections) ? (selectedSections as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const parsedPri = typeof priority === "string" && (PRIORITY_VALUES as readonly string[]).includes(priority) ? priority : "normal";

  // Save a structured revision comment for the team
  await db.insert(cpPageCommentsTable).values({
    reviewId:  review.id,
    projectId: review.projectId,
    comment:   `[Revision Request] ${notes.trim()}`,
    authorName: review.clientName,
    authorType: "client",
    priority:   parsedPri,
    status:     "open",
    sectionId:  sections.length === 1 ? sections[0] : null,
    pageNumber: pages.length === 1    ? pages[0]    : null,
  });

  logAudit("cp-review", "cp_review.revision_requested", String(review.id), "creative_ai_client_review", "success", {
    projectId: review.projectId,
    notes: notes.trim(),
    pages,
    sections,
    priority: parsedPri,
  });

  publishSafe({
    eventType: "customer.cp_review.revision_requested",
    sourceModule: "cp-review",
    sourceId: String(review.id),
    payload: {
      reviewId: review.id,
      projectId: review.projectId,
      notes: notes.trim(),
      pages,
      sections,
      priority: parsedPri,
    },
  });

  res.json({ success: true, status: "revision_requested", pages, sections, priority: parsedPri });
});

// ── GET /public/cp-review/:token/dashboard — review KPI dashboard ─────────────

router.get("/public/cp-review/:token/dashboard", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };

  const validated = await resolveToken(token);
  if (!validated.ok) { res.status(validated.status).json({ error: validated.error }); return; }
  const { review } = validated;

  const [comments, versions, asset, filesUnlocked] = await Promise.all([
    db.select().from(cpPageCommentsTable).where(eq(cpPageCommentsTable.reviewId, review.id)),
    listVersionsForProject(review.projectId),
    getLatestCpAsset(review.projectId),
    getFilesUnlocked(review.projectId),
  ]);

  const meta      = (asset?.metadata ?? {}) as Record<string, unknown>;
  const qcResult  = asset ? scoreFromAssetMetadata(meta) : null;
  const latestVer = versions[0];

  const totalComments    = comments.length;
  const openComments     = comments.filter((c) => c.status === "open").length;
  const resolvedComments = comments.filter((c) => c.status === "resolved").length;
  const pendingRevisions = comments.filter((c) => c.status === "open" && c.priority !== "low").length;
  const highPriority     = comments.filter((c) => c.status === "open" && (c.priority === "high" || c.priority === "urgent")).length;

  res.json({
    reviewId:       review.id,
    reviewStatus:   review.status,
    currentVersion: latestVer?.versionLabel ?? null,
    totalVersions:  versions.length,
    // Comments KPIs
    totalComments,
    openComments,
    resolvedComments,
    pendingRevisions,
    highPriorityPending: highPriority,
    // QC
    qcScore:        qcResult?.qcScore ?? null,
    qcPassed:       qcResult?.passed  ?? null,
    // Payment
    filesUnlocked,
    approvalStatus: review.status,
    approvedAt:     review.approvedAt?.toISOString() ?? null,
    // Timeline
    sharedAt:        review.sharedAt?.toISOString() ?? null,
    revisionRequestedAt: review.revisionRequestedAt?.toISOString() ?? null,
  });
});

// ============================================================================
// ADMIN ROUTES — /cp-review/admin/*  (require admin key via adminAuthWithExceptions)
// ============================================================================

// ── POST /cp-review/admin/projects/:projectId/versions — snapshot version ─────

router.post("/cp-review/admin/projects/:projectId/versions", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const { reviewId, assetId, reason, revisionNotes, createdBy } = (req.body ?? {}) as {
    reviewId?:      unknown;
    assetId?:       unknown;
    reason?:        unknown;
    revisionNotes?: unknown;
    createdBy?:     unknown;
  };

  const [project] = await db
    .select({ projectId: creativeProjectsTable.projectId })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found." }); return; }

  const version = await snapshotDocumentVersion({
    projectId,
    reviewId:      typeof reviewId      === "number" ? reviewId      : undefined,
    assetId:       typeof assetId       === "number" ? assetId       : undefined,
    reason:        typeof reason        === "string" ? reason        : undefined,
    revisionNotes: typeof revisionNotes === "string" ? revisionNotes : undefined,
    createdBy:     typeof createdBy     === "string" ? createdBy     : undefined,
  });

  publishSafe({
    eventType: "admin.cp_review.version_created",
    sourceModule: "cp-review",
    sourceId: projectId,
    payload: { projectId, version: version.version, versionLabel: version.versionLabel },
  });

  res.status(201).json(version);
});

// ── GET /cp-review/admin/projects/:projectId/pending-revisions ────────────────

router.get("/cp-review/admin/projects/:projectId/pending-revisions", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };

  const comments = await db
    .select()
    .from(cpPageCommentsTable)
    .where(and(
      eq(cpPageCommentsTable.projectId, projectId),
      eq(cpPageCommentsTable.status, "open"),
    ))
    .orderBy(cpPageCommentsTable.createdAt);

  const bySection: Record<string, ReturnType<typeof serializeComment>[]> = {};
  const byPage:    Record<number, ReturnType<typeof serializeComment>[]> = {};
  const general:   ReturnType<typeof serializeComment>[] = [];

  for (const c of comments) {
    const sc = serializeComment(c);
    if (c.sectionId) {
      (bySection[c.sectionId] ??= []).push(sc);
    } else if (c.pageNumber !== null && c.pageNumber !== undefined) {
      (byPage[c.pageNumber] ??= []).push(sc);
    } else {
      general.push(sc);
    }
  }

  res.json({
    total: comments.length,
    bySection,
    byPage,
    general,
  });
});

// ── PATCH /cp-review/admin/comments/:id — admin resolve/reply ─────────────────

router.patch("/cp-review/admin/comments/:id", async (req, res): Promise<void> => {
  const commentId = parseInt(req.params["id"] as string, 10);
  if (isNaN(commentId)) { res.status(400).json({ error: "Invalid comment ID" }); return; }

  const { status, resolvedBy } = (req.body ?? {}) as { status?: unknown; resolvedBy?: unknown };

  const [existing] = await db
    .select()
    .from(cpPageCommentsTable)
    .where(eq(cpPageCommentsTable.id, commentId))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Comment not found." }); return; }

  const updates: Partial<typeof cpPageCommentsTable.$inferInsert> = {};

  if (typeof status === "string" && ["open", "resolved", "archived"].includes(status)) {
    updates.status = status;
    if (status === "resolved") {
      updates.resolvedBy = typeof resolvedBy === "string" ? resolvedBy : "admin";
      updates.resolvedAt = new Date();
    }
    if (status === "open") {
      updates.resolvedBy = null;
      updates.resolvedAt = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide status to update." });
    return;
  }

  const [updated] = await db
    .update(cpPageCommentsTable)
    .set(updates)
    .where(eq(cpPageCommentsTable.id, commentId))
    .returning();

  res.json(serializeComment(updated));
});

// ── POST /cp-review/admin/comments/:reviewId/reply — admin reply to comment ───

router.post("/cp-review/admin/comments/:reviewId/reply", async (req, res): Promise<void> => {
  const reviewId  = parseInt(req.params["reviewId"] as string, 10);
  if (isNaN(reviewId)) { res.status(400).json({ error: "Invalid reviewId" }); return; }

  const { comment, authorName, parentCommentId } = (req.body ?? {}) as {
    comment?: unknown;
    authorName?: unknown;
    parentCommentId?: unknown;
  };

  if (!comment || typeof comment !== "string" || !comment.trim())
    { res.status(400).json({ error: "comment is required" }); return; }
  if (!authorName || typeof authorName !== "string" || !authorName.trim())
    { res.status(400).json({ error: "authorName is required" }); return; }

  // Load review to get projectId
  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.id, reviewId))
    .limit(1);

  if (!review) { res.status(404).json({ error: "Review not found." }); return; }

  const [inserted] = await db
    .insert(cpPageCommentsTable)
    .values({
      reviewId,
      projectId:       review.projectId,
      parentCommentId: typeof parentCommentId === "number" ? parentCommentId : null,
      comment:         comment.trim(),
      authorName:      (authorName as string).trim(),
      authorType:      "admin",
      priority:        "normal",
      status:          "open",
    })
    .returning();

  publishSafe({
    eventType: "admin.cp_review.admin_replied",
    sourceModule: "cp-review",
    sourceId: String(reviewId),
    payload: { reviewId, projectId: review.projectId, commentId: inserted.id },
  });

  res.status(201).json(serializeComment(inserted));
});

export default router;
