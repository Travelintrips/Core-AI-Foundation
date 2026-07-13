/**
 * jobCompletionGuard.ts — Phase 1B Production Safety
 *
 * Registry of job types and their completion requirements.
 * Prevents file-producing jobs from being marked `completed` without a real deliverable.
 *
 * Error codes:
 *   WORKER_NOT_IMPLEMENTED  — job type has no real implementation
 *   DELIVERABLE_NOT_CREATED — file-producing job returned no asset reference
 *   ASSET_VALIDATION_FAILED — result has wrong field values (bad URL, wrong MIME, etc.)
 *   STORAGE_OBJECT_MISSING  — storage path present but object not found in Supabase
 *   ASSET_UPLOAD_FAILED     — upload returned but file appears empty
 */

// ── Error codes (exported for use in tests and routes) ────────────────────────

export const WORKER_NOT_IMPLEMENTED  = "WORKER_NOT_IMPLEMENTED";
export const DELIVERABLE_NOT_CREATED = "DELIVERABLE_NOT_CREATED";
export const ASSET_VALIDATION_FAILED = "ASSET_VALIDATION_FAILED";
export const STORAGE_OBJECT_MISSING  = "STORAGE_OBJECT_MISSING";
export const ASSET_UPLOAD_FAILED     = "ASSET_UPLOAD_FAILED";

// ── Error classes ─────────────────────────────────────────────────────────────

/**
 * Thrown by executeJob() for worker types that have no real implementation yet.
 * The dispatcher catches this and calls retryJob(), which eventually marks
 * the job `failed` after max retries are exhausted.
 */
export class WorkerNotImplementedError extends Error {
  readonly code = WORKER_NOT_IMPLEMENTED;

  constructor(jobType: string) {
    super(
      `Worker '${jobType}' is not implemented. No deliverable was generated. ` +
      `Build the engine for this job type before it can be dispatched.`,
    );
    this.name = "WorkerNotImplementedError";
  }
}

/**
 * Thrown by validateJobCompletion() when a file-producing job's result
 * does not contain the expected asset references.
 */
export class DeliverableValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeliverableValidationError";
  }
}

// ── Job type registry ─────────────────────────────────────────────────────────

interface JobRequirement {
  /** True if the job must produce a file/asset to be considered complete. */
  requiresAsset: boolean;
  /**
   * For file-producing jobs: result object fields that must be non-empty strings.
   * Fields whose name ends in "Url" are additionally checked to be HTTP(S) URLs.
   */
  requiredResultFields?: readonly string[];
}

/**
 * Registry of known job types and their completion requirements.
 *
 * Unknown job types default to `{ requiresAsset: false }` — they pass the guard
 * without file validation so future types don't break silently.
 * Add new types here as the platform grows.
 */
export const JOB_COMPLETION_REQUIREMENTS: Readonly<Record<string, JobRequirement>> = {
  // ── Non-file jobs — a valid structured result is sufficient ───────────────
  llm_inference:    { requiresAsset: false },
  creative_brief:   { requiresAsset: false },
  creative_text:    { requiresAsset: false },
  qc_review:        { requiresAsset: false },
  noop:             { requiresAsset: false },

  // ── File-producing jobs — must have asset reference in result ─────────────
  image_generation:    { requiresAsset: true, requiredResultFields: ["imageUrl"] },
  pdf_export:          { requiresAsset: true, requiredResultFields: ["storagePath", "permanentUrl"] },
  pptx_export:         { requiresAsset: true, requiredResultFields: ["storagePath", "permanentUrl"] },
  archive_asset:       { requiresAsset: true, requiredResultFields: ["storagePath", "permanentUrl"] },
  optimize_asset:      { requiresAsset: true, requiredResultFields: ["permanentUrl"] },
  generate_thumbnail:  { requiresAsset: true, requiredResultFields: ["permanentUrl"] },
  zip_export:          { requiresAsset: true, requiredResultFields: ["storagePath", "permanentUrl"] },
  video_generation:    { requiresAsset: true, requiredResultFields: ["storagePath", "permanentUrl"] },
};

/** True if this job type is expected to produce a file deliverable. */
export function isFileProducingJob(jobType: string): boolean {
  return (JOB_COMPLETION_REQUIREMENTS[jobType]?.requiresAsset) ?? false;
}

/**
 * Detect if a completed job's result_json looks like a stub dispatch payload.
 * Used by the audit script to find false-completed jobs in the database.
 *
 * Returns true (= suspect false completion) if:
 *   - result is null/undefined/non-object
 *   - result has only "message" (containing "dispatched") + optional "jobId"
 *   - result has no asset reference (imageUrl, permanentUrl, storagePath)
 */
export function isFalseCompletionResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;

  const r = result as Record<string, unknown>;
  const message = typeof r["message"] === "string" ? r["message"].toLowerCase() : "";
  const fieldCount = Object.keys(r).length;

  // Stub pattern: message contains "dispatched" + ≤2 fields
  if (message.includes("dispatched") && fieldCount <= 2) return true;

  // No asset reference — missing the expected deliverable fields
  const hasAssetRef =
    (typeof r["imageUrl"] === "string" && r["imageUrl"].startsWith("http")) ||
    (typeof r["permanentUrl"] === "string" && r["permanentUrl"].startsWith("http")) ||
    (typeof r["storagePath"] === "string" && r["storagePath"].trim().length > 0);

  return !hasAssetRef;
}

/**
 * Validate that a file-producing job's result contains all required asset references.
 *
 * - Non-file jobs (llm_inference, creative_brief, etc.): always passes.
 * - Unknown job types: treated as non-file — passes without guard.
 * - File-producing jobs: every `requiredResultFields` entry must be a non-empty string.
 *   Fields ending in "Url" must additionally be valid HTTP(S) URLs.
 * - Stub-dispatch detection: if the result looks like a placeholder
 *   ("dispatched" in message and ≤ 2 total fields), rejected even if
 *   no specific fields are declared.
 *
 * @throws {DeliverableValidationError} with a specific error code if validation fails.
 */
export function validateJobCompletion(
  jobType: string,
  result: Record<string, unknown>,
): void {
  const req = JOB_COMPLETION_REQUIREMENTS[jobType];
  if (!req?.requiresAsset) return; // non-file or unknown — no guard needed

  // ── Stub-dispatch pattern detection ───────────────────────────────────────
  // Real workers always return rich result objects. A result with only a
  // "message" (containing "dispatched") and optionally "jobId" is a stub.
  const message = typeof result["message"] === "string" ? result["message"].toLowerCase() : "";
  const fieldCount = Object.keys(result).length;
  if (message.includes("dispatched") && fieldCount <= 2) {
    throw new DeliverableValidationError(
      DELIVERABLE_NOT_CREATED,
      `File-producing job '${jobType}' returned a stub dispatch message without a real ` +
      `deliverable. The worker has no implementation. Job cannot be marked completed.`,
    );
  }

  // ── Required field validation ─────────────────────────────────────────────
  for (const field of req.requiredResultFields ?? []) {
    const value = result[field];

    // Must be a non-empty string
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DeliverableValidationError(
        DELIVERABLE_NOT_CREATED,
        `File-producing job '${jobType}' completed without a valid '${field}' in its result. ` +
        `No file was created or uploaded. Job cannot be marked completed.`,
      );
    }

    // URL fields must be HTTP(S)
    if (field.endsWith("Url") || field.endsWith("url")) {
      if (!value.startsWith("http://") && !value.startsWith("https://")) {
        throw new DeliverableValidationError(
          ASSET_VALIDATION_FAILED,
          `Field '${field}' in job '${jobType}' is not a valid HTTP(S) URL: ` +
          `"${value.slice(0, 80)}". Expected a URL pointing to the generated file.`,
        );
      }
    }
  }
}
