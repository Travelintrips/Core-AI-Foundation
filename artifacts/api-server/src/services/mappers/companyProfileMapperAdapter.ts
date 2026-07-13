/**
 * companyProfileMapperAdapter.ts — Phase 3 Creative Document Engine
 *
 * Wraps the existing Phase 2 companyProfileDocumentMapper into the
 * Phase 3 DocumentDefinition contract, so the generic worker can
 * handle company_profile alongside all new document types.
 *
 * The original companyProfileDocumentMapper.ts is UNCHANGED —
 * this adapter is the only new file that touches it.
 */

import type { CreativeProject } from "@workspace/db";
import type { DocumentDefinition } from "../creativeDocumentWorkerService.js";
import {
  generateCompanyProfileContent,
  mapCompanyProfileToDocumentSpec,
  type CompanyProfileBrief,
} from "../companyProfileDocumentMapper.js";

function buildBrief(project: CreativeProject): CompanyProfileBrief {
  return {
    brandName:        project.brandName,
    businessType:     project.businessType,
    targetMarket:     project.targetMarket,
    productOrService: project.productOrService,
    goal:             project.goal,
    notes:            project.notes,
    colorPreference:  project.colorPreference,
    stylePreference:  project.stylePreference,
  };
}

export const companyProfileDefinition: DocumentDefinition = {
  documentType:     "company_profile",
  filenamePrefix:   "company-profile",
  minimumPageCount: 3,
  requiresLogo:     false,
  maxInlineImages:  2,

  generateContent: async (project) => {
    const brief       = buildBrief(project);
    const aggregated  = (project.result ?? {}) as Record<string, unknown>;
    const { content, llmUsage } = await generateCompanyProfileContent(
      brief,
      {
        copy:          aggregated["copy"]          as Record<string, unknown> | undefined,
        brandStrategy: aggregated["brandStrategy"] as Record<string, unknown> | undefined,
      },
      project.projectId,
      project.id,
    );
    return { content: { ...content, _llmUsage: llmUsage } as unknown as Record<string, unknown> };
  },

  buildSpec: (project, rawContent, coverImageBuffer, inlineImages) => {
    const brief   = buildBrief(project);
    // Strip the injected _llmUsage before passing to the mapper.
    // Double-cast is necessary: mapCompanyProfileToDocumentSpec expects the
    // typed CompanyProfileContent, but the generic worker stores it as
    // Record<string,unknown>. The content was produced by generateCompanyProfileContent
    // so the runtime shape is correct — only the static type needs bridging.
    const { _llmUsage: _ignored, ...contentRest } = rawContent as { _llmUsage?: unknown } & Record<string, unknown>;
    const { spec, report } = mapCompanyProfileToDocumentSpec(
      brief,
      contentRest as unknown as Parameters<typeof mapCompanyProfileToDocumentSpec>[1],
      coverImageBuffer,
      inlineImages,
    );
    return { spec, report: report as unknown as Record<string, unknown> };
  },
};
