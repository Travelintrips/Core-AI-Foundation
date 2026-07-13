/**
 * creativePresentationWorkerService.ts — Phase 4 Presentation Engine
 *
 * Generic PPTX export worker, structurally mirroring creativeDocumentWorkerService.ts
 * but for presentations (PPTX + spec-rendered PDF preview + thumbnail), kept as a
 * SEPARATE registry/pipeline so presentations never mix with the Document Engine.
 *
 * Pipeline:
 *   1. Load creative project
 *   2. Look up PresentationDefinition from registry
 *   3. Idempotency: reuse valid existing PPTX asset or recover missing storage object
 *   4. Download completed image assets (logo + supporting visuals)
 *   5. Generate / normalize structured content (no fabricated facts)
 *   6. Map to CreativePresentationSpec
 *   7. Render PPTX → validate → upload → verify
 *   8. Render PDF preview (honest fallback) → upload → verify
 *   9. Render thumbnail → upload → verify
 *  10. Create/update creative_ai_assets rows for all three deliverables
 *  11. Audit log + release project
 *  12. Return rich completion result (PPTX is the primary/required asset)
 *
 * Error codes:
 *   PRESENTATION_CONTENT_MISSING   — required workflow output absent from project.result
 *   PRESENTATION_RENDER_FAILED     — pptxgenjs render threw or validation failed
 *   PRESENTATION_UPLOAD_FAILED     — upload succeeded but post-upload verify failed
 *   PRESENTATION_PREVIEW_FAILED    — PDF preview or thumbnail generation failed (non-fatal —
 *                                    logged, but never blocks the PPTX deliverable itself)
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
import { logAudit } from "../aiAuditService.js";
import { logger } from "../../lib/logger.js";
import { WorkerNotImplementedError } from "../jobCompletionGuard.js";
import type { CreativePresentationType } from "./presentationTypes.js";
import type { CreativePresentationSpec } from "./presentationTypes.js";
import { renderPresentation } from "./presentationRenderService.js";
import { validateGeneratedPresentation, PPTX_MIME } from "./presentationValidationService.js";
import { generatePresentationPdfPreview } from "./presentationPdfPreviewService.js";
import { generatePresentationThumbnail } from "./presentationThumbnailService.js";
import {
  uploadToSupabase,
  storageObjectExists,
  getSupabasePublicUrl,
} from "../../lib/supabaseStorage.js";

// ── Presentation definition contract ──────────────────────────────────────────

export interface PresentationDefinition {
  presentationType: CreativePresentationType;
  filenamePrefix: string;
  minimumSlideCount: number;
  maximumSlideCount: number;
  requiresLogo: boolean;
  maxInlineImages: number;
  generateContent: (
    project: CreativeProject,
  ) => Promise<{ content: Record<string, unknown> }>;
  buildSpec: (
    project: CreativeProject,
    content: Record<string, unknown>,
    logoBuffer: Buffer | null,
    inlineImages: Array<{ buffer: Buffer; caption?: string }>,
  ) => { spec: CreativePresentationSpec; report: Record<string, unknown> };
}

// ── Registry ───────────────────────────────────────────────────────────────────

const _registry = new Map<CreativePresentationType, PresentationDefinition>();

export function registerPresentation(definition: PresentationDefinition): void {
  _registry.set(definition.presentationType, definition);
}

export function getPresentationDefinition(
  presentationType: CreativePresentationType,
): PresentationDefinition | undefined {
  return _registry.get(presentationType);
}

export function getSupportedPresentationTypes(): CreativePresentationType[] {
  return Array.from(_registry.keys());
}

// ── Structured error codes ────────────────────────────────────────────────────

export class PresentationWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PresentationWorkerError";
  }
}

export const PRESENTATION_CONTENT_MISSING = "PRESENTATION_CONTENT_MISSING";
export const PRESENTATION_RENDER_FAILED   = "PRESENTATION_RENDER_FAILED";
export const PRESENTATION_UPLOAD_FAILED   = "PRESENTATION_UPLOAD_FAILED";
export const PRESENTATION_PREVIEW_FAILED  = "PRESENTATION_PREVIEW_FAILED";

// ── Image download helper (mirrors Document Engine's) ─────────────────────────

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
        "[presentation-worker] Failed to download image — skipping",
      );
    }
  }
  return downloaded;
}

async function releaseProjectIfWaiting(project: CreativeProject): Promise<void> {
  if (project.status === "generating_presentation") {
    await db
      .update(creativeProjectsTable)
      .set({ status: "completed" })
      .where(eq(creativeProjectsTable.id, project.id));
  }
}

function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uploadAndVerify(path: string, buffer: Buffer, contentType: string): Promise<string> {
  const url = await uploadToSupabase(path, buffer, contentType);
  const verified = await storageObjectExists(path);
  if (!verified) {
    throw new PresentationWorkerError(
      PRESENTATION_UPLOAD_FAILED,
      `Upload verification failed — object not found at ${path} right after upload`,
    );
  }
  return url;
}

// ── Generic PPTX export job ───────────────────────────────────────────────────

interface PptxExportPayload {
  projectId?: number;
  presentationType?: string;
}

export interface PresentationExportResult {
  jobId: number;
  assetId: number;
  projectId: string;
  presentationType: CreativePresentationType;
  storagePath: string;
  permanentUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  slideCount: number;
  version: number;
  checksum: string;
  renderDurationMs: number;
  finalDeliverable: true;
  pdfPreview: { storagePath: string; permanentUrl: string; conversionStrategy: string; pageCount: number } | null;
  thumbnail: { storagePath: string; permanentUrl: string } | null;
  reused?: boolean;
}

/**
 * Execute a `pptx_export` job for any registered presentation type.
 * Callers: jobWorkerService.executeJob() only — never call directly.
 */
export async function executeGenericPresentationExportJob(
  job: AiJob,
  presentationType: CreativePresentationType,
): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson ?? {}) as PptxExportPayload;
  const projectDbId = payload.projectId;
  if (typeof projectDbId !== "number") {
    throw new Error("pptx_export job payload is missing a numeric 'projectId'");
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) {
    throw new Error(`pptx_export: creative project ${projectDbId} not found`);
  }

  const definition = getPresentationDefinition(presentationType);
  if (!definition) {
    throw new WorkerNotImplementedError(
      `pptx_export for presentation type '${presentationType}' (no registered definition)`,
    );
  }

  // ── Idempotency ──────────────────────────────────────────────────────────────
  const [existingAsset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, project.projectId),
        eq(creativeAiAssetsTable.assetType, "presentation"),
        eq(creativeAiAssetsTable.category, presentationType),
      ),
    )
    .orderBy(desc(creativeAiAssetsTable.version))
    .limit(1);

  let targetVersion = 1;
  if (existingAsset) {
    if (existingAsset.status === "completed" && existingAsset.storagePath) {
      const stillThere = await storageObjectExists(existingAsset.storagePath);
      if (stillThere) {
        await releaseProjectIfWaiting(project);
        const meta = (existingAsset.metadata ?? {}) as Record<string, unknown>;
        return {
          jobId: job.id,
          assetId: existingAsset.id,
          projectId: project.projectId,
          presentationType,
          storagePath: existingAsset.storagePath,
          permanentUrl: existingAsset.imageUrl ?? getSupabasePublicUrl(existingAsset.storagePath),
          mimeType: PPTX_MIME,
          version: existingAsset.version,
          slideCount: meta["slideCount"] ?? null,
          fileSizeBytes: meta["fileSizeBytes"] ?? null,
          checksum: meta["checksum"] ?? null,
          pdfPreview: meta["pdfPreview"] ?? null,
          thumbnail: meta["thumbnail"] ?? null,
          reused: true,
          finalDeliverable: true,
        };
      }
      targetVersion = existingAsset.version;
    } else {
      targetVersion = existingAsset.version;
    }
  }

  // ── Images ───────────────────────────────────────────────────────────────────
  const totalImageBudget = 1 + definition.maxInlineImages;
  const images = await downloadProjectImages(project.projectId, totalImageBudget);

  if (definition.requiresLogo && images.length === 0) {
    logger.warn(
      { projectId: project.projectId },
      "[presentation-worker] No logo/image asset available — cover slide will render without a logo mark",
    );
  }

  // ── Content + spec ───────────────────────────────────────────────────────────
  const { content } = await definition.generateContent(project);
  const logoBuffer = images[0]?.buffer ?? null;
  const inlineImages = images.slice(1);
  const { spec, report } = definition.buildSpec(project, content, logoBuffer, inlineImages);

  if (spec.slides.length === 0) {
    throw new PresentationWorkerError(
      PRESENTATION_CONTENT_MISSING,
      `No slides could be built for ${presentationType} (project ${project.projectId}) — required workflow output is missing`,
    );
  }

  // ── Render PPTX ──────────────────────────────────────────────────────────────
  let renderResult;
  try {
    renderResult = await renderPresentation(spec);
  } catch (err) {
    throw new PresentationWorkerError(
      PRESENTATION_RENDER_FAILED,
      `PPTX render failed for ${presentationType} (project ${project.projectId}): ${String(err)}`,
    );
  }

  let validation;
  try {
    validation = await validateGeneratedPresentation(
      renderResult.buffer,
      renderResult.slideCount,
      definition.minimumSlideCount,
    );
  } catch (err) {
    throw new PresentationWorkerError(PRESENTATION_RENDER_FAILED, String(err));
  }

  const ownerSlug = sanitizeSlug(project.brandName || "client") || "client";
  const basePath = `creative-projects/${ownerSlug}/${project.projectId}/${job.id}/presentations`;
  const pptxFilename = `${definition.filenamePrefix}-v${targetVersion}.pptx`;
  const pptxStoragePath = `${basePath}/${pptxFilename}`;

  const pptxUrl = await uploadAndVerify(pptxStoragePath, renderResult.buffer, PPTX_MIME);
  const checksum = createHash("sha256").update(renderResult.buffer).digest("hex");

  // ── PDF preview (non-fatal on failure) ────────────────────────────────────────
  let pdfPreviewMeta: { storagePath: string; permanentUrl: string; conversionStrategy: string; pageCount: number } | null = null;
  try {
    const preview = await generatePresentationPdfPreview(spec);
    const previewPath = `${basePath}/${definition.filenamePrefix}-v${targetVersion}-preview.pdf`;
    const previewUrl = await uploadAndVerify(previewPath, preview.buffer, "application/pdf");
    pdfPreviewMeta = {
      storagePath: previewPath,
      permanentUrl: previewUrl,
      conversionStrategy: preview.conversionStrategy,
      pageCount: preview.pageCount,
    };
  } catch (err) {
    logger.warn({ err, projectId: project.projectId }, "[presentation-worker] PDF preview generation failed — PPTX deliverable unaffected");
  }

  // ── Thumbnail (non-fatal on failure) ─────────────────────────────────────────
  let thumbnailMeta: { storagePath: string; permanentUrl: string } | null = null;
  try {
    const thumb = await generatePresentationThumbnail(spec);
    const thumbPath = `${basePath}/${definition.filenamePrefix}-v${targetVersion}-thumb.webp`;
    const thumbUrl = await uploadAndVerify(thumbPath, thumb.buffer, "image/webp");
    thumbnailMeta = { storagePath: thumbPath, permanentUrl: thumbUrl };
  } catch (err) {
    logger.warn({ err, projectId: project.projectId }, "[presentation-worker] Thumbnail generation failed — PPTX deliverable unaffected");
  }

  const metadata = {
    fileSizeBytes: renderResult.buffer.length,
    slideCount: validation.slideCount,
    checksum,
    mimeType: PPTX_MIME,
    filename: pptxFilename,
    presentationType,
    renderDurationMs: renderResult.renderDurationMs,
    continuationSlidesCreated: renderResult.continuationSlidesCreated,
    generatedAt: new Date().toISOString(),
    generationReport: report,
    finalDeliverable: true,
    temporaryPreview: false,
    pdfPreview: pdfPreviewMeta,
    thumbnail: thumbnailMeta,
  };

  let assetId: number;
  if (existingAsset && existingAsset.version === targetVersion) {
    await db
      .update(creativeAiAssetsTable)
      .set({
        status: "completed",
        storagePath: pptxStoragePath,
        imageUrl: pptxUrl,
        prompt: `${presentationType} PPTX for ${project.brandName}`,
        metadata,
      })
      .where(eq(creativeAiAssetsTable.id, existingAsset.id));
    assetId = existingAsset.id;
  } else {
    const [inserted] = await db
      .insert(creativeAiAssetsTable)
      .values({
        projectId: project.projectId,
        provider: "internal",
        model: "creative-presentation-engine",
        assetType: "presentation",
        category: presentationType,
        prompt: `${presentationType} PPTX for ${project.brandName}`,
        status: "completed",
        version: targetVersion,
        storagePath: pptxStoragePath,
        imageUrl: pptxUrl,
        metadata,
      })
      .returning({ id: creativeAiAssetsTable.id });
    assetId = inserted!.id;
  }

  await logAudit(
    "creative-presentation-engine",
    "pptx_generated",
    project.projectId,
    "creative_project",
    "success",
    {
      assetId,
      presentationType,
      slideCount: validation.slideCount,
      fileSizeBytes: renderResult.buffer.length,
      version: targetVersion,
      jobId: job.id,
      renderDurationMs: renderResult.renderDurationMs,
      pdfPreviewGenerated: pdfPreviewMeta !== null,
      thumbnailGenerated: thumbnailMeta !== null,
    },
  );

  await releaseProjectIfWaiting(project);

  const result: PresentationExportResult = {
    jobId: job.id,
    assetId,
    projectId: project.projectId,
    presentationType,
    storagePath: pptxStoragePath,
    permanentUrl: pptxUrl,
    mimeType: PPTX_MIME,
    fileSizeBytes: renderResult.buffer.length,
    slideCount: validation.slideCount,
    version: targetVersion,
    checksum,
    renderDurationMs: renderResult.renderDurationMs,
    finalDeliverable: true,
    pdfPreview: pdfPreviewMeta,
    thumbnail: thumbnailMeta,
  };
  return result as unknown as Record<string, unknown>;
}

/**
 * On final job failure (retries exhausted), flip the project status from
 * "generating_presentation" → "failed" so it surfaces in admin/customer views.
 */
export async function markProjectPresentationFailed(
  projectDbId: number,
  errorMessage: string,
): Promise<void> {
  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));
  if (!project || project.status !== "generating_presentation") return;

  await db
    .update(creativeProjectsTable)
    .set({ status: "failed" })
    .where(eq(creativeProjectsTable.id, projectDbId));

  await logAudit(
    "creative-presentation-engine",
    "pptx_export_exhausted",
    project.projectId,
    "creative_project",
    "failure",
    { error: errorMessage },
  );
}
