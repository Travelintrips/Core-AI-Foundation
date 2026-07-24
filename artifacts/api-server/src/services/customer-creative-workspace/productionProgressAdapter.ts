/**
 * productionProgressAdapter.ts — Customer-safe production progress read model.
 *
 * Reads creative_project_steps and maps them to customer-facing stage cards.
 * Security: SELECT only id/stepName/status/createdAt/updatedAt — never
 *   input, output, errorMessage, tokenUsage, provider, model, latencyMs.
 * IDOR: caller must pass in a project already verified to belong to clientEmail.
 */
import { eq } from "drizzle-orm";
import { db, creativeProjectStepsTable } from "@workspace/db";
import type { ProductionProgress, ProductionStage, StageStatus } from "./types.js";

export const STEP_DESCRIPTIONS: Record<string, string> = {
  // ── Generic 4-agent pipeline ──────────────────────────────────────────────
  "Brand Strategy":      "Menganalisis brand dan menentukan positioning strategis untuk proyek Anda.",
  "Creative Direction":  "Merancang konsep kreatif, visual, dan panduan desain.",
  "Copy Production":     "Membuat teks konten, caption, dan narasi brand yang kuat.",
  "Quality Control":     "Memeriksa kualitas semua output sebelum pengiriman ke Anda.",

  // ── Interior Design pipeline (INTERIOR_PIPELINE) ──────────────────────────
  "Design Concept":         "Arsitek konsep kami mengembangkan visi desain menyeluruh, tema, dan mood board yang sesuai dengan kebutuhan ruang Anda.",
  "Space Planning":         "Perencana ruang menyusun tata letak optimal — sirkulasi, zona fungsional, dan keseimbangan proporsi setiap area.",
  "Material Specification": "Spesialis material mengkurasi palet material, finishing, tekstur, dan furnitur yang sesuai anggaran dan gaya yang dipilih.",
  "Design Copy":            "Copywriter interior menyusun deskripsi ruang, konsep naratif, dan dokumen presentasi desain yang meyakinkan.",
  "Interior Quality Control": "Tim QC memeriksa konsistensi desain, kepatuhan anggaran, dan kesiapan dokumen sebelum pengiriman ke Anda.",

  // ── Fashion Design pipeline ───────────────────────────────────────────────
  "Fashion Brand Strategy":    "Menganalisis segmen pasar fashion, positioning brand, dan competitive landscape.",
  "Fashion Creative Direction": "Merancang arah kreatif koleksi, palet warna, dan mood board fashion.",
  "Collection Copy":           "Menyusun deskripsi koleksi, product copy, dan narasi brand fashion.",
  "Trend Analysis":            "Menganalisis tren fashion global yang relevan dengan koleksi dan target pasar.",
  "Fashion Quality Control":   "Memeriksa konsistensi koleksi, brand fit, dan kesiapan dokumen fashion.",
};

// creative_project_steps.status vocabulary from schema
const STATUS_MAP: Record<string, StageStatus> = {
  pending:           "pending",
  running:           "working",
  completed:         "completed",
  failed:            "failed",
  blocked_by_budget: "blocked",
};

const STAGE_DISPLAY: Record<StageStatus, string> = {
  pending:   "Menunggu",
  working:   "Sedang Dikerjakan",
  completed: "Selesai ✓",
  failed:    "Gagal",
  blocked:   "Tertahan",
};

const PROJECT_STATUS_PROGRESS: Record<string, number> = {
  pending:                    5,
  waiting_payment:            10,
  deposit_paid:               15,
  payment_verified:           20,
  waiting_remaining_payment:  20,
  remaining_paid:             20,
  ready_to_build:             25,
  orchestrating:              30,
  building:                   55,
  in_progress:                60,
  internal_review:            80,
  waiting_client_review:      85,
  revision_requested:         87,
  revision:                   87,
  completed:                  100,
  failed:                     100,
  cancelled:                  0,
};

const PROJECT_STAGE_LABEL: Record<string, string> = {
  pending:                    "Menunggu Konfirmasi",
  waiting_payment:            "Menunggu Pembayaran",
  deposit_paid:               "Deposit Diterima",
  payment_verified:           "Pembayaran Dikonfirmasi",
  ready_to_build:             "Siap Diproduksi",
  orchestrating:              "Memulai Produksi",
  building:                   "Dalam Produksi",
  in_progress:                "Sedang Dikerjakan",
  internal_review:            "QC Internal",
  waiting_client_review:      "Menunggu Review Anda",
  revision_requested:         "Revisi Dalam Proses",
  revision:                   "Revisi Dalam Proses",
  completed:                  "Selesai 🎉",
  failed:                     "Produksi Gagal",
  cancelled:                  "Dibatalkan",
};

export async function getProductionProgress(
  internalProjectId: number,   // creative_projects.id (integer PK)
  projectNumber: string,
  projectStatus: string,
  deliveryDate: string | null,
): Promise<ProductionProgress> {
  // SELECT only safe columns — never input/output/errorMessage/tokenUsage/provider/model
  const steps = await db
    .select({
      id:        creativeProjectStepsTable.id,
      stepName:  creativeProjectStepsTable.stepName,
      status:    creativeProjectStepsTable.status,
      createdAt: creativeProjectStepsTable.createdAt,
      updatedAt: creativeProjectStepsTable.updatedAt,
    })
    .from(creativeProjectStepsTable)
    .where(eq(creativeProjectStepsTable.projectId, internalProjectId))
    .orderBy(creativeProjectStepsTable.id);

  const stages: ProductionStage[] = steps.map((s, i) => {
    const rawStatus = (s.status ?? "pending") as string;
    const stageStatus: StageStatus = STATUS_MAP[rawStatus] ?? "pending";

    // Use createdAt as "started" proxy, updatedAt as "completed" proxy for terminal steps
    const isTerminal = stageStatus === "completed" || stageStatus === "failed";
    return {
      id:          s.id,
      name:        s.stepName ?? `Step ${i + 1}`,
      label:       STAGE_DISPLAY[stageStatus],
      status:      stageStatus,
      startedAt:   stageStatus !== "pending" ? s.createdAt.toISOString() : null,
      completedAt: isTerminal ? s.updatedAt.toISOString() : null,
      description: STEP_DESCRIPTIONS[s.stepName ?? ""] ?? "Memproses tahap ini.",
    };
  });

  // Compute overall progress
  let progressPercent: number;
  let currentStageName: string | null = null;
  let lastActivityAt: string | null = null;

  if (stages.length > 0) {
    const completedCount = stages.filter((s) => s.status === "completed").length;
    const workingStage = stages.find((s) => s.status === "working");
    const nextPending = stages.find((s) => s.status === "pending");

    // 25 base (pre-production) + up to 70 for step completion
    const stepProgress = Math.round((completedCount / stages.length) * 70);
    progressPercent = Math.min(25 + stepProgress, projectStatus === "completed" ? 100 : 95);

    currentStageName = workingStage?.name ?? nextPending?.name ?? null;
    const lastDone = [...stages].reverse().find((s) => s.completedAt);
    lastActivityAt = lastDone?.completedAt ?? null;
  } else {
    progressPercent = PROJECT_STATUS_PROGRESS[projectStatus] ?? 0;
  }

  return {
    projectNumber,
    projectStatus,
    overallStageLabel: PROJECT_STAGE_LABEL[projectStatus] ?? projectStatus.replace(/_/g, " "),
    progressPercent,
    stages,
    currentStageName,
    estimatedDelivery: deliveryDate,
    lastActivityAt,
  };
}
