/**
 * customer-creative-workspace/index.ts — Team 2 Enhanced Creative Workspace routes.
 *
 * All routes are under /public/customer/creative-workspace/:token/...
 * which falls under the PUBLIC_PATH_PREFIXES exception in adminAuth middleware
 * (same pattern as the existing /public/ workspace routes).
 *
 * Route registration: Team 24 mounts this router in routes/index.ts.
 * See integration/manifests/team-02.json for the integration contract.
 *
 * Security:
 *   • All routes call guardToken() first → 401/404 on invalid token
 *   • IDOR protection: verifyProjectOwnership() delegates to existing service
 *   • No storagePath / imageUrl / provider / model / cost data in any response
 */
import { Router } from "express";
import { guardToken, verifyProjectOwnership } from "../../services/customer-creative-workspace/authGuard.js";
import { buildBriefStatus } from "../../services/customer-creative-workspace/briefStatusAdapter.js";
import { getProductionProgress } from "../../services/customer-creative-workspace/productionProgressAdapter.js";
import { getDeliverableBundle } from "../../services/customer-creative-workspace/deliverableAdapter.js";
import { getRevisionHistory } from "../../services/customer-creative-workspace/revisionAdapter.js";
import { buildEnhancedNotifications } from "../../services/customer-creative-workspace/notificationAdapter.js";
import { buildOverview } from "../../services/customer-creative-workspace/overviewAggregator.js";
import { getProjectHistory } from "../../services/customer-creative-workspace/historyAdapter.js";
import { getPublicBaseUrl } from "../../lib/publicBaseUrl.js";
import { db, aiServiceRequestsTable, creativeProjectsTable, customerNotificationReadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  listWorkspaceProjectsFiltered,
} from "../../services/customerWorkspaceService.js";

const router = Router();

// ── Pagination helper ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT     = 100;

function parsePagination(query: Record<string, string | undefined>): { limit: number; offset: number } {
  const rawLimit  = parseInt(query["limit"]  ?? String(DEFAULT_PAGE_LIMIT), 10);
  const rawOffset = parseInt(query["offset"] ?? "0", 10);
  const limit  = Number.isFinite(rawLimit)  ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_LIMIT) : DEFAULT_PAGE_LIMIT;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0)                          : 0;
  return { limit, offset };
}

// ── GET /public/customer/creative-workspace/:token/overview ───────────────────
// Unified dashboard response — stats + recent projects + urgent actions.
router.get("/public/customer/creative-workspace/:token/overview", async (req, res): Promise<void> => {
  const session = await guardToken(req, res);
  if (!session) return;

  const { token } = req.params as { token: string };

  try {
    const overview = await buildOverview(req, session, token);
    res.json(overview);
  } catch (err) {
    console.error("[cw2] overview error", err);
    res.status(500).json({ error: "Failed to load overview" });
  }
});

// ── GET /public/customer/creative-workspace/:token/projects ───────────────────
// Enhanced project list with urgency classification.
router.get("/public/customer/creative-workspace/:token/projects", async (req, res): Promise<void> => {
  const session = await guardToken(req, res);
  if (!session) return;

  const { token } = req.params as { token: string };
  const q = req.query as Record<string, string | undefined>;

  try {
    const items = await listWorkspaceProjectsFiltered(req, session.clientEmail, {
      search:   q["search"],
      status:   q["status"],
      service:  q["service"],
      industry: q["industry"],
      sort:     (q["sort"] as "newest" | "oldest" | "delivery_date" | undefined) ?? "newest",
    });

    // Enrich with urgency flag
    const allEnriched = items.map((p) => ({
      ...p,
      hasUrgentAction:
        p.reviewStatus === "shared" ||
        p.currentStage === "client_review" ||
        p.currentStage === "waiting_payment",
      creativeWorkspaceDetailPath: `/creative-workspace/${token}/projects/${p.projectNumber}`,
    }));

    // Apply pagination — projects sorted newest-first by listWorkspaceProjectsFiltered
    const { limit: pLimit, offset: pOffset } = parsePagination(q as Record<string, string | undefined>);
    const total = allEnriched.length;
    const enriched = allEnriched.slice(pOffset, pOffset + pLimit);
    res.json({ items: enriched, total, limit: pLimit, offset: pOffset });
  } catch (err) {
    console.error("[cw2] projects error", err);
    res.status(500).json({ error: "Failed to load projects" });
  }
});

// ── GET /public/customer/creative-workspace/:token/projects/:projectNumber/brief ─
// Brief status — structured field-by-field completion view.
router.get(
  "/public/customer/creative-workspace/:token/projects/:projectNumber/brief",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { projectNumber } = req.params as { projectNumber: string };

    try {
      const detail = await verifyProjectOwnership(req, session, projectNumber);
      if (!detail) { res.status(404).json({ error: "Project not found" }); return; }

      const p = detail.overview;

      // Load briefJson from the service request if it's a catalog project
      let briefJson: unknown = null;
      let submittedAt: string | null = null;
      let updatedAt: string | null = null;

      if (p.kind === "service_request") {
        const [sr] = await db
          .select({
            briefJson: aiServiceRequestsTable.briefJson,
            createdAt: aiServiceRequestsTable.createdAt,
            updatedAt: aiServiceRequestsTable.updatedAt,
          })
          .from(aiServiceRequestsTable)
          .where(eq(aiServiceRequestsTable.requestId, projectNumber))
          .limit(1);

        if (sr) {
          briefJson  = sr.briefJson;
          submittedAt = sr.createdAt.toISOString();
          updatedAt  = sr.updatedAt?.toISOString() ?? null;
        }
      } else if (p.internalProjectId) {
        // For direct creative projects, look for a linked service request via serviceRequestId
        const [proj] = await db
          .select({ serviceRequestId: creativeProjectsTable.serviceRequestId })
          .from(creativeProjectsTable)
          .where(eq(creativeProjectsTable.id, p.internalProjectId))
          .limit(1);
        if (proj?.serviceRequestId) {
          const [sr] = await db
            .select({ briefJson: aiServiceRequestsTable.briefJson, createdAt: aiServiceRequestsTable.createdAt, updatedAt: aiServiceRequestsTable.updatedAt })
            .from(aiServiceRequestsTable)
            .where(eq(aiServiceRequestsTable.id, proj.serviceRequestId))
            .limit(1);
          if (sr) {
            briefJson  = sr.briefJson;
            submittedAt = sr.createdAt?.toISOString() ?? null;
            updatedAt  = sr.updatedAt?.toISOString() ?? null;
          }
        }
      }

      const status = buildBriefStatus({
        projectNumber,
        serviceType: p.serviceName ?? null,
        briefJson,
        submittedAt,
        updatedAt,
      });

      res.json(status);
    } catch (err) {
      console.error("[cw2] brief error", err);
      res.status(500).json({ error: "Failed to load brief status" });
    }
  },
);

// ── GET /public/customer/creative-workspace/:token/projects/:projectNumber/progress ─
// Production progress — step-by-step stage cards.
router.get(
  "/public/customer/creative-workspace/:token/projects/:projectNumber/progress",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { projectNumber } = req.params as { projectNumber: string };

    try {
      const detail = await verifyProjectOwnership(req, session, projectNumber);
      if (!detail) { res.status(404).json({ error: "Project not found" }); return; }

      const p = detail.overview;
      if (!p.internalProjectId) {
        // Service request without a linked project yet — return minimal progress
        res.json({
          projectNumber,
          projectStatus: p.currentStage,
          overallStageLabel: p.currentStageLabel,
          progressPercent: p.progressPercent,
          stages: [],
          currentStageName: null,
          estimatedDelivery: p.deliveryDate,
          lastActivityAt: null,
        });
        return;
      }

      const progress = await getProductionProgress(
        p.internalProjectId,
        projectNumber,
        p.currentStage,
        p.deliveryDate,
      );
      res.json(progress);
    } catch (err) {
      console.error("[cw2] progress error", err);
      res.status(500).json({ error: "Failed to load production progress" });
    }
  },
);

// ── GET /public/customer/creative-workspace/:token/projects/:projectNumber/deliverables ─
// Customer-safe deliverable gallery (no storage paths, no internal URLs).
router.get(
  "/public/customer/creative-workspace/:token/projects/:projectNumber/deliverables",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { token, projectNumber } = req.params as { token: string; projectNumber: string };

    try {
      const detail = await verifyProjectOwnership(req, session, projectNumber);
      if (!detail) { res.status(404).json({ error: "Project not found" }); return; }

      const p = detail.overview;
      if (!p.internalProjectId) {
        res.json({ projectNumber, filesUnlocked: false, deliverables: [], zipBundle: null, totalAssets: 0, approvedAssets: 0, pendingAssets: 0 });
        return;
      }

      // Get the projectId (UUID text) — we need it for asset queries
      const [proj] = await db
        .select({ projectId: creativeProjectsTable.projectId })
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.id, p.internalProjectId))
        .limit(1);

      if (!proj?.projectId) {
        res.json({ projectNumber, filesUnlocked: false, deliverables: [], zipBundle: null, totalAssets: 0, approvedAssets: 0, pendingAssets: 0 });
        return;
      }

      const bundle = await getDeliverableBundle(
        proj.projectId,
        p.internalProjectId,
        projectNumber,
        p.filesUnlocked,
        token,
      );

      // Apply pagination to deliverables list
      const { limit, offset } = parsePagination(req.query as Record<string, string | undefined>);
      const totalAssets = bundle.deliverables.length;
      const paged = bundle.deliverables.slice(offset, offset + limit);
      res.json({ ...bundle, deliverables: paged, totalAssets, limit, offset });
    } catch (err) {
      console.error("[cw2] deliverables error", err);
      res.status(500).json({ error: "Failed to load deliverables" });
    }
  },
);

// ── GET /public/customer/creative-workspace/:token/projects/:projectNumber/revisions ─
// Review & revision history — no tokens exposed.
router.get(
  "/public/customer/creative-workspace/:token/projects/:projectNumber/revisions",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { projectNumber } = req.params as { projectNumber: string };

    try {
      const detail = await verifyProjectOwnership(req, session, projectNumber);
      if (!detail) { res.status(404).json({ error: "Project not found" }); return; }

      const p = detail.overview;
      if (!p.internalProjectId) {
        res.json({ projectNumber, totalRounds: 0, currentStatus: "none", currentStatusLabel: "Belum Ada Review", entries: [] });
        return;
      }

      const [proj] = await db
        .select({ projectId: creativeProjectsTable.projectId })
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.id, p.internalProjectId))
        .limit(1);

      if (!proj?.projectId) {
        res.json({ projectNumber, totalRounds: 0, currentStatus: "none", currentStatusLabel: "Belum Ada Review", entries: [] });
        return;
      }

      const baseUrl = getPublicBaseUrl(req);
      const full = await getRevisionHistory(proj.projectId, projectNumber, baseUrl);

      // Apply pagination to revision entries — stable createdAt-ASC order preserved in adapter
      const { limit, offset } = parsePagination(req.query as Record<string, string | undefined>);
      const totalRounds = full.entries.length;
      const entries = full.entries.slice(offset, offset + limit);
      res.json({ ...full, entries, totalRounds, limit, offset });
    } catch (err) {
      console.error("[cw2] revisions error", err);
      res.status(500).json({ error: "Failed to load revision history" });
    }
  },
);

// ── GET /public/customer/creative-workspace/:token/projects/:projectNumber/history ─
// Canonical event feed for a project — customer-safe activity log.
router.get(
  "/public/customer/creative-workspace/:token/projects/:projectNumber/history",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { projectNumber } = req.params as { projectNumber: string };
    const limit = Math.min(parseInt((req.query["limit"] as string) ?? "50", 10), 100);

    try {
      const detail = await verifyProjectOwnership(req, session, projectNumber);
      if (!detail) { res.status(404).json({ error: "Project not found" }); return; }

      const p = detail.overview;
      if (!p.internalProjectId) {
        res.json({ projectNumber, events: [], total: 0 });
        return;
      }

      const [proj] = await db
        .select({ projectId: creativeProjectsTable.projectId })
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.id, p.internalProjectId))
        .limit(1);

      if (!proj?.projectId) {
        res.json({ projectNumber, events: [], total: 0 });
        return;
      }

      const { limit: histLimit, offset: histOffset } = parsePagination(req.query as Record<string, string | undefined>);
      const history = await getProjectHistory(proj.projectId, projectNumber, p.internalProjectId, histLimit + histOffset);
      // Apply offset (historyAdapter already caps at 100 but we paginate after)
      const allEvents = history.events;
      const pagedEvents = allEvents.slice(histOffset, histOffset + histLimit);
      res.json({ ...history, events: pagedEvents, total: allEvents.length, limit: histLimit, offset: histOffset });
    } catch (err) {
      console.error("[cw2] history error", err);
      res.status(500).json({ error: "Failed to load project history" });
    }
  },
);

// ── GET /public/customer/creative-workspace/:token/notifications ──────────────
// Enhanced notifications synthesized from project states + DB read tracking.
router.get("/public/customer/creative-workspace/:token/notifications", async (req, res): Promise<void> => {
  const session = await guardToken(req, res);
  if (!session) return;

  const { token } = req.params as { token: string };

  try {
    const [projects, readRows] = await Promise.all([
      listWorkspaceProjectsFiltered(req, session.clientEmail, { sort: "newest" }),
      db
        .select({ notificationKey: customerNotificationReadsTable.notificationKey })
        .from(customerNotificationReadsTable)
        .where(eq(customerNotificationReadsTable.emailHash, session.emailHash)),
    ]);

    const projectStates = (Array.isArray(projects) ? projects : []).map((p) => ({
      projectNumber: p.projectNumber,
      brandName:     p.brandName,
      currentStage:  p.currentStage,
      filesUnlocked: p.filesUnlocked,
      reviewStatus:  p.reviewStatus,
      paymentStatus: p.paymentStatus,
    }));

    const readSet = new Set(readRows.map((r) => r.notificationKey));

    // Build notifications from project states only (no separate DB notifications table)
    const summary = buildEnhancedNotifications([], projectStates, token);

    // Apply DB read tracking
    summary.items = summary.items.map((n) => ({
      ...n,
      read: readSet.has(n.id),
    }));
    summary.unreadCount = summary.items.filter((n) => !n.read).length;

    // Apply pagination — stable descending-createdAt order preserved in adapter
    const { limit: nLimit, offset: nOffset } = parsePagination(req.query as Record<string, string | undefined>);
    const total = summary.items.length;
    const items = summary.items.slice(nOffset, nOffset + nLimit);
    res.json({ ...summary, items, total, limit: nLimit, offset: nOffset });
  } catch (err) {
    console.error("[cw2] notifications error", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// ── POST /public/customer/creative-workspace/:token/notifications/:id/read ───
// Mark a notification as read (persists to customer_notification_reads).
router.post(
  "/public/customer/creative-workspace/:token/notifications/:id/read",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { id } = req.params as { id: string };
    try {
      await db
        .insert(customerNotificationReadsTable)
        .values({ emailHash: session.emailHash, notificationKey: id })
        .onConflictDoNothing();
      res.json({ ok: true });
    } catch (err) {
      console.error("[cw2] mark-read error", err);
      res.status(500).json({ error: "Failed to mark notification read" });
    }
  },
);

// ── POST /public/customer/creative-workspace/:token/notifications/read-all ───
router.post(
  "/public/customer/creative-workspace/:token/notifications/read-all",
  async (req, res): Promise<void> => {
    const session = await guardToken(req, res);
    if (!session) return;

    const { token } = req.params as { token: string };
    try {
      // Get all notification IDs (synthesized + DB) and mark them all
      const projects = await listWorkspaceProjectsFiltered(req, session.clientEmail, { sort: "newest" });

      const projectStates = (Array.isArray(projects) ? projects : []).map((p) => ({
        projectNumber: p.projectNumber,
        brandName:     p.brandName,
        currentStage:  p.currentStage,
        filesUnlocked: p.filesUnlocked,
        reviewStatus:  p.reviewStatus,
        paymentStatus: p.paymentStatus,
      }));

      const summary = buildEnhancedNotifications([], projectStates, token);

      for (const n of summary.items) {
        await db
          .insert(customerNotificationReadsTable)
          .values({ emailHash: session.emailHash, notificationKey: n.id })
          .onConflictDoNothing();
      }

      res.json({ ok: true, markedCount: summary.items.length });
    } catch (err) {
      console.error("[cw2] read-all error", err);
      res.status(500).json({ error: "Failed to mark all notifications read" });
    }
  },
);

export default router;
