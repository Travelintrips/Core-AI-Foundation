/**
 * Customer Portal public routes — no admin key required.
 * All routes are prefixed /public/customer/ which falls under the
 * PUBLIC_PATH_PREFIXES exception in adminAuth middleware.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
import {
  db,
  creativeProjectsTable,
  creativeAiClientReviewsTable,
  creativeAiAssetsTable,
  customerDashboardTokensTable,
  creativeProjectQuotationsTable,
  aiServiceRequestsTable,
  aiServicesTable,
} from "@workspace/db";
import {
  SubmitCustomerProjectBody,
  RequestCustomerAccessBody,
} from "@workspace/api-zod";
import { generateReviewToken, hashToken } from "../services/clientReviewService.js";
import { publishSafe } from "../services/aiEventBusService.js";
import { logAudit } from "../services/aiAuditService.js";
import { runCreativeBriefWorkflow } from "../services/creativeWorkflowRunner.js";
import { runImageDesignerPipeline } from "../services/imageDesignerService.js";


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
  // On Replit, REPLIT_DEV_DOMAIN gives the correct public domain
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    return `https://${process.env["REPLIT_DEV_DOMAIN"]}`;
  }
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

const DASHBOARD_TOKEN_EXPIRY_DAYS = 30;
const REVIEW_TOKEN_EXPIRY_DAYS = 60;

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

  const projectId = randomUUID();

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
      status: "pending",
    })
    .returning();

  if (!project) {
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

  // 5. Kick off AI generation in the background if requested.
  // Text workflow (brand strategist -> creative director -> copywriter -> QC) first,
  // then chain into image concept generation so the client's review page has visual
  // assets ready, not just copy.
  if (autoGenerate) {
    runCreativeBriefWorkflow(project.id)
      .then(() => runImageDesignerPipeline(project.id, projectId, 2))
      .catch(async (err) => {
        console.error(`[customer-portal] Workflow failed for project ${projectId}:`, err);
        await db
          .update(creativeProjectsTable)
          .set({ status: "failed" })
          .where(eq(creativeProjectsTable.id, project.id));
        await logAudit("customer-portal", "workflow_error", projectId, "creative_project", "failure", {
          error: String(err),
        });
      });
  }

  await logAudit("customer-portal", "project_submitted", projectId, "creative_project", "success", {
    clientName,
    clientEmail,
    brandName,
  });

  // 5. Kick off the 4-agent creative workflow in the background (unless the
  // client opted to submit the brief for manual handling only).
  if (autoGenerate ?? true) {
    runCreativeBriefWorkflow(project.id).catch(async (err) => {
      console.error(`[customer-portal] Workflow failed for project ${projectId}:`, err);
      await db
        .update(creativeProjectsTable)
        .set({ status: "failed" })
        .where(eq(creativeProjectsTable.id, project.id));
      await logAudit("customer-portal", "workflow_error", projectId, "creative_project", "failure", {
        error: String(err),
      });
    });
  }

  const base = buildBaseUrl(req);
  const reviewUrl = `${base}/review/${reviewToken}`;
  const dashboardUrl = `${base}/dashboard/${dashboardToken}`;

  res.status(201).json({
    projectId,
    reviewToken,
    reviewUrl,
    dashboardToken,
    dashboardUrl,
    status: "pending",
    brandName,
    clientName,
    createdAt: new Date().toISOString(),
  });
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
  const emailHash = hashEmail(email);

  // Find existing dashboard token for this email
  const [existing] = await db
    .select()
    .from(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.emailHash, emailHash));

  // Count projects for this email from client reviews (old flow)
  const reviews = await db
    .select({ id: creativeAiClientReviewsTable.id })
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.clientEmail, email.toLowerCase().trim()));

  // Count service requests for this email (new catalog flow)
  const serviceReqs = await db
    .select({ id: aiServiceRequestsTable.id, customerName: aiServiceRequestsTable.customerName })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.customerEmail, email.toLowerCase().trim()));

  const projectCount = reviews.length + serviceReqs.length;

  let dashboardToken: string;
  // Prefer name from service requests if available and not already set
  const nameFromServiceReq = serviceReqs[0]?.customerName;
  let clientName = existing?.clientName && existing.clientName !== "Customer"
    ? existing.clientName
    : (nameFromServiceReq ?? existing?.clientName ?? "Customer");

  if (existing && new Date() < existing.expiresAt) {
    // Reuse existing token — regenerate a new one pointing to same email
    // (We can't recover the plaintext, so we always issue a new token)
    const { plaintext, hash } = generateReviewToken();
    dashboardToken = plaintext;
    const dashboardExpiry = new Date(Date.now() + DASHBOARD_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await db
      .update(customerDashboardTokensTable)
      .set({ tokenHash: hash, expiresAt: dashboardExpiry })
      .where(eq(customerDashboardTokensTable.id, existing.id));
  } else if (existing) {
    // Expired — refresh
    const { plaintext, hash } = generateReviewToken();
    dashboardToken = plaintext;
    const dashboardExpiry = new Date(Date.now() + DASHBOARD_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await db
      .update(customerDashboardTokensTable)
      .set({ tokenHash: hash, expiresAt: dashboardExpiry })
      .where(eq(customerDashboardTokensTable.id, existing.id));
  } else {
    // No record — create new entry with unknown clientName
    const { plaintext, hash } = generateReviewToken();
    dashboardToken = plaintext;
    const dashboardExpiry = new Date(Date.now() + DASHBOARD_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await db.insert(customerDashboardTokensTable).values({
      emailHash,
      clientEmail: email.toLowerCase().trim(),
      clientName: "Customer",
      tokenHash: hash,
      expiresAt: dashboardExpiry,
    });
  }

  const base = buildBaseUrl(req);
  const dashboardUrl = `${base}/dashboard/${dashboardToken}`;

  res.json({
    dashboardToken,
    dashboardUrl,
    clientEmail: email.toLowerCase().trim(),
    projectCount,
    message: "Dashboard access granted. Save this link — it expires in 30 days.",
  });
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
      createdAt: aiServiceRequestsTable.createdAt,
      updatedAt: aiServiceRequestsTable.updatedAt,
      serviceName: aiServicesTable.serviceName,
    })
    .from(aiServiceRequestsTable)
    .leftJoin(aiServicesTable, eq(aiServiceRequestsTable.serviceId, aiServicesTable.id))
    .where(eq(aiServiceRequestsTable.customerEmail, session.clientEmail))
    .orderBy(aiServiceRequestsTable.createdAt);

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
    // Link to the right page based on status (no token needed for brief/pricing pages)
    portalPath: ((): string => {
      if (["draft", "brief_in_progress"].includes(r.status))
        return `/request-service/${r.requestId}/brief`;
      return `/request-service/${r.requestId}/pricing`;
    })(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  const pendingServiceRequests = serviceRequests.filter((r) =>
    ["waiting_customer_approval", "quotation_ready"].includes(r.status),
  ).length;

  res.json({
    clientName: session.clientName,
    clientEmail: session.clientEmail,
    projects: validProjects,
    serviceRequests,
    totalProjects: validProjects.length + serviceRequests.length,
    pendingReview: validProjects.filter((p) =>
      ["not_shared", "shared", "viewed"].includes(p.reviewStatus),
    ).length + pendingServiceRequests,
    approved: validProjects.filter((p) => p.reviewStatus === "approved").length,
  });
});

export default router;
