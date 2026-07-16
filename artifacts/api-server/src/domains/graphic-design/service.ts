/**
 * graphic-design/service.ts — Team 15
 *
 * Domain service layer.
 *
 * All business logic for creating, processing, and completing Graphic Design
 * orders lives here. External dependencies are injected via port interfaces
 * (ports.ts) — this keeps the core logic testable without real DB or AI calls.
 *
 * Adapter wiring:
 *   resolveAdapters() builds the concrete GraphicDesignPorts by importing
 *   the real Team 7-14 service modules. Call it once at startup (in routes.ts).
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { logAudit } from "../../services/aiAuditService.js";
import { publishSafe } from "../../services/aiEventBusService.js";

import type { GraphicDesignBrief, GdServiceCode, GdStatus, PackageTier, OutputFormat } from "./schema.js";
import type { GraphicDesignPorts, GraphicDesignJobPayload, JobPriority, TemplateMatchRequest } from "./ports.js";
import { buildDeliverableManifest, getRequiredFormats } from "./manifest.js";
import { getBlueprint, getVariantSpec } from "./blueprints.js";
import { getPackagePolicy } from "./packagePolicy.js";
import { runQc, type QcInput } from "./qc.js";

// ── In-memory brief store (replaced by DB once migration runs) ────────────────
// The graphic-design tables (team-15.sql) may not exist yet in all environments.
// Until then we use a Map so routes work immediately. The service layer is
// the ONLY place that touches this store — routes never access it directly.

interface BriefRecord {
  id:          string;
  serviceCode: GdServiceCode;
  status:      GdStatus;
  packageTier: PackageTier;
  outputFormat: OutputFormat;
  brief:       GraphicDesignBrief;
  manifest:    ReturnType<typeof buildDeliverableManifest>;
  jobs:        string[];        // job IDs dispatched
  qcResult?:   ReturnType<typeof runQc>;
  note?:       string;
  createdAt:   string;
  updatedAt:   string;
}

const BRIEF_STORE = new Map<string, BriefRecord>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function assertBrief(id: string): BriefRecord {
  const r = BRIEF_STORE.get(id);
  if (!r) throw Object.assign(new Error(`Graphic design brief not found: ${id}`), { status: 404 });
  return r;
}

/** Terminal statuses — cannot be advanced further. */
const TERMINAL: GdStatus[] = ["completed", "cancelled"];

// ── Adapters ──────────────────────────────────────────────────────────────────

/**
 * Build the concrete port adapters from real Team 7-14 services.
 * Import lazily so tests can avoid loading heavy service modules.
 */
export async function resolveAdapters(): Promise<GraphicDesignPorts> {
  // Team 7-8: Design Renderer
  // Wraps imageDesignerService / designStudioService
  const renderer = {
    async render(spec: import("./ports.js").RenderSpec): Promise<import("./ports.js").RenderResult> {
      try {
        // Adapter: translate RenderSpec → designStudioService.saveDesignCanvas call
        // and trigger an export. For now we call the export endpoint internally.
        // Real integration: import { exportDesign } from "../../services/designStudioService.js"
        // and pass the canvas state. Stub returns a structured result.
        return {
          success:     true,
          deliverable: {
            variant:        spec.variant,
            canvasWidthPx:  spec.canvasWidthPx,
            canvasHeightPx: spec.canvasHeightPx,
            resolutionDpi:  spec.resolutionDpi,
            colorMode:      spec.colorMode === "CMYK" ? "CMYK" : "sRGB",
            elements:       [],
            fileFormats:    spec.formats,
          },
          fileUrls:    Object.fromEntries(spec.formats.map((f) => [`${spec.variant}_${f}`, `https://placeholder/${spec.serviceCode}/${f}`])),
          durationMs:  0,
        };
      } catch (err) {
        return { success: false, fileUrls: {}, error: String(err), durationMs: 0 };
      }
    },
  };

  // Team 9-10: Template Matcher
  // Wraps templateAiService.generateTemplateFromPrompt
  const matcher = {
    async matchTemplate(req: TemplateMatchRequest): Promise<import("./ports.js").TemplateMatchResult> {
      try {
        // Real integration: import { generateTemplateFromPrompt } from "../../services/design-ai/templateAiService.js"
        // Adapter maps brief summary → system prompt → ranked template matches.
        return {
          matches: [
            {
              templateId:  "builtin-default",
              templateCode: `${req.serviceCode}-DEFAULT`,
              score:        0.75,
              canvasState:  { width: 1000, height: 1000, background: req.colorPalette[0] ?? "#ffffff", elements: [] },
            },
          ],
          usedFallback: true,
        };
      } catch {
        return { matches: [], usedFallback: true };
      }
    },
  };

  // Team 11-12: Asset Library
  // Wraps assetLibraryService
  const assets = {
    async searchAssets(query: import("./ports.js").AssetQuery): Promise<import("./ports.js").AssetItem[]> {
      // Real integration: import { searchAssets } from "../../services/assetLibraryService.js"
      return [];
    },
    async getAsset(assetId: string): Promise<import("./ports.js").AssetItem | null> {
      return null;
    },
  };

  // Team 13-14: Workflow / Job Engine
  // Wraps the dispatcher service (POST /ai/jobs)
  const workflow = {
    async dispatch(payload: GraphicDesignJobPayload, priority: JobPriority): Promise<import("./ports.js").DispatchResult> {
      // Real integration: POST internal to /api/ai/jobs with payload
      // import { createJob } from "../../services/jobService.js"
      const jobId = `gd-${randomUUID()}`;
      return { jobId, status: "queued", estimatedMs: 30_000 };
    },
    async getStatus(jobId: string): Promise<import("./ports.js").JobStatus> {
      return { jobId, status: "queued", progressPct: 0 };
    },
    async cancel(jobId: string): Promise<void> {
      // no-op stub
    },
  };

  return { renderer, matcher, assets, workflow };
}

// ── Service functions ─────────────────────────────────────────────────────────

export interface CreateBriefResult {
  briefId:      string;
  status:       GdStatus;
  manifestId:   string;
  requiredFiles: number;
  estimatedDays: number;
}

/**
 * Create a new graphic design brief.
 * Status starts at "pending_review" (admin must approve before production).
 */
export async function createBrief(
  brief: GraphicDesignBrief,
  ports: GraphicDesignPorts
): Promise<CreateBriefResult> {
  const briefId    = randomUUID();
  const policy     = getPackagePolicy(brief.serviceCode, brief.packageTier);
  const manifest   = buildDeliverableManifest(brief.serviceCode, brief.packageTier, brief.outputFormat);
  const blueprint  = getBlueprint(brief.serviceCode);
  const variant    = blueprint.defaultVariant;

  const record: BriefRecord = {
    id: briefId,
    serviceCode: brief.serviceCode,
    status:      "pending_review",
    packageTier: brief.packageTier,
    outputFormat: brief.outputFormat,
    brief,
    manifest,
    jobs:        [],
    createdAt:   now(),
    updatedAt:   now(),
  };

  BRIEF_STORE.set(briefId, record);

  await logAudit(
    "graphic-design",
    "create_brief",
    briefId,
    "gd_brief",
    "success",
    { serviceCode: brief.serviceCode, packageTier: brief.packageTier, brandName: brief.brandName }
  );

  publishSafe({
    eventType:    "graphic_design.brief.created",
    sourceModule: "graphic-design",
    sourceId:     briefId,
    payload:      { briefId, serviceCode: brief.serviceCode, clientName: brief.clientName, packageTier: brief.packageTier },
  });

  return {
    briefId,
    status:        "pending_review",
    manifestId:    briefId,
    requiredFiles: manifest.requiredCount,
    estimatedDays: brief.urgencyLevel === "rush" ? (policy.rushDeliveryDays ?? policy.deliveryDays) : policy.deliveryDays,
  };
}

export interface ListBriefsOptions {
  serviceCode?: GdServiceCode;
  status?:      GdStatus;
  page?:        number;
  pageSize?:    number;
}

export interface ListBriefsResult {
  items:    BriefSummary[];
  total:    number;
  page:     number;
  pageSize: number;
}

export interface BriefSummary {
  id:          string;
  serviceCode: GdServiceCode;
  status:      GdStatus;
  packageTier: PackageTier;
  brandName:   string;
  clientName:  string;
  createdAt:   string;
  updatedAt:   string;
  jobCount:    number;
}

export function listBriefs(opts: ListBriefsOptions = {}): ListBriefsResult {
  const { serviceCode, status, page = 1, pageSize = 20 } = opts;

  let items = [...BRIEF_STORE.values()];

  if (serviceCode) items = items.filter((r) => r.serviceCode === serviceCode);
  if (status)      items = items.filter((r) => r.status === status);

  // Sort newest first
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = items.length;
  const paged = items.slice((page - 1) * pageSize, page * pageSize);

  return {
    items: paged.map((r) => ({
      id:          r.id,
      serviceCode: r.serviceCode,
      status:      r.status,
      packageTier: r.packageTier,
      brandName:   r.brief.brandName,
      clientName:  r.brief.clientName,
      createdAt:   r.createdAt,
      updatedAt:   r.updatedAt,
      jobCount:    r.jobs.length,
    })),
    total,
    page,
    pageSize,
  };
}

export function getBrief(id: string): BriefRecord {
  return assertBrief(id);
}

export interface UpdateStatusResult {
  briefId:     string;
  prevStatus:  GdStatus;
  nextStatus:  GdStatus;
  updatedAt:   string;
}

export async function updateBriefStatus(
  id: string,
  nextStatus: GdStatus,
  note?: string
): Promise<UpdateStatusResult> {
  const record = assertBrief(id);
  const prevStatus = record.status;

  if (TERMINAL.includes(prevStatus)) {
    throw Object.assign(
      new Error(`Brief ${id} is in terminal status "${prevStatus}" and cannot be updated`),
      { status: 409 }
    );
  }

  record.status    = nextStatus;
  record.note      = note ?? record.note;
  record.updatedAt = now();

  await logAudit("graphic-design", "update_status", id, "gd_brief", "success", { prevStatus, nextStatus, note });

  publishSafe({
    eventType:    "graphic_design.brief.status_changed",
    sourceModule: "graphic-design",
    sourceId:     id,
    payload:      { briefId: id, prevStatus, nextStatus },
  });

  return { briefId: id, prevStatus, nextStatus, updatedAt: record.updatedAt };
}

/**
 * Approve brief and dispatch generation jobs to Team 13-14 workflow engine.
 * One job per concept variant × output variant.
 */
export async function approveBriefAndDispatch(
  id: string,
  ports: GraphicDesignPorts
): Promise<{ jobIds: string[]; conceptCount: number }> {
  const record = assertBrief(id);

  if (record.status !== "pending_review" && record.status !== "approved") {
    throw Object.assign(
      new Error(`Brief must be in "pending_review" or "approved" status to dispatch`),
      { status: 409 }
    );
  }

  const policy    = getPackagePolicy(record.serviceCode, record.packageTier);
  const blueprint = getBlueprint(record.serviceCode);
  const variant   = blueprint.defaultVariant;

  // Match template once for all concepts
  const matchReq: TemplateMatchRequest = {
    serviceCode:     record.serviceCode,
    stylePreference: record.brief.stylePreference,
    industry:        record.brief.industry,
    colorPalette:    record.brief.colorPalette,
    briefSummary:    `${record.brief.brandName} — ${record.brief.targetAudience} — ${record.brief.notes ?? ""}`,
    maxResults:      policy.conceptVariants,
  };

  const matchResult = await ports.matcher.matchTemplate(matchReq);
  const jobIds: string[] = [];

  for (let i = 0; i < policy.conceptVariants; i++) {
    const canvasState = matchResult.matches[i]?.canvasState ?? { width: 1000, height: 1000, background: "#ffffff", elements: [] };
    const priority: JobPriority = record.brief.urgencyLevel === "rush" ? "high" : record.brief.urgencyLevel === "express" ? "urgent" : "normal";

    const payload: GraphicDesignJobPayload = {
      briefId:         record.id,
      serviceCode:     record.serviceCode,
      packageTier:     record.packageTier,
      outputFormat:    record.outputFormat,
      brief:           record.brief,
      variantKey:      variant,
      conceptIndex:    i,
      totalConcepts:   policy.conceptVariants,
      manifestFileKey: record.manifest.files[0]?.fileKey ?? "unknown",
    };

    const result = await ports.workflow.dispatch(payload, priority);
    jobIds.push(result.jobId);
  }

  record.jobs      = [...record.jobs, ...jobIds];
  record.status    = "in_production";
  record.updatedAt = now();

  await logAudit("graphic-design", "dispatch_jobs", id, "gd_brief", "success", { jobIds, conceptCount: policy.conceptVariants });

  return { jobIds, conceptCount: policy.conceptVariants };
}

export interface QcRunResult {
  briefId:   string;
  qcScore:   number;
  passed:    boolean;
  warnings:  string[];
  failures:  string[];
  newStatus: GdStatus;
}

/**
 * Run QC against a rendered deliverable and update brief status.
 * Called after Team 7-8 has finished rendering.
 */
export async function runBriefQc(
  id: string,
  deliverable: import("./qc.js").RenderedDeliverable
): Promise<QcRunResult> {
  const record = assertBrief(id);

  const input: QcInput = {
    serviceCode:     record.serviceCode,
    outputFormat:    record.outputFormat,
    deliverable,
    expectedFormats: getRequiredFormats(record.serviceCode, record.packageTier, record.outputFormat),
  };

  const result    = runQc(input);
  record.qcResult = result;
  record.status   = result.passed ? "qc_check" : "qc_failed";
  record.updatedAt = now();

  await logAudit(
    "graphic-design",
    "qc_run",
    id,
    "gd_brief",
    result.passed ? "success" : "failure",
    { qcScore: result.qcScore, passed: result.passed, failureCount: result.failures.length }
  );

  publishSafe({
    eventType:    result.passed ? "graphic_design.qc.passed" : "graphic_design.qc.failed",
    sourceModule: "graphic-design",
    sourceId:     id,
    payload:      { briefId: id, qcScore: result.qcScore, passed: result.passed },
  });

  return {
    briefId:   id,
    qcScore:   result.qcScore,
    passed:    result.passed,
    warnings:  result.warnings,
    failures:  result.failures,
    newStatus: record.status,
  };
}

export function getBriefManifest(id: string) {
  const record = assertBrief(id);
  return record.manifest;
}

export function getBriefQcResult(id: string) {
  const record = assertBrief(id);
  return record.qcResult ?? null;
}
