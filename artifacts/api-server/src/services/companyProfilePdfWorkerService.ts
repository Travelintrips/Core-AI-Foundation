/**
 * companyProfilePdfWorkerService.ts — Phase 2 Creative Document Engine
 *
 * Implements the `pdf_export` job worker for documentType "company_profile".
 * Invoked by jobWorkerService.executeJob() — never call this directly outside
 * the job dispatcher (it assumes it owns the job's lifecycle bookkeeping).
 *
 * Pipeline:
 *   1. Load the creative project + confirm it resolves to documentType "company_profile"
 *   2. Idempotency check against creative_ai_assets (reuse valid existing asset,
 *      recover from a missing storage object, or start a fresh version)
 *   3. Generate structured company-profile content (LLM call) from the brief +
 *      existing text-pipeline outputs (brand strategy / copy)
 *   4. Download up to 3 completed image assets to embed as cover/inline images
 *      (a failed image download is skipped, never fatal to the whole document)
 *   5. Render the PDF, validate it (magic bytes, min size, min page count)
 *   6. Upload to Supabase Storage at a deterministic path, verify the object exists
 *   7. Create or supersede the creative_ai_assets record for this document
 *   8. Mark the project completed (only if it was waiting on this document)
 *
 * Returns a result object satisfying jobCompletionGuard's requirements for
 * `pdf_export` (`storagePath` + `permanentUrl`, both valid, permanentUrl http(s)).
 */

import { eq, and, inArray, desc } from "drizzle-orm";
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
import { resolveProjectDocumentType } from "./creativeProjectDocumentType.js";
import {
  generateCompanyProfileContent,
  mapCompanyProfileToDocumentSpec,
  type CompanyProfileBrief,
} from "./companyProfileDocumentMapper.js";
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

interface PdfExportPayload {
  projectId?: number;
}

const MAX_INLINE_IMAGES = 3;

function buildBrief(project: CreativeProject): CompanyProfileBrief {
  return {
    brandName: project.brandName,
    businessType: project.businessType,
    targetMarket: project.targetMarket,
    productOrService: project.productOrService,
    goal: project.goal,
    notes: project.notes,
    colorPreference: project.colorPreference,
    stylePreference: project.stylePreference,
  };
}

/** Downloads completed image assets for a project into buffers, skipping any that fail. */
async function downloadProjectImages(
  projectId: string,
): Promise<Array<{ buffer: Buffer; caption?: string }>> {
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
    .limit(MAX_INLINE_IMAGES);

  const downloaded: Array<{ buffer: Buffer; caption?: string }> = [];
  for (const asset of imageAssets) {
    const src = asset.imageUrl ?? (asset.storagePath ? getSupabasePublicUrl(asset.storagePath) : null);
    if (!src) continue;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) throw new Error("empty image buffer");
      downloaded.push({ buffer });
    } catch (err) {
      logger.warn(
        { err, assetId: asset.id, projectId },
        "[pdf-export] Failed to download image asset — continuing without it",
      );
    }
  }
  return downloaded;
}

/** Marks a project completed once its blocking document has been produced. */
async function releaseProjectIfWaiting(project: CreativeProject): Promise<void> {
  if (project.status === "generating_document") {
    await db
      .update(creativeProjectsTable)
      .set({ status: "completed" })
      .where(eq(creativeProjectsTable.id, project.id));
  }
}

export async function executeCompanyProfilePdfExportJob(
  job: AiJob,
): Promise<Record<string, unknown>> {
  const payload = (job.payloadJson ?? {}) as PdfExportPayload;
  const projectDbId = payload.projectId;
  if (typeof projectDbId !== "number") {
    throw new Error("pdf_export job payload is missing a numeric 'projectId'");
  }

  const [project] = await db
    .select()
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.id, projectDbId));

  if (!project) {
    throw new Error(`pdf_export: creative project ${projectDbId} not found`);
  }

  const documentType = await resolveProjectDocumentType(project);
  if (documentType !== "company_profile") {
    throw new WorkerNotImplementedError(
      `pdf_export for document type '${documentType ?? "unknown"}'`,
    );
  }

  // ── Idempotency: look up the latest document asset already on record ──────
  const [existingAsset] = await db
    .select()
    .from(creativeAiAssetsTable)
    .where(
      and(
        eq(creativeAiAssetsTable.projectId, project.projectId),
        eq(creativeAiAssetsTable.assetType, "document"),
        eq(creativeAiAssetsTable.category, "company_profile"),
      ),
    )
    .orderBy(desc(creativeAiAssetsTable.version))
    .limit(1);

  let targetVersion = 1;
  if (existingAsset) {
    if (existingAsset.status === "completed" && existingAsset.storagePath) {
      const stillThere = await storageObjectExists(existingAsset.storagePath);
      if (stillThere) {
        // Safe to reuse — retried jobs (e.g. dispatcher timeout after a
        // successful upload) must not regenerate or duplicate the asset.
        await releaseProjectIfWaiting(project);
        return {
          jobId: job.id,
          assetId: existingAsset.id,
          projectId: project.projectId,
          storagePath: existingAsset.storagePath,
          permanentUrl: existingAsset.imageUrl ?? getSupabasePublicUrl(existingAsset.storagePath),
          mimeType: "application/pdf",
          version: existingAsset.version,
          reused: true,
        };
      }
      // Storage object went missing (e.g. bucket cleared) — this is a
      // recovery, not a legitimate revision, so keep the same version number.
      targetVersion = existingAsset.version;
    } else {
      // A previous attempt left a non-completed row (e.g. crashed mid-upload) —
      // finish that same version rather than creating an orphan duplicate.
      targetVersion = existingAsset.version;
    }
  }

  const brief = buildBrief(project);
  const aggregated = (project.result ?? {}) as Record<string, unknown>;

  const images = await downloadProjectImages(project.projectId);
  const coverImageBuffer = images[0]?.buffer ?? null;
  const inlineImages = images.slice(1);

  const { content } = await generateCompanyProfileContent(
    brief,
    {
      copy: aggregated["copy"] as Record<string, unknown> | undefined,
      brandStrategy: aggregated["brandStrategy"] as Record<string, unknown> | undefined,
    },
    project.projectId,
    project.id,
  );

  const { spec } = mapCompanyProfileToDocumentSpec(brief, content, coverImageBuffer, inlineImages);

  const { buffer, pageCount, renderDurationMs } = await renderDocument(spec);
  validateGeneratedPdf(buffer, pageCount, 3);

  const ownerSlug = sanitizeStorageFilename(project.brandName || "client") || "client";
  const filename = `company-profile-v${targetVersion}.pdf`;
  const storagePath = `creative-projects/${ownerSlug}/${project.projectId}/${job.id}/documents/${filename}`;

  const permanentUrl = await uploadToSupabase(storagePath, buffer, "application/pdf");

  const uploaded = await storageObjectExists(storagePath);
  if (!uploaded) {
    throw new Error(
      `pdf_export: upload verification failed — object not found at ${storagePath} right after upload`,
    );
  }

  const checksum = createHash("sha256").update(buffer).digest("hex");
  const metadata = {
    fileSizeBytes: buffer.length,
    pageCount,
    checksum,
    mimeType: "application/pdf",
    filename,
    renderDurationMs,
    generatedAt: new Date().toISOString(),
  };

  let assetId: number;
  if (existingAsset && existingAsset.version === targetVersion) {
    await db
      .update(creativeAiAssetsTable)
      .set({
        status: "completed",
        storagePath,
        imageUrl: permanentUrl,
        prompt: `Company Profile PDF for ${brief.brandName}`,
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
        model: "creative-document-engine",
        assetType: "document",
        category: "company_profile",
        prompt: `Company Profile PDF for ${brief.brandName}`,
        status: "completed",
        version: targetVersion,
        storagePath,
        imageUrl: permanentUrl,
        metadata,
      })
      .returning({ id: creativeAiAssetsTable.id });
    assetId = inserted!.id;
  }

  await logAudit(
    "creative-document-engine",
    "pdf_generated",
    project.projectId,
    "creative_project",
    "success",
    { assetId, pageCount, fileSizeBytes: buffer.length, version: targetVersion, jobId: job.id },
  );

  await releaseProjectIfWaiting(project);

  return {
    jobId: job.id,
    assetId,
    projectId: project.projectId,
    storagePath,
    permanentUrl,
    mimeType: "application/pdf",
    fileSizeBytes: buffer.length,
    pageCount,
    version: targetVersion,
    checksum,
    renderDurationMs,
    finalDeliverable: true,
  };
}

/**
 * On a job's final failed attempt (retries exhausted), the project must not
 * stay silently stuck in "generating_document" forever — flip it to "failed"
 * so it surfaces in admin/customer views instead of looking like a hang.
 */
export async function markProjectDocumentFailed(projectDbId: number, errorMessage: string): Promise<void> {
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
