/**
 * creativeDocumentWorkerService.ts — Phase 3 Creative Document Engine
 *
 * Generic PDF export worker that handles ALL document-producing services
 * via a DocumentDefinition registry. Each definition supplies:
 *   - document type identifier
 *   - filename prefix, minimum page count, logo requirements
 *   - generateContent()  — normalizes/produces structured content from the project
 *   - buildSpec()        — maps content to a CreativeDocumentSpec
 *
 * Pipeline (same for every document type):
 *   1. Load creative project
 *   2. Look up DocumentDefinition from registry
 *   3. Idempotency: reuse valid existing asset or recover missing storage object
 *   4. Download completed image assets (respecting maxInlineImages + logo rules)
 *   5. Generate / normalize structured content
 *   6. Map to CreativeDocumentSpec
 *   7. Render PDF → validate → upload to Supabase → verify
 *   8. Create / update creative_ai_assets record
 *   9. Audit log + release project
 *  10. Return rich completion result
 *
 * Error codes (thrown as structured errors):
 *   REQUIRED_LOGO_ASSET_MISSING     — brand identity requested but no logo image found
 *   BRAND_IDENTITY_ASSETS_INCOMPLETE — logo exists but storage object gone and unreachable
 *   DOCUMENT_CONTENT_MISSING         — required workflow output absent from project.result
 *   DOCUMENT_RENDER_FAILED           — renderDocument() threw
 *   DOCUMENT_UPLOAD_FAILED           — upload succeeded but post-upload verify failed
 */

import { eq, and, desc, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import {
  db,
  creativeProjectsTable,
  creativeAiAssetsTable,
  type AiJob,
  type CreativeProject,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { logger } from "../lib/logger.js";
import { WorkerNotImplementedError } from "./jobCompletionGuard.js";
import type { CreativeDocumentType } from "./creativeProjectDocumentType.js";
import type { CreativeDocumentSpec } from "./creativeDocumentService.js";
import {
  renderDocument,
  validateGeneratedPdf,
  sanitizeStorageFilename,
} from "./creativeDocumentService.js";
import {
  uploadToSupabase,
  storageObjectExists,
  getSupabasePublicUrl,
} from "../lib/supabaseStorage.js";

// ── Document definition contract ─────────────────────────────────────────────

export interface DocumentDefinition {
  documentType: CreativeDocumentType;
  /** Sanitised filename prefix, e.g. "brand-strategy" → "brand-strategy-v1.pdf" */
  filenamePrefix: string;
  /** Minimum PDF page count required to pass validation. */
  minimumPageCount: number;
  /**
   * When true, at least one completed image asset must exist for the project
   * before the PDF can be rendered. Used by Brand Identity Guideline.
   */
  requiresLogo: boolean;
  /** Maximum number of images to embed as inline figures (beyond the cover). */
  maxInlineImages: number;
  /**
   * Generate or normalize the structured content that will be passed to buildSpec.
   * Implementations should prefer existing workflow outputs over new LLM calls.
   */
  generateContent: (
    project: CreativeProject,
  ) => Promise<{ content: Record<string, unknown> }>;
  /**
   * Map the generated content + available images to a full CreativeDocumentSpec.
   * coverImageBuffer is the first downloaded image (or null).
   * inlineImages are subsequent images.
   */
  buildSpec: (
    project: CreativeProject,
    content: Record<string, unknown>,
    coverImageBuffer: Buffer | null,
    inlineImages: Array<{ buffer: Buffer; caption?: string }>,
  ) => { spec: CreativeDocumentSpec; report: Record<string, unknown> };
}

// ── Registry — populated by creativeDocumentRegistry.ts via registerDocument() ─

const _registry = new Map<CreativeDocumentType, DocumentDefinition>();

export function registerDocument(definition: DocumentDefinition): void {
  _registry.set(definition.documentType, definition);
}

export function getDocumentDefinition(
  documentType: CreativeDocumentType,
): DocumentDefinition | undefined {
  return _registry.get(documentType);
}

export function getSupportedDocumentTypes(): CreativeDocumentType[] {
  return Array.from(_registry.keys());
}

// ── Structured error codes ────────────────────────────────────────────────────

export class DocumentWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DocumentWorkerError";
  }
}

export const REQUIRED_LOGO_ASSET_MISSING       = "REQUIRED_LOGO_ASSET_MISSING";
export const BRAND_IDENTITY_ASSETS_INCOMPLETE  = "BRAND_IDENTITY_ASSETS_INCOMPLETE";
export const DOCUMENT_CONTENT_MISSING          = "DOCUMENT_CONTENT_MISSING";
export const DOCUMENT_RENDER_FAILED            = "DOCUMENT_RENDER_FAILED";
export const DOCUMENT_UPLOAD_FAILED            = "DOCUMENT_UPLOAD_FAILED";

// ── Image download helper ─────────────────────────────────────────────────────

async function downloadProjectImages(
  projectId: string,
  limit: number,
): Promise<Array<{ buffer: Buffer; caption?: string }>> {
  if (limit <= 0) return [];

  const imageAssets = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, projectId),
        eq(creativeAiAssetsTable.assetType, "image"),
        inArray(creativeAiAssetsTable.status, ["completed", "approved"]),
      ),
    )
    .orderBy(creativeAiAssetsTable.createdAt)
    .limit(limit);

  const downloaded: Array<{ buffer: Buffer; caption?: string }> = [];
  for (const asset of imageAssets) {
    const src = asset.imageUrl ?? (asset.storagePath ? getSupabasePublicUrl(asset.storagePath) : null);
    if (!src) continue;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) throw new Error("empty buffer");
      downloaded.push({ buffer, caption: asset.category ?? undefined });
    } catch (err) {
      logger.warn(
        { err, assetId: asset.id, projectId },
        "[doc-worker] Failed to download image — skipping",
      );
    }
  }
  return downloaded;
}

// ── Project release helper ────────────────────────────────────────────────────

async function releaseProjectIfWaiting(project: CreativeProject): Promise<void> {
  if (project.status === "generating_document") {
    await db
      .update(creativeProjectsTable)
      .set({ status: "completed" })
      .where(eq(creativeProjectsTable.id, project.id));
  }
}

// ── Generic PDF export job ────────────────────────────────────────────────────

interface PdfExportPayload {
  projectId?: number;
  documentType?: string;
}

/**
 * Execute a `pdf_export` job for any registered document type.
 *
 * Callers: jobWorkerService.executeJob() only — never call directly.
 * The job payload must contain a numeric `projectId`.
 *
 * @param job         The AiJob row (status already "running").
 * @param documentType The resolved CreativeDocumentType for this project.
 */
export async function executeGenericPdfExportJob(
  job: AiJob,
  documentType: CreativeDocumentType,
): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson ?? {}) as PdfExportPayload;
  const projectDbId = payload.projectId;
  if (typeof projectDbId !== "number") {
    throw new Error("pdf_export job payload is missing a numeric 'projectId'");
  }

  // ── Load project ────────────────────────────────────────────────────────────
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) {
    throw new Error(`pdf_export: creative project ${projectDbId} not found`);
  }

  // ── Look up definition ──────────────────────────────────────────────────────
  const definition = getDocumentDefinition(documentType);
  if (!definition) {
    throw new WorkerNotImplementedError(
      `pdf_export for document type '${documentType}' (no registered definition)`,
    );
  }

  // ── Idempotency: check for an existing asset ────────────────────────────────
  const [existingAsset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, project.projectId),
        eq(creativeAiAssetsTable.assetType, "document"),
        eq(creativeAiAssetsTable.category, documentType),
      ),
    )
    .orderBy(desc(creativeAiAssetsTable.version))
    .limit(1);

  let targetVersion = 1;
  if (existingAsset) {
    if (existingAsset.status === "completed" && existingAsset.storagePath) {
      const stillThere = await storageObjectExists(existingAsset.storagePath);
      if (stillThere) {
        // Already done — idempotent retry: reuse without re-rendering.
        await releaseProjectIfWaiting(project);
        const meta = (existingAsset.metadata ?? {}) as Record<string, unknown>;
        return {
          jobId:         job.id,
          assetId:       existingAsset.id,
          projectId:     project.projectId,
          documentType,
          storagePath:   existingAsset.storagePath,
          permanentUrl:  existingAsset.imageUrl ?? getSupabasePublicUrl(existingAsset.storagePath),
          mimeType:      "application/pdf",
          version:       existingAsset.version,
          pageCount:     meta["pageCount"] ?? null,
          fileSizeBytes: meta["fileSizeBytes"] ?? null,
          checksum:      meta["checksum"] ?? null,
          reused:        true,
        };
      }
      // Storage object missing — recover at same version.
      targetVersion = existingAsset.version;
    } else {
      // Incomplete prior attempt — continue at same version.
      targetVersion = existingAsset.version;
    }
  }

  // ── Download images ─────────────────────────────────────────────────────────
  // Total download budget: 1 cover + maxInlineImages inline images.
  const totalImageBudget = 1 + definition.maxInlineImages;
  const images = await downloadProjectImages(project.projectId, totalImageBudget);

  // ── Logo requirement check ──────────────────────────────────────────────────
  if (definition.requiresLogo && images.length === 0) {
    throw new DocumentWorkerError(
      REQUIRED_LOGO_ASSET_MISSING,
      `Brand Identity Guideline PDF cannot be generated: no completed logo/image asset ` +
      `found for project ${project.projectId}. ` +
      `The image pipeline must complete successfully before the PDF can be rendered.`,
    );
  }

  // ── Generate / normalize structured content ─────────────────────────────────
  const { content } = await definition.generateContent(project);

  // ── Map to document spec ────────────────────────────────────────────────────
  const coverImageBuffer  = images[0]?.buffer ?? null;
  const inlineImages      = images.slice(1);
  const { spec, report }  = definition.buildSpec(project, content, coverImageBuffer, inlineImages);

  // ── Render ──────────────────────────────────────────────────────────────────
  let buffer: Buffer;
  let pageCount: number;
  let renderDurationMs: number;
  try {
    const rendered = await renderDocument(spec);
    buffer          = rendered.buffer;
    pageCount       = rendered.pageCount;
    renderDurationMs = rendered.renderDurationMs;
  } catch (err) {
    throw new DocumentWorkerError(
      DOCUMENT_RENDER_FAILED,
      `PDF render failed for ${documentType} (project ${project.projectId}): ${String(err)}`,
    );
  }

  validateGeneratedPdf(buffer, pageCount, definition.minimumPageCount);

  // ── Build storage path ──────────────────────────────────────────────────────
  const ownerSlug   = sanitizeStorageFilename(project.brandName || "client") || "client";
  const filename    = `${definition.filenamePrefix}-v${targetVersion}.pdf`;
  const storagePath = `creative-projects/${ownerSlug}/${project.projectId}/${job.id}/documents/${filename}`;

  // ── Upload ──────────────────────────────────────────────────────────────────
  const permanentUrl = await uploadToSupabase(storagePath, buffer, "application/pdf");

  // ── Upload verification ─────────────────────────────────────────────────────
  const verified = await storageObjectExists(storagePath);
  if (!verified) {
    throw new DocumentWorkerError(
      DOCUMENT_UPLOAD_FAILED,
      `pdf_export: upload verification failed — object not found at ${storagePath} right after upload`,
    );
  }

  // ── Checksum + metadata ─────────────────────────────────────────────────────
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const metadata = {
    fileSizeBytes: buffer.length,
    pageCount,
    checksum,
    mimeType:        "application/pdf",
    filename,
    documentType,
    renderDurationMs,
    generatedAt:     new Date().toISOString(),
    generationReport: report,
    finalDeliverable: true,
    temporaryPreview: false,
  };

  // ── Create / update asset record ────────────────────────────────────────────
  let assetId: number;
  if (existingAsset && existingAsset.version === targetVersion) {
    await db
      .update(creativeAiAssetsTable)
      .set({
        status:     "completed",
        storagePath,
        imageUrl:   permanentUrl,
        prompt:     `${documentType} PDF for ${project.brandName}`,
        metadata,
      })
      .where(eq(creativeAiAssetsTable.id, existingAsset.id));
    assetId = existingAsset.id;
  } else {
    const [inserted] = await db
      .insert(creativeAiAssetsTable)
      .values({
        projectId: project.projectId,
        provider:  "internal",
        model:     "creative-document-engine",
        assetType: "document",
        category:  documentType,
        prompt:    `${documentType} PDF for ${project.brandName}`,
        status:    "completed",
        version:   targetVersion,
        storagePath,
        imageUrl:  permanentUrl,
        metadata,
      })
      .returning({ id: creativeAiAssetsTable.id });
    assetId = inserted!.id;
  }

  // ── Audit log ───────────────────────────────────────────────────────────────
  await logAudit(
    "creative-document-engine",
    "pdf_generated",
    project.projectId,
    "creative_project",
    "success",
    {
      assetId,
      documentType,
      pageCount,
      fileSizeBytes: buffer.length,
      version:       targetVersion,
      jobId:         job.id,
      renderDurationMs,
    },
  );

  // ── Release project ─────────────────────────────────────────────────────────
  await releaseProjectIfWaiting(project);

  return {
    jobId:           job.id,
    assetId,
    projectId:       project.projectId,
    documentType,
    storagePath,
    permanentUrl,
    mimeType:        "application/pdf",
    fileSizeBytes:   buffer.length,
    pageCount,
    version:         targetVersion,
    checksum,
    renderDurationMs,
    finalDeliverable: true,
  };
}

/**
 * On final job failure (retries exhausted), flip the project status from
 * "generating_document" → "failed" so it surfaces in admin/customer views.
 */
export async function markProjectDocumentFailed(
  projectDbId: number,
  errorMessage: string,
): Promise<void> {
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));
  if (!project || project.status !== "generating_document") return;

  await db
    .update(creativeProjectsTable)
    .set({ status: "failed" })
    .where(eq(creativeProjectsTable.id, projectDbId));

  await logAudit(
    "creative-document-engine",
    "pdf_export_exhausted",
    project.projectId,
    "creative_project",
    "failure",
    { error: errorMessage },
  );
}
