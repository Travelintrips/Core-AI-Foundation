/**
 * Universal Catalog Import Engine — Phase 4A
 * Public domain exports.
 */

export { runImportPipeline } from "./catalogImportPipeline.js";
export { getJob, getStagingItems } from "./stagingService.js";
export type { PipelineResult, PipelineOptions, AdapterSourceType, StagingPreviewItem, ImportJob } from "./types.js";
export { csvAdapter } from "./adapters/csvAdapter.js";
export { excelAdapter } from "./adapters/excelAdapter.js";
export { jsonAdapter } from "./adapters/jsonAdapter.js";
export { xmlAdapter } from "./adapters/xmlAdapter.js";
export { pdfAdapter } from "./adapters/pdfAdapter.js";
export { websiteAdapter } from "./adapters/websiteAdapter.js";
export { apiAdapter } from "./adapters/apiAdapter.js";
