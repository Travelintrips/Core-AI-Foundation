/**
 * overviewAggregator.ts — Single-call overview for the creative workspace dashboard.
 *
 * Composes data from multiple existing services into one customer-safe response.
 * IDOR: all queries are already scoped by the existing services to clientEmail.
 */
import type { Request } from "express";
import type { WorkspaceSession } from "../customerWorkspaceService.js";
import {
  getWorkspaceSummary,
  listWorkspaceProjectsFiltered,
} from "../customerWorkspaceService.js";
import type { CWOverview, CWProjectCard, CWUrgentAction } from "./types.js";

const STAGE_LABELS: Record<string, string> = {
  package_selected:   "Paket Dipilih",
  brief_completed:    "Brief Selesai",
  waiting_payment:    "Menunggu Pembayaran",
  payment_verified:   "Pembayaran Dikonfirmasi",
  ai_strategy:        "Strategi AI",
  creative_direction: "Arah Kreatif",
  production:         "Dalam Produksi",
  internal_qc:        "QC Internal",
  client_review:      "Menunggu Review",
  revision:           "Revisi",
  completed:          "Selesai",
};

function deriveUrgentAction(
  p: {
    projectNumber: string;
    brandName: string;
    currentStage: string;
    filesUnlocked: boolean;
    reviewStatus: string | null;
    paymentStatus: string | null;
  },
  token: string,
): CWUrgentAction | null {
  const base = `/creative-workspace/${token}/projects/${p.projectNumber}`;

  if (p.reviewStatus === "shared" || p.currentStage === "client_review") {
    return {
      type: "review_pending",
      projectNumber: p.projectNumber,
      projectName: p.brandName,
      label: "Review Menunggu",
      message: "File siap — berikan feedback Anda sekarang.",
      priority: "high",
      actionPath: `${base}?tab=revisions`,
    };
  }
  if (p.currentStage === "waiting_payment") {
    return {
      type: "payment_required",
      projectNumber: p.projectNumber,
      projectName: p.brandName,
      label: "Pembayaran Diperlukan",
      message: "Produksi menunggu konfirmasi pembayaran.",
      priority: "high",
      actionPath: `${base}?tab=payments`,
    };
  }
  if (p.filesUnlocked && p.currentStage === "completed") {
    return {
      type: "download_ready",
      projectNumber: p.projectNumber,
      projectName: p.brandName,
      label: "File Siap Diunduh",
      message: "Proyek selesai. Unduh file Anda.",
      priority: "medium",
      actionPath: `${base}?tab=deliverables`,
    };
  }
  if (p.currentStage === "revision") {
    return {
      type: "revision_requested",
      projectNumber: p.projectNumber,
      projectName: p.brandName,
      label: "Revisi Dalam Proses",
      message: "Tim kami sedang mengerjakan revisi Anda.",
      priority: "low",
      actionPath: `${base}?tab=progress`,
    };
  }
  return null;
}

export async function buildOverview(
  req: Request,
  session: WorkspaceSession,
  token: string,
): Promise<CWOverview> {
  // Fetch summary + projects in parallel
  const [summary, projectsResult] = await Promise.all([
    getWorkspaceSummary(req, session),
    listWorkspaceProjectsFiltered(req, session.clientEmail, { sort: "newest" }),
  ]);

  const projects = Array.isArray(projectsResult) ? projectsResult : [];

  const urgentActions: CWUrgentAction[] = [];
  const recentProjects: CWProjectCard[] = projects.slice(0, 10).map((p) => {
    const action = deriveUrgentAction(
      {
        projectNumber: p.projectNumber,
        brandName:     p.brandName,
        currentStage:  p.currentStage,
        filesUnlocked: p.filesUnlocked,
        reviewStatus:  p.reviewStatus,
        paymentStatus: p.paymentStatus,
      },
      token,
    );
    if (action && urgentActions.length < 5) urgentActions.push(action);

    return {
      projectNumber:     p.projectNumber,
      brandName:         p.brandName,
      serviceName:       p.serviceName,
      packageName:       p.packageName,
      currentStage:      p.currentStage,
      currentStageLabel: STAGE_LABELS[p.currentStage] ?? p.currentStageLabel,
      progressPercent:   p.progressPercent,
      filesUnlocked:     p.filesUnlocked,
      deliveryDate:      p.deliveryDate,
      reviewStatus:      p.reviewStatus,
      paymentStatus:     p.paymentStatus,
      urgentAction:      action,
      createdAt:         p.createdAt,
      updatedAt:         p.updatedAt,
    };
  });

  const totalProjects   = projects.length;
  const activeProjects  = projects.filter((p) => !["completed", "cancelled", "failed"].includes(p.currentStage)).length;
  const waitingReview   = projects.filter((p) => p.reviewStatus === "shared" || p.currentStage === "client_review").length;
  const completedProjects = projects.filter((p) => p.currentStage === "completed").length;
  const pendingPayment  = projects.filter((p) => p.currentStage === "waiting_payment").length;

  return {
    clientName:  session.clientName,
    clientEmail: session.clientEmail,
    stats: {
      totalProjects,
      activeProjects,
      waitingReview,
      completedProjects,
      pendingPayment,
      unreadNotifications: 0, // enriched by caller if needed
      downloadableAssets:  summary.downloadCount ?? 0,
      outstandingBalance:  Number(summary.outstandingBalance ?? 0),
      outstandingCurrency: summary.outstandingCurrency ?? "IDR",
    },
    recentProjects,
    urgentActions,
  };
}
