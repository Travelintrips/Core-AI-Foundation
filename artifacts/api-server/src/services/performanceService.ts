/**
 * Performance Service — Phase 4.9
 * Tracks employee performance metrics and drives the Learning Engine.
 */
import { eq } from "drizzle-orm";
import { db, aiEmployeePerformanceTable } from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

const TRAINING_THRESHOLD_SUCCESS_RATE = 70;  // below this → training required
const PROMOTION_THRESHOLD_SUCCESS_RATE = 90; // above this + quality → promotion candidate
const PROMOTION_THRESHOLD_QUALITY      = 85;
const TRAINING_XP_COST  = 100;
const PROMOTION_XP_BONUS = 250;

// ── Core helpers ──────────────────────────────────────────────────────────────

/** Ensure a performance record exists; create if missing. */
export async function ensurePerformanceRecord(employeeId: number) {
  const [existing] = await db
    .select()
    .from(aiEmployeePerformanceTable)
    .where(eq(aiEmployeePerformanceTable.employeeId, employeeId));

  if (existing) return existing;

  const [created] = await db
    .insert(aiEmployeePerformanceTable)
    .values({ employeeId })
    .returning();

  return created;
}

/** Record task completion and update metrics. */
export async function recordTaskCompletion(
  employeeId: number,
  outcome: "success" | "failure" | "revision",
  latencyMs?: number,
  costUsd?: number,
): Promise<void> {
  const perf = await ensurePerformanceRecord(employeeId);

  const prevTotal = perf.completedProjects;
  const newTotal  = prevTotal + 1;

  // Rolling average helpers — guard against null/NaN so bad data never propagates
  const roll = (old: string | null, val: number | undefined) => {
    if (val == null || Number.isNaN(val)) return old;
    const prevAvg = old != null ? parseFloat(old) : NaN;
    if (Number.isNaN(prevAvg)) return val.toFixed(4);
    return ((prevAvg * prevTotal + val) / newTotal).toFixed(4);
  };

  const successIncrement = outcome === "success" ? 1 : 0;
  const prevSuccesses    = Math.round((parseFloat(String(perf.successRate)) / 100) * prevTotal);
  const newSuccessRate   = newTotal > 0 ? ((prevSuccesses + successIncrement) / newTotal) * 100 : 0;

  const prevApprovals = Math.round((parseFloat(String(perf.approvalRate)) / 100) * prevTotal);
  const newApprovalRate = newTotal > 0 ? ((prevApprovals + successIncrement) / newTotal) * 100 : 0;

  const revisionIncrement = outcome === "revision" ? 1 : 0;
  const prevRevisions     = Math.round((parseFloat(String(perf.revisionRate)) / 100) * prevTotal);
  const newRevisionRate   = newTotal > 0 ? ((prevRevisions + revisionIncrement) / newTotal) * 100 : 0;

  const failureIncrement = outcome === "failure" ? 1 : 0;
  const prevFailures     = Math.round((parseFloat(String(perf.failureRate)) / 100) * prevTotal);
  const newFailureRate   = newTotal > 0 ? ((prevFailures + failureIncrement) / newTotal) * 100 : 0;

  // XP: +10 for success, +5 for revision, +1 for failure (learning)
  const xpGain = outcome === "success" ? 10 : outcome === "revision" ? 5 : 1;

  // Quality score: weighted average of success + approval
  const newQualityScore = (newSuccessRate * 0.6 + newApprovalRate * 0.4);

  // Learning Engine: auto-flag training / promotion
  const trainingRequired = newSuccessRate < TRAINING_THRESHOLD_SUCCESS_RATE;
  const newPromotionScore =
    newSuccessRate >= PROMOTION_THRESHOLD_SUCCESS_RATE &&
    newQualityScore >= PROMOTION_THRESHOLD_QUALITY
      ? Math.min(100, parseFloat(String(perf.promotionScore)) + 5)
      : Math.max(0, parseFloat(String(perf.promotionScore)) - 1);

  await db
    .update(aiEmployeePerformanceTable)
    .set({
      completedProjects: newTotal,
      successRate:       newSuccessRate.toFixed(2),
      averageLatency:    roll(String(perf.averageLatency), latencyMs),
      averageCost:       roll(String(perf.averageCost), costUsd),
      approvalRate:      newApprovalRate.toFixed(2),
      revisionRate:      newRevisionRate.toFixed(2),
      failureRate:       newFailureRate.toFixed(2),
      qualityScore:      newQualityScore.toFixed(2),
      experiencePoints:  perf.experiencePoints + xpGain,
      promotionScore:    newPromotionScore.toFixed(2),
      trainingRequired,
      lastUpdated:       new Date(),
    })
    .where(eq(aiEmployeePerformanceTable.employeeId, employeeId));

  if (trainingRequired && !perf.trainingRequired) {
    await logAudit(
      "performance",
      "training_flagged",
      String(employeeId),
      "employee",
      "failure",
      { successRate: newSuccessRate.toFixed(2) },
    ).catch(() => {});
  }
}

/** Get all performance records. */
export async function getAllPerformance() {
  return db.select().from(aiEmployeePerformanceTable);
}

/** Get performance for one employee. */
export async function getEmployeePerformance(employeeId: number) {
  const [row] = await db
    .select()
    .from(aiEmployeePerformanceTable)
    .where(eq(aiEmployeePerformanceTable.employeeId, employeeId));
  return row ?? null;
}
