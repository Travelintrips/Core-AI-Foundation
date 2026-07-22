/**
 * Team 32 — Design Rendering and Preview Adapters
 *
 * Public API re-exports.
 *
 * Usage:
 *   import { createDesignRendererRegistry, TemplateRendererAdapter } from
 *     './services/design-rendering-adapters/index.js';
 *
 * Adapter layer responsibilities:
 *  1. Capability-based renderer resolution (DesignRendererRegistry)
 *  2. Honest render classification (RenderClassification)
 *  3. Signed URL generation (generateRenderSignedToken)
 *  4. Tenant isolation (enforced in every adapter)
 *  5. Filename sanitization (sanitizeRenderFilename)
 *  6. Resource limit enforcement (DESIGN_RENDER_ADAPTER_LIMITS)
 */

// ── Contract types ────────────────────────────────────────────────────────────
export type {
  DesignRenderFormat,
  DesignRenderTarget,
  RenderClassification,
  DesignRenderProfile,
  DesignRenderRequest,
  DesignRenderJobStatus,
  DesignRenderJob,
  DesignRenderResult,
  DesignPreviewDescriptor,
  DesignThumbnailDescriptor,
  DesignRenderErrorCode,
  DesignRenderCapability,
  DesignRendererAdapter,
} from "./types.js";

export {
  DesignRenderError,
  SUPPORTED_FORMATS,
  MIME_FOR_FORMAT,
  DESIGN_RENDER_ADAPTER_LIMITS,
  sanitizeRenderFilename,
  generateRenderSignedToken,
  verifyRenderSignedToken,
} from "./types.js";

// ── Registry ──────────────────────────────────────────────────────────────────
export { DesignRendererRegistry, createDesignRendererRegistry, ensureRequestId, validateRenderProfile } from "./registry.js";
export type { RegistryResolveResult } from "./registry.js";

// ── Adapters ──────────────────────────────────────────────────────────────────
export { TemplateRendererAdapter } from "./adapters/templateRendererAdapter.js";
export type { TemplateRendererAdapterDeps } from "./adapters/templateRendererAdapter.js";

export { ThumbnailAdapter } from "./adapters/thumbnailAdapter.js";
export type { ThumbnailAdapterDeps, ThumbnailGeneratorInput, ThumbnailGeneratorOutput } from "./adapters/thumbnailAdapter.js";

export { PlaceholderAdapter } from "./adapters/placeholderAdapter.js";
