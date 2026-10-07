/**
 * Customer Portal public routes — no admin key required.
 * All routes are prefixed /public/customer/ which falls under the
 * PUBLIC_PATH_PREFIXES exception in adminAuth middleware.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
import { getPublicBaseUrl } from "../lib/publicBaseUrl";
import {
  db,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  creativeAiAssetsTable,
  customerDashboardTokensTable,
  creativeProjectQuotationsTable,
  aiServiceRequestsTable,
  aiServicesTable,
  aiQuotationsTable,
} from "@workspace/db";
import {
  SubmitCustomerProjectBody,
  RequestCustomerAccessBody,
} from "@workspace/api-zod";
import { fashionDesignOrdersTable } from "../domains/fashion-design/schema.js";
import { generateReviewToken, hashToken } from "../services/clientReviewService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { logAudit } from "../services/aiAuditService.js";
import {
  claimFingerprint,
  commitFingerprint,
  releaseFingerprint,
} from "../services/submitIdempotencyService.js";
// P0-1: runCreativeBriefWorkflow and runImageDesignerPipeline intentionally
// NOT imported here — autoGenerate is gated behind payment verification.
// AI production starts only via POST /ai/payments/:id/verify.


const router = Router();

// ── Rate limiter (shared with public.ts approach) ───────────────────────────
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

/** Generate a SHA-256 hash of a lower-cased email for private lookup */
function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

/** Build the base URL for constructing portal links from a request */
function buildBaseUrl(req: import("express").Request): string {
  return getPublicBaseUrl(req);
}

const DASHBOARD_TOKEN_EXPIRY_DAYS = 30;
const REVIEW_TOKEN_EXPIRY_DAYS = 60;

async function issueDashboardAccessForEmail(email: string, preferredName?: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const emailHash = hashEmail(normalizedEmail);

  const [existing] = await db
    .select()
    .from(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.emailHash, emailHash));

  const reviews = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.clientEmail, normalizedEmail));

  const serviceReqs = await db
    .select({ id: aiServiceRequestsTable.id, customerName: aiServiceRequestsTable.customerName })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.customerEmail, normalizedEmail));

  const projectCount = reviews.length + serviceReqs.length;
  const serviceName = serviceReqs[0]?.customerName;
  const clientName =
    preferredName?.trim() ||
    (existing?.clientName && existing.clientName !== "Customer" ? existing.clientName : undefined) ||
    serviceName ||
    existing?.clientName ||
    "Customer";

  const { plaintext: dashboardToken, hash: dashboardTokenHash } = generateReviewToken();
  const dashboardExpiry = new Date(
    Date.now() + DASHBOARD_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  if (existing) {
    await db
      .update(customerDashboardTokensTable)
      .set({
        clientEmail: normalizedEmail,
        clientName,
        tokenHash: dashboardTokenHash,
        expiresAt: dashboardExpiry,
      })
      .where(eq(customerDashboardTokensTable.id, existing.id));
  } else {
    await db.insert(customerDashboardTokensTable).values({
      emailHash,
      clientEmail: normalizedEmail,
      clientName,
      tokenHash: dashboardTokenHash,
      expiresAt: dashboardExpiry,
    });
  }

  return {
    dashboardToken,
    clientEmail: normalizedEmail,
    clientName,
    projectCount,
  };
}

// ── DEF-001: In-process deduplication map (60-second window) ─────────────────
// Protects against concurrent duplicate submissions with the same identity
// fingerprint (email + brandName + businessType). Concurrency-safe within a
// single Node.js event loop — no shared mutable state across awaits.
// Tenant-scoped: fingerprint includes clientEmail which is per-customer.

interface DedupEntry {
  projectId: string;
  responseData: Record<string, unknown>;
  expiresAt: number;
}

const _submitDedup = new Map<string, DedupEntry>();
const SUBMIT_DEDUP_TTL_MS = 60_000;

function _makeSubmitFingerprint(email: string, brand: string, bizType: string): string {
  return createHash("sha256")
    .update(`${email.toLowerCase().trim()}|${brand.toLowerCase().trim()}|${bizType.toLowerCase().trim()}`)
    .digest("hex");
}

function _cleanExpiredDedupEntries(): void {
  const now = Date.now();
  for (const [k, v] of _submitDedup) {
    if (v.expiresAt < now) _submitDedup.delete(k);
  }
}

// ── POST /api/public/customer/submit ─────────────────────────────────────────

router.post("/public/customer/submit", async (req, res): Promise<void> => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ??
    req.socket.remoteAddress ??
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests, please try again later" });
    return;
  }

  const parsed = SubmitCustomerProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const {
    clientName,
    clientEmail,
    clientPhone,
    brandName,
    businessType,
    productOrService,
    targetMarket,
    stylePreference,
    colorPreference,
    referenceLinks,
    goal,
    notes,
    deadline,
    autoGenerate,
  } = parsed.data;

  // DEF-001: L1 — in-process deduplication (fast guard within single process)
  _cleanExpiredDedupEntries();
  const fingerprint = _makeSubmitFingerprint(clientEmail ?? "", brandName, businessType);
  const existingDedup = _submitDedup.get(fingerprint);
  if (existingDedup && Object.keys(existingDedup.responseData).length > 0) {
    res.status(201).json(existingDedup.responseData);
    return;
  }

  // DEF-001: L2 — DB-backed idempotency (multi-instance / restart-safe)
  // Atomically claims the fingerprint; guarantees only one project is created
  // even across concurrent requests on multiple server instances.
  const dedupExpiry = new Date(Date.now() + SUBMIT_DEDUP_TTL_MS);
  const dbClaim = await claimFingerprint(fingerprint, dedupExpiry);
  if (!dbClaim.claimed) {
    if (dbClaim.responseData && Object.keys(dbClaim.responseData).length > 0) {
      // Another instance already created this project — return its canonical response
      res.status(201).json(dbClaim.responseData);
      return;
    }
    // First request is still in-flight on another instance
    res.status(409).json({
      error: "Duplicate submission in progress. Please retry in a few seconds.",
      code: "DUPLICATE_SUBMISSION_IN_FLIGHT",
    });
    return;
  }

  // Mark as in-flight in L1 cache synchronously so same-process concurrent
  // requests within the same event-loop tick also hit the dedup guard.
  const placeholderProjectId = randomUUID();
  _submitDedup.set(fingerprint, {
    projectId: placeholderProjectId,
    responseData: {},
    expiresAt: Date.now() + SUBMIT_DEDUP_TTL_MS,
  });

  const projectId = placeholderProjectId;

  // 1. Create the creative project
  const [project] = await db
    .insert(creativeProjectsTable)
    .values({
      projectId,
      brandName,
      businessType,
      productOrService,
      targetMarket,
      stylePreference: stylePreference ?? null,
      colorPreference: colorPreference ?? null,
      referenceLinks: referenceLinks ?? null,
      goal,
      notes: notes ?? null,
      deadline: deadline ?? null,
      // P0-1: project starts in waiting_payment — AI workflow fires only after
      // an admin verifies payment via POST /ai/payments/:scheduleId/verify.
      status: "waiting_payment",
    })
    .returning();

  if (!project) {
    // Release fingerprint claim so the customer can retry immediately
    await releaseFingerprint(fingerprint);
    res.status(500).json({ error: "Failed to create project" });
    return;
  }

  // 2. Generate review token (60-day expiry)
  const { plaintext: reviewToken, hash: reviewTokenHash } = generateReviewToken();
  const reviewTokenExpiry = new Date(Date.now() + REVIEW_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(creativeAiClientReviewsTable).values({
    projectId,
    clientName,
    clientEmail: clientEmail ?? null,
    clientPhone: clientPhone ?? null,
    reviewTokenHash,
    reviewTokenPlain: reviewToken, // stored so dashboard can surface review links
    tokenExpiresAt: reviewTokenExpiry,
    status: "shared",
    sharedAt: new Date(),
  });

  // 3. Create or refresh dashboard token for this email
  const { plaintext: dashboardToken, hash: dashboardTokenHash } = generateReviewToken();
  const dashboardExpiry = new Date(Date.now() + DASHBOARD_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const emailHash = hashEmail(clientEmail);

  // Delete any existing tokens for this email before inserting fresh one
  await db
    .delete(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.emailHash, emailHash));

  await db.insert(customerDashboardTokensTable).values({
    emailHash,
    clientEmail,
    clientName,
    tokenHash: dashboardTokenHash,
    expiresAt: dashboardExpiry,
  });

  // 4. Publish event
  await publishSafe({
    eventType: "customer.project.submitted",
    sourceModule: "customer-portal",
    sourceId: projectId,
    payload: {
      projectId,
      clientName,
      clientEmail,
      brandName,
      autoGenerate: autoGenerate ?? false,
    },
  });

  // 5. P0-1 PAYMENT GATE: autoGenerate is disabled — AI production must not start
  // before payment is verified. The project is created in "waiting_payment" status.
  // Production starts automatically when an admin calls POST /ai/payments/:id/verify.
  // Left as a commented reference so the intent is clear.
  //
  // if (autoGenerate) {
  //   runCreativeBriefWorkflow(project.id) ...
  // }

  await logAudit("customer-portal", "project_submitted", projectId, "creative_project", "success", {
    clientName,
    clientEmail,
    brandName,
  });

  // 5. P0-1: autoGenerate removed — AI cannot start without payment verification.
  // The autoGenerate parameter is intentionally ignored.
  // Production is triggered automatically by verifyPayment() once admin
  // marks the payment installment as paid.
  void autoGenerate; // acknowledge parameter without acting on it

  const base = buildBaseUrl(req);
  const reviewUrl = `${base}/review/${reviewToken}`;
  const dashboardUrl = `${base}/dashboard/${dashboardToken}`;

  const responseData: Record<string, unknown> = {
    projectId,
    reviewToken,
    reviewUrl,
    dashboardToken,
    dashboardUrl,
    status: "waiting_payment",
    brandName,
    clientName,
    createdAt: new Date().toISOString(),
  };

  // DEF-001: Commit real data to L1 (in-process) and L2 (DB) so any subsequent
  // duplicate — on this instance or another — gets the same canonical response.
  _submitDedup.set(fingerprint, {
    projectId,
    responseData,
    expiresAt: Date.now() + SUBMIT_DEDUP_TTL_MS,
  });
  await commitFingerprint(fingerprint, projectId, responseData);

  res.status(201).json(responseData);
});

// ── POST /api/public/customer/request-access ─────────────────────────────────

router.post("/public/customer/request-access", async (req, res): Promise<void> => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ??
    req.socket.remoteAddress ??
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests, please try again later" });
    return;
  }

  const parsed = RequestCustomerAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.issues });
    return;
  }

  const { email } = parsed.data;
  const access = await issueDashboardAccessForEmail(email);

  const base = buildBaseUrl(req);
  const dashboardUrl = `${base}/dashboard/${access.dashboardToken}`;

  res.json({
    dashboardToken: access.dashboardToken,
    dashboardUrl,
    clientEmail: access.clientEmail,
    projectCount: access.projectCount,
    message: "Dashboard access granted. Save this link — it expires in 30 days.",
  });
});

// ── GET /api/public/customer/quotation-access/:token ────────────────────────
// Token-protected handoff used by quotation emails. A valid quotation token is
// exchanged for a fresh dashboard token, then the browser lands on the user's
// dashboard with the target quotation highlighted. This keeps email entry
// inside the customer dashboard instead of bypassing it with a raw public page.
router.get("/public/customer/quotation-access/:token", async (req, res): Promise<void> => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0] ??
    req.socket.remoteAddress ??
    "unknown";

  if (!checkRateLimit(ip)) {
    res.status(429).json({ error: "Too many requests, please try again later" });
    return;
  }

  const token = String(req.params.token ?? "").trim();
  if (!token) {
    res.status(400).json({ error: "Quotation token is required" });
    return;
  }

  const tokenHash = hashToken(token);
  const [quotation] = await db
    .select({
      id: aiQuotationsTable.id,
      serviceRequestId: aiQuotationsTable.serviceRequestId,
      customerName: aiQuotationsTable.customerName,
      customerEmail: aiQuotationsTable.customerEmail,
      reviewTokenExpiresAt: aiQuotationsTable.reviewTokenExpiresAt,
      deletedAt: aiQuotationsTable.deletedAt,
    })
    .from(aiQuotationsTable)
    .where(eq(aiQuotationsTable.reviewTokenHash, tokenHash))
    .limit(1);

  if (!quotation || quotation.deletedAt) {
    res.status(404).json({ error: "Quotation link not found" });
    return;
  }

  if (quotation.reviewTokenExpiresAt && new Date() > quotation.reviewTokenExpiresAt) {
    res.status(401).json({ error: "Quotation link has expired" });
    return;
  }

  if (!quotation.serviceRequestId) {
    res.status(409).json({ error: "Quotation is not linked to a service request" });
    return;
  }

  const [serviceRequest] = await db
    .select({
      requestId: aiServiceRequestsTable.requestId,
      customerEmail: aiServiceRequestsTable.customerEmail,
      customerName: aiServiceRequestsTable.customerName,
    })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, quotation.serviceRequestId))
    .limit(1);

  if (!serviceRequest) {
    res.status(404).json({ error: "Service request not found" });
    return;
  }

  if (serviceRequest.customerEmail.toLowerCase().trim() !== quotation.customerEmail.toLowerCase().trim()) {
    res.status(409).json({ error: "Quotation customer does not match service request" });
    return;
  }

  const access = await issueDashboardAccessForEmail(
    quotation.customerEmail,
    quotation.customerName || serviceRequest.customerName,
  );
  const base = buildBaseUrl(req);
  const dashboardUrl =
    `${base}/dashboard/${access.dashboardToken}` +
    `?focusRequest=${encodeURIComponent(serviceRequest.requestId)}` +
    `&quotationToken=${encodeURIComponent(token)}`;

  res.setHeader("Cache-Control", "no-store");
  await logAudit(
    "customer-portal",
    "quotation_dashboard_handoff",
    String(quotation.id),
    "ai_quotation",
    "success",
    { requestId: serviceRequest.requestId, customerEmail: access.clientEmail },
  );

  res.redirect(302, dashboardUrl);
});

// ── GET /api/public/customer/dashboard/:dashboardToken ─────────────────────

router.get("/public/customer/dashboard/:dashboardToken", async (req, res): Promise<void> => {
  const { dashboardToken } = req.params as { dashboardToken: string };

  const tokenHash = hashToken(dashboardToken);

  const [session] = await db
    .select()
    .from(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.tokenHash, tokenHash));

  if (!session) {
    res.status(404).json({ error: "Dashboard link not found" });
    return;
  }

  if (new Date() > session.expiresAt) {
    res.status(401).json({ error: "Dashboard link has expired. Please request a new one." });
    return;
  }

  // Publish view event (fire-and-forget)
  publishSafe({
    eventType: "customer.project.viewed",
    sourceModule: "customer-portal",
    sourceId: session.clientEmail,
    payload: { clientEmail: session.clientEmail, clientName: session.clientName },
  });

  // Fetch all client review records for this email (old creative flow)
  const reviews = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.clientEmail, session.clientEmail))
    .orderBy(creativeAiClientReviewsTable.createdAt);

  // Fetch all service requests for this email (new catalog flow)
  const rawServiceRequests = await db
    .select({
      id: aiServiceRequestsTable.id,
      requestId: aiServiceRequestsTable.requestId,
      serviceId: aiServiceRequestsTable.serviceId,
      customerName: aiServiceRequestsTable.customerName,
      currency: aiServiceRequestsTable.currency,
      total: aiServiceRequestsTable.total,
      status: aiServiceRequestsTable.status,
      completionNotes: aiServiceRequestsTable.completionNotes,
      completionLinks: aiServiceRequestsTable.completionLinks,
      createdAt: aiServiceRequestsTable.createdAt,
      updatedAt: aiServiceRequestsTable.updatedAt,
      serviceName: aiServicesTable.serviceName,
    })
    .from(aiServiceRequestsTable)
    .leftJoin(aiServicesTable, eq(aiServiceRequestsTable.serviceId, aiServicesTable.id))
    .where(eq(aiServiceRequestsTable.customerEmail, session.clientEmail))
    .orderBy(aiServiceRequestsTable.createdAt);

  // Fashion orders share the same customer identity and belong in the same
  // dashboard so customers do not need to remember an order number manually.
  const rawFashionOrders = await db
    .select({
      id: fashionDesignOrdersTable.id,
      orderName: fashionDesignOrdersTable.orderName,
      serviceType: fashionDesignOrdersTable.serviceType,
      status: fashionDesignOrdersTable.status,
      outputs: fashionDesignOrdersTable.outputs,
      colorways: fashionDesignOrdersTable.colorways,
      createdAt: fashionDesignOrdersTable.createdAt,
      updatedAt: fashionDesignOrdersTable.updatedAt,
    })
    .from(fashionDesignOrdersTable)
    .where(eq(fashionDesignOrdersTable.customerEmail, session.clientEmail))
    .orderBy(fashionDesignOrdersTable.createdAt);

  // For each review, fetch the associated project and asset count
  const projects = await Promise.all(
    reviews.map(async (review) => {
      const [project] = await db
        .select()
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.projectId, review.projectId));

      if (!project) return null;

      const assets = await db
        .select({ id: creativeAiAssetsTable.id })
        .from(creativeAiAssetsTable)
        .where(eq(creativeAiAssetsTable.projectId, review.projectId));

      // Find the review token (we have hash, but not plaintext — reviewToken in results
      // is the token hash display value; we store the hash and direct the user via
      // the review link stored at submission time. For dashboard display, we just
      // know the token is valid and encode the reviewUrl from the token hash — but
      // we can't recover plaintext. Instead we expose reviewId so the portal can
      // show status without needing the token.)
      // NOTE: reviewToken in CustomerDashboardProject is used by the frontend to
      // navigate. Since we can't recover plaintext from hash, we pass reviewId instead
      // and include a pre-built reviewUrl constructed from what we have.
      // The dashboard just shows status; navigation uses the bookmarked review link.
      const [quotation] = await db
        .select()
        .from(creativeProjectQuotationsTable)
        .where(eq(creativeProjectQuotationsTable.projectId, review.projectId));

      const plainToken = review.reviewTokenPlain ?? "";
      const base = buildBaseUrl(req);
      return {
        projectId: project.projectId,
        brandName: project.brandName,
        businessType: project.businessType,
        productOrService: project.productOrService,
        goal: project.goal,
        status: project.status,
        reviewStatus: review.status,
        reviewToken: plainToken,
        reviewUrl: plainToken ? `${base}/review/${plainToken}` : "",
        deadline: project.deadline ?? null,
        hasResult: !!project.result,
        assetCount: assets.length,
        quotationStatus: quotation && quotation.status !== "draft" ? quotation.status : null,
        quotationTotal: quotation && quotation.status !== "draft" ? quotation.total : null,
        quotationCurrency: quotation?.currency ?? null,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    }),
  );

  const validProjects = projects.filter(Boolean) as NonNullable<(typeof projects)[number]>[];

  // Map service requests to a dashboard-friendly shape
  const serviceRequests = rawServiceRequests.map((r) => ({
    requestId: r.requestId,
    serviceName: r.serviceName ?? "Layanan",
    currency: r.currency,
    total: r.total,
    status: r.status,
    // Derive a customer-friendly label for the status
    statusLabel: ((): string => {
      const map: Record<string, string> = {
        draft: "Baru",
        brief_in_progress: "Brief Sedang Diisi",
        brief_completed: "Brief Selesai",
        quoted: "Harga Dikalkulasi",
        quotation_ready: "Penawaran Dikirim",
        waiting_customer_approval: "Menunggu Persetujuan Anda",
        approved: "Disetujui",
        waiting_commercial_gate: "Verifikasi Komersial",
        ready_to_build: "Siap Produksi",
        in_progress: "Sedang Diproduksi",
        orchestrating: "Sedang Diproduksi",
        waiting_review: "Menunggu Review",
        completed: "Selesai",
        converted_to_project: "Selesai",
        cancelled: "Dibatalkan",
        revision_requested: "Revisi Diminta",
      };
      return map[r.status] ?? r.status;
    })(),
    completionNotes: r.completionNotes ?? null,
    completionLinks: (r.completionLinks as Array<{ label: string; url: string }> | null) ?? null,
    // Link to the right page based on status (no token needed for brief/pricing pages)
    portalPath: ((): string => {
      if (["draft", "brief_in_progress"].includes(r.status))
        return `/request-service/${r.requestId}/brief`;
      if (["completed", "converted_to_project"].includes(r.status))
        return `/request-service/${r.requestId}/results`;
      return `/request-service/${r.requestId}/pricing`;
    })(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const pendingServiceRequests = serviceRequests.filter((r) =>
    ["waiting_customer_approval", "quotation_ready"].includes(r.status),
  ).length;

  const fashionOrders = rawFashionOrders.map((order) => ({
    id: order.id,
    orderName: order.orderName,
    serviceType: order.serviceType,
    status: order.status,
    statusLabel: ((): string => {
      const map: Record<string, string> = {
        draft: "Draft",
        blueprint_ready: "Blueprint Siap",
        generating: "AI Generating",
        review: "Siap Direview",
        revision_requested: "Revisi Diminta",
        revision_in_progress: "Designer Bekerja",
        approved: "Disetujui",
        delivered: "Terkirim",
        trademark_flagged: "Perlu Review Trademark",
        cancelled: "Dibatalkan",
      };
      return map[order.status] ?? order.status;
    })(),
    outputs: order.outputs ?? null,
    colorways: order.colorways ?? [],
    portalPath: "/fashion-design",
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  }));

  const pendingFashionOrders = fashionOrders.filter((order) =>
    ["review", "revision_requested", "revision_in_progress"].includes(order.status),
  ).length;

  res.json({
    clientName: session.clientName,
    clientEmail: session.clientEmail,
    projects: validProjects,
    serviceRequests,
    fashionOrders,
    totalProjects: validProjects.length + serviceRequests.length + fashionOrders.length,
    pendingReview: validProjects.filter((p) =>
      ["not_shared", "shared", "viewed"].includes(p.reviewStatus),
    ).length + pendingServiceRequests + pendingFashionOrders,
    approved:
      validProjects.filter((p) => p.reviewStatus === "approved").length +
      fashionOrders.filter((order) => ["approved", "delivered"].includes(order.status)).length,
  });
});

// ── Test-only cache resets ────────────────────────────────────────────────────
// These functions are exported ONLY for test isolation — never call them from
// production code. They clear module-level caches so each test case starts
// from a clean state without resetting DB-backed idempotency guarantees.

/** @internal Test-only: clears the in-process dedup Map (L1 cache) between tests. */
export function _testClearSubmitDedupCache(): void {
  _submitDedup.clear();
}

/** @internal Test-only: clears the rate-limit map between tests. */
export function _testClearRateLimitMap(): void {
  rateLimitMap.clear();
}

export default router;
