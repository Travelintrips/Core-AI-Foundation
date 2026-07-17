/**
 * notificationAdapter.ts — Enhanced notification synthesis for Team 2.
 *
 * Synthesizes actionable notifications from project states and existing
 * workspace notification rows. Adds urgency classification and action paths
 * that deep-link into the creative workspace UI.
 *
 * Delegates to existing listWorkspaceNotifications for DB-persisted notifications,
 * then augments with project-derived notifications (review pending, download ready,
 * payment required). All are customer-safe — no internal data exposed.
 */
import type { WorkspaceSession } from "../customerWorkspaceService.js";
import type { CWNotification, NotificationSeverity, NotificationSummary } from "./types.js";

interface ProjectState {
  projectNumber: string;
  brandName: string;
  currentStage: string;
  filesUnlocked: boolean;
  reviewStatus: string | null;
  paymentStatus: string | null;
}

/** Synthesize project-derived notifications that may not be in the DB yet. */
function synthesizeProjectNotifications(
  projects: ProjectState[],
  token: string,
): CWNotification[] {
  const notifications: CWNotification[] = [];
  const base = `/creative-workspace/${token}`;
  const now = new Date().toISOString();

  for (const p of projects) {
    // Review pending
    if (p.reviewStatus === "shared" || p.currentStage === "waiting_client_review") {
      notifications.push({
        id: `synth-review-${p.projectNumber}`,
        type: "review_pending",
        title: "Review Menunggu Anda",
        message: `${p.brandName} — File review siap. Silakan berikan feedback Anda.`,
        projectNumber: p.projectNumber,
        read: false,
        severity: "action",
        createdAt: now,
        actionLabel: "Buka Review",
        actionPath: `${base}/projects/${p.projectNumber}?tab=revisions`,
      });
    }

    // Download ready
    if (p.filesUnlocked && p.currentStage === "completed") {
      notifications.push({
        id: `synth-download-${p.projectNumber}`,
        type: "download_ready",
        title: "File Siap Diunduh",
        message: `${p.brandName} — Proyek selesai dan file Anda siap diunduh.`,
        projectNumber: p.projectNumber,
        read: false,
        severity: "success",
        createdAt: now,
        actionLabel: "Unduh Sekarang",
        actionPath: `${base}/projects/${p.projectNumber}?tab=deliverables`,
      });
    }

    // Payment required
    if (
      p.paymentStatus === "pending" ||
      p.paymentStatus === "waiting_verification" ||
      p.currentStage === "waiting_payment"
    ) {
      notifications.push({
        id: `synth-payment-${p.projectNumber}`,
        type: "payment_required",
        title: "Pembayaran Diperlukan",
        message: `${p.brandName} — Konfirmasi pembayaran diperlukan untuk melanjutkan produksi.`,
        projectNumber: p.projectNumber,
        read: false,
        severity: "warning",
        createdAt: now,
        actionLabel: "Lihat Invoice",
        actionPath: `${base}/projects/${p.projectNumber}?tab=payments`,
      });
    }

    // Revision in progress
    if (p.currentStage === "revision_requested" || p.reviewStatus === "revision_requested") {
      notifications.push({
        id: `synth-revision-${p.projectNumber}`,
        type: "revision_in_progress",
        title: "Revisi Sedang Dikerjakan",
        message: `${p.brandName} — Tim kami sedang mengerjakan revisi berdasarkan feedback Anda.`,
        projectNumber: p.projectNumber,
        read: false,
        severity: "info",
        createdAt: now,
        actionLabel: "Pantau Progress",
        actionPath: `${base}/projects/${p.projectNumber}?tab=progress`,
      });
    }
  }

  return notifications;
}

/**
 * Build enhanced notification list for the creative workspace.
 * Merges persisted DB notifications with synthesized project-state notifications.
 */
export function buildEnhancedNotifications(
  persistedNotifications: Array<{
    id: number;
    type: string | null;
    title: string | null;
    message: string | null;
    projectId: string | null;
    read: boolean;
    severity: string | null;
    createdAt: Date;
    category: string | null;
  }>,
  projects: ProjectState[],
  token: string,
): NotificationSummary {
  const synthesized = synthesizeProjectNotifications(projects, token);

  // Map persisted notifications to CWNotification
  const persisted: CWNotification[] = persistedNotifications.map((n) => ({
    id:            String(n.id),
    type:          n.type ?? "general",
    title:         n.title ?? "Notifikasi",
    message:       n.message ?? "",
    projectNumber: n.projectId ?? null,
    read:          n.read,
    severity:      (n.severity as NotificationSeverity) ?? "info",
    createdAt:     n.createdAt.toISOString(),
    actionLabel:   null,
    actionPath:    null,
  }));

  // Deduplicate synthesized by type+project (don't show if already in DB)
  const existingKeys = new Set(persistedNotifications.map((n) => `${n.type}-${n.projectId}`));
  const uniqueSynthesized = synthesized.filter(
    (s) => !existingKeys.has(`${s.type}-${s.projectNumber}`),
  );

  const all = [...uniqueSynthesized, ...persisted].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return {
    items:       all,
    unreadCount: all.filter((n) => !n.read).length,
    total:       all.length,
  };
}
