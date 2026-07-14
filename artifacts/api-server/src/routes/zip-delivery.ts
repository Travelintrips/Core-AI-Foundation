/**
 * zip-delivery.ts — V4.2D ZIP Delivery routes
 *
 * Customer workspace: check ZIP status, trigger ZIP for unlocked projects.
 * Admin: ZIP status overview, force retry.
 * No zod import — manual validation per convention.
 */
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  getZipDelivery,
  enqueueZipDelivery,
  retryZipDelivery,
  listZipDeliveries,
  getAdminZipStats,
} from "../services/zipDeliveryService.js";
import { db, creativeProjectsTable, creativeAiClientReviewsTable, aiServiceRequestsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

async function withSession(req: import("express").Request, res: import("express").Response) {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

async function customerOwnsProject(clientEmail: string, projectId: string): Promise<boolean> {
  const email = clientEmail.toLowerCase().trim();
  const [review] = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(and(eq(creativeAiClientReviewsTable.projectId, projectId), eq(creativeAiClientReviewsTable.clientEmail, email)));
  if (review) return true;

  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (project?.serviceRequestId) {
    const [sr] = await db
      .select({ id: aiServiceRequestsTable.id })
      .from(aiServiceRequestsTable)
      .where(and(eq(aiServiceRequestsTable.id, project.serviceRequestId), eq(aiServiceRequestsTable.customerEmail, email)));
    if (sr) return true;
  }
  return false;
}

// ── GET /public/customer/workspace/:token/zip/:projectId ──────────────────────
// Get ZIP delivery status for a project
router.get("/public/customer/workspace/:token/zip/:projectId", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const { projectId } = req.params as { projectId: string };

  const owns = await customerOwnsProject(session.clientEmail, projectId);
  if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

  const delivery = await getZipDelivery(projectId, true);
  if (!delivery) { res.json({ status: "none", projectId }); return; }
  res.json(delivery);
});

// ── POST /public/customer/workspace/:token/zip/:projectId/request ─────────────
// Customer requests ZIP generation for a completed, unlocked project
router.post("/public/customer/workspace/:token/zip/:projectId/request", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const { projectId } = req.params as { projectId: string };

  const owns = await customerOwnsProject(session.clientEmail, projectId);
  if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

  // Verify project is unlocked (filesUnlocked is the canonical gate)
  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!project.filesUnlocked) {
    res.status(402).json({ error: "Files are locked. Complete payment to request ZIP delivery.", code: "FILES_LOCKED" });
    return;
  }

  const delivery = await enqueueZipDelivery(projectId);
  await logAudit("zip-delivery", "zip_requested", projectId, "creative_project", "success", {
    clientEmail: session.clientEmail,
    deliveryId: delivery.id,
  });
  res.status(202).json(delivery);
});

// ── POST /public/customer/workspace/:token/zip/:projectId/retry ───────────────
router.post("/public/customer/workspace/:token/zip/:projectId/retry", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const { projectId } = req.params as { projectId: string };

  const owns = await customerOwnsProject(session.clientEmail, projectId);
  if (!owns) { res.status(404).json({ error: "Project not found" }); return; }

  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, projectId));
  if (!project?.filesUnlocked) {
    res.status(402).json({ error: "Files are locked.", code: "FILES_LOCKED" });
    return;
  }

  const delivery = await retryZipDelivery(projectId);
  res.status(202).json(delivery);
});

// ── Admin ─────────────────────────────────────────────────────────────────────

// GET /ai/zip-deliveries — stats overview
router.get("/ai/zip-deliveries", async (_req, res): Promise<void> => {
  const stats = await getAdminZipStats();
  res.json(stats);
});

// POST /ai/zip-deliveries/:projectId/retry — admin force retry
router.post("/ai/zip-deliveries/:projectId/retry", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const delivery = await retryZipDelivery(projectId);
  await logAudit("zip-delivery", "admin_retry", projectId, "creative_project", "success", {});
  res.status(202).json(delivery);
});

// GET /ai/zip-deliveries/:projectId — admin view of a single project's ZIP
router.get("/ai/zip-deliveries/:projectId", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const delivery = await getZipDelivery(projectId, true);
  if (!delivery) { res.json({ status: "none", projectId }); return; }
  res.json(delivery);
});

export default router;
