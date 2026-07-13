/**
 * companyProfilePdfWorkerService.ts — Phase 2/3 Creative Document Engine
 *
 * Thin compatibility shim. The pdf_export job for company_profile is now
 * handled by the Phase 3 generic worker (creativeDocumentWorkerService.ts)
 * via the companyProfileDefinition registered in creativeDocumentRegistry.ts.
 *
 * This file is kept for:
 *   - Backward compatibility with existing imports (tests, job dispatcher)
 *   - Re-exporting markProjectDocumentFailed (used by jobDispatcherService)
 *
 * The original implementation is intact in companyProfileDocumentMapper.ts
 * (content generation) and mappers/companyProfileMapperAdapter.ts (registry).
 */

export { markProjectDocumentFailed } from "./creativeDocumentWorkerService.js";

/**
 * @deprecated Use executeGenericPdfExportJob() from creativeDocumentWorkerService.ts.
 * Kept for any external callers that imported this directly.
 */
export async function executeCompanyProfilePdfExportJob(
  job: import("@workspace/db").AiJob,
): Promise<Record<string, unknown>> {
  const { executeGenericPdfExportJob } = await import("./creativeDocumentWorkerService.js");
  const { initDocumentRegistry } = await import("./creativeDocumentRegistry.js");
  initDocumentRegistry();
  return executeGenericPdfExportJob(job, "company_profile");
}
