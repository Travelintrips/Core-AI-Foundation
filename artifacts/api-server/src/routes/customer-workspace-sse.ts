/**
 * customer-workspace-sse.ts — SSE streaming endpoint for canonical runtime events.
 *
 * Route: GET /public/customer/workspace/:token/projects/:projectNumber/events/stream
 *
 * Security:
 *   - workspace token validated via resolveWorkspaceSession (existing mechanism)
 *   - project ownership resolved server-side via getProjectDetail
 *   - no arbitrary internalProjectId accepted from client
 *   - token never logged (URL serializer in app.ts already strips query, but token is path param)
 *   - no sensitive fields in event payload (enforced by canonicalEventService)
 *
 * Proxy compatibility:
 *   - X-Accel-Buffering: no     → disables nginx/Replit proxy buffering
 *   - Cache-Control: no-cache, no-transform
 *   - Connection: keep-alive
 */

import { Router } from "express";
import type { Request, Response } from "express";
import {
  resolveWorkspaceSession,
  getProjectDetail,
} from "../services/customerWorkspaceService.js";
import {
  registerSubscriber,
  removeSubscriber,
  decodeCursor,
} from "../services/sseManager.js";
import { DEFAULT_TENANT_ID } from "../security/tenantResolution.js";
import { logger } from "../lib/logger.js";

const router = Router();

/** Project stages that are terminal — stream closes after snapshot. */
const TERMINAL_STAGES = new Set([
  "completed",
  "delivered",
  "failed",
  "cancelled",
]);

/**
 * Send SSE headers. Must be called before any write.
 * `res.flushHeaders()` immediately dispatches the HTTP 200 + headers so the
 * client's EventSource transitions to OPEN before the first data arrives.
 */
function sendSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx / Replit proxy buffering
  // Disable express compression for this route (compression middleware checks this)
  res.setHeader("Content-Encoding", "identity");
  res.flushHeaders();
}

function writeRaw(res: Response, event: string, data: unknown, id?: string): void {
  if (res.writableEnded) return;
  try {
    if (id !== undefined) res.write(`id: ${id}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch { /* socket closed */ }
}

// ── GET /public/customer/workspace/:token/projects/:projectNumber/events/stream ─

router.get(
  "/public/customer/workspace/:token/projects/:projectNumber/events/stream",
  async (req: Request, res: Response): Promise<void> => {
    const { token, projectNumber } = req.params as {
      token: string;
      projectNumber: string;
    };

    // ── 1. Validate workspace token ─────────────────────────────────────────
    const sessionResult = await resolveWorkspaceSession(token);
    if (!sessionResult.ok) {
      res.status(sessionResult.status).json({ error: sessionResult.error });
      return;
    }
    const session = sessionResult.session;

    // ── 2. Resolve project ownership (server-side only) ─────────────────────
    const detail = await getProjectDetail(req, session.clientEmail, projectNumber);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const internalProjectId = detail.overview.internalProjectId;
    // projectNumber is the UUID projectId (creativeProjects.projectId)
    const projectId = detail.overview.projectNumber;
    const isTerminal = TERMINAL_STAGES.has(detail.overview.currentStage);

    // ── 3. Set SSE headers ──────────────────────────────────────────────────
    sendSSEHeaders(res);

    // ── 4. No-runtime linkage — send empty snapshot + heartbeats only ────────
    if (!internalProjectId) {
      writeRaw(
        res,
        "snapshot",
        { events: [], lastEventId: null, generatedAt: new Date().toISOString() },
        `snapshot:${Date.now()}`,
      );

      // Keep-alive heartbeats until client disconnects
      const hb = setInterval(() => {
        if (res.writableEnded) { clearInterval(hb); return; }
        writeRaw(res, "heartbeat", { timestamp: new Date().toISOString() });
      }, 20_000);

      req.on("close", () => { clearInterval(hb); if (!res.writableEnded) res.end(); });
      return;
    }

    // ── 5. Parse reconnect cursor (Last-Event-ID header or ?after= param) ───
    const lastEventIdHeader = req.headers["last-event-id"] as string | undefined;
    const afterParam = req.query["after"] as string | undefined;
    const rawCursor = lastEventIdHeader ?? afterParam ?? null;
    const afterCursor = rawCursor ? decodeCursor(rawCursor) : null;

    // ── 6. Resolve client IP (trust proxy is set on the Express app) ─────────
    const ip = (
      (req.ip ?? (req.socket as { remoteAddress?: string })?.remoteAddress ?? "unknown")
    ).replace(/^::ffff:/, "");

    // ── 7. Register subscriber with shared SSE manager ───────────────────────
    const result = await registerSubscriber({
      res,
      ip,
      token,
      projectId,
      internalProjectId,
      afterCursor,
      isProjectTerminal: isTerminal,
      // V4.1 — real flag, used only for ExecutionSummary derivation (never guessed downstream).
      filesUnlocked: detail.overview.filesUnlocked,
      // WP-07 — server-resolved tenant; never taken from client input.
      tenantId: DEFAULT_TENANT_ID,
    });

    if (!result.ok) {
      // Headers already sent — send a customer-safe stream.error, then close
      if (!res.writableEnded) {
        writeRaw(res, "stream.error", {
          message: "Live updates are temporarily unavailable. Reconnecting…",
        });
        res.end();
      }
      return;
    }

    const sub = result.sub;

    // ── 8. Terminal project — close cleanly after snapshot ───────────────────
    if (isTerminal) {
      writeRaw(res, "stream.complete", { message: "Project completed." });
      res.end();
      removeSubscriber(sub);
      return;
    }

    // ── 9. Clean up subscriber when client disconnects ───────────────────────
    req.on("close", () => {
      logger.debug({ subId: sub.id, projectId }, "[sse] Client disconnected");
      removeSubscriber(sub);
    });
  },
);

export default router;
