/**
 * Design Renderer — Public API
 *
 * Re-exports the two entry points used by the rest of the system:
 *  - renderTemplate()        → production render + storage upload
 *  - renderTemplatePreview() → in-request preview (no permanent storage)
 */

export { renderTemplate, renderTemplatePreview } from "./templateRenderer.js";
export type { RenderPipelineInput, PipelineResult, PreviewResult } from "./templateRenderer.js";
export { RenderError, isRetryable, toErrorCode, sanitiseErrorMessage } from "./errors.js";
export type { RenderErrorCode } from "./errors.js";
export { renderConfig } from "./config.js";
export { AssetCache } from "./assetCache.js";
export { xmlEscape } from "./elementRenderer.js";
export { estimateTextWidth, wrapText, layoutText } from "./textLayout.js";
export { resolveFont } from "./fontRegistry.js";
export { validateOutputDimensions, mimeForFormat, extForFormat } from "./outputEncoder.js";
