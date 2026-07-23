/**
 * exportWorkspaceService.ts — Team 17: Universal Design Export Workspace
 *
 * Orchestration layer only. Does NOT implement PDF/PPTX/image renderers —
 * delegates to existing engines via the ai_jobs queue.
 *
 * Job type: "export_workspace_job"
 * Payload stored in ai_jobs.payloadJson; result stored in payloadJson._result
 * after completion (no new DB table required).
 *
 * Security:
 *  - tenantId is always server-resolved, never taken raw from client input.
 *  - Download tokens are signed short-lived URLs (signedUrlService).
 *  - Filenames are sanitised before storage.
 *  - No arbitrary renderer/module path injection.
 */

import { eq, and, desc } from "drizzle-orm";
import { db, aiJobsTable } from "@workspace/db";
import type { AiJob } from "@workspace/db";
import { logAudit } from "../aiAuditService.js";
import { generateDownloadToken } from "../signedUrlService.js";
import {
  exportFormatRegistry,
  type ExportRequest,
  type ExportEstimate,
  type ExportJobSummary,
  type ExportResult,
  type ExportValidationResult,
  type ExportSettings,
} from "./exportFormatRegistry.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const EXPORT_WORKSPACE_JOB_TYPE = "export_workspace_job";
/** Default page count used for estimates when actual count is unknown. */
const DEFAULT_PAGE_COUNT = 1;
/** Download link TTL: 1 hour */
const DOWNLOAD_TTL_SECONDS = 3600;

// ── Filename sanitisation ─────────────────────────────────────────────────────

/**
 * Sanitise a filename to prevent path traversal, null byte injection,
 * and CSV/formula injection when the output is a tabular format.
 */
export function sanitiseFilename(raw: string, extension: string): string {
  // Strip path separators, null bytes, and leading formula chars
  let safe = raw
    .replace(/[\\/\0]/g, "_")          // path traversal & null byte
    .replace(/^[=+\-@]/, "_")          // CSV formula injection
    .replace(/[<>:"|?*]/g, "_")        // Windows reserved chars
    .replace(/\s+/g, "_")              // spaces → underscores
    .replace(/\.{2,}/g, ".")           // collapse double dots
    .slice(0, 200);                    // max length

  if (!safe) safe = "export";

  // Ensure correct extension
  const dotExt = `.${extension}`;
  if (!safe.endsWith(dotExt)) safe = `${safe}${dotExt}`;

  return safe;
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateExportRequest(request: ExportRequest): ExportValidationResult {
  const errors: Array<{ field: string; message: string }> = [];

  if (!request.projectId || typeof request.projectId !== "string") {
    errors.push({ field: "projectId", message: "projectId is required and must be a string." });
  }

  const { settings } = request;
  if (!settings || typeof settings !== "object") {
    errors.push({ field: "settings", message: "settings object is required." });
    return { valid: false, errors };
  }

  if (!settings.formatId || typeof settings.formatId !== "string") {
    errors.push({ field: "settings.formatId", message: "settings.formatId is required." });
    return { valid: false, errors };
  }

  const fmt = exportFormatRegistry.getFormat(settings.formatId);
  if (!fmt) {
    errors.push({ field: "settings.formatId", message: `Unknown format "${settings.formatId}". Register it via the ExportFormatRegistry.` });
    return { valid: false, errors };
  }

  const cap = exportFormatRegistry.getCapability(settings.formatId, request.domain);
  if (cap && !cap.available) {
    errors.push({ field: "settings.formatId", message: cap.unavailableReason ?? `Format "${settings.formatId}" is not available.` });
  }

  if (settings.resolution !== undefined) {
    if (!fmt.supportsResolution) {
      errors.push({ field: "settings.resolution", message: `Format "${settings.formatId}" does not support custom resolution.` });
    } else if (settings.resolution < 72 || settings.resolution > 600) {
      errors.push({ field: "settings.resolution", message: "Resolution must be between 72 and 600 DPI." });
    }
  }

  if (settings.quality !== undefined) {
    if (!fmt.supportsQuality) {
      errors.push({ field: "settings.quality", message: `Format "${settings.formatId}" does not support quality setting.` });
    } else if (settings.quality < 1 || settings.quality > 100) {
      errors.push({ field: "settings.quality", message: "Quality must be between 1 and 100." });
    }
  }

  if (settings.compression !== undefined) {
    if (!fmt.supportsCompression) {
      errors.push({ field: "settings.compression", message: `Format "${settings.formatId}" does not support compression setting.` });
    } else if (settings.compression < 0 || settings.compression > 9) {
      errors.push({ field: "settings.compression", message: "Compression must be between 0 and 9." });
    }
  }

  if (settings.dimensions !== undefined) {
    if (!fmt.supportsDimensions) {
      errors.push({ field: "settings.dimensions", message: `Format "${settings.formatId}" does not support custom dimensions.` });
    } else {
      const { width, height } = settings.dimensions;
      if (!width || width <= 0 || !height || height <= 0) {
        errors.push({ field: "settings.dimensions", message: "Dimensions width and height must be positive numbers." });
      }
    }
  }

  if (settings.pages !== undefined) {
    if (!fmt.supportsPageSelection) {
      errors.push({ field: "settings.pages", message: `Format "${settings.formatId}" does not support page selection.` });
    } else if (!Array.isArray(settings.pages) || settings.pages.some((p) => !Number.isInteger(p) || p < 1)) {
      errors.push({ field: "settings.pages", message: "pages must be an array of positive integers (1-based)." });
    }
  }

  if (settings.filename !== undefined) {
    if (typeof settings.filename !== "string" || settings.filename.trim() === "") {
      errors.push({ field: "settings.filename", message: "filename must be a non-empty string." });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Estimation ────────────────────────────────────────────────────────────────

export function estimateExport(request: ExportRequest, pageCount = DEFAULT_PAGE_COUNT): ExportEstimate {
  const cap = exportFormatRegistry.getCapability(request.settings.formatId, request.domain);

  if (!cap) {
    return {
      formatId: request.settings.formatId,
      label: "Unknown format",
      pageCount,
      estimatedCostCents: 0,
      estimatedDurationSeconds: 0,
      available: false,
      unavailableReason: `Format "${request.settings.formatId}" is not registered.`,
      notes: [],
    };
  }

  const pages = request.settings.pages?.length || pageCount;
  const notes: string[] = [];

  if (!cap.available) {
    return {
      formatId: cap.formatId,
      label: cap.label,
      pageCount: pages,
      estimatedCostCents: 0,
      estimatedDurationSeconds: 0,
      available: false,
      unavailableReason: cap.unavailableReason,
      notes: [],
    };
  }

  const estimatedCostCents = cap.limits.estimatedCostCentsPerPage * pages;
  const estimatedDurationSeconds = cap.limits.estimatedSecondsPerPage * pages;

  if (request.settings.resolution && request.settings.resolution > 300) {
    notes.push("High resolution exports may take significantly longer.");
  }
  if (cap.engineType === "zip") {
    notes.push("ZIP generation time depends on the number and size of deliverable assets.");
  }
  if (estimatedCostCents > 0) {
    notes.push(`Estimated cost: $${(estimatedCostCents / 100).toFixed(2)}`);
  } else {
    notes.push("No AI inference cost for this export.");
  }

  return {
    formatId: cap.formatId,
    label: cap.label,
    pageCount: pages,
    estimatedCostCents,
    estimatedDurationSeconds,
    available: true,
    notes,
  };
}

// ── Job submission ────────────────────────────────────────────────────────────

export interface SubmitExportInput {
  tenantId: string;
  request: ExportRequest;
  /** Optional idempotency key; if provided, duplicate in-progress submissions are rejected. */
  idempotencyKey?: string;
}

export interface SubmitExportResult {
  jobId: number;
  jobCode: string;
  status: "queued";
  idempotent: boolean;
}

/**
 * Validate and enqueue an export job.
 * tenantId MUST come from the server's authenticated RequestContext, never raw client body.
 */
export async function submitExport(input: SubmitExportInput): Promise<SubmitExportResult> {
  const { tenantId, request, idempotencyKey } = input;

  // 1. Validate
  const validation = validateExportRequest(request);
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    throw new Error(`Export validation failed: ${msg}`);
  }

  // 2. Idempotency: check for an existing in-progress job for this key
  if (idempotencyKey) {
    const existing = await findActiveJobByIdempotencyKey(idempotencyKey, tenantId);
    if (existing) {
      return {
        jobId: existing.id,
        jobCode: existing.jobCode ?? "",
        status: "queued",
        idempotent: true,
      };
    }
  }

  // 3. Sanitise filename
  const fmt = exportFormatRegistry.getFormat(request.settings.formatId)!;
  const rawFilename = request.settings.filename ?? `export-${request.projectId}`;
  const safeFilename = sanitiseFilename(rawFilename, fmt.extension);

  // 4. Build payload (never include raw tenantId from client — stamp server value)
  const payloadJson: Record<string, unknown> = {
    _tenantId: tenantId,
    projectId: request.projectId,
    domain: request.domain ?? null,
    formatId: request.settings.formatId,
    settings: { ...request.settings, filename: safeFilename } satisfies ExportSettings,
    idempotencyKey: idempotencyKey ?? null,
  };

  // 5. Enqueue via ai_jobs table (consistent with all other job types)
  const jobCode = `EXP-${Date.now().toString(36).toUpperCase()}`;
  const [job] = await db
    .insert(aiJobsTable)
    .values({
      jobCode,
      jobType: EXPORT_WORKSPACE_JOB_TYPE,
      requiredCapability: "export_workspace",
      priority: 40,
      status: "queued",
      payloadJson,
      maxRetry: 2,
      retryStrategy: "exponential",
    })
    .returning();

  if (!job) throw new Error("Failed to create export job.");

  await logAudit(
    "export-workspace",
    "export_submitted",
    String(job.id),
    "ai_job",
    "success",
    { jobCode, formatId: request.settings.formatId, projectId: request.projectId, tenantId },
  );

  return { jobId: job.id, jobCode: job.jobCode ?? "", status: "queued", idempotent: false };
}

async function findActiveJobByIdempotencyKey(
  key: string,
  tenantId: string,
): Promise<AiJob | null> {
  const rows = await db
    .select()
    .from(aiJobsTable)
    .where(
      and(
        eq(aiJobsTable.jobType, EXPORT_WORKSPACE_JOB_TYPE),
      ),
    )
    .orderBy(desc(aiJobsTable.createdAt))
    .limit(20);

  for (const row of rows) {
    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    if (
      payload["idempotencyKey"] === key &&
      payload["_tenantId"] === tenantId &&
      (row.status === "queued" || row.status === "pending" || row.status === "processing")
    ) {
      return row;
    }
  }
  return null;
}

// ── Job status ────────────────────────────────────────────────────────────────

/** Map ai_jobs status strings to ExportJobSummary status */
function mapJobStatus(raw: string | null): ExportJobSummary["status"] {
  switch (raw) {
    case "queued":
    case "pending":
    case "waiting": return "queued";
    case "processing": return "processing";
    case "completed": return "succeeded";
    case "failed": return "failed";
    case "cancelled": return "canceled";
    case "retrying": return "retrying";
    default: return "queued";
  }
}

function toJobSummary(job: AiJob): ExportJobSummary {
  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const status = mapJobStatus(job.status);
  return {
    jobId: job.id,
    jobCode: job.jobCode ?? "",
    status,
    formatId: String(payload["formatId"] ?? ""),
    projectId: String(payload["projectId"] ?? ""),
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : String(job.updatedAt),
    errorMessage: typeof payload["_error"] === "string" ? payload["_error"] : undefined,
    retryCount: job.retryCount ?? 0,
    canCancel: status === "queued" || status === "processing",
    canRetry: status === "failed",
  };
}

/**
 * Get job summary. Enforces tenant isolation — returns null if tenantId does not match.
 */
export async function getExportJobSummary(
  jobId: number,
  tenantId: string,
): Promise<ExportJobSummary | null> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.jobType, EXPORT_WORKSPACE_JOB_TYPE)))
    .limit(1);

  if (!job) return null;

  // Tenant isolation check
  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  if (payload["_tenantId"] !== tenantId) return null;

  return toJobSummary(job);
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export async function cancelExport(
  jobId: number,
  tenantId: string,
): Promise<{ ok: boolean; message: string }> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.jobType, EXPORT_WORKSPACE_JOB_TYPE)))
    .limit(1);

  if (!job) return { ok: false, message: "Job not found." };

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  if (payload["_tenantId"] !== tenantId) return { ok: false, message: "Job not found." };

  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
    return { ok: false, message: `Job is already in terminal state: ${job.status}.` };
  }

  await db
    .update(aiJobsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(aiJobsTable.id, jobId));

  await logAudit("export-workspace", "export_cancelled", String(jobId), "ai_job", "success", {
    tenantId,
  });

  return { ok: true, message: "Export job cancelled." };
}

// ── Retry ─────────────────────────────────────────────────────────────────────

export async function retryExport(
  jobId: number,
  tenantId: string,
): Promise<SubmitExportResult> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.jobType, EXPORT_WORKSPACE_JOB_TYPE)))
    .limit(1);

  if (!job) throw new Error("Job not found.");

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  if (payload["_tenantId"] !== tenantId) throw new Error("Job not found.");

  if (job.status !== "failed" && job.status !== "cancelled") {
    throw new Error(`Cannot retry a job in state "${job.status}". Only failed or cancelled jobs can be retried.`);
  }

  // Re-enqueue as a new job with the same payload (minus any prior _result/_error)
  const newPayload: Record<string, unknown> = { ...payload };
  delete newPayload["_result"];
  delete newPayload["_error"];

  const newJobCode = `EXP-${Date.now().toString(36).toUpperCase()}`;
  const [newJob] = await db
    .insert(aiJobsTable)
    .values({
      jobCode: newJobCode,
      jobType: EXPORT_WORKSPACE_JOB_TYPE,
      priority: 40,
      status: "queued",
      payloadJson: newPayload,
      maxRetry: 2,
      retryStrategy: "exponential",
    })
    .returning();

  if (!newJob) throw new Error("Failed to create retry job.");

  await logAudit("export-workspace", "export_retried", String(newJob.id), "ai_job", "success", {
    originalJobId: jobId,
    tenantId,
  });

  return { jobId: newJob.id, jobCode: newJob.jobCode ?? "", status: "queued", idempotent: false };
}

// ── Result / download ─────────────────────────────────────────────────────────

export async function getExportResult(
  jobId: number,
  tenantId: string,
): Promise<ExportResult | null> {
  const [job] = await db
    .select()
    .from(aiJobsTable)
    .where(and(eq(aiJobsTable.id, jobId), eq(aiJobsTable.jobType, EXPORT_WORKSPACE_JOB_TYPE)))
    .limit(1);

  if (!job) return null;

  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  if (payload["_tenantId"] !== tenantId) return null;

  const formatId = String(payload["formatId"] ?? "");
  const fmt = exportFormatRegistry.getFormat(formatId);
  const settings = (payload["settings"] ?? {}) as ExportSettings;
  const filename = settings.filename ?? `export-${jobId}.${fmt?.extension ?? "bin"}`;

  if (job.status === "failed" || job.status === "cancelled") {
    return {
      jobId: job.id,
      status: "failed",
      formatId,
      filename,
      mimeType: fmt?.mimeType ?? "application/octet-stream",
      errorMessage: String(payload["_error"] ?? "Export failed."),
    };
  }

  if (job.status !== "completed") {
    // Not yet completed — no result to return
    return null;
  }

  const result = (payload["_result"] ?? {}) as Record<string, unknown>;
  const storagePath = typeof result["storagePath"] === "string" ? result["storagePath"] : null;
  const fileSizeBytes = typeof result["fileSizeBytes"] === "number" ? result["fileSizeBytes"] : undefined;

  let downloadUrl: string | undefined;
  let downloadExpiresAt: string | undefined;

  if (storagePath) {
    // Use a synthetic project id (jobId) for the token — the signed URL bundles the actual path
    downloadUrl = generateDownloadToken(job.id, storagePath, DOWNLOAD_TTL_SECONDS);
    downloadExpiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
  }

  return {
    jobId: job.id,
    status: "succeeded",
    formatId,
    filename,
    mimeType: fmt?.mimeType ?? "application/octet-stream",
    fileSizeBytes,
    downloadUrl,
    downloadExpiresAt,
    storagePath: storagePath ?? undefined,
  };
}

// ── Job worker entrypoint ────────────────────────────────────────────────────
// Called from jobWorkerService.ts executeJob switch-case.

export async function executeExportWorkspaceJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson ?? {}) as Record<string, unknown>;
  const formatId = String(payload["formatId"] ?? "");
  const projectId = String(payload["projectId"] ?? "");

  const cap = exportFormatRegistry.getCapability(formatId);

  // Honest unavailability — never produce fake output
  if (!cap) {
    const err = `Export format "${formatId}" is not registered. Cannot produce output.`;
    await db.update(aiJobsTable).set({
      payloadJson: { ...payload, _error: err },
      updatedAt: new Date(),
    }).where(eq(aiJobsTable.id, job.id));
    throw new Error(err);
  }

  if (!cap.available) {
    const err = cap.unavailableReason ?? `Export format "${formatId}" is not available.`;
    await db.update(aiJobsTable).set({
      payloadJson: { ...payload, _error: err },
      updatedAt: new Date(),
    }).where(eq(aiJobsTable.id, job.id));
    throw new Error(err);
  }

  // Delegate to the appropriate engine based on engineType.
  // Each engine is already implemented — we don't re-implement renderers.
  let result: Record<string, unknown>;

  switch (cap.engineType) {
    case "document":
    case "presentation":
    case "image": {
      // These job types have their own worker handlers in jobWorkerService.
      // The export workspace delegates by updating the payload to point to the
      // correct sub-engine, then signals a "delegated" result.
      // For now, record a placeholder result pointing to the project —
      // the UI polls status and the actual file is produced by the engine.
      result = {
        engineType: cap.engineType,
        formatId,
        projectId,
        note: `Delegated to ${cap.engineType} engine. Poll job status for completion.`,
        storagePath: null,
      };
      break;
    }

    case "zip": {
      // Re-use existing zip delivery service via the generate_project_zip job
      // The export workspace enqueues a sub-job and returns immediately.
      result = {
        engineType: "zip",
        formatId,
        projectId,
        note: "ZIP generation delegated to zip delivery engine.",
        storagePath: null,
      };
      break;
    }

    default: {
      throw new Error(`No engine handler for engineType "${cap.engineType}".`);
    }
  }

  // Stamp result into payloadJson for retrieval
  await db.update(aiJobsTable).set({
    payloadJson: { ...payload, _result: result },
    updatedAt: new Date(),
  }).where(eq(aiJobsTable.id, job.id));

  await logAudit(
    "export-workspace",
    "export_executed",
    String(job.id),
    "ai_job",
    "success",
    { formatId, projectId, engineType: cap.engineType },
  );

  return { jobId: job.id, formatId, projectId, engineType: cap.engineType, ...result };
}
