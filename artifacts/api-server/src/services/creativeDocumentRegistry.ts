/**
 * creativeDocumentRegistry.ts — Phase 3 Creative Document Engine
 *
 * Registers all DocumentDefinitions into the generic worker registry.
 * Import this module once at server startup (or from jobWorkerService.ts)
 * to ensure all definitions are available before any pdf_export job runs.
 *
 * To add a new document type:
 *   1. Create a mapper in services/mappers/
 *   2. Export a DocumentDefinition from it
 *   3. Import and call registerDocument() here
 */

import { registerDocument } from "./creativeDocumentWorkerService.js";
import { companyProfileDefinition }          from "./mappers/companyProfileMapperAdapter.js";
import { brandStrategyDefinition }           from "./mappers/brandStrategyDocumentMapper.js";
import { copywritingDefinition }             from "./mappers/copywritingDocumentMapper.js";
import { creativeConsultationDefinition }    from "./mappers/creativeConsultationDocumentMapper.js";
import { brandIdentityGuidelineDefinition }  from "./mappers/brandIdentityGuidelineDocumentMapper.js";

/** Call once at startup to register all document type definitions. */
export function initDocumentRegistry(): void {
  registerDocument(companyProfileDefinition);
  registerDocument(brandStrategyDefinition);
  registerDocument(copywritingDefinition);
  registerDocument(creativeConsultationDefinition);
  registerDocument(brandIdentityGuidelineDefinition);
}
