/**
 * companyProfileMapperAdapter.ts — Company Profile Full Sprint, Workstream 2 (P1)
 *
 * Wraps companyProfileDocumentMapper into the Phase 3 DocumentDefinition contract.
 *
 * P1 additions:
 *   - Loads ai_service_requests.brief_json via project.serviceRequestId and
 *     merges all 27 cp* fields into CompanyProfileBrief
 *   - Loads ai_service_packages for the request's packageId to determine
 *     packageLevel and enforce minimum page count (package enforcement)
 *   - Falls back gracefully to generic project columns for legacy projects
 *     that predate the P0 brief wizard
 */

import { eq } from "drizzle-orm";
import {
  db,
  aiServiceRequestsTable,
  aiServicePackagesTable,
  type CreativeProject,
} from "@workspace/db";
import type { DocumentDefinition } from "../creativeDocumentWorkerService.js";
import {
  generateCompanyProfileContent,
  mapCompanyProfileToDocumentSpec,
  PACKAGE_PAGE_TARGETS,
  type CompanyProfileBrief,
} from "../companyProfileDocumentMapper.js";

// ── Package level → minimum page count mapping ────────────────────────────────
// Used to override the static minimumPageCount on the definition when we know
// the package tier at generation time.
const MINIMUM_PAGES_BY_LEVEL: Record<string, number> = {
  starter:      3,
  professional: 5,
  business:     8,
  enterprise:   12,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Load brief_json from ai_service_requests and package info from
 * ai_service_packages. Returns empty defaults for legacy projects where
 * serviceRequestId is null.
 */
async function loadRequestContext(project: CreativeProject): Promise<{
  cpFields: Record<string, unknown>;
  packageLevel: string;
  packageName: string;
  minimumPageCount: number;
  pageTarget: number;
}> {
  const defaults = {
    cpFields: {},
    packageLevel: "starter",
    packageName: "Starter",
    minimumPageCount: 3,
    pageTarget: PACKAGE_PAGE_TARGETS["starter"] ?? 5,
  };

  if (!project.serviceRequestId) return defaults;

  const [sr] = await db
    .select({
      briefJson: aiServiceRequestsTable.briefJson,
      packageId: aiServiceRequestsTable.packageId,
    })
    .from(aiServiceRequestsTable)
    .where(eq(aiServiceRequestsTable.id, project.serviceRequestId))
    .limit(1);

  if (!sr) return defaults;

  const cpFields = (sr.briefJson ?? {}) as Record<string, unknown>;

  if (!sr.packageId) {
    return { ...defaults, cpFields };
  }

  const [pkg] = await db
    .select({
      packageName: aiServicePackagesTable.packageName,
      packageLevel: aiServicePackagesTable.packageLevel,
      limitsJson: aiServicePackagesTable.limitsJson,
    })
    .from(aiServicePackagesTable)
    .where(eq(aiServicePackagesTable.id, sr.packageId))
    .limit(1);

  if (!pkg) return { ...defaults, cpFields };

  const level = pkg.packageLevel ?? "starter";
  const minPages = MINIMUM_PAGES_BY_LEVEL[level] ?? 3;
  const pageTarget = PACKAGE_PAGE_TARGETS[level] ?? 5;

  return {
    cpFields,
    packageLevel: level,
    packageName: pkg.packageName,
    minimumPageCount: minPages,
    pageTarget,
  };
}

/**
 * Merge generic CreativeProject columns with cp* fields from brief_json
 * into a CompanyProfileBrief. cp* fields take precedence over generic
 * project columns for contact and identity information.
 */
function buildEnrichedBrief(
  project: CreativeProject,
  cpFields: Record<string, unknown>,
  packageLevel: string,
  packageName: string,
): CompanyProfileBrief {
  return {
    // Generic project columns (always present)
    brandName:        project.brandName,
    businessType:     project.businessType,
    targetMarket:     project.targetMarket,
    productOrService: project.productOrService,
    goal:             project.goal,
    notes:            project.notes,
    colorPreference:  project.colorPreference,
    stylePreference:  project.stylePreference,
    // P0/P1: cp* fields from brief_json
    cpLegalName:          safeStr(cpFields["cpLegalName"]),
    cpCompanyHistory:     safeStr(cpFields["cpCompanyHistory"]),
    cpVision:             safeStr(cpFields["cpVision"]),
    cpMission:            safeStr(cpFields["cpMission"]),
    cpCompanyValues:      safeStr(cpFields["cpCompanyValues"]),
    cpValueProposition:   safeStr(cpFields["cpValueProposition"]),
    cpProductsServices:   safeStr(cpFields["cpProductsServices"]),
    cpGeographicCoverage: safeStr(cpFields["cpGeographicCoverage"]),
    cpFacilities:         safeStr(cpFields["cpFacilities"]),
    cpProductionCapacity: safeStr(cpFields["cpProductionCapacity"]),
    cpCertifications:     safeStr(cpFields["cpCertifications"]),
    cpLegalDocuments:     safeStr(cpFields["cpLegalDocuments"]),
    cpOrganizationStructure: safeStr(cpFields["cpOrganizationStructure"]),
    cpKeyPeople:          safeStr(cpFields["cpKeyPeople"]),
    cpClientsPartners:    safeStr(cpFields["cpClientsPartners"]),
    cpProjectExperience:  safeStr(cpFields["cpProjectExperience"]),
    cpQualityAssurance:   safeStr(cpFields["cpQualityAssurance"]),
    cpSustainability:     safeStr(cpFields["cpSustainability"]),
    cpPageTarget:         safeStr(cpFields["cpPageTarget"]),
    cpContactEmail:       safeStr(cpFields["cpContactEmail"]),
    cpContactPhone:       safeStr(cpFields["cpContactPhone"]),
    cpContactAddress:     safeStr(cpFields["cpContactAddress"]),
    cpContactWebsite:     safeStr(cpFields["cpContactWebsite"]),
    // P1.2: Package enforcement
    packageLevel,
    packageName,
  };
}

// ── Document definition ────────────────────────────────────────────────────────

export const companyProfileDefinition: DocumentDefinition = {
  documentType:     "company_profile",
  filenamePrefix:   "company-profile",
  minimumPageCount: 3,   // floor; overridden dynamically per-request via context
  requiresLogo:     false,
  maxInlineImages:  2,

  generateContent: async (project) => {
    const { cpFields, packageLevel, packageName } = await loadRequestContext(project);
    const brief = buildEnrichedBrief(project, cpFields, packageLevel, packageName);

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
    return { content: { ...content, _llmUsage: llmUsage, _brief: brief } as unknown as Record<string, unknown> };
  },

  buildSpec: (project, rawContent, coverImageBuffer, inlineImages) => {
    // Strip injected _llmUsage and _brief before passing to the mapper.
    const { _llmUsage: _ignored, _brief: briefRaw, ...contentRest } = rawContent as {
      _llmUsage?: unknown;
      _brief?: unknown;
    } & Record<string, unknown>;

    // Reconstruct brief from the stored _brief blob so buildSpec uses the same
    // enriched brief that generateContent used (package level, cp* fields, etc.)
    const storedBrief = briefRaw as CompanyProfileBrief | undefined;
    const brief: CompanyProfileBrief = storedBrief ?? {
      brandName:        project.brandName,
      businessType:     project.businessType,
      targetMarket:     project.targetMarket,
      productOrService: project.productOrService,
      goal:             project.goal,
      notes:            project.notes,
      colorPreference:  project.colorPreference,
      stylePreference:  project.stylePreference,
    };

    const { spec, report } = mapCompanyProfileToDocumentSpec(
      brief,
      contentRest as unknown as Parameters<typeof mapCompanyProfileToDocumentSpec>[1],
      coverImageBuffer,
      inlineImages,
    );

    // Attach LLM usage to the report
    const llmUsage = (_ignored ?? {}) as {
      provider?: string;
      model?: string;
      tokensUsed?: number;
      latencyMs?: number;
    };
    report.llmProvider   = llmUsage.provider   ?? "";
    report.llmModel      = llmUsage.model      ?? "";
    report.llmTokensUsed = llmUsage.tokensUsed ?? 0;
    report.llmLatencyMs  = llmUsage.latencyMs  ?? 0;

    return { spec, report: report as unknown as Record<string, unknown> };
  },
};
