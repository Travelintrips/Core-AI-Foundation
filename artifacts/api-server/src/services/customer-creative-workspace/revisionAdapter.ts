/**
 * revisionAdapter.ts — Customer-safe revision / review history read model.
 *
 * Reads creative_ai_client_reviews.
 * Security:
 *   • reviewTokenHash is NEVER included
 *   • reviewTokenPlain is used ONLY to construct the reviewUrl for the session owner
 *   • No internal project details
 * IDOR: caller must pass in a project already verified to belong to clientEmail.
 */
import { eq, asc } from "drizzle-orm";
import { db, creativeAiClientReviewsTable } from "@workspace/db";
import type { RevisionHistory, CWRevisionEntry } from "./types.js";

const STATUS_LABELS: Record<string, string> = {
  not_shared:          "Belum Dibagikan",
  shared:              "Dikirim — Menunggu Review",
  viewed:              "Anda Sudah Melihat",
  approved:            "Anda Setujui ✓",
  rejected:            "Ditolak",
  revision_requested:  "Revisi Diminta",
  revision_complete:   "Revisi Selesai",
  expired:             "Link Kadaluarsa",
  revoked:             "Dibatalkan",
};

const TERMINAL_STATUSES = new Set(["approved", "rejected", "revision_complete", "expired", "revoked"]);

export async function getRevisionHistory(
  projectId: string,       // text UUID — creative_ai_client_reviews.project_id
  projectNumber: string,
  baseUrl: string,         // for constructing reviewUrl from plaintext token
): Promise<RevisionHistory> {
  const rows = await db
    .select({
      id:                   creativeAiClientReviewsTable.id,
      status:               creativeAiClientReviewsTable.status,
      // Use reviewTokenPlain only to construct the URL (safe for the session owner)
      reviewTokenPlain:     creativeAiClientReviewsTable.reviewTokenPlain,
      sharedAt:             creativeAiClientReviewsTable.sharedAt,
      viewedAt:             creativeAiClientReviewsTable.viewedAt,
      approvedAt:           creativeAiClientReviewsTable.approvedAt,
      revisionRequestedAt:  creativeAiClientReviewsTable.revisionRequestedAt,
      createdAt:            creativeAiClientReviewsTable.createdAt,
    })
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.projectId, projectId))
    .orderBy(asc(creativeAiClientReviewsTable.createdAt));

  const entries: CWRevisionEntry[] = rows.map((r, i) => {
    const status = r.status ?? "not_shared";
    const isTerminal = TERMINAL_STATUSES.has(status);

    // Build reviewUrl from plaintext token (safe to expose to session owner)
    const reviewUrl = r.reviewTokenPlain
      ? `${baseUrl}/review/${r.reviewTokenPlain}`
      : null;

    // resolvedAt: pick whichever terminal timestamp is present
    const resolvedAt = r.approvedAt ?? r.revisionRequestedAt ?? (isTerminal ? r.createdAt : null);

    return {
      id:           r.id,
      round:        i + 1,
      status,
      statusLabel:  STATUS_LABELS[status] ?? status,
      feedback:     null,  // feedback is tracked via asset revisionNotes, not here
      sharedAt:     r.sharedAt ? r.sharedAt.toISOString() : null,
      viewedAt:     r.viewedAt ? r.viewedAt.toISOString() : null,
      resolvedAt:   resolvedAt ? resolvedAt.toISOString() : null,
      reviewUrl,
    };
  });

  const latest = rows[rows.length - 1];
  const currentStatus = latest?.status ?? "none";

  return {
    projectNumber,
    totalRounds:        entries.length,
    currentStatus,
    currentStatusLabel: STATUS_LABELS[currentStatus] ?? currentStatus,
    entries,
  };
}
