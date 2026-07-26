/**
 * Material Catalog Integration — Phase 3 Foundation
 * Public barrel export.
 *
 * ⚠️  Route is NOT mounted. Feature flag defaults to false.
 *     Production behavior is unchanged until explicitly enabled.
 */

// Types
export type {
  ExternalCatalogItem,
  CatalogProviderCapabilities,
  CatalogFetchContext,
  ExternalCatalogResult,
  CatalogProviderValidationResult,
  ImportOptions,
  ImportPreviewResult,
  ImportReport,
  ImportReportStatus,
  DuplicateClassification,
  DuplicateCheckResult,
  ClassifiedItem,
  MediaReference,
  MediaReferenceKind,
  NormalizationResult,
} from "./types.js";

// Provider contract
export type { MaterialCatalogProvider, CatalogSourceType } from "./catalogProvider.js";

// Errors
export {
  CatalogProviderNotFoundError,
  CatalogDuplicateProviderError,
  CatalogConfigValidationError,
  CatalogValidationError,
  CatalogProviderError,
  CatalogProductionImportRejectedError,
  CatalogPayloadTooLargeError,
  CatalogResponseTooLargeError,
  CatalogFetchError,
  CatalogUnsupportedUrlSchemeError,
  CatalogFeatureDisabledError,
  CatalogFetchError,
  redactProviderConfig,
} from "./errors.js";

// Schemas
export {
  ExternalCatalogItemSchema,
  ImportOptionsSchema,
  ImportPreviewResultSchema,
  ImportReportSchema,
  MAX_RECORDS_PER_PREVIEW,
  MAX_PAYLOAD_SIZE_BYTES,
} from "./schemas.js";

// Registry
export {
  registerProvider,
  unregisterProvider,
  getProvider,
  listProviders,
  listProvidersByCapability,
  enableProvider,
  disableProvider,
  hasProvider,
  providerCount,
  _resetProviderRegistry,
} from "./providerRegistry.js";

// Normalizer
export { normalizeExternalItem } from "./catalogNormalizer.js";

// Duplicate detector
export {
  classifyItem,
  classifyBatch,
  addToIndex,
  createDetectionIndex,
} from "./catalogDuplicateDetector.js";

// Media resolver
export { resolveMediaReference, resolveMediaReferences, validateSourceUrl } from "./catalogMediaResolver.js";

// Preview & report
export { runImportPreview } from "./catalogImportPreview.js";
export { buildImportReport, buildRejectedReport } from "./catalogImportReport.js";

// Service (main orchestrator)
export { runCatalogImportPreview } from "./catalogImportService.js";

// Feature flag
export {
  isMaterialCatalogEnabled,
  setMaterialCatalogFlagOverride,
  clearMaterialCatalogFlagOverride,
} from "./featureFlag.js";

export {
  registerOfficialMaterialProviders,
  NIRO_GRANITE_PROVIDER_FLAG,
} from "./officialProviderRegistration.js";
