/**
 * paymentGate.ts — P0-1 reusable Payment Gate middleware.
 *
 * Ensures AI production (brand strategy, creative workflow, image generation,
 * copywriting, QC) cannot start until a project has reached one of the
 * payment-ready statuses defined in the payment policy.
 *
 * Payment policy support:
 *   full_payment   → requires status = payment_verified
 *   deposit        → requires status = deposit_paid OR payment_verified
 *   subscription   → requires status = payment_verified
 *   purchase_order → requires status = deposit_paid OR payment_verified
 */
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, creativeProjectsTable } from "@workspace/db";

/** Project statuses that indicate payment is sufficient to start AI production. */
export const PAYMENT_READY_STATUSES = new Set([
  "deposit_paid",
  "payment_verified",
  "remaining_paid",
  "completed",
]);

/** Project statuses that indicate all payments are complete and files may be unlocked. */
export const FILE_UNLOCK_STATUSES = new Set([
  "remaining_paid",
  "payment_verified", // full_payment / subscription / PO flow
  "completed",
]);

/**
 * requirePaymentVerified — middleware factory.
 *
 * Resolves the project from `req.params[paramName]` (defaults to "id") or
 * `req.body.projectId`. Returns 402 if the project's payment status does not
 * yet allow AI production.
 */
export function requirePaymentVerified(paramName = "id") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawId = (req.params as Record<string, string>)[paramName] ?? req.body?.projectId;
    const id = typeof rawId === "string" ? parseInt(rawId, 10) : typeof rawId === "number" ? rawId : NaN;

    if (Number.isNaN(id)) {
      res.status(400).json({ error: "projectId is required for payment gate check", code: "MISSING_PROJECT_ID" });
      return;
    }

    const [project] = await db
      .select({
        id: creativeProjectsTable.id,
        status: creativeProjectsTable.status,
        paymentStatus: creativeProjectsTable.paymentStatus,
        filesUnlocked: creativeProjectsTable.filesUnlocked,
      })
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, id))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
      return;
    }

    if (!PAYMENT_READY_STATUSES.has(project.status)) {
      res.status(402).json({
        error: "Payment required before AI production can start.",
        code: "PAYMENT_REQUIRED",
        projectStatus: project.status,
        paymentStatus: project.paymentStatus,
        requiredStatuses: [...PAYMENT_READY_STATUSES],
      });
      return;
    }

    next();
  };
}

/**
 * requireFilesUnlocked — middleware factory.
 *
 * Returns 402 if the project's files are not yet unlocked (i.e. remaining
 * payment has not been verified).
 */
export function requireFilesUnlocked(paramName = "id") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawId = (req.params as Record<string, string>)[paramName] ?? req.body?.projectId;
    const id = typeof rawId === "string" ? parseInt(rawId, 10) : typeof rawId === "number" ? rawId : NaN;

    if (Number.isNaN(id)) {
      res.status(400).json({ error: "projectId is required", code: "MISSING_PROJECT_ID" });
      return;
    }

    const [project] = await db
      .select({ id: creativeProjectsTable.id, filesUnlocked: creativeProjectsTable.filesUnlocked, status: creativeProjectsTable.status })
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.id, id))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: "Project not found", code: "PROJECT_NOT_FOUND" });
      return;
    }

    if (!project.filesUnlocked) {
      res.status(402).json({
        error: "Final files are locked until remaining payment is verified.",
        code: "FILES_LOCKED",
        filesUnlocked: false,
        projectStatus: project.status,
      });
      return;
    }

    next();
  };
}

/** Helper: returns true if a project status allows AI production. */
export function isPaymentReady(status: string): boolean {
  return PAYMENT_READY_STATUSES.has(status);
}

/** Helper: returns true if a project's files should be unlocked. */
export function areFilesUnlocked(filesUnlocked: boolean): boolean {
  return filesUnlocked === true;
}
