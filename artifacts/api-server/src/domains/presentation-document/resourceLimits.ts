/**
 * resourceLimits.ts — Team 16: Presentation & Document Creative Services
 *
 * Hard resource ceilings for all document and presentation generation jobs.
 * These constants are enforced by the domain adapter BEFORE handing off to
 * the existing Document Engine or Presentation Engine.
 *
 * The existing engines (creativeDocumentWorkerService, presentationWorkerService)
 * may impose their own structural limits; these domain-level limits are an
 * additional guard at the adapter boundary.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const RESOURCE_LIMITS = {
  /** Absolute page ceiling across all PDF service types (enterprise tier max is 50). */
  MAX_PAGES: 50,

  /** Absolute slide ceiling for PPTX service types. */
  MAX_SLIDES: 60,

  /** Absolute image count ceiling per document (individual mappers may set lower). */
  MAX_IMAGES_PER_DOC: 6,

  /**
   * Maximum bytes for a single source image asset fetched from an external URL.
   * Matches the design-renderer imageResolver pattern (10 MB).
   */
  MAX_SOURCE_ASSET_BYTES: 10 * 1024 * 1024, // 10 MB

  /**
   * Maximum bytes for the final generated output (PDF or PPTX buffer).
   * A 50-page PDF with embedded images should stay well under 50 MB.
   */
  MAX_GENERATED_OUTPUT_BYTES: 50 * 1024 * 1024, // 50 MB

  /**
   * Maximum wall-clock time allowed for the full generation pipeline
   * (content generation + spec build + render).
   */
  GENERATION_TIMEOUT_MS: 5 * 60 * 1000, // 5 minutes

  /** Per-image HTTP fetch timeout when resolving external image URLs. */
  IMAGE_FETCH_TIMEOUT_MS: 15_000, // 15 seconds
} as const;

// ── Error class ───────────────────────────────────────────────────────────────

export type ResourceLimitCode =
  | "PAGE_LIMIT_EXCEEDED"
  | "SLIDE_LIMIT_EXCEEDED"
  | "IMAGE_COUNT_EXCEEDED"
  | "SOURCE_ASSET_TOO_LARGE"
  | "OUTPUT_TOO_LARGE"
  | "GENERATION_TIMEOUT";

export class ResourceLimitError extends Error {
  readonly code: ResourceLimitCode;
  readonly limit: number;
  readonly actual: number;

  constructor(code: ResourceLimitCode, actual: number, limit: number) {
    super(`Resource limit exceeded [${code}]: actual=${actual}, limit=${limit}`);
    this.name = "ResourceLimitError";
    this.code = code;
    this.actual = actual;
    this.limit = limit;
  }
}

// ── Enforcement functions ─────────────────────────────────────────────────────

/**
 * Throw ResourceLimitError if pageCount exceeds the given max.
 * maxPages defaults to RESOURCE_LIMITS.MAX_PAGES.
 */
export function enforcePageLimit(pageCount: number, maxPages: number = RESOURCE_LIMITS.MAX_PAGES): void {
  if (pageCount > maxPages) {
    throw new ResourceLimitError("PAGE_LIMIT_EXCEEDED", pageCount, maxPages);
  }
}

/**
 * Throw ResourceLimitError if slideCount exceeds the given max.
 * maxSlides defaults to RESOURCE_LIMITS.MAX_SLIDES.
 */
export function enforceSlideLimit(slideCount: number, maxSlides: number = RESOURCE_LIMITS.MAX_SLIDES): void {
  if (slideCount > maxSlides) {
    throw new ResourceLimitError("SLIDE_LIMIT_EXCEEDED", slideCount, maxSlides);
  }
}

/**
 * Throw ResourceLimitError if imageCount exceeds the given max.
 * maxImages defaults to RESOURCE_LIMITS.MAX_IMAGES_PER_DOC.
 */
export function enforceImageCount(imageCount: number, maxImages: number = RESOURCE_LIMITS.MAX_IMAGES_PER_DOC): void {
  if (imageCount > maxImages) {
    throw new ResourceLimitError("IMAGE_COUNT_EXCEEDED", imageCount, maxImages);
  }
}

/**
 * Throw ResourceLimitError if a source asset (image from external URL) exceeds
 * MAX_SOURCE_ASSET_BYTES.
 */
export function enforceSourceAssetBytes(byteSize: number): void {
  if (byteSize > RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES) {
    throw new ResourceLimitError(
      "SOURCE_ASSET_TOO_LARGE",
      byteSize,
      RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES,
    );
  }
}

/**
 * Throw ResourceLimitError if the generated output buffer exceeds
 * MAX_GENERATED_OUTPUT_BYTES.
 */
export function enforceOutputBytes(byteSize: number): void {
  if (byteSize > RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES) {
    throw new ResourceLimitError(
      "OUTPUT_TOO_LARGE",
      byteSize,
      RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES,
    );
  }
}

// ── Composite check ───────────────────────────────────────────────────────────

export interface DocumentResourceCheck {
  pageCount:    number;
  imageCount:   number;
  outputBytes?: number;
  /** Override the default MAX_PAGES limit (e.g. from package rules). */
  maxPages?:    number;
}

/**
 * Run all applicable document resource checks in one call.
 * Throws ResourceLimitError on the first violation.
 */
export function checkDocumentResourceLimits(input: DocumentResourceCheck): void {
  enforcePageLimit(input.pageCount, input.maxPages ?? RESOURCE_LIMITS.MAX_PAGES);
  enforceImageCount(input.imageCount);
  if (input.outputBytes !== undefined) {
    enforceOutputBytes(input.outputBytes);
  }
}

export interface PresentationResourceCheck {
  slideCount:   number;
  imageCount:   number;
  outputBytes?: number;
}

/**
 * Run all applicable presentation resource checks in one call.
 * Throws ResourceLimitError on the first violation.
 */
export function checkPresentationResourceLimits(input: PresentationResourceCheck): void {
  enforceSlideLimit(input.slideCount);
  enforceImageCount(input.imageCount);
  if (input.outputBytes !== undefined) {
    enforceOutputBytes(input.outputBytes);
  }
}
