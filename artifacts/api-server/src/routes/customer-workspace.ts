/**
 * customer-workspace.ts — Customer Workspace public routes (post-payment
 * professional dashboard: Projects, Downloads, Invoices, Brand Kit,
 * Notifications, Activity, Profile, Support, Repeat Order).
 *
 * All routes are prefixed /public/customer/workspace/ which falls under the
 * PUBLIC_PATH_PREFIXES exception in adminAuth middleware. Auth continues to
 * use the existing dashboardToken model (customer_dashboard_tokens) — no new
 * session/auth mechanism. NOTE: no zod import here — matches the manual
 * validation convention used by customer-portal.ts / quotations.ts.
 *
 * This module only reads existing data (creative projects, service catalog,
 * quotations, payments, invoices, assets, audit log) and reuses the existing
 * signedUrlService (Sprint P0) for downloads. It never touches AI Workforce /
 * Queue / Dispatcher / Event Bus / Scheduler / Workflow Runner / Creative AI /
 * Pricing Engine / Marketplace / Human Task / Client Review / Security P0.
 */
import { Router } from "express";
import { logAudit } from "../services/aiAuditService.js";
import type { WorkspaceSession } from "../services/customerWorkspaceService.js";
import {
  resolveWorkspaceSession,
  getWorkspaceSummary,
  listWorkspaceProjectsFiltered,
  getProjectDetail,
  listWorkspaceDownloads,
  signWorkspaceDownload,
  listBrandKits,
  listWorkspaceInvoices,
  listWorkspaceNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  listWorkspaceActivity,
  getWorkspaceProfile,
  updateWorkspaceProfile,
  createSupportTicket,
  listSupportTickets,
  buildRepeatOrderDraft,
  recommendationsFor,
  type ProfilePatch,
  type RepeatOrderMode,
} from "../services/customerWorkspaceService.js";
import {
  getEventsForProject,
  filterForActivityFeed,
} from "../services/canonicalEventService.js";
import { db, creativeProjectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveProjectImageBatchType } from "../services/creativeProjectImageBatchType.js";
import { getPublicBaseUrl } from "../lib/publicBaseUrl.js";
import { listBatchAssets, groupAssetsForGallery } from "../services/image-batch/imageBatchAssetService.js";

const router = Router();

async function withSession(
  req: import("express").Request,
  res: import("express").Response,
): Promise<WorkspaceSession | null> {
  const { token } = req.params as { token: string };
  const result = await resolveWorkspaceSession(token);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.session;
}

// ── GET /public/customer/workspace/:token/summary ─────────────────────────────
router.get("/public/customer/workspace/:token/summary", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const summary = await getWorkspaceSummary(req, session);
  res.json(summary);
});

// ── GET /public/customer/workspace/:token/projects ────────────────────────────
router.get("/public/customer/workspace/:token/projects", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const items = await listWorkspaceProjectsFiltered(req, session.clientEmail, {
    search: q["search"],
    status: q["status"],
    service: q["service"],
    industry: q["industry"],
    sort: (q["sort"] as "newest" | "oldest" | "delivery_date" | undefined) ?? "newest",
  });
  res.json({ items, total: items.length });
});

// ── GET /public/customer/workspace/:token/projects/:projectNumber ────────────
router.get("/public/customer/workspace/:token/projects/:projectNumber", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const { projectNumber } = req.params as { projectNumber: string };
  const detail = await getProjectDetail(req, session.clientEmail, projectNumber);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json({ ...detail, recommendations: recommendationsFor(detail.overview.serviceName) });
});

// ── GET /public/customer/workspace/:token/projects/:projectNumber/events ─────
// V4.0C: Canonical Runtime Event stream for a single project.
// Sorted chronologically (ASC). All events are customer-safe — no internals.
// Optional ?filter=activity returns only activity-feed-relevant events.
router.get(
  "/public/customer/workspace/:token/projects/:projectNumber/events",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;

    const { projectNumber } = req.params as { projectNumber: string };

    // Ownership check: verify the project belongs to this session's customer
    const detail = await getProjectDetail(req, session.clientEmail, projectNumber);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Return the already-computed events from the detail (no extra DB round-trip).
    // V4.1 — pair events with their pre-computed summaries (same order/length as
    // detail.events) before filtering, so `summaries` stays index-aligned with `events`.
    const eventIndexById = new Map(detail.events.map((e, i) => [e.eventId, i]));
    const events = (req.query["filter"] === "activity")
      ? filterForActivityFeed(detail.events)
      : detail.events;
    const summaries = events.map((e) => detail.eventSummaries[eventIndexById.get(e.eventId)!]);

    res.json({ events, summaries, total: events.length });
  },
);

// ── GET /public/customer/workspace/:token/projects/:projectNumber/image-batch ─
// Phase 5: grouped image batch gallery (logo concepts / social pack / packaging
// views). Customer-safe fields only — no qc notes, cost, or entitlement source.
router.get(
  "/public/customer/workspace/:token/projects/:projectNumber/image-batch",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const { projectNumber } = req.params as { projectNumber: string };

    // Ownership check via the existing detail lookup before touching batch data.
    const detail = await getProjectDetail(req, session.clientEmail, projectNumber);
    if (!detail) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [project] = await db
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, projectNumber));
    const batchType = project ? await resolveProjectImageBatchType(project) : null;
    if (!project || !batchType) {
      res.json({ batchType: null, groups: [] });
      return;
    }

    const assets = await listBatchAssets(project.projectId, batchType);
    const groups = groupAssetsForGallery(assets);

    res.json({
      batchType,
      filesUnlocked: detail.overview.filesUnlocked ?? false,
      groups: groups.map((g) => ({
        group: g.group,
        groupLabel: g.groupLabel,
        items: g.items.map((a) => ({
          id: a.id,
          status: a.status,
          imageUrl: a.status === "completed" ? a.imageUrl : null,
        })),
      })),
    });
  },
);

// ── GET /public/customer/workspace/:token/downloads ───────────────────────────
router.get("/public/customer/workspace/:token/downloads", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const items = await listWorkspaceDownloads(req, session.clientEmail, {
    category: q["category"],
    projectNumber: q["projectId"],
    search: q["search"],
  });
  res.json({ items, total: items.length });
});

// ── POST /public/customer/workspace/:token/downloads/:assetId/sign ───────────
router.post("/public/customer/workspace/:token/downloads/:assetId/sign", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const assetId = parseInt((req.params as { assetId: string }).assetId, 10);
  if (isNaN(assetId)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  const result = await signWorkspaceDownload(session.clientEmail, assetId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.status === 402 ? "FILES_LOCKED" : "NOT_FOUND" });
    return;
  }
  await logAudit("customer-workspace", "download_signed", String(assetId), "creative_ai_asset", "success", {
    clientEmail: session.clientEmail,
  });
  res.status(201).json(result);
});

// ── GET /public/customer/workspace/:token/brand-kit ───────────────────────────
router.get("/public/customer/workspace/:token/brand-kit", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const kits = await listBrandKits(req, session.clientEmail);
  res.json({ items: kits, total: kits.length });
});

// ── GET /public/customer/workspace/:token/invoices ────────────────────────────
router.get("/public/customer/workspace/:token/invoices", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const items = await listWorkspaceInvoices(req, session.clientEmail, { status: q["status"] });
  res.json({ items, total: items.length });
});

// ── GET /public/customer/workspace/:token/notifications ───────────────────────
router.get("/public/customer/workspace/:token/notifications", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const q = req.query as Record<string, string | undefined>;
  const items = await listWorkspaceNotifications(req, session, {
    category: q["category"],
    read: q["read"] as "read" | "unread" | undefined,
  });
  res.json({ items, total: items.length, unreadCount: items.filter((n) => !n.isRead).length });
});

// ── POST /public/customer/workspace/:token/notifications/read ────────────────
router.post("/public/customer/workspace/:token/notifications/read", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const body = req.body as Record<string, unknown>;
  const key = typeof body["key"] === "string" ? body["key"] : "";
  if (!key) {
    res.status(400).json({ error: "key is required" });
    return;
  }
  await markNotificationRead(session.emailHash, key);
  res.json({ ok: true });
});

// ── POST /public/customer/workspace/:token/notifications/read-all ────────────
router.post("/public/customer/workspace/:token/notifications/read-all", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const count = await markAllNotificationsRead(req, session);
  res.json({ ok: true, markedRead: count });
});

// ── GET /public/customer/workspace/:token/activity ────────────────────────────
router.get("/public/customer/workspace/:token/activity", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const items = await listWorkspaceActivity(req, session.clientEmail);
  res.json({ items, total: items.length });
});

// ── GET /public/customer/workspace/:token/profile ─────────────────────────────
router.get("/public/customer/workspace/:token/profile", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const profile = await getWorkspaceProfile(session);
  res.json(profile);
});

// ── PATCH /public/customer/workspace/:token/profile ───────────────────────────
router.patch("/public/customer/workspace/:token/profile", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const body = req.body as Record<string, unknown>;
  const ALLOWED = ["companyName", "address", "picName", "picPhone", "billingEmail", "taxId", "paymentMethodNotes", "brandPreferences"] as const;
  const patch: ProfilePatch = {};
  for (const key of ALLOWED) {
    if (key in body) {
      (patch as Record<string, unknown>)[key] = body[key] === "" ? null : body[key];
    }
  }
  const updated = await updateWorkspaceProfile(session, patch);
  await logAudit("customer-workspace", "profile_updated", session.emailHash, "customer_profile", "success", {});
  res.json(updated);
});

// ── GET /public/customer/workspace/:token/support/tickets ─────────────────────
router.get("/public/customer/workspace/:token/support/tickets", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const items = await listSupportTickets(session);
  res.json({ items, total: items.length });
});

// ── POST /public/customer/workspace/:token/support/tickets ────────────────────
router.post("/public/customer/workspace/:token/support/tickets", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;
  const body = req.body as Record<string, unknown>;
  const subject = typeof body["subject"] === "string" ? body["subject"].trim() : "";
  const message = typeof body["message"] === "string" ? body["message"].trim() : "";
  const category = typeof body["category"] === "string" ? body["category"] : undefined;
  const projectNumber = typeof body["projectNumber"] === "string" ? body["projectNumber"] : undefined;

  if (!subject || !message) {
    res.status(400).json({ error: "subject and message are required" });
    return;
  }

  const ticket = await createSupportTicket(session, { subject, message, category, projectNumber });
  await logAudit("customer-workspace", "support_ticket_created", String(ticket?.id ?? ""), "support_ticket", "success", {
    clientEmail: session.clientEmail,
    category,
  });
  res.status(201).json(ticket);
});

// ── POST /public/customer/workspace/:token/projects/:projectNumber/repeat-order ─
router.post(
  "/public/customer/workspace/:token/projects/:projectNumber/repeat-order",
  async (req, res): Promise<void> => {
    const session = await withSession(req, res);
    if (!session) return;
    const { projectNumber } = req.params as { projectNumber: string };
    const body = req.body as Record<string, unknown>;
    const mode = (typeof body["mode"] === "string" ? body["mode"] : "similar") as RepeatOrderMode;
    if (!["similar", "duplicate", "use_brief"].includes(mode)) {
      res.status(400).json({ error: "Invalid mode. Use similar | duplicate | use_brief" });
      return;
    }

    const draft = await buildRepeatOrderDraft(req, session.clientEmail, projectNumber, mode);
    if (!draft) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    await logAudit("customer-workspace", "repeat_order_requested", projectNumber, "creative_project", "success", {
      clientEmail: session.clientEmail,
      mode,
    });
    res.json(draft);
  },
);

// ── GET /public/customer/workspace/:token/affiliate ────────────────────────────
// Return this customer's affiliate profile (by email) or null.

router.get("/public/customer/workspace/:token/affiliate", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db, aiAffiliatesTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [aff] = await db
    .select()
    .from(aiAffiliatesTable)
    .where(eq(aiAffiliatesTable.email, session.clientEmail))
    .limit(1);

  res.json(aff ?? null);
});

// ── POST /public/customer/workspace/:token/affiliate/join ─────────────────────
// Register this customer as an affiliate.

router.post("/public/customer/workspace/:token/affiliate/join", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db, aiAffiliatesTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const crypto = await import("node:crypto");

  const [existing] = await db
    .select({ id: aiAffiliatesTable.id })
    .from(aiAffiliatesTable)
    .where(eq(aiAffiliatesTable.email, session.clientEmail))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Already an affiliate" });
    return;
  }

  const affiliateCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  const baseUrl = getPublicBaseUrl(req);

  const [aff] = await db
    .insert(aiAffiliatesTable)
    .values({
      name: session.clientName,
      email: session.clientEmail,
      affiliateCode,
      commissionRate: 10,
      status: "active",
    })
    .returning();

  await logAudit("affiliate", "affiliate_joined", String(aff.id), "ai_affiliate", "success", { email: session.clientEmail });
  res.status(201).json({ ...aff, affiliateLink: `${baseUrl}?ref=${affiliateCode}` });
});

// ── GET /public/customer/workspace/:token/affiliate/conversions ───────────────

router.get("/public/customer/workspace/:token/affiliate/conversions", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db, aiAffiliatesTable, aiAffiliateConversionsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [aff] = await db
    .select({ id: aiAffiliatesTable.id })
    .from(aiAffiliatesTable)
    .where(eq(aiAffiliatesTable.email, session.clientEmail))
    .limit(1);

  if (!aff) { res.json([]); return; }

  const conversions = await db
    .select()
    .from(aiAffiliateConversionsTable)
    .where(eq(aiAffiliateConversionsTable.affiliateId, aff.id));

  res.json(conversions);
});

// ── GET /public/customer/workspace/:token/referral ────────────────────────────
// Return this customer's primary referral entry or null.

router.get("/public/customer/workspace/:token/referral", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db } = await import("@workspace/db");
  const { sql } = await import("drizzle-orm");

  // Get customer profile ID from email
  const rows = await db.execute(
    sql`SELECT id FROM ai_platform.customer_profiles WHERE client_email = ${session.clientEmail} LIMIT 1`,
  );
  const profileId = (rows as unknown as Array<{ id: number }>)[0]?.id;
  if (!profileId) { res.json(null); return; }

  const { aiReferralsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");

  const [ref] = await db
    .select()
    .from(aiReferralsTable)
    .where(eq(aiReferralsTable.referrerProfileId, profileId))
    .limit(1);

  res.json(ref ?? null);
});

// ── POST /public/customer/workspace/:token/referral/generate ──────────────────

router.post("/public/customer/workspace/:token/referral/generate", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db } = await import("@workspace/db");
  const { sql, eq } = await import("drizzle-orm");

  const rows = await db.execute(
    sql`SELECT id FROM ai_platform.customer_profiles WHERE client_email = ${session.clientEmail} LIMIT 1`,
  );
  const profileId = (rows as unknown as Array<{ id: number }>)[0]?.id;
  if (!profileId) { res.status(404).json({ error: "Customer profile not found" }); return; }

  const { aiReferralsTable } = await import("@workspace/db");
  const crypto = await import("node:crypto");

  const [existing] = await db
    .select()
    .from(aiReferralsTable)
    .where(eq(aiReferralsTable.referrerProfileId, profileId))
    .limit(1);

  if (existing) { res.json(existing); return; }

  const referralCode = crypto.randomBytes(5).toString("hex").toUpperCase();
  const baseUrl = getPublicBaseUrl(req);

  const [ref] = await db
    .insert(aiReferralsTable)
    .values({
      referrerProfileId: profileId,
      referralCode,
      referralLink: `${baseUrl}?r=${referralCode}`,
      status: "pending",
      rewardType: "discount",
      rewardAmount: 50000,
      rewardStatus: "pending",
    })
    .returning();

  await logAudit("referral", "referral_generated", String(ref.id), "ai_referral", "success", { email: session.clientEmail });
  res.status(201).json(ref);
});

// ── GET /public/customer/workspace/:token/referral/stats ──────────────────────

router.get("/public/customer/workspace/:token/referral/stats", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db } = await import("@workspace/db");
  const { sql, eq, count } = await import("drizzle-orm");

  const rows = await db.execute(
    sql`SELECT id FROM ai_platform.customer_profiles WHERE client_email = ${session.clientEmail} LIMIT 1`,
  );
  const profileId = (rows as unknown as Array<{ id: number }>)[0]?.id;
  if (!profileId) { res.json({ totalReferrals: 0, pendingReferrals: 0, convertedReferrals: 0, totalRewardEarned: 0 }); return; }

  const { aiReferralsTable } = await import("@workspace/db");
  const allReferrals = await db.select().from(aiReferralsTable).where(eq(aiReferralsTable.referrerProfileId, profileId));

  const stats = {
    totalReferrals: allReferrals.length,
    pendingReferrals: allReferrals.filter((r) => r.status === "pending").length,
    convertedReferrals: allReferrals.filter((r) => r.status === "converted").length,
    totalRewardEarned: allReferrals
      .filter((r) => r.rewardStatus === "claimed")
      .reduce((sum, r) => sum + (r.rewardAmount ?? 0), 0),
  };

  res.json(stats);
});

// ── GET /public/customer/workspace/:token/referral/history ────────────────────

router.get("/public/customer/workspace/:token/referral/history", async (req, res): Promise<void> => {
  const session = await withSession(req, res);
  if (!session) return;

  const { db } = await import("@workspace/db");
  const { sql, eq } = await import("drizzle-orm");

  const rows = await db.execute(
    sql`SELECT id FROM ai_platform.customer_profiles WHERE client_email = ${session.clientEmail} LIMIT 1`,
  );
  const profileId = (rows as unknown as Array<{ id: number }>)[0]?.id;
  if (!profileId) { res.json([]); return; }

  const { aiReferralsTable } = await import("@workspace/db");
  const history = await db.select().from(aiReferralsTable).where(eq(aiReferralsTable.referrerProfileId, profileId));
  res.json(history);
});

export default router;
