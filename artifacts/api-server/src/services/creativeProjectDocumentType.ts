/**
 * creativeProjectDocumentType.ts — Phase 2/3 Creative Document Engine
 *
 * Resolves whether a `creative_projects` row is a document-producing project
 * (e.g. Company Profile PDF, Brand Strategy PDF) vs. a plain image/asset
 * project, and which document type it maps to.
 *
 * A project is document-producing only when it came through the service
 * catalog (sourceType === "service_catalog") and its linked `ai_services`
 * row has a known documentType-bearing serviceCode. Legacy/direct projects
 * never produce documents — only the original image/creative-brief pipeline.
 *
 * Phase 3: Added brand_strategy, copywriting, creative_consultation,
 *          brand_identity_guideline.
 */

import { eq } from "drizzle-orm";
import { db, aiServiceRequestsTable, aiServicesTable, type CreativeProject } from "@workspace/db";

// ── Document type union ───────────────────────────────────────────────────────

export type CreativeDocumentType =
  | "company_profile"
  | "brand_strategy"
  | "copywriting"
  | "creative_consultation"
  | "brand_identity_guideline"
  | "fashion_design"
  | "interior_design"
  | "ebook";

/**
 * Maps a catalog `serviceCode` to the document type its PDF export worker
 * should handle. Add new entries here as more document types get built —
 * each new entry must have a matching definition in DOCUMENT_DEFINITIONS
 * inside creativeDocumentWorkerService.ts.
 */
export const SERVICE_CODE_TO_DOCUMENT_TYPE: Readonly<Record<string, CreativeDocumentType>> = {
  "company-profile":        "company_profile",
  "brand-strategy":         "brand_strategy",
  "copywriting":            "copywriting",
  "creative-consultation":  "creative_consultation",
  "brand-identity":         "brand_identity_guideline",
  "fashion-design":         "fashion_design",
  "fashion-brand-brief":    "fashion_design",
  "interior-design":        "interior_design",
  "interior-concept-design":"interior_design",
  "ebook":                  "ebook",
};

/**
 * Resolve the document type for a creative project, or `null` if this
 * project does not produce a document (e.g. a plain visual-identity project).
 */
export async function resolveProjectDocumentType(
  project: Pick<CreativeProject, "sourceType" | "serviceRequestId">,
): Promise<CreativeDocumentType | null> {
  if (project.sourceType !== "service_catalog" || !project.serviceRequestId) {
    return null;
  }

  const [request] = await db
    .select({ serviceId: aiServiceRequestsTable.serviceId })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, project.serviceRequestId))
    .limit(1);

  if (!request) return null;

  const [service] = await db
    .select({ serviceCode: aiServicesTable.serviceCode })
    .from(aiServicesTable)
    .where(eq(aiServicesTable.id, request.serviceId))
    .limit(1);

  if (!service) return null;

  return SERVICE_CODE_TO_DOCUMENT_TYPE[service.serviceCode] ?? null;
}
