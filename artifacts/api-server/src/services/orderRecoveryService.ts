/**
 * orderRecoveryService — Workstream B diagnostic & repair utilities.
 *
 * Scans creative orders for inconsistent states (completed without artifacts,
 * payment verified but files not unlocked, etc.) and optionally repairs them.
 *
 * Design rules:
 *   - scanBrokenCreativeOrder is always read-only and idempotent.
 *   - repairBrokenCreativeOrder makes the minimum targeted DB writes to bring
 *     the order back to a consistent state; every repair is logged via logAudit.
 *   - Both functions operate on a single order identified by its UUID projectId.
 */

import { eq, and, ne } from "drizzle-orm";
import {
  db,
  creativeProjectsTable,
  aiPaymentScheduleTable,
  aiInvoicesTable,
  creativeAiAssetsTable,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RepairAction =
  | "repair:completed_without_artifacts"
  | "repair:completed_without_invoice"
  | "repair:completed_without_storage"
  | "repair:files_unlocked_without_payment"
  | "repair:payment_verified_files_not_unlocked"
  | "repair:stuck_in_waiting_payment_verification";

export interface OrderScanResult {
  projectId: string;
  projectDbId: number;
  status: string;
  filesUnlocked: boolean;
  paymentStatus: string;
  hasArtifacts: boolean;
  hasArtifactWithStorage: boolean;
  hasPaymentSchedule: boolean;
  hasInvoice: boolean;
  allPaymentsPaid: boolean;
  proofSubmittedButStuck: boolean;
  repairActions: RepairAction[];
  healthy: boolean;
}

export interface OrderRepairResult {
  projectId: string;
  actionsApplied: RepairAction[];
  skipped: RepairAction[];
  errors: { action: RepairAction; error: string }[];
}

// ── scanBrokenCreativeOrder ──────────────────────────────────────────────────
// Read-only diagnostic. Returns the list of repair actions that would be taken,
// plus boolean flags for each dimension of project health.

export async function scanBrokenCreativeOrder(projectId: string): Promise<OrderScanResult> {
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.projectId, projectId))
    .limit(1);

  if (!project) throw new Error(`Project not found: ${projectId}`);

  // ── Artifact check ────────────────────────────────────────────────────────
  const assets = await db
    .select({
      id: creativeAiAssetsTable.id,
      storagePath: creativeAiAssetsTable.storagePath,
      imageUrl: creativeAiAssetsTable.imageUrl,
    })
    .from(creativeAiAssetsTable)
    .where(eq(creativeAiAssetsTable.projectId, project.id));

  const hasArtifacts = assets.length > 0;
  const hasArtifactWithStorage = assets.some(
    (a) => !!(a.storagePath || a.imageUrl),
  );

  // ── Payment schedule check ────────────────────────────────────────────────
  const schedule = await db
    .select()
    .from(aiPaymentScheduleTable)
    .where(eq(aiPaymentScheduleTable.projectId, project.id));

  const hasPaymentSchedule = schedule.length > 0;
  const allPaymentsPaid =
    hasPaymentSchedule &&
    schedule.every((s) => s.status === "paid" || s.status === "cancelled");

  // A proof is "stuck" when there's at least one proof_submitted schedule but
  // the project is still sitting at waiting_payment_verification for too long
  // (this scan just flags it; repair would nudge or re-notify admin).
  const proofSubmittedButStuck =
    project.status === "waiting_payment_verification" &&
    schedule.some((s) => s.status === "proof_submitted");

  // ── Invoice check ─────────────────────────────────────────────────────────
  const [anyInvoice] = await db
    .select({ id: aiInvoicesTable.id })
    .from(aiInvoicesTable)
    .where(eq(aiInvoicesTable.projectId, project.id))
    .limit(1);

  const hasInvoice = !!anyInvoice;

  // ── Derive repair actions ─────────────────────────────────────────────────
  const repairActions: RepairAction[] = [];
  const isCompleted = project.status === "completed";

  if (isCompleted && !hasArtifacts) {
    repairActions.push("repair:completed_without_artifacts");
  }

  if (isCompleted && !hasInvoice && !hasPaymentSchedule) {
    repairActions.push("repair:completed_without_invoice");
  }

  if (isCompleted && hasArtifacts && !hasArtifactWithStorage) {
    repairActions.push("repair:completed_without_storage");
  }

  if (project.filesUnlocked && !allPaymentsPaid && hasPaymentSchedule) {
    repairActions.push("repair:files_unlocked_without_payment");
  }

  // All payments verified (paid) but files_unlocked is still false — admin
  // may have forgotten to unlock or the verifyPayment trigger didn't fire.
  if (!project.filesUnlocked && allPaymentsPaid) {
    repairActions.push("repair:payment_verified_files_not_unlocked");
  }

  if (proofSubmittedButStuck) {
    repairActions.push("repair:stuck_in_waiting_payment_verification");
  }

  return {
    projectId: project.projectId,
    projectDbId: project.id,
    status: project.status,
    filesUnlocked: project.filesUnlocked ?? false,
    paymentStatus: project.paymentStatus ?? "unknown",
    hasArtifacts,
    hasArtifactWithStorage,
    hasPaymentSchedule,
    hasInvoice,
    allPaymentsPaid,
    proofSubmittedButStuck,
    repairActions,
    healthy: repairActions.length === 0,
  };
}

// ── repairBrokenCreativeOrder ─────────────────────────────────────────────────
// Applies only the safe, targeted repairs — never restarts AI production.
// Returns what was applied and what was skipped (e.g. if a precondition
// changed between scan and repair, that action is skipped rather than errored).

export async function repairBrokenCreativeOrder(
  projectId: string,
  repairedBy: string,
): Promise<OrderRepairResult> {
  const scan = await scanBrokenCreativeOrder(projectId);

  const actionsApplied: RepairAction[] = [];
  const skipped: RepairAction[] = [];
  const errors: { action: RepairAction; error: string }[] = [];

  for (const action of scan.repairActions) {
    try {
      if (action === "repair:payment_verified_files_not_unlocked") {
        // Re-verify files_unlocked flag when all payments are cleared.
        const [updated] = await db
          .update(creativeProjectsTable)
          .set({ filesUnlocked: true, updatedAt: new Date() })
          .where(
            and(
              eq(creativeProjectsTable.projectId, projectId),
              ne(creativeProjectsTable.filesUnlocked, true),
            ),
          )
          .returning();

        if (updated) {
          await logAudit(
            "order-recovery",
            action,
            projectId,
            "creative_project",
            "success",
            { repairedBy, reason: "All payments paid but files were still locked" },
          );
          publishSafe({
            eventType: "files.unlocked",
            sourceModule: "order-recovery",
            sourceId: String(scan.projectDbId),
            payload: { projectId: scan.projectDbId, repairedBy },
          });
          actionsApplied.push(action);
        } else {
          // Already unlocked or project disappeared between scan and repair
          skipped.push(action);
        }

      } else if (action === "repair:stuck_in_waiting_payment_verification") {
        // Re-publish the proof_submitted event so admin notification fires again.
        publishSafe({
          eventType: "payment.proof_renotify",
          sourceModule: "order-recovery",
          sourceId: projectId,
          payload: { projectId: scan.projectDbId, repairedBy },
        });
        await logAudit(
          "order-recovery",
          action,
          projectId,
          "creative_project",
          "success",
          { repairedBy },
        );
        actionsApplied.push(action);

      } else {
        // Diagnostic-only actions: log them but don't auto-repair (require
        // admin manual intervention via other endpoints).
        await logAudit(
          "order-recovery",
          `scan_flagged:${action}`,
          projectId,
          "creative_project",
          "failure",
          { repairedBy, autoRepair: false, reason: "Requires manual admin review" },
        );
        skipped.push(action);
      }
    } catch (err) {
      errors.push({ action, error: String(err) });
    }
  }

  return { projectId, actionsApplied, skipped, errors };
}
