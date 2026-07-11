/**
 * files.ts — P0-2 Final File Protection.
 *
 * GET  /public/files/access/:token   — verify signed token, check filesUnlocked, redirect
 * POST /ai/files/generate-token      — admin: generate signed download token for a project file
 * POST /ai/files/revoke-token        — admin: revoke a signed token
 *
 * Design:
 *   • File URLs are never sent directly to customers — only signed tokens.
 *   • Tokens are HMAC-SHA256 signed, self-expiring (1 hour default).
 *   • Access is double-gated: valid token AND project.files_unlocked = true.
 *   • Every access attempt is written to the audit log.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, creativeProjectsTable } from "@workspace/db";
import { logAudit } from "../services/aiAuditService.js";
import {
  generateDownloadToken,
  verifyDownloadToken,
  revokeToken,
} from "../services/signedUrlService.js";
import { uploadLimiter } from "../middleware/rateLimiter.js";

const router = Router();

// ── GET /public/files/access/:token ────────────────────────────────────────────
// Public (no admin key). Verifies the token, checks payment status, logs, redirects.

router.get("/public/files/access/:token", async (req, res): Promise<void> => {
  const { token } = req.params as { token: string };
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? req.socket.remoteAddress ?? "unknown";

  const verification = verifyDownloadToken(token);

  if (!verification.valid || !verification.payload) {
    await logAudit("files", "access_denied", token.slice(0, 12), "signed_url", "failure", {
      reason: verification.reason,
      ip,
    });
    res.status(401).json({ error: `File access denied: ${verification.reason}` });
    return;
  }

  const { pid, url } = verification.payload;

  // Double-check: project must have files_unlocked = true
  const [project] = await db
    .select({ id: creativeProjectsTable.id, filesUnlocked: creativeProjectsTable.filesUnlocked, status: creativeProjectsTable.status })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, pid))
    .limit(1);

  if (!project) {
    await logAudit("files", "access_denied", String(pid), "signed_url", "failure", { reason: "Project not found", ip });
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.filesUnlocked) {
    await logAudit("files", "access_denied_locked", String(pid), "signed_url", "failure", {
      reason: "Files not unlocked — remaining payment outstanding",
      projectStatus: project.status,
      ip,
    });
    res.status(402).json({
      error: "Files are locked. Please complete remaining payment to access final files.",
      code: "FILES_LOCKED",
      projectStatus: project.status,
    });
    return;
  }

  await logAudit("files", "access_granted", String(pid), "signed_url", "success", {
    tokenId: verification.payload.id,
    ip,
  });

  // Redirect to the actual file URL
  res.redirect(302, url);
});

// ── POST /ai/files/generate-token ──────────────────────────────────────────────
// Admin: generate a signed download token for a project file.

router.post("/ai/files/generate-token", uploadLimiter, async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const projectId = typeof body.projectId === "number" ? body.projectId : parseInt(String(body.projectId ?? ""), 10);
  const fileUrl = typeof body.fileUrl === "string" ? body.fileUrl.trim() : "";
  const ttlSeconds = typeof body.ttlSeconds === "number" ? body.ttlSeconds : 3600;

  if (isNaN(projectId)) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!fileUrl) {
    res.status(400).json({ error: "fileUrl is required" });
    return;
  }

  // Ensure project exists and files are unlocked before issuing a token
  const [project] = await db
    .select({ id: creativeProjectsTable.id, filesUnlocked: creativeProjectsTable.filesUnlocked })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  if (!project.filesUnlocked) {
    res.status(402).json({
      error: "Cannot generate download token — project files are not yet unlocked.",
      code: "FILES_LOCKED",
    });
    return;
  }

  const token = generateDownloadToken(projectId, fileUrl, Math.min(ttlSeconds, 86400));
  const expiresAt = new Date(Date.now() + Math.min(ttlSeconds, 86400) * 1000).toISOString();

  await logAudit("files", "token_generated", String(projectId), "signed_url", "success", {
    fileUrl: fileUrl.slice(0, 80),
    ttlSeconds,
  });

  res.status(201).json({ token, expiresAt, projectId });
});

// ── POST /ai/files/revoke-token ────────────────────────────────────────────────
// Admin: revoke a previously issued signed token.

router.post("/ai/files/revoke-token", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const revoked = revokeToken(token);
  if (!revoked) {
    res.status(400).json({ error: "Token is invalid or already expired" });
    return;
  }

  await logAudit("files", "token_revoked", "admin", "signed_url", "success", {});
  res.json({ ok: true, revoked: true });
});

export default router;
