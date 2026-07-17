/**
 * graphic-design/service.ts — Team 15
 *
 * Domain service layer — ADAPTER pattern.
 *
 * This module is a domain adapter, not a rendering engine. It:
 *   1. Validates and stores graphic design briefs.
 *   2. Maps brief parameters → canvas dimensions (from blueprints).
 *   3. Dispatches creation via the canonical CanonicalJobAdapter
 *      (backed by designStudioService.createDesignProject — the
 *      existing canvas engine, not a second one).
 *   4. Runs domain-specific QC rules on renderer output.
 *   5. Builds deliverable manifests per service/tier/format.
 *
 * There is ONE execution path: approveBriefAndDispatch → CanonicalJobAdapter.
 * No code path may directly render or mutate status outside this adapter.
 *
 * Route mounting: NOT self-mounted. Routes are declared in
 * integration/manifests/team-15.json → routesToMount and must be
 * applied by the integration layer (Team 24).
 */

import { randomUUID } from "crypto";
import { logAudit } from "../../services/aiAuditService.js";
import { publishSafe } from "../../services/aiEventBusService.js";

import type { GraphicDesignBrief, GdServiceCode, GdStatus, PackageTier, OutputFormat } from "./schema.js";
import { buildDeliverableManifest, getRequiredFormats } from "./manifest.js";
import { getBlueprint, isPrintSpec } from "./blueprints.js";
import { getPackagePolicy } from "./packagePolicy.js";
import { runQc, type QcInput, type RenderedDeliverable } from "./qc.js";
import {
  sanitizeFileFormats,
  sanitizeVariantKey,
  sanitizeColorMode,
} from "./sanitize.js";

// ── Canonical job adapter ─────────────────────────────────────────────────────

/**
 * The ONE adapter all execution paths go through.
 *
 * Backed by designStudioService.createDesignProject (the existing canvas
 * engine). Any future wiring to a batch-render queue also goes here.
 *
 * Tests inject a mock to avoid hitting the DB.
 */
export interface CanonicalJobAdapter {
  createProject(input: {
    name:           string;
    description?:   string;
    canvasWidthPx:  number;
    canvasHeightPx: number;
    tags?:          string[];
  }): Promise<{ projectId: string }>;
}

/**
 * Build the default adapter backed by designStudioService.
 * Imported lazily so the heavy service module is not loaded in tests.
 */
export async function makeDefaultAdapter(): Promise<CanonicalJobAdapter> {
  const { createDesignProject } = await import(
    "../../services/designStudioService.js"
  );
  return {
    async createProject(input) {
      const project = await createDesignProject({
        name:         input.name,
        description:  input.description,
        canvasWidth:  input.canvasWidthPx,
        canvasHeight: input.canvasHeightPx,
        tags:         input.tags,
      });
      return { projectId: String(project.id) };
    },
  };
}

// ── In-memory brief store (replaced by DB once migration runs) ────────────────
// team-15.sql creates ai_platform.gd_briefs and ai_platform.gd_qc_runs.
// Until that migration is applied the Map keeps routes functional.
// The service layer is the ONLY consumer of this store.

interface BriefRecord {
  id:           string;
  serviceCode:  GdServiceCode;
  status:       GdStatus;
  packageTier:  PackageTier;
  outputFormat: OutputFormat;
  brief:        GraphicDesignBrief;
  manifest:     ReturnType<typeof buildDeliverableManifest>;
  /** Design-studio project IDs (one per concept variant). */
  jobs:         string[];
  qcResult?:    ReturnType<typeof runQc>;
  note?:        string;
  createdAt:    string;
  updatedAt:    string;
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

const TERMINAL: GdStatus[] = ["completed", "cancelled"];

// ── Brief CRUD ────────────────────────────────────────────────────────────────

export interface CreateBriefResult {
  briefId:       string;
  status:        GdStatus;
  manifestId:    string;
  requiredFiles: number;
  estimatedDays: number;
}

/**
 * Create a new graphic design brief.
 * Status starts at "pending_review" — no execution happens here.
 * Execution only occurs via approveBriefAndDispatch.
 */
export async function createBrief(
  brief: GraphicDesignBrief,
): Promise<CreateBriefResult> {
  const briefId   = randomUUID();
  const policy    = getPackagePolicy(brief.serviceCode, brief.packageTier);
  const manifest  = buildDeliverableManifest(brief.serviceCode, brief.packageTier, brief.outputFormat);

  const record: BriefRecord = {
    id:           briefId,
    serviceCode:  brief.serviceCode,
    status:       "pending_review",
    packageTier:  brief.packageTier,
    outputFormat: brief.outputFormat,
    brief,
    manifest,
    jobs:         [],
    createdAt:    now(),
    updatedAt:    now(),
  };

  BRIEF_STORE.set(briefId, record);

  await logAudit(
    "graphic-design",
    "create_brief",
    briefId,
    "gd_brief",
    "success",
    { serviceCode: brief.serviceCode, packageTier: brief.packageTier, brandName: brief.brandName },
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
    estimatedDays: brief.urgencyLevel === "rush"
      ? (policy.rushDeliveryDays ?? policy.deliveryDays)
      : policy.deliveryDays,
  };
}

export interface ListBriefsOptions {
  serviceCode?: GdServiceCode;
  status?:      GdStatus;
  page?:        number;
  pageSize?:    number;
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

export interface ListBriefsResult {
  items:    BriefSummary[];
  total:    number;
  page:     number;
  pageSize: number;
}

export function listBriefs(opts: ListBriefsOptions = {}): ListBriefsResult {
  const { serviceCode, status, page = 1, pageSize = 20 } = opts;

  let items = [...BRIEF_STORE.values()];
  if (serviceCode) items = items.filter((r) => r.serviceCode === serviceCode);
  if (status)      items = items.filter((r) => r.status === status);

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
  briefId:    string;
  prevStatus: GdStatus;
  nextStatus: GdStatus;
  updatedAt:  string;
}

export async function updateBriefStatus(
  id:         string,
  nextStatus: GdStatus,
  note?:      string,
): Promise<UpdateStatusResult> {
  const record     = assertBrief(id);
  const prevStatus = record.status;

  if (TERMINAL.includes(prevStatus)) {
    throw Object.assign(
      new Error(`Brief ${id} is in terminal status "${prevStatus}" and cannot be updated`),
      { status: 409 },
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

// ── Dispatch — SINGLE canonical path ─────────────────────────────────────────

/**
 * Approve a brief and dispatch design projects via the canonical adapter.
 *
 * The ONLY execution path in this domain. All creation goes through
 * CanonicalJobAdapter (backed by designStudioService.createDesignProject).
 *
 * Blueprint dimensions drive the canvas size — this is the adapter's role.
 * No direct render calls, no status mutations outside this function.
 *
 * @param id      Brief ID
 * @param adapter Canonical job adapter (defaults to designStudioService wrapper)
 */
export async function approveBriefAndDispatch(
  id:       string,
  adapter?: CanonicalJobAdapter,
): Promise<{ jobIds: string[]; conceptCount: number }> {
  const record = assertBrief(id);

  if (record.status !== "pending_review" && record.status !== "approved") {
    throw Object.assign(
      new Error(`Brief must be "pending_review" or "approved" to dispatch (current: "${record.status}")`),
      { status: 409 },
    );
  }

  const policy    = getPackagePolicy(record.serviceCode, record.packageTier);
  const blueprint = getBlueprint(record.serviceCode);

  // Blueprint selection: pick the canonical spec for canvas dimensions
  const specEntry =
    (blueprint.printVariants as Record<string, { widthPxWithBleed?: number; heightPxWithBleed?: number; widthPx?: number; heightPx?: number } | undefined>)[blueprint.defaultVariant] ??
    (blueprint.digitalVariants as Record<string, { widthPx: number; heightPx: number } | undefined>)[blueprint.defaultVariant];

  const canvasWidthPx  = specEntry
    ? (("widthPxWithBleed" in specEntry ? specEntry.widthPxWithBleed : specEntry.widthPx) ?? 1000)
    : 1000;
  const canvasHeightPx = specEntry
    ? (("heightPxWithBleed" in specEntry ? specEntry.heightPxWithBleed : specEntry.heightPx) ?? 1000)
    : 1000;

  // Resolve adapter once — single canonical path
  const canonicalAdapter = adapter ?? await makeDefaultAdapter();

  const jobIds: string[] = [];
  for (let i = 0; i < policy.conceptVariants; i++) {
    const { projectId } = await canonicalAdapter.createProject({
      name:          `${record.brief.brandName} — ${record.serviceCode} — Concept ${i + 1}`,
      description:   `GD Brief ${id} | ${record.brief.clientName} | ${record.brief.industry}`,
      canvasWidthPx,
      canvasHeightPx,
      tags:          [record.serviceCode, record.packageTier, `brief:${id}`, `concept:${i + 1}`],
    });
    jobIds.push(projectId);
  }

  record.jobs      = [...record.jobs, ...jobIds];
  record.status    = "in_production";
  record.updatedAt = now();

  await logAudit(
    "graphic-design",
    "dispatch_jobs",
    id,
    "gd_brief",
    "success",
    { jobIds, conceptCount: policy.conceptVariants, canvasWidthPx, canvasHeightPx },
  );

  publishSafe({
    eventType:    "graphic_design.brief.dispatched",
    sourceModule: "graphic-design",
    sourceId:     id,
    payload:      { briefId: id, jobIds, conceptCount: policy.conceptVariants },
  });

  return { jobIds, conceptCount: policy.conceptVariants };
}

// ── QC ────────────────────────────────────────────────────────────────────────

export interface QcRunResult {
  briefId:   string;
  qcScore:   number;
  passed:    boolean;
  warnings:  string[];
  failures:  string[];
  newStatus: GdStatus;
}

/**
 * Run domain QC rules against a rendered deliverable and update brief status.
 * Called after the canvas engine (Team 7-8) has finished rendering.
 *
 * P0 PATH TRAVERSAL: all user-supplied strings in `deliverable` are sanitized
 * before use. File formats are validated against the allowlist; variant key
 * is stripped to alphanumeric + hyphen; colorMode is validated against the enum.
 */
export async function runBriefQc(
  id:          string,
  rawDeliverable: RenderedDeliverable,
): Promise<QcRunResult> {
  const record = assertBrief(id);

  // Sanitize all user-supplied strings from renderer before processing
  const deliverable: RenderedDeliverable = {
    ...rawDeliverable,
    variant:     sanitizeVariantKey(rawDeliverable.variant ?? ""),
    colorMode:   sanitizeColorMode(rawDeliverable.colorMode ?? ""),
    fileFormats: sanitizeFileFormats(rawDeliverable.fileFormats ?? []),
  };

  const input: QcInput = {
    serviceCode:     record.serviceCode,
    outputFormat:    record.outputFormat,
    deliverable,
    expectedFormats: getRequiredFormats(record.serviceCode, record.packageTier, record.outputFormat),
  };

  const result      = runQc(input);
  record.qcResult   = result;
  record.status     = result.passed ? "qc_check" : "qc_failed";
  record.updatedAt  = now();

  await logAudit(
    "graphic-design",
    "qc_run",
    id,
    "gd_brief",
    result.passed ? "success" : "failure",
    { qcScore: result.qcScore, passed: result.passed, failureCount: result.failures.length },
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

// ── Manifest & QC getters ─────────────────────────────────────────────────────

export function getBriefManifest(id: string) {
  return assertBrief(id).manifest;
}

export function getBriefQcResult(id: string) {
  return assertBrief(id).qcResult ?? null;
}

// ── Job list (P2: paginated) ──────────────────────────────────────────────────

export interface ListBriefJobsResult {
  briefId:  string;
  jobs:     string[];
  total:    number;
  page:     number;
  pageSize: number;
}

/**
 * Return a paginated list of design-studio project IDs (job references)
 * for a given brief.
 */
export function listBriefJobs(
  id:       string,
  opts:     { page?: number; pageSize?: number } = {},
): ListBriefJobsResult {
  const record   = assertBrief(id);
  const page     = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const total    = record.jobs.length;
  const paged    = record.jobs.slice((page - 1) * pageSize, page * pageSize);

  return { briefId: id, jobs: paged, total, page, pageSize };
}

// ── Test helper ───────────────────────────────────────────────────────────────

/** Clear the in-memory store between tests. Not exported to production routes. */
export function _clearStoreForTest(): void {
  BRIEF_STORE.clear();
}
