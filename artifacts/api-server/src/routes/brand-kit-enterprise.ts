/**
 * brand-kit-enterprise.ts — V4.2D Brand Kit Enterprise routes
 *
 * Public (token-auth) and Admin routes for the enterprise brand kit.
 * No zod import — manual validation per convention.
 * All paths under PUBLIC_PATH_PREFIXES are admin-key-exempt.
 */
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import { resolveWorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  getBrandKitEnterprise,
  listBrandKitEnterpriseForCustomer,
  upsertBrandKitSlot,
  archiveBrandKitSlot,
  getSlotVersionHistory,
  customerOwnsProjectBrandKit,
  getAdminBrandKitStats,
} from "../services/brandKitEnterpriseService.js";
import { BRAND_KIT_SLOTS } from "@workspace/db";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withSession(req: import("express").Request, res: import("express").Response) {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

// ── GET /public/customer/workspace/:token/brand-kit-enterprise ────────────────
// Returns all brand kit slot assets with completeness score for this customer.
router.get("/public/customer/workspace/:token/brand-kit-enterprise", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const kits = await listBrandKitEnterpriseForCustomer(session.emailHash, session.clientEmail);
  res.json({ items: kits, total: kits.length });
});

// ── GET /public/customer/workspace/:token/brand-kit-enterprise/:projectId ─────
router.get("/public/customer/workspace/:token/brand-kit-enterprise/:projectId", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const { projectId } = req.params as { projectId: string };

  const owns = await customerOwnsProjectBrandKit(session.emailHash, session.clientEmail, projectId);
  if (!owns) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const kit = await getBrandKitEnterprise(projectId);
  if (!kit) {
    res.status(404).json({ error: "Brand kit not found" });
    return;
  }
  res.json(kit);
});

// ── PUT /public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot ──
// Upsert a brand kit slot (upload or set text value). Creates a new version.
router.put(
  "/public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const { projectId, slot } = req.params as { projectId: string; slot: string };

    if (!BRAND_KIT_SLOTS.includes(slot as (typeof BRAND_KIT_SLOTS)[number])) {
      res.status(400).json({ error: `Invalid slot. Valid slots: ${BRAND_KIT_SLOTS.join(", ")}` });
      return;
    }

    const owns = await customerOwnsProjectBrandKit(session.emailHash, session.clientEmail, projectId);
    if (!owns) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const updated = await upsertBrandKitSlot({
      projectId,
      emailHash: session.emailHash,
      slot,
      fileName: typeof body["fileName"] === "string" ? body["fileName"] : undefined,
      storagePath: typeof body["storagePath"] === "string" ? body["storagePath"] : undefined,
      previewUrl: typeof body["previewUrl"] === "string" ? body["previewUrl"] : undefined,
      mimeType: typeof body["mimeType"] === "string" ? body["mimeType"] : undefined,
      fileSizeBytes: typeof body["fileSizeBytes"] === "number" ? body["fileSizeBytes"] : undefined,
      value: typeof body["value"] === "string" ? body["value"] : undefined,
      valueJson: body["valueJson"] !== undefined ? (body["valueJson"] as Record<string, unknown>) : undefined,
      uploadedBy: session.clientEmail,
      tags: Array.isArray(body["tags"]) ? (body["tags"] as string[]) : undefined,
    });

    res.status(201).json(updated);
  },
);

// ── DELETE /public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot ──
// Archive a brand kit slot.
router.delete(
  "/public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const { projectId, slot } = req.params as { projectId: string; slot: string };

    const owns = await customerOwnsProjectBrandKit(session.emailHash, session.clientEmail, projectId);
    if (!owns) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const ok = await archiveBrandKitSlot(projectId, slot);
    if (!ok) {
      res.status(404).json({ error: "Slot not found" });
      return;
    }
    res.json({ ok: true });
  },
);

// ── GET /public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot/history ──
router.get(
  "/public/customer/workspace/:token/brand-kit-enterprise/:projectId/slots/:slot/history",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const { projectId, slot } = req.params as { projectId: string; slot: string };

    const owns = await customerOwnsProjectBrandKit(session.emailHash, session.clientEmail, projectId);
    if (!owns) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const history = await getSlotVersionHistory(projectId, slot);
    res.json({ items: history, total: history.length });
  },
);

// ── Admin ─────────────────────────────────────────────────────────────────────

// GET /ai/brand-kit/stats — brand kit completeness summary
router.get("/ai/brand-kit/stats", async (_req, res): Promise<void> => {
  const stats = await getAdminBrandKitStats();
  res.json(stats);
});

// GET /ai/brand-kit/projects/:projectId — admin view of any project's brand kit
router.get("/ai/brand-kit/projects/:projectId", async (req, res): Promise<void> => {
  const { projectId } = req.params as { projectId: string };
  const kit = await getBrandKitEnterprise(projectId);
  if (!kit) {
    res.status(404).json({ error: "Brand kit not found" });
    return;
  }
  res.json(kit);
});

export default router;
