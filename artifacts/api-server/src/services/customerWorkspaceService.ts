/**
 * customerWorkspaceService.ts — Customer Workspace aggregation layer.
 *
 * Purely additive, read-mostly service that composes data already owned by
 * other modules (creative projects, service catalog, quotations, payments,
 * invoices, assets, audit log) into the shapes the Customer Workspace UI
 * needs. It does NOT modify any existing table's write paths and does not
 * touch AI Workforce / Queue / Dispatcher / Event Bus / Scheduler / Workflow
 * Runner / Creative AI / Pricing Engine / Marketplace / Human Task / Client
 * Review / Security P0 — it only reads their data and reuses the existing
 * signedUrlService (Sprint P0) for downloads.
 *
 * Customer identity continues to be the existing dashboardToken model
 * (customer_dashboard_tokens); there is no new auth mechanism here.
 */
import { createHash } from "crypto";
import type { Request } from "express";
import { eq, and, inArray, desc } from "drizzle-orm";
import {
  db,
  customerDashboardTokensTable,
  creativeProjectsTable,
  creativeProjectStepsTable,
  creativeAiClientReviewsTable,
  creativeAiAssetsTable,
  creativeProjectQuotationsTable,
  aiServiceRequestsTable,
  aiServicesTable,
  aiServicePackagesTable,
  aiPaymentScheduleTable,
  aiInvoicesTable,
  aiAuditLogsTable,
  customerProfilesTable,
  customerNotificationReadsTable,
  customerSupportTicketsTable,
  type CreativeProject,
  type AiServiceRequest,
} from "@workspace/db";
import { hashToken } from "./clientReviewService.js";
import { generateDownloadToken } from "./signedUrlService.js";
import { getPublicBaseUrl } from "../lib/publicBaseUrl.js";
import { buildProjectRuntimeSnapshot, type ProjectRuntimeSnapshot } from "./runtimeRosterService.js";
import {
  getEventsWithSummariesForProject,
  getEventsForProjects,
  filterForActivityFeed,
  type CanonicalEvent,
} from "./canonicalEventService.js";
import type { ExecutionSummary, EventWithSummary } from "./executionSummaryService.js";

// ── Shared helpers ────────────────────────────────────────────────────────────

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

export interface WorkspaceSession {
  emailHash: string;
  clientEmail: string;
  clientName: string;
}

export type SessionResult =
  | { ok: true; session: WorkspaceSession }
  | { ok: false; status: 404 | 401; error: string };

/** Resolve a dashboardToken (plaintext, from the URL) into a workspace session. */
export async function resolveWorkspaceSession(dashboardToken: string): Promise<SessionResult> {
  const tokenHash = hashToken(dashboardToken);
  const [row] = await db
    .select()
    .from(customerDashboardTokensTable)
    .where(eq(customerDashboardTokensTable.tokenHash, tokenHash));

  if (!row) return { ok: false, status: 404, error: "Workspace link not found" };
  if (new Date() > row.expiresAt) {
    return { ok: false, status: 401, error: "Workspace link has expired. Please request a new one." };
  }
  return {
    ok: true,
    session: { emailHash: row.emailHash, clientEmail: row.clientEmail, clientName: row.clientName },
  };
}

// ── Status / stage labels (customer-facing, Indonesian — matches existing dashboard) ──

const STAGE_ORDER = [
  "package_selected",
  "brief_completed",
  "waiting_payment",
  "payment_verified",
  "ai_strategy",
  "creative_direction",
  "production",
  "internal_qc",
  "client_review",
  "revision",
  "completed",
] as const;

/** Maps raw project/service-request status values to a position on the Project Timeline. */
function stageForStatus(status: string, sourceType: "direct" | "service_catalog"): (typeof STAGE_ORDER)[number] {
  const map: Record<string, (typeof STAGE_ORDER)[number]> = {
    draft: "package_selected",
    brief_in_progress: "package_selected",
    brief_completed: "brief_completed",
    quoted: "brief_completed",
    quotation_ready: "brief_completed",
    waiting_customer_approval: "brief_completed",
    approved: "waiting_payment",
    waiting_commercial_gate: "waiting_payment",
    ready_to_build: "payment_verified",
    pending: "waiting_payment",
    waiting_payment: "waiting_payment",
    deposit_paid: "payment_verified",
    waiting_payment_verification: "waiting_payment",
    payment_verified: "payment_verified",
    waiting_remaining_payment: "payment_verified",
    remaining_paid: "payment_verified",
    orchestrating: "ai_strategy",
    in_progress: "production",
    building: "production",
    running: "production",
    internal_review: "internal_qc",
    waiting_review: "client_review",
    waiting_client_review: "client_review",
    revision_requested: "revision",
    revision: "revision",
    completed: "completed",
    converted_to_project: "completed",
    cancelled: "completed",
    failed: "completed",
  };
  return map[status] ?? (sourceType === "service_catalog" ? "package_selected" : "waiting_payment");
}

function progressPercentForStage(stage: (typeof STAGE_ORDER)[number]): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return Math.round(((idx + 1) / STAGE_ORDER.length) * 100);
}

const SERVICE_REQUEST_STATUS_LABELS: Record<string, string> = {
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

const PROJECT_STATUS_LABELS: Record<string, string> = {
  pending: "Menunggu",
  waiting_payment: "Menunggu Pembayaran",
  deposit_paid: "DP Diterima",
  waiting_payment_verification: "Verifikasi Pembayaran",
  payment_verified: "Pembayaran Terverifikasi",
  waiting_remaining_payment: "Menunggu Pelunasan",
  remaining_paid: "Lunas",
  ready_to_build: "Siap Produksi",
  building: "Sedang Diproduksi",
  running: "Sedang Diproduksi",
  internal_review: "QC Internal",
  waiting_client_review: "Menunggu Review Anda",
  revision: "Revisi",
  approved: "Disetujui",
  completed: "Selesai",
  failed: "Gagal",
};

function labelForProject(status: string): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}
function labelForServiceRequest(status: string): string {
  return SERVICE_REQUEST_STATUS_LABELS[status] ?? status;
}

// ── Normalized project shape used by the workspace UI ────────────────────────

export interface WorkspaceProject {
  projectNumber: string; // creativeProjects.projectId or aiServiceRequests.requestId
  kind: "creative_project" | "service_request";
  brandName: string;
  serviceName: string;
  packageName: string | null;
  businessType: string | null;
  currentStage: string;
  currentStageLabel: string;
  progressPercent: number;
  assignedAiTeam: string[];
  deliveryDate: string | null;
  paymentStatus: string | null;
  filesUnlocked: boolean;
  reviewStatus: string | null;
  reviewToken: string | null;
  reviewUrl: string | null;
  portalPath: string | null;
  quotationStatus: string | null;
  quotationTotal: number | null;
  quotationCurrency: string | null;
  currency: string;
  total: number | null;
  createdAt: string;
  updatedAt: string;
  internalProjectId: number | null; // creativeProjectsTable.id, when one exists
}

async function projectFromCreativeProject(
  req: Request,
  project: CreativeProject,
  opts: { reviewToken?: string | null; serviceName?: string; packageName?: string | null; aiTeam?: string[] },
): Promise<WorkspaceProject> {
  const base = buildBaseUrl(req);
  const stage = stageForStatus(project.status, project.sourceType === "service_catalog" ? "service_catalog" : "direct");
  const [quotation] = project.sourceType === "direct"
    ? await db.select().from(creativeProjectQuotationsTable).where(eq(creativeProjectQuotationsTable.projectId, project.projectId))
    : [];
  return {
    projectNumber: project.projectId,
    kind: "creative_project",
    brandName: project.brandName,
    serviceName: opts.serviceName ?? "Custom Creative Project",
    packageName: opts.packageName ?? null,
    businessType: project.businessType,
    currentStage: project.status,
    currentStageLabel: labelForProject(project.status),
    progressPercent: progressPercentForStage(stage),
    assignedAiTeam: opts.aiTeam ?? ["AI Creative Team"],
    deliveryDate: project.deadline ?? null,
    paymentStatus: project.paymentStatus,
    filesUnlocked: project.filesUnlocked,
    reviewStatus: null,
    reviewToken: opts.reviewToken ?? null,
    reviewUrl: opts.reviewToken ? `${base}/review/${opts.reviewToken}` : null,
    portalPath: opts.reviewToken ? `/review/${opts.reviewToken}` : `/workspace/${""}/projects/${project.projectId}`,
    quotationStatus: quotation && quotation.status !== "draft" ? quotation.status : null,
    quotationTotal: quotation && quotation.status !== "draft" ? Number(quotation.total) : null,
    quotationCurrency: quotation?.currency ?? null,
    currency: quotation?.currency ?? "IDR",
    total: quotation ? Number(quotation.total) : null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    internalProjectId: project.id,
  };
}

function buildBaseUrl(req: Request): string {
  return getPublicBaseUrl(req);
}

/** All normalized projects owned by a customer email (legacy + service-catalog flows). */
export async function listAllWorkspaceProjects(
  req: Request,
  clientEmail: string,
): Promise<WorkspaceProject[]> {
  const email = clientEmail.toLowerCase().trim();
  const results: WorkspaceProject[] = [];

  // 1. Legacy/direct flow: creative_ai_client_reviews -> creative_projects
  const reviews = await db
    .select()
    .from(creativeAiClientReviewsTable)
    .where(eq(creativeAiClientReviewsTable.clientEmail, email));

  for (const review of reviews) {
    const [project] = await db
      .select()
      .from(creativeProjectsTable)
      .where(eq(creativeProjectsTable.projectId, review.projectId));
    if (!project || project.sourceType === "service_catalog") continue; // avoid double counting
    const item = await projectFromCreativeProject(req, project, { reviewToken: review.reviewTokenPlain });
    item.reviewStatus = review.status;
    results.push(item);
  }

  // 2. Service-catalog flow: ai_service_requests (+ created project, when handed off)
  const serviceReqs = await db
    .select()
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.customerEmail, email));

  for (const sr of serviceReqs) {
    const [service] = await db.select().from(aiServicesTable).where(eq(aiServicesTable.id, sr.serviceId));
    const pkg = sr.packageId
      ? (await db.select().from(aiServicePackagesTable).where(eq(aiServicePackagesTable.id, sr.packageId)))[0]
      : undefined;

    if (sr.createdProjectId) {
      const [project] = await db
        .select()
        .from(creativeProjectsTable)
        .where(eq(creativeProjectsTable.projectId, sr.createdProjectId));
      if (project) {
        const [review] = await db
          .select()
          .from(creativeAiClientReviewsTable)
          .where(eq(creativeAiClientReviewsTable.projectId, project.projectId));
        const item = await projectFromCreativeProject(req, project, {
          reviewToken: review?.reviewTokenPlain ?? null,
          serviceName: service?.serviceName ?? "Layanan",
          packageName: pkg?.packageName ?? null,
          aiTeam: service?.aiEmployeesInvolved?.length ? service.aiEmployeesInvolved : undefined,
        });
        item.reviewStatus = review?.status ?? null;
        results.push(item);
        continue;
      }
    }

    // No project yet — surface the service request itself as a pre-project item
    const stage = stageForStatus(sr.status, "service_catalog");
    results.push({
      projectNumber: sr.requestId,
      kind: "service_request",
      brandName: sr.companyName ?? sr.customerName,
      serviceName: service?.serviceName ?? "Layanan",
      packageName: pkg?.packageName ?? null,
      businessType: null,
      currentStage: sr.status,
      currentStageLabel: labelForServiceRequest(sr.status),
      progressPercent: progressPercentForStage(stage),
      assignedAiTeam: service?.aiEmployeesInvolved?.length ? service.aiEmployeesInvolved : ["AI Creative Team"],
      deliveryDate: null,
      paymentStatus: null,
      reviewStatus: null,
      reviewToken: null,
      reviewUrl: null,
      filesUnlocked: false,
      portalPath: portalPathForServiceRequest(sr),
      quotationStatus: null,
      quotationTotal: null,
      quotationCurrency: null,
      currency: sr.currency,
      total: Number(sr.total),
      createdAt: sr.createdAt.toISOString(),
      updatedAt: sr.updatedAt.toISOString(),
      internalProjectId: null,
    });
  }

  return results.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function portalPathForServiceRequest(sr: AiServiceRequest): string {
  if (["draft", "brief_in_progress"].includes(sr.status)) return `/request-service/${sr.requestId}/brief`;
  if (["completed", "converted_to_project"].includes(sr.status)) return `/request-service/${sr.requestId}/results`;
  return `/request-service/${sr.requestId}/pricing`;
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface WorkspaceSummary {
  clientName: string;
  clientEmail: string;
  activeProjects: number;
  waitingReview: number;
  completedProjects: number;
  outstandingBalance: number;
  outstandingCurrency: string;
  invoiceCount: number;
  downloadCount: number;
  brandAssetCount: number;
  aiCredits: number; // future-ready placeholder
}

export async function getWorkspaceSummary(
  req: Request,
  session: WorkspaceSession,
): Promise<WorkspaceSummary> {
  const projects = await listAllWorkspaceProjects(req, session.clientEmail);
  const activeProjects = projects.filter((p) => !["completed", "cancelled"].includes(p.currentStage)).length;
  const waitingReview = projects.filter((p) => p.currentStage === "waiting_client_review" || p.reviewStatus === "shared" || p.reviewStatus === "viewed").length;
  const completedProjects = projects.filter((p) => p.currentStage === "completed" || p.currentStage === "converted_to_project").length;

  const internalIds = projects.map((p) => p.internalProjectId).filter((v): v is number => v !== null);
  let outstandingBalance = 0;
  let outstandingCurrency = "IDR";
  let invoiceCount = 0;
  if (internalIds.length > 0) {
    const schedules = await db.select().from(aiPaymentScheduleTable).where(inArray(aiPaymentScheduleTable.projectId, internalIds));
    for (const s of schedules) {
      if (s.status !== "paid" && s.status !== "cancelled" && s.status !== "refunded") {
        outstandingBalance += Number(s.amount);
        outstandingCurrency = s.currency;
      }
    }
    const invoices = await db.select({ id: aiInvoicesTable.id }).from(aiInvoicesTable).where(inArray(aiInvoicesTable.projectId, internalIds));
    invoiceCount = invoices.length;
  }

  const assets = internalIds.length > 0
    ? await db.select({ id: creativeAiAssetsTable.id }).from(creativeAiAssetsTable).where(inArray(creativeAiAssetsTable.projectId, projects.map((p) => p.projectNumber)))
    : [];

  return {
    clientName: session.clientName,
    clientEmail: session.clientEmail,
    activeProjects,
    waitingReview,
    completedProjects,
    outstandingBalance,
    outstandingCurrency,
    invoiceCount,
    downloadCount: assets.length,
    brandAssetCount: assets.length,
    aiCredits: 0,
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface ProjectListFilters {
  search?: string;
  status?: string;
  service?: string;
  industry?: string;
  sort?: "newest" | "oldest" | "delivery_date";
}

export async function listWorkspaceProjectsFiltered(
  req: Request,
  clientEmail: string,
  filters: ProjectListFilters,
): Promise<WorkspaceProject[]> {
  let items = await listAllWorkspaceProjects(req, clientEmail);

  if (filters.search) {
    const q = filters.search.toLowerCase();
    items = items.filter(
      (p) =>
        p.brandName.toLowerCase().includes(q) ||
        p.serviceName.toLowerCase().includes(q) ||
        p.projectNumber.toLowerCase().includes(q),
    );
  }
  if (filters.status) items = items.filter((p) => p.currentStage === filters.status);
  if (filters.service) items = items.filter((p) => p.serviceName.toLowerCase() === filters.service?.toLowerCase());
  if (filters.industry) items = items.filter((p) => (p.businessType ?? "").toLowerCase() === filters.industry?.toLowerCase());

  if (filters.sort === "oldest") items = [...items].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
  else if (filters.sort === "delivery_date") {
    items = [...items].sort((a, b) => (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999"));
  } // "newest" is already the default sort order

  return items;
}

// ── Project detail ───────────────────────────────────────────────────────────

export interface ProjectDetail {
  overview: WorkspaceProject & { targetMarket: string | null; productOrService: string | null; goal: string | null; stylePreference: string | null; colorPreference: string | null };
  timeline: { stage: string; label: string; completed: boolean; current: boolean }[];
  deliverables: WorkspaceDownloadItem[];
  reviews: { status: string; sharedAt: string | null; createdAt: string }[];
  payments: { id: number; paymentType: string; amount: string; currency: string; status: string; dueDate: string | null; paidAt: string | null }[];
  invoices: WorkspaceInvoice[];
  /** V4.0B — additive, optional-shaped runtime roster snapshot. Never breaks old clients that ignore it. */
  runtime: ProjectRuntimeSnapshot;
  /** V4.0C — canonical event stream for this project. Sorted chronologically. */
  events: CanonicalEvent[];
  /**
   * V4.1 — deterministic, customer-safe summaries paired 1:1 with `events`
   * (same length, same order, same indices). Additive only — clients that
   * only read `events` are unaffected.
   */
  eventSummaries: ExecutionSummary[];
}

export async function getProjectDetail(
  req: Request,
  clientEmail: string,
  projectNumber: string,
): Promise<ProjectDetail | null> {
  const projects = await listAllWorkspaceProjects(req, clientEmail);
  const found = projects.find((p) => p.projectNumber === projectNumber);
  if (!found) return null;

  let project: CreativeProject | undefined;
  if (found.internalProjectId) {
    [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, found.internalProjectId));
  }

  const stage = project ? stageForStatus(project.status, project.sourceType === "service_catalog" ? "service_catalog" : "direct") : "package_selected";
  const stageIdx = STAGE_ORDER.indexOf(stage);
  const timeline = STAGE_ORDER.map((s, i) => ({
    stage: s,
    label: STAGE_LABELS[s],
    completed: i < stageIdx,
    current: i === stageIdx,
  }));

  const deliverables = found.internalProjectId ? await listDownloadsForProjects(req, [found]) : [];

  const reviews = project
    ? (
        await db
          .select()
          .from(creativeAiClientReviewsTable)
          .where(eq(creativeAiClientReviewsTable.projectId, project.projectId))
      ).map((r) => ({ status: r.status, sharedAt: r.sharedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() }))
    : [];

  const payments = found.internalProjectId
    ? (
        await db
          .select()
          .from(aiPaymentScheduleTable)
          .where(eq(aiPaymentScheduleTable.projectId, found.internalProjectId))
          .orderBy(aiPaymentScheduleTable.displayOrder)
      ).map((p) => ({
        id: p.id,
        paymentType: p.paymentType,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        dueDate: p.dueDate?.toISOString() ?? null,
        paidAt: p.paidAt?.toISOString() ?? null,
      }))
    : [];

  const invoices = found.internalProjectId ? await listInvoicesForProjects([found]) : [];

  const [runtime, eventPairs] = await Promise.all([
    buildProjectRuntimeSnapshot(found.internalProjectId),
    found.internalProjectId
      ? getEventsWithSummariesForProject(found.projectNumber, found.internalProjectId, {
          filesUnlocked: found.filesUnlocked,
        })
      : Promise.resolve([] as EventWithSummary[]),
  ]);
  const events = eventPairs.map((p) => p.event);
  const eventSummaries = eventPairs.map((p) => p.summary);

  return {
    overview: {
      ...found,
      targetMarket: project?.targetMarket ?? null,
      productOrService: project?.productOrService ?? null,
      goal: project?.goal ?? null,
      stylePreference: project?.stylePreference ?? null,
      colorPreference: project?.colorPreference ?? null,
    },
    timeline,
    deliverables,
    reviews,
    payments,
    invoices,
    runtime,
    events,
    eventSummaries,
  };
}

const STAGE_LABELS: Record<(typeof STAGE_ORDER)[number], string> = {
  package_selected: "Package Selected",
  brief_completed: "Brief Completed",
  waiting_payment: "Payment Verified",
  payment_verified: "Payment Verified",
  ai_strategy: "AI Strategy",
  creative_direction: "Creative Direction",
  production: "Production",
  internal_qc: "Internal QC",
  client_review: "Client Review",
  revision: "Revision",
  completed: "Completed",
};

// ── Downloads / Brand Asset Library ──────────────────────────────────────────

export interface WorkspaceDownloadItem {
  id: number;
  title: string;
  category: string;
  projectNumber: string;
  projectName: string;
  version: number;
  status: string;
  approvedBy: string | null;
  revisionNotes: string | null;
  locked: boolean;
  createdAt: string;
  /** Present for document assets (PDF). */
  pageCount?: number | null;
  /** File size in bytes — present for document assets. */
  fileSizeBytes?: number | null;
  /** Structured document type, e.g. "brand_strategy". */
  documentType?: string | null;
  /** MIME type of the asset. */
  mimeType?: string | null;
  /** Present for presentation assets (PPTX) — number of slides. */
  slideCount?: number | null;
}

function formatDocumentTitle(documentType: string): string {
  const labels: Record<string, string> = {
    company_profile:          "Company Profile PDF",
    brand_strategy:           "Brand Strategy PDF",
    copywriting:              "Copywriting PDF",
    creative_consultation:    "Creative Consultation PDF",
    brand_identity_guideline: "Brand Identity Guideline PDF",
  };
  return labels[documentType] ?? documentType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function formatPresentationTitle(presentationType: string): string {
  const labels: Record<string, string> = {
    pitch_deck: "Pitch Deck (PPTX)",
  };
  return labels[presentationType] ?? presentationType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function guessCategory(assetType: string, category: string | null): string {
  if (category) return category;
  if (assetType === "image") return "images";
  return "source_files";
}

async function listDownloadsForProjects(
  _req: Request,
  projects: WorkspaceProject[],
): Promise<WorkspaceDownloadItem[]> {
  if (projects.length === 0) return [];
  const projectNumbers = projects.map((p) => p.projectNumber);
  const assets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(inArray(creativeAiAssetsTable.projectId, projectNumbers))
    .orderBy(desc(creativeAiAssetsTable.createdAt));

  const byId = new Map(projects.map((p) => [p.projectNumber, p]));
  return assets.map((a) => {
    const proj = byId.get(a.projectId);
    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const isDoc = a.assetType === "document";
    const isPresentation = a.assetType === "presentation";
    const docType = isDoc ? (a.category ?? null) : null;
    const presentationType = isPresentation ? (a.category ?? null) : null;
    const title = isDoc
      ? `${proj?.brandName ?? "Asset"} — ${formatDocumentTitle(docType ?? "document")} v${a.version}`
      : isPresentation
        ? `${proj?.brandName ?? "Asset"} — ${formatPresentationTitle(presentationType ?? "presentation")} v${a.version}`
        : `${proj?.brandName ?? "Asset"} — ${a.assetType} #${a.id}`;
    return {
      id: a.id,
      title,
      category: guessCategory(a.assetType, a.category),
      projectNumber: a.projectId,
      projectName: proj?.brandName ?? a.projectId,
      version: a.version,
      status: a.status,
      approvedBy: a.approvedBy,
      revisionNotes: a.revisionNotes,
      locked: !(proj?.filesUnlocked ?? false),
      createdAt: a.createdAt.toISOString(),
      pageCount:    isDoc ? (typeof meta["pageCount"]    === "number" ? meta["pageCount"]    : null) : null,
      fileSizeBytes: (isDoc || isPresentation) ? (typeof meta["fileSizeBytes"] === "number" ? meta["fileSizeBytes"] : null) : null,
      documentType: docType ?? presentationType,
      mimeType:     isDoc ? (typeof meta["mimeType"] === "string" ? meta["mimeType"] : "application/pdf")
                  : isPresentation ? (typeof meta["mimeType"] === "string" ? meta["mimeType"] : PPTX_MIME_TYPE)
                  : null,
      slideCount:   isPresentation ? (typeof meta["slideCount"] === "number" ? meta["slideCount"] : null) : null,
    };
  });
}

export interface DownloadFilters {
  category?: string;
  projectNumber?: string;
  search?: string;
}

export async function listWorkspaceDownloads(
  req: Request,
  clientEmail: string,
  filters: DownloadFilters,
): Promise<WorkspaceDownloadItem[]> {
  const projects = await listAllWorkspaceProjects(req, clientEmail);
  let items = await listDownloadsForProjects(req, projects);

  // Also surface invoices/receipts as downloadable documents
  const invoiceDocs = (await listInvoicesForProjects(projects)).map((inv) => ({
    id: -inv.id, // negative id namespace to avoid clashing with asset ids
    title: `${inv.invoiceType === "receipt" ? "Receipt" : "Invoice"} ${inv.invoiceNumber}`,
    category: inv.invoiceType === "receipt" ? "receipt" : "invoice",
    projectNumber: inv.projectNumber,
    projectName: inv.projectNumber,
    version: 1,
    status: inv.status,
    approvedBy: null,
    revisionNotes: null,
    locked: false,
    createdAt: inv.issuedAt,
  }));
  items = [...items, ...invoiceDocs];

  if (filters.category) items = items.filter((i) => i.category === filters.category);
  if (filters.projectNumber) items = items.filter((i) => i.projectNumber === filters.projectNumber);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    items = items.filter((i) => i.title.toLowerCase().includes(q));
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export type SignResult =
  | { ok: true; token: string; expiresAt: string; accessPath: string }
  | { ok: false; status: 402 | 404; error: string };

export async function signWorkspaceDownload(
  clientEmail: string,
  assetId: number,
  ttlSeconds = 3600,
): Promise<SignResult> {
  const [asset] = await db.select().from(creativeAiAssetsTable).where(eq(creativeAiAssetsTable.id, assetId));
  if (!asset) return { ok: false, status: 404, error: "File not found" };

  const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.projectId, asset.projectId));
  if (!project) return { ok: false, status: 404, error: "File not found" };

  // Ownership check: the project must belong to this customer (via review or service request)
  const owns = await customerOwnsProject(clientEmail, project.projectId);
  if (!owns) return { ok: false, status: 404, error: "File not found" };

  if (!project.filesUnlocked) {
    return { ok: false, status: 402, error: "Files are locked. Please complete payment to unlock downloads." };
  }

  const fileUrl = asset.imageUrl ?? asset.storagePath ?? "";
  if (!fileUrl) return { ok: false, status: 404, error: "File not found" };

  const token = generateDownloadToken(project.id, fileUrl, Math.min(ttlSeconds, 86400));
  const expiresAt = new Date(Date.now() + Math.min(ttlSeconds, 86400) * 1000).toISOString();
  return { ok: true, token, expiresAt, accessPath: `/public/files/access/${token}` };
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

// ── Brand Kit ────────────────────────────────────────────────────────────────

export interface BrandKit {
  projectNumber: string;
  brandName: string;
  colorPalette: string | null;
  typography: string | null;
  visualStyle: Record<string, unknown> | null;
  brandVoice: Record<string, unknown> | null;
  targetAudience: string | null;
  logos: WorkspaceDownloadItem[];
}

export async function listBrandKits(req: Request, clientEmail: string): Promise<BrandKit[]> {
  const projects = (await listAllWorkspaceProjects(req, clientEmail)).filter((p) => p.internalProjectId !== null);
  const kits: BrandKit[] = [];
  for (const p of projects) {
    const [project] = await db.select().from(creativeProjectsTable).where(eq(creativeProjectsTable.id, p.internalProjectId!));
    if (!project) continue;
    const result = (project.result ?? {}) as Record<string, unknown>;
    const creativeDirection = (result["creativeDirection"] ?? null) as Record<string, unknown> | null;
    const copyOutput = (result["copyOutput"] ?? null) as Record<string, unknown> | null;
    const logos = (await listDownloadsForProjects(req, [p])).filter((d) => d.category === "logo");
    kits.push({
      projectNumber: p.projectNumber,
      brandName: project.brandName,
      colorPalette: project.colorPreference,
      typography: (creativeDirection?.["typography"] as { headline_style?: string } | undefined)?.headline_style ?? null,
      visualStyle: (creativeDirection?.["visual_style"] as Record<string, unknown> | undefined) ?? null,
      brandVoice: copyOutput ? { tone_notes: copyOutput["tone_notes"] } : null,
      targetAudience: project.targetMarket,
      logos,
    });
  }
  return kits;
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export interface WorkspaceInvoice {
  id: number;
  invoiceNumber: string;
  projectNumber: string;
  invoiceType: string;
  amount: string;
  currency: string;
  status: string;
  issuedAt: string;
  paidAt: string | null;
  dueDate: string | null;
  paymentScheduleId: number | null;
  scheduleStatus: string | null;
  scheduleReference: string | null;
  proofImageUrl: string | null;
}

async function listInvoicesForProjects(projects: WorkspaceProject[]): Promise<WorkspaceInvoice[]> {
  const internalIds = projects.map((p) => p.internalProjectId).filter((v): v is number => v !== null);
  if (internalIds.length === 0) return [];
  const invoices = await db
    .select()
    .from(aiInvoicesTable)
    .where(inArray(aiInvoicesTable.projectId, internalIds))
    .orderBy(desc(aiInvoicesTable.issuedAt));

  const bySchedule = new Map<number, { dueDate: Date | null; status: string; reference: string | null; proofImageUrl: string | null }>();
  const scheduleIds = invoices.map((i) => i.paymentScheduleId).filter((v): v is number => v !== null);
  if (scheduleIds.length > 0) {
    const schedules = await db.select().from(aiPaymentScheduleTable).where(inArray(aiPaymentScheduleTable.id, scheduleIds));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of schedules) bySchedule.set(s.id, { dueDate: s.dueDate, status: s.status, reference: s.reference ?? null, proofImageUrl: (s as any).proofImageUrl ?? null });
  }

  const byInternalId = new Map(projects.filter((p) => p.internalProjectId !== null).map((p) => [p.internalProjectId!, p]));

  return invoices.map((inv) => {
    const sched = inv.paymentScheduleId ? bySchedule.get(inv.paymentScheduleId) : undefined;
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      projectNumber: byInternalId.get(inv.projectId)?.projectNumber ?? String(inv.projectId),
      invoiceType: inv.invoiceType,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      issuedAt: inv.issuedAt.toISOString(),
      paidAt: inv.paidAt?.toISOString() ?? null,
      dueDate: sched?.dueDate?.toISOString() ?? null,
      paymentScheduleId: inv.paymentScheduleId ?? null,
      scheduleStatus: sched?.status ?? null,
      scheduleReference: sched?.reference ?? null,
      proofImageUrl: sched?.proofImageUrl ?? null,
    };
  });
}

export async function listWorkspaceInvoices(
  req: Request,
  clientEmail: string,
  filters: { status?: string },
): Promise<WorkspaceInvoice[]> {
  const projects = await listAllWorkspaceProjects(req, clientEmail);
  let items = await listInvoicesForProjects(projects);
  if (filters.status) items = items.filter((i) => i.status === filters.status);
  return items;
}

// ── Notifications (synthesized, read-state persisted) ────────────────────────

export interface WorkspaceNotification {
  key: string;
  category: "payment" | "project" | "review" | "revision" | "download" | "invoice" | "announcement";
  title: string;
  message: string;
  projectNumber: string | null;
  isRead: boolean;
  createdAt: string;
}

export async function listWorkspaceNotifications(
  req: Request,
  session: WorkspaceSession,
  filters: { category?: string; read?: "read" | "unread" },
): Promise<WorkspaceNotification[]> {
  const projects = await listAllWorkspaceProjects(req, session.clientEmail);
  const readRows = await db
    .select({ key: customerNotificationReadsTable.notificationKey })
    .from(customerNotificationReadsTable)
    .where(eq(customerNotificationReadsTable.emailHash, session.emailHash));
  const readKeys = new Set(readRows.map((r) => r.key));

  const notifications: WorkspaceNotification[] = [];
  for (const p of projects) {
    notifications.push({
      key: `project:${p.projectNumber}:stage:${p.currentStage}`,
      category: "project",
      title: p.brandName,
      message: `Status proyek: ${p.currentStageLabel}`,
      projectNumber: p.projectNumber,
      isRead: false,
      createdAt: p.updatedAt,
    });
    if (p.paymentStatus) {
      notifications.push({
        key: `payment:${p.projectNumber}:${p.paymentStatus}`,
        category: "payment",
        title: p.brandName,
        message: `Status pembayaran: ${p.paymentStatus}`,
        projectNumber: p.projectNumber,
        isRead: false,
        createdAt: p.updatedAt,
      });
    }
    if (p.reviewStatus) {
      const revisionMsgMap: Record<string, string> = {
        shared: "Hasil kreatif siap direview",
        viewed: "Anda sedang melihat hasil kreatif",
        approved: "Anda telah menyetujui hasil kreatif",
        rejected: "Anda menolak hasil kreatif",
        revision_requested: "Revisi diminta",
      };
      notifications.push({
        key: `review:${p.projectNumber}:${p.reviewStatus}`,
        category: p.reviewStatus === "revision_requested" ? "revision" : "review",
        title: p.brandName,
        message: revisionMsgMap[p.reviewStatus] ?? `Status review: ${p.reviewStatus}`,
        projectNumber: p.projectNumber,
        isRead: false,
        createdAt: p.updatedAt,
      });
    }
  }

  const invoices = await listInvoicesForProjects(projects);
  for (const inv of invoices) {
    notifications.push({
      key: `invoice:${inv.invoiceNumber}:${inv.status}`,
      category: "invoice",
      title: `Invoice ${inv.invoiceNumber}`,
      message: inv.status === "paid" ? "Invoice telah dibayar" : "Invoice baru diterbitkan",
      projectNumber: inv.projectNumber,
      isRead: false,
      createdAt: inv.issuedAt,
    });
  }

  const downloads = await listDownloadsForProjects(req, projects);
  for (const d of downloads.filter((d) => !d.locked)) {
    notifications.push({
      key: `download:${d.id}:${d.status}`,
      category: "download",
      title: d.title,
      message: "File siap diunduh",
      projectNumber: d.projectNumber,
      isRead: false,
      createdAt: d.createdAt,
    });
  }

  let deduped = notifications
    .map((n) => ({ ...n, isRead: readKeys.has(n.key) }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (filters.category) deduped = deduped.filter((n) => n.category === filters.category);
  if (filters.read === "read") deduped = deduped.filter((n) => n.isRead);
  if (filters.read === "unread") deduped = deduped.filter((n) => !n.isRead);

  return deduped;
}

export async function markNotificationRead(emailHash: string, key: string): Promise<void> {
  await db
    .insert(customerNotificationReadsTable)
    .values({ emailHash, notificationKey: key })
    .onConflictDoNothing();
}

export async function markAllNotificationsRead(
  req: Request,
  session: WorkspaceSession,
): Promise<number> {
  const all = await listWorkspaceNotifications(req, session, {});
  const unread = all.filter((n) => !n.isRead);
  for (const n of unread) {
    await markNotificationRead(session.emailHash, n.key);
  }
  return unread.length;
}

// ── Activity ─────────────────────────────────────────────────────────────────

export interface ActivityItem {
  action: string;
  label: string;
  resourceId: string | null;
  status: string;
  createdAt: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  project_submitted: "Project Created",
  payment_verified: "Payment Verified",
  workflow_started: "AI Build Started",
  asset_generated: "Preview Ready",
  review_submitted: "Review Submitted",
  revision_completed: "Revision Completed",
  files_unlocked: "Files Ready",
  access_granted: "Download",
  quotation_approved: "Quotation Approved",
};

export async function listWorkspaceActivity(
  req: Request,
  clientEmail: string,
): Promise<ActivityItem[]> {
  const projects = await listAllWorkspaceProjects(req, clientEmail);
  if (projects.length === 0) return [];

  // V4.0C: source is now the Canonical Runtime Event Model, not ai_audit_logs.
  // Response shape (ActivityItem[]) is unchanged — no API break.
  const projectsForEvents = projects.map((p) => ({
    projectId: p.projectNumber,
    internalProjectId: p.internalProjectId,
  }));

  const allEvents = await getEventsForProjects(projectsForEvents, { limit: 100 });
  const activityEvents = filterForActivityFeed(allEvents); // already sorted DESC by getEventsForProjects

  return activityEvents.map((e) => ({
    action:     e.eventType,
    label:      e.publicMessage,
    resourceId: e.projectId,
    status:     e.severity === "error" ? "failure" : e.severity === "warning" ? "warning" : "success",
    createdAt:  e.createdAt,
  }));
}

// ── Profile ──────────────────────────────────────────────────────────────────

export async function getWorkspaceProfile(session: WorkspaceSession) {
  const [row] = await db.select().from(customerProfilesTable).where(eq(customerProfilesTable.emailHash, session.emailHash));
  return {
    clientEmail: session.clientEmail,
    clientName: session.clientName,
    companyName: row?.companyName ?? null,
    address: row?.address ?? null,
    picName: row?.picName ?? null,
    picPhone: row?.picPhone ?? null,
    billingEmail: row?.billingEmail ?? null,
    taxId: row?.taxId ?? null,
    paymentMethodNotes: row?.paymentMethodNotes ?? null,
    brandPreferences: row?.brandPreferences ?? null,
  };
}

export interface ProfilePatch {
  companyName?: string | null;
  address?: string | null;
  picName?: string | null;
  picPhone?: string | null;
  billingEmail?: string | null;
  taxId?: string | null;
  paymentMethodNotes?: string | null;
  brandPreferences?: Record<string, unknown> | null;
}

export async function updateWorkspaceProfile(session: WorkspaceSession, patch: ProfilePatch) {
  const [existing] = await db.select().from(customerProfilesTable).where(eq(customerProfilesTable.emailHash, session.emailHash));
  if (existing) {
    await db.update(customerProfilesTable).set(patch).where(eq(customerProfilesTable.emailHash, session.emailHash));
  } else {
    await db.insert(customerProfilesTable).values({ emailHash: session.emailHash, clientEmail: session.clientEmail, ...patch });
  }
  return getWorkspaceProfile(session);
}

// ── Support tickets ──────────────────────────────────────────────────────────

export async function createSupportTicket(
  session: WorkspaceSession,
  data: { subject: string; message: string; category?: string; projectNumber?: string },
) {
  const [row] = await db
    .insert(customerSupportTicketsTable)
    .values({
      emailHash: session.emailHash,
      clientEmail: session.clientEmail,
      clientName: session.clientName,
      projectId: data.projectNumber ?? null,
      subject: data.subject,
      message: data.message,
      category: data.category ?? "general",
    })
    .returning();
  return row;
}

export async function listSupportTickets(session: WorkspaceSession) {
  return db
    .select()
    .from(customerSupportTicketsTable)
    .where(eq(customerSupportTicketsTable.emailHash, session.emailHash))
    .orderBy(desc(customerSupportTicketsTable.createdAt));
}

// ── Repeat order ─────────────────────────────────────────────────────────────

export type RepeatOrderMode = "similar" | "duplicate" | "use_brief";

export async function buildRepeatOrderDraft(
  req: Request,
  clientEmail: string,
  projectNumber: string,
  mode: RepeatOrderMode,
): Promise<{ redirectPath: string; prefill: Record<string, unknown> } | null> {
  const detail = await getProjectDetail(req, clientEmail, projectNumber);
  if (!detail) return null;
  const o = detail.overview;

  // Service-catalog projects: send the customer back into the request flow,
  // pre-filled from the previous brief. Legacy/direct projects: send to /submit
  // pre-filled with the same brand details. No new project/order is created
  // server-side here — the customer confirms details before submitting, same
  // as the existing intake flows (keeps this additive and gate-safe).
  const prefill: Record<string, unknown> = {
    brandName: mode === "duplicate" ? o.brandName : `${o.brandName} (New)`,
    businessType: o.businessType,
    targetMarket: o.targetMarket,
    productOrService: o.productOrService,
    stylePreference: o.stylePreference,
    colorPreference: o.colorPreference,
    goal: mode === "use_brief" ? o.goal : "",
    sourceProjectNumber: projectNumber,
    mode,
  };

  return { redirectPath: "/submit", prefill };
}

// ── AI Recommendation (rule-based, additive — no ML/model call) ──────────────

const SERVICE_RECOMMENDATIONS: Record<string, string[]> = {
  logo: ["Company Profile", "Presentation", "Social Media Kit", "Packaging", "Website Landing Page"],
  branding: ["Company Profile", "Presentation", "Social Media Kit"],
  "company profile": ["Presentation", "Website Landing Page"],
  presentation: ["Company Profile", "Social Media Kit"],
};

export function recommendationsFor(serviceName: string): string[] {
  const key = serviceName.toLowerCase();
  for (const [k, v] of Object.entries(SERVICE_RECOMMENDATIONS)) {
    if (key.includes(k)) return v;
  }
  return ["Company Profile", "Presentation", "Social Media Kit"];
}

// ── Admin views ──────────────────────────────────────────────────────────────

export async function resolveCustomerByEmail(clientEmail: string): Promise<WorkspaceSession | null> {
  const emailHash = hashEmail(clientEmail);
  const [row] = await db.select().from(customerDashboardTokensTable).where(eq(customerDashboardTokensTable.emailHash, emailHash));
  if (!row) return null;
  return { emailHash: row.emailHash, clientEmail: row.clientEmail, clientName: row.clientName };
}

export interface WorkspaceAnalytics {
  repeatOrderRate: number;
  totalDownloads: number;
  averageProjectDays: number | null;
  averageRevisions: number;
  averageInvoiceCollectionDays: number | null;
  customerRetentionRate: number;
  customerLifetimeValuePlaceholder: true;
}

export async function computeWorkspaceAnalytics(): Promise<WorkspaceAnalytics> {
  const allTokens = await db.select().from(customerDashboardTokensTable);
  const allServiceReqs = await db.select().from(aiServiceRequestsTable);
  const allProjects = await db.select().from(creativeProjectsTable);
  const allInvoices = await db.select().from(aiInvoicesTable);
  const allAssets = await db.select({ id: creativeAiAssetsTable.id }).from(creativeAiAssetsTable);
  const allReviews = await db.select().from(creativeAiClientReviewsTable);

  const emailCounts = new Map<string, number>();
  for (const sr of allServiceReqs) {
    emailCounts.set(sr.customerEmail, (emailCounts.get(sr.customerEmail) ?? 0) + 1);
  }
  const repeatCustomers = [...emailCounts.values()].filter((c) => c > 1).length;
  const repeatOrderRate = emailCounts.size > 0 ? Math.round((repeatCustomers / emailCounts.size) * 1000) / 10 : 0;

  const completed = allProjects.filter((p) => p.status === "completed");
  const avgProjectDays =
    completed.length > 0
      ? Math.round(
          (completed.reduce((sum, p) => sum + (p.updatedAt.getTime() - p.createdAt.getTime()), 0) / completed.length) /
            (1000 * 60 * 60 * 24) * 10,
        ) / 10
      : null;

  const revisionRequests = allReviews.filter((r) => r.status === "revision_requested").length;
  const averageRevisions = allReviews.length > 0 ? Math.round((revisionRequests / allReviews.length) * 100) / 100 : 0;

  const paidInvoices = allInvoices.filter((i) => i.status === "paid" && i.paidAt);
  const avgCollectionDays =
    paidInvoices.length > 0
      ? Math.round(
          (paidInvoices.reduce((sum, i) => sum + (i.paidAt!.getTime() - i.issuedAt.getTime()), 0) / paidInvoices.length) /
            (1000 * 60 * 60 * 24) * 10,
        ) / 10
      : null;

  const retentionRate = allTokens.length > 0 ? Math.round((repeatCustomers / allTokens.length) * 1000) / 10 : 0;

  return {
    repeatOrderRate,
    totalDownloads: allAssets.length,
    averageProjectDays: avgProjectDays,
    averageRevisions,
    averageInvoiceCollectionDays: avgCollectionDays,
    customerRetentionRate: retentionRate,
    customerLifetimeValuePlaceholder: true,
  };
}
