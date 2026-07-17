/**
 * Universal Renderer — Public API (Team 14)
 *
 * Exports the service class, all port contracts, all adapters, and
 * convenience factory for production use.
 */

export { UniversalRendererService } from "./universalRendererService.js";
export type {
  UniversalRenderRequest,
  UniversalRenderResult,
  RenderArtifact,
  OutputFormat,
  RenderSource,
  UniversalRendererDeps,
} from "./universalRendererService.js";

export * from "./ports/index.js";

export {
  SvgRendererAdapter,
  PdfRendererAdapter,
  PngRendererAdapter,
  StorageAdapter,
  JobSchedulerAdapter,
} from "./adapters/index.js";

export { RenderError, isRetryable } from "./errors.js";
export type { UniversalRenderErrorCode } from "./errors.js";

export { UNIVERSAL_RENDER_LIMITS } from "./resourceLimits.js";
export { computeRenderHash, checkIdempotency, recordIdempotencyResult } from "./idempotencyService.js";
export { validateAssetUrl, scanSvgForBlockedUrls, secureFetch } from "./ssrfFetchValidator.js";

export { computeChecksum, verifyChecksum } from "./checksumService.js";
export { stampWatermarkBuffer, stampWatermarkSvg } from "./watermarkService.js";
export { generateThumbnail } from "./thumbnailService.js";
export { buildZipPackage }   from "./zipPackageService.js";
export { buildComposition, parseComposition } from "./compositionService.js";
export { makePrintReady }    from "./printReadyService.js";

// ── Production factory ────────────────────────────────────────────────────────

import { SvgRendererAdapter }  from "./adapters/SvgRendererAdapter.js";
import { PdfRendererAdapter }  from "./adapters/PdfRendererAdapter.js";
import { PngRendererAdapter }  from "./adapters/PngRendererAdapter.js";
import { StorageAdapter }      from "./adapters/StorageAdapter.js";
import { JobSchedulerAdapter } from "./adapters/JobSchedulerAdapter.js";
import { UniversalRendererService } from "./universalRendererService.js";

let _instance: UniversalRendererService | null = null;

/**
 * Return a singleton UniversalRendererService wired with production adapters.
 * Safe to call multiple times — returns the same instance.
 */
export function getUniversalRenderer(): UniversalRendererService {
  if (!_instance) {
    _instance = new UniversalRendererService({
      svgRenderer:   new SvgRendererAdapter(),
      pdfRenderer:   new PdfRendererAdapter(),
      pngRenderer:   new PngRendererAdapter(),
      storage:       new StorageAdapter(),
      jobScheduler:  new JobSchedulerAdapter(),
    });
  }
  return _instance;
}
