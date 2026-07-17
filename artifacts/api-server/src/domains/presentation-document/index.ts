/**
 * index.ts — Team 16: Presentation & Document Creative Services
 *
 * Domain initializer. Call initPresentationDocumentDomain() once at server
 * startup (from jobWorkerService.ts, alongside initDocumentRegistry()) to
 * register all Team 16 document types into the generic Document Engine.
 *
 * Ownership:
 *   Team 16 owns the following document types:
 *     proposal | product_catalog | annual_report | whitepaper | case_study | ebook
 *
 *   Company Profile and Pitch Deck are NOT registered here — they are owned
 *   by their existing mappers in services/mappers/ and services/presentation/.
 *
 * Re-exports:
 *   All domain types, profiles, and adapters are re-exported for use by
 *   admin routes, QC services, and test suites.
 */

import { registerDocument } from "../../services/creativeDocumentWorkerService.js";
import { proposalDefinition }       from "./mappers/proposalDocumentMapper.js";
import { productCatalogDefinition } from "./mappers/productCatalogDocumentMapper.js";
import { annualReportDefinition }   from "./mappers/annualReportDocumentMapper.js";
import { whitepaperDefinition }     from "./mappers/whitepaperDocumentMapper.js";
import { caseStudyDefinition }      from "./mappers/caseStudyDocumentMapper.js";
import { ebookDefinition }          from "./mappers/ebookDocumentMapper.js";

/**
 * Register all Team 16 document definitions into the generic Document Engine.
 * Safe to call multiple times (idempotent — Map.set overwrites with the same value).
 */
export function initPresentationDocumentDomain(): void {
  registerDocument(proposalDefinition);
  registerDocument(productCatalogDefinition);
  registerDocument(annualReportDefinition);
  registerDocument(whitepaperDefinition);
  registerDocument(caseStudyDefinition);
  registerDocument(ebookDefinition);
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export type { PresentationDocumentServiceType, ServiceFormatSpec, AntiFabricationPolicy } from "./types.js";
export { SERVICE_FORMAT_MAP, ANTI_FABRICATION_POLICIES }                                  from "./types.js";

export type { SectionDescriptor }                                                          from "./sectionMapping.js";
export { getSectionMap, getRequiredSections, SECTION_MAPS }                               from "./sectionMapping.js";

export type { PackageRule, PageLimits, PackageTier }                                       from "./packageRules.js";
export { getPackageRule, getMinimumPageCount, resolvePackageTier, PACKAGE_RULES }          from "./packageRules.js";

export type { QcProfile, QcDimension, QcResult, QcDimensionResult }                       from "./qcProfile.js";
export { evaluateQc, scoreSectionCoverage, scoreDataCompleteness, scorePageCount, QC_PROFILES } from "./qcProfile.js";

export type { TemplateCompatibilityEntry, TemplateStyle }                                  from "./templateCompatibility.js";
export { getTemplateCompatibility, isStyleCompatible, TEMPLATE_COMPATIBILITY }             from "./templateCompatibility.js";

export type { DocumentThemeOverride, BrandDnaApplicationReport }                           from "./brandDnaAdapter.js";
export { extractBrandDnaTheme }                                                            from "./brandDnaAdapter.js";

export {
  resolveRenderFormat,
  isDocumentEngineService,
  isPresentationEngineService,
  evaluateDocumentQc,
  checkTemplateCompatibility,
  validateAntiFabrication,
  buildPipelineSummary,
  // Resource limits
  RESOURCE_LIMITS,
  ResourceLimitError,
  enforcePageLimit,
  enforceSlideLimit,
  enforceImageCount,
  enforceSourceAssetBytes,
  enforceOutputBytes,
  checkDocumentResourceLimits,
  checkPresentationResourceLimits,
  // Image validation
  validateImageUrl,
} from "./adapters/presentationDocumentAdapter.js";
export type {
  ResourceLimitCode,
  DocumentResourceCheck,
  PresentationResourceCheck,
  ImageValidationResult,
  ImageValidationCode,
} from "./adapters/presentationDocumentAdapter.js";

// ── Individual mapper exports (for direct use in tests) ───────────────────────

export { proposalDefinition,       normalizeProposalContent,       buildProposalSpec       } from "./mappers/proposalDocumentMapper.js";
export { productCatalogDefinition, normalizeProductCatalogContent, buildProductCatalogSpec } from "./mappers/productCatalogDocumentMapper.js";
export { annualReportDefinition,   normalizeAnnualReportContent,   buildAnnualReportSpec   } from "./mappers/annualReportDocumentMapper.js";
export { whitepaperDefinition,     normalizeWhitepaperContent,     buildWhitepaperSpec     } from "./mappers/whitepaperDocumentMapper.js";
export { caseStudyDefinition,      normalizeCaseStudyContent,      buildCaseStudySpec      } from "./mappers/caseStudyDocumentMapper.js";
export { ebookDefinition,          normalizeEbookContent,          buildEbookSpec          } from "./mappers/ebookDocumentMapper.js";
