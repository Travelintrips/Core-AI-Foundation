/**
 * creativeProjectDocumentType.ts — Phase 2 Creative Document Engine
 *
 * Resolves whether a `creative_projects` row is a document-producing project
 * (e.g. Company Profile PDF) vs. a plain image/asset project, and which
 * document type it maps to.
 *
 * A project is document-producing only when it came through the service
 * catalog (sourceType === "service_catalog") and its linked `ai_services`
 * row has a known documentType-bearing serviceCode. Legacy/direct projects
 * never produce documents — only the original image/creative-brief pipeline.
 */

import { eq } from "drizzle-orm";
import { db, aiServiceRequestsTable, aiServicesTable, type CreativeProject } from "@workspace/db";

/**
 * Maps a catalog `serviceCode` to the document type its PDF export worker
 * should handle. Add new entries here as more document types get built —
 * each new entry must have a matching branch in the pdf_export dispatcher.
 */
const SERVICE_CODE_TO_DOCUMENT_TYPE: Readonly<Record<string, string>> = {
  "company-profile": "company_profile",
};

/**
 * Resolve the document type for a creative project, or `null` if this
 * project does not produce a document (e.g. a plain visual-identity project).
 */
export async function resolveProjectDocumentType(
  project: Pick<CreativeProject, "sourceType" | "serviceRequestId">,
): Promise<string | null> {
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
