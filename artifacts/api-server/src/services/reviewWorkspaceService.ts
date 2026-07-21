/**
 * reviewWorkspaceService.ts — Team 16
 *
 * Business logic for the universal Review Workspace. Operates on top of the
 * existing creative_ai_client_reviews + creative_ai_client_comments tables
 * and the new ai_review_workspace_meta table.
 *
 * Canonical statuses remain unchanged. This layer adds:
 *  - workspace display status (wsStatus)
 *  - permission set
 *  - internal sign-off
 *  - due date
 *  - config-driven checklist
 *  - synthesized history timeline
 */

import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  pool,
  creativeAiClientReviewsTable,
  creativeAiClientCommentsTable,
  creativeProjectsTable,
  aiReviewWorkspaceMetaTable,
  type AiReviewWorkspaceMeta,
  type CreativeAiClientReview,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

// ── DDL: ensure meta table exists on startup ──────────────────────────────────

export async function ensureWorkspaceMetaTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_platform.ai_review_workspace_meta (
      id SERIAL PRIMARY KEY,
      review_id INTEGER NOT NULL UNIQUE,
      due_date TIMESTAMPTZ,
      internal_signed_off BOOLEAN NOT NULL DEFAULT FALSE,
      internal_signed_off_by TEXT,
      internal_signed_off_at TIMESTAMPTZ,
      checklist_state JSONB NOT NULL DEFAULT '{}',
      cancel_reason TEXT,
      cancelled_by TEXT,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Checklist Registry (config-driven, pluggable) ─────────────────────────────

export interface ChecklistItemDef {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  source: "core" | "workflow" | "plugin" | "service_policy";
  domain?: string; // undefined = all domains
}

const _checklistRegistry: ChecklistItemDef[] = [
  {
    id: "content_reviewed",
    label: "Content has been reviewed",
    description: "All text, copy, and creative direction have been checked",
    required: true,
    source: "core",
  },
  {
    id: "assets_verified",
    label: "All assets verified",
    description: "All generated images and media assets have been inspected",
    required: true,
    source: "core",
  },
  {
    id: "brand_alignment_checked",
    label: "Brand alignment checked",
    description: "Work aligns with brand guidelines and style preferences",
    required: false,
    source: "core",
  },
  {
    id: "client_info_confirmed",
    label: "Client information confirmed",
    description: "Client name, contact, and project details are accurate",
    required: false,
    source: "core",
  },
  {
    id: "legal_cleared",
    label: "Legal / trademark cleared",
    description: "No prohibited marks or protected content in deliverables",
    required: false,
    source: "core",
  },
];

/** Register additional checklist items from plugins or service policy. */
export function registerChecklistItems(items: ChecklistItemDef[]): void {
  for (const item of items) {
    if (!_checklistRegistry.find((r) => r.id === item.id)) {
      _checklistRegistry.push(item);
    }
  }
}

/** Retrieve checklist items, optionally filtered to a domain. */
export function getChecklistDefs(domain?: string): ChecklistItemDef[] {
  return _checklistRegistry.filter((item) => !item.domain || item.domain === domain);
}

// ── Status helpers ────────────────────────────────────────────────────────────

/** All statuses from the canonical DB enum */
export type CanonicalReviewStatus =
  | "not_shared"
  | "shared"
  | "viewed"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "expired"
  | "revoked";

/** Workspace-level display statuses (superset, includes computed ones) */
export type WorkspaceStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "expired"
  | "canceled"
  | "revoked"
  | "superseded";

export function computeWsStatus(
  review: Pick<CreativeAiClientReview, "status" | "tokenExpiresAt">,
  meta: AiReviewWorkspaceMeta | null,
  isSuperseded: boolean,
): WorkspaceStatus {
  if (isSuperseded) return "superseded";
  const now = new Date();
  if (review.status === "revoked") {
    return meta?.cancelReason ? "canceled" : "revoked";
  }
  if (review.status === "shared" && now > review.tokenExpiresAt) return "expired";
  switch (review.status) {
    case "not_shared":
    case "shared":
      return "pending";
    case "viewed":
      return "in_review";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "revision_requested":
      return "revision_requested";
    default:
      return "pending";
  }
}

// ── Permission model ──────────────────────────────────────────────────────────

export type ReviewPermission =
  | "can_approve"
  | "can_reject"
  | "can_request_revision"
  | "can_sign_off"
  | "can_remove_sign_off"
  | "can_cancel"
  | "can_set_due_date"
  | "can_manage_checklist";

const ACTIONABLE = new Set(["shared", "viewed"]);
const TERMINAL = new Set(["approved", "rejected", "revoked"]);

export function computePermissions(
  review: Pick<CreativeAiClientReview, "status" | "tokenExpiresAt">,
  meta: AiReviewWorkspaceMeta | null,
): Set<ReviewPermission> {
  const perms = new Set<ReviewPermission>();
  const now = new Date();
  const isExpired = review.status === "shared" && now > review.tokenExpiresAt;
  const isTerminal = TERMINAL.has(review.status) || isExpired;

  if (ACTIONABLE.has(review.status) && !isExpired) {
    perms.add("can_approve");
    perms.add("can_reject");
    perms.add("can_request_revision");
  }
  if (!isTerminal) {
    perms.add("can_cancel");
    perms.add("can_set_due_date");
    perms.add("can_manage_checklist");
  }
  if (!meta?.internalSignedOff && !isTerminal) {
    perms.add("can_sign_off");
  }
  if (meta?.internalSignedOff && !isTerminal) {
    perms.add("can_remove_sign_off");
  }
  return perms;
}

// ── Meta upsert helper ────────────────────────────────────────────────────────

export async function upsertMeta(
  reviewId: number,
  patch: Partial<Omit<AiReviewWorkspaceMeta, "id" | "reviewId" | "createdAt" | "updatedAt">>,
): Promise<AiReviewWorkspaceMeta> {
  // Try update first
  const updated = await db
    .update(aiReviewWorkspaceMetaTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(aiReviewWorkspaceMetaTable.reviewId, reviewId))
    .returning();

  if (updated.length > 0) return updated[0]!;

  // Insert if not exists
  const inserted = await db
    .insert(aiReviewWorkspaceMetaTable)
    .values({ reviewId, ...patch })
    .returning();
  return inserted[0]!;
}

// ── Core service functions ────────────────────────────────────────────────────

export async function getReview(reviewId: number) {
  const [review] = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.id, reviewId));
  return review ?? null;
}

export async function getMeta(reviewId: number): Promise<AiReviewWorkspaceMeta | null> {
  const [meta] = await db
    .select()
    .from(aiReviewWorkspaceMetaTable)
    .where(eq(aiReviewWorkspaceMetaTable.reviewId, reviewId));
  return meta ?? null;
}

export async function getProjectReviews(projectId: string) {
  const reviews = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.projectId, projectId))
    .orderBy(desc(creativeAiClientReviewsTable.createdAt));

  if (reviews.length === 0) return [];

  const metas = await db
    .select()
    .from(aiReviewWorkspaceMetaTable)
    .where(
      inArray(
        aiReviewWorkspaceMetaTable.reviewId,
        reviews.map((r) => r.id),
      ),
    );

  const metaMap = new Map(metas.map((m) => [m.reviewId, m]));
  const now = new Date();

  return reviews.map((review, idx) => {
    const meta = metaMap.get(review.id) ?? null;
    // A review is superseded if it's older than the most recent non-terminal review
    // (i.e., there's a newer pending/in-review review for the same project)
    const isSuperseded =
      idx > 0 &&
      !["approved", "rejected", "revoked"].includes(review.status) &&
      reviews
        .slice(0, idx)
        .some((r) => !["approved", "rejected", "revoked"].includes(r.status));
    const effectiveStatus =
      review.status === "shared" && now > review.tokenExpiresAt ? "shared" : review.status;
    const wsStatus = computeWsStatus(
      { ...review, status: effectiveStatus },
      meta,
      isSuperseded,
    );
    const perms = computePermissions({ ...review, status: effectiveStatus }, meta);
    return { review, meta, wsStatus, permissions: [...perms] };
  });
}

export type WorkspaceSummary = {
  review: (typeof creativeAiClientReviewsTable.$inferSelect) & { wsStatus: WorkspaceStatus };
  project: { brandName: string; businessType: string; projectId: string } | null;
  meta: AiReviewWorkspaceMeta | null;
  permissions: ReviewPermission[];
  commentCount: number;
};

export async function getWorkspaceSummary(reviewId: number): Promise<WorkspaceSummary | null> {
  const review = await getReview(reviewId);
  if (!review) return null;

  const meta = await getMeta(reviewId);

  // Check superseded: if there's a newer review for the same project
  const [newerReview] = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(
      and(
        eq(creativeAiClientReviewsTable.projectId, review.projectId),
        // Drizzle doesn't have a `gt` on timestamp easily, so we use createdAt comparison via raw
      ),
    )
    .orderBy(desc(creativeAiClientReviewsTable.createdAt))
    .limit(1);
  const isSuperseded = (newerReview?.id ?? review.id) !== review.id;

  const wsStatus = computeWsStatus(review, meta, isSuperseded);
  const perms = computePermissions(review, meta);

  const [project] = await db
    .select({
      brandName: creativeProjectsTable.brandName,
      businessType: creativeProjectsTable.businessType,
      projectId: creativeProjectsTable.projectId,
    })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, review.projectId));

  const comments = await db
    .select({ id: creativeAiClientCommentsTable.id })
    .from(creativeAiClientCommentsTable)
    .where(eq(creativeAiClientCommentsTable.reviewId, reviewId));

  return {
    review: { ...review, wsStatus },
    project: project ?? null,
    meta,
    permissions: [...perms],
    commentCount: comments.length,
  };
}

export type HistoryEvent = {
  id: string;
  eventType: string;
  label: string;
  actor: string;
  actorType: "client" | "internal" | "agent" | "system";
  occurredAt: string;
  notes?: string;
};

export async function getReviewHistory(reviewId: number): Promise<HistoryEvent[]> {
  const review = await getReview(reviewId);
  if (!review) return [];

  const meta = await getMeta(reviewId);

  const events: HistoryEvent[] = [];

  // Status transition events from review timestamps
  const transitions: Array<{ at: Date | null; type: string; label: string }> = [
    { at: review.createdAt, type: "created", label: "Review created" },
    { at: review.sharedAt, type: "shared", label: "Sent to client" },
    { at: review.viewedAt, type: "viewed", label: "Client opened review" },
    { at: review.approvedAt, type: "approved", label: "Approved by client" },
    { at: review.rejectedAt, type: "rejected", label: "Rejected by client" },
    { at: review.revisionRequestedAt, type: "revision_requested", label: "Revision requested" },
    { at: review.revokedAt, type: "revoked", label: meta?.cancelReason ? "Review canceled" : "Review link revoked" },
  ];

  for (const t of transitions) {
    if (!t.at) continue;
    events.push({
      id: `review-${reviewId}-${t.type}`,
      eventType: t.type,
      label: t.label,
      actor: t.type === "shared" || t.type === "created" || t.type === "revoked" ? "internal" : review.clientName,
      actorType: t.type === "shared" || t.type === "created" || t.type === "revoked" ? "internal" : "client",
      occurredAt: t.at.toISOString(),
      notes: t.type === "revoked" && meta?.cancelReason ? meta.cancelReason : undefined,
    });
  }

  // Meta events
  if (meta?.internalSignedOffAt) {
    events.push({
      id: `review-${reviewId}-sign-off`,
      eventType: "internal_sign_off",
      label: "Internal sign-off recorded",
      actor: meta.internalSignedOffBy ?? "internal",
      actorType: "internal",
      occurredAt: meta.internalSignedOffAt.toISOString(),
    });
  }

  // Comment events
  const comments = await db
    .select()
    .from(creativeAiClientCommentsTable)
    .where(eq(creativeAiClientCommentsTable.reviewId, reviewId))
    .orderBy(creativeAiClientCommentsTable.createdAt);

  for (const c of comments) {
    events.push({
      id: `comment-${c.id}`,
      eventType: "comment",
      label: `Comment by ${c.authorName}`,
      actor: c.authorName,
      actorType: c.authorType as "client" | "internal" | "agent",
      occurredAt: c.createdAt.toISOString(),
      notes: c.comment,
    });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  return events;
}

export async function setDueDate(
  reviewId: number,
  dueDate: Date | null,
): Promise<AiReviewWorkspaceMeta> {
  const meta = await upsertMeta(reviewId, { dueDate });
  await logAudit(
    "review-workspace",
    "review.due_date.set",
    String(reviewId),
    "creative_ai_client_review",
    "success",
    { dueDate: dueDate?.toISOString() ?? null },
  ).catch(() => {});
  return meta;
}

export async function internalSignOff(
  reviewId: number,
  signedOffBy: string,
): Promise<AiReviewWorkspaceMeta> {
  const meta = await upsertMeta(reviewId, {
    internalSignedOff: true,
    internalSignedOffBy: signedOffBy,
    internalSignedOffAt: new Date(),
  });
  await logAudit(
    "review-workspace",
    "review.internal_sign_off",
    String(reviewId),
    "creative_ai_client_review",
    "success",
    { signedOffBy },
  ).catch(() => {});
  publishSafe({
    eventType: "internal.review.signed_off",
    sourceModule: "review-workspace",
    sourceId: String(reviewId),
    payload: { reviewId, signedOffBy },
  });
  return meta;
}

export async function removeInternalSignOff(reviewId: number): Promise<AiReviewWorkspaceMeta> {
  const meta = await upsertMeta(reviewId, {
    internalSignedOff: false,
    internalSignedOffBy: null,
    internalSignedOffAt: null,
  });
  await logAudit(
    "review-workspace",
    "review.internal_sign_off_removed",
    String(reviewId),
    "creative_ai_client_review",
    "success",
    {},
  ).catch(() => {});
  return meta;
}

export async function cancelReview(
  reviewId: number,
  reason: string,
  cancelledBy: string,
): Promise<{ review: typeof creativeAiClientReviewsTable.$inferSelect; meta: AiReviewWorkspaceMeta }> {
  // Use CAS-style update: only revoke non-terminal reviews
  const updated = await db
    .update(creativeAiClientReviewsTable)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(
      and(
        eq(creativeAiClientReviewsTable.id, reviewId),
        inArray(creativeAiClientReviewsTable.status, ["not_shared", "shared", "viewed", "revision_requested"]),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw Object.assign(new Error("Review cannot be canceled in its current state."), { status: 409 });
  }

  const meta = await upsertMeta(reviewId, {
    cancelReason: reason,
    cancelledBy,
    cancelledAt: new Date(),
  });

  await logAudit(
    "review-workspace",
    "review.canceled",
    String(reviewId),
    "creative_ai_client_review",
    "success",
    { reason, cancelledBy },
  ).catch(() => {});

  publishSafe({
    eventType: "internal.review.canceled",
    sourceModule: "review-workspace",
    sourceId: String(reviewId),
    payload: { reviewId, reason, cancelledBy },
  });

  return { review: updated[0]!, meta };
}

export type ChecklistItem = ChecklistItemDef & {
  completedAt: string | null;
  completedBy: string | null;
};

export async function getChecklist(reviewId: number, domain?: string): Promise<ChecklistItem[]> {
  const meta = await getMeta(reviewId);
  const state = (meta?.checklistState ?? {}) as Record<string, { completedAt: string; completedBy: string }>;
  const defs = getChecklistDefs(domain);
  return defs.map((def) => ({
    ...def,
    completedAt: state[def.id]?.completedAt ?? null,
    completedBy: state[def.id]?.completedBy ?? null,
  }));
}

export async function toggleChecklistItem(
  reviewId: number,
  itemId: string,
  completed: boolean,
  completedBy: string,
): Promise<ChecklistItem[]> {
  const defs = getChecklistDefs();
  if (!defs.find((d) => d.id === itemId)) {
    throw Object.assign(new Error(`Unknown checklist item: ${itemId}`), { status: 400 });
  }

  const meta = await getMeta(reviewId);
  const state = { ...((meta?.checklistState ?? {}) as Record<string, { completedAt: string; completedBy: string }>) };

  if (completed) {
    state[itemId] = { completedAt: new Date().toISOString(), completedBy };
  } else {
    delete state[itemId];
  }

  await upsertMeta(reviewId, { checklistState: state });
  return getChecklist(reviewId);
}
