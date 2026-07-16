/**
 * Universal Renderer — Error types (Team 14)
 */

export type UniversalRenderErrorCode =
  | "SVG_CONTENT_MISSING"
  | "SVG_TOO_LARGE"
  | "SVG_SANITISE_FAILED"
  | "PNG_TOO_LARGE"
  | "PDF_INVALID"
  | "PDF_TOO_LARGE"
  | "ZIP_EMPTY"
  | "ZIP_TOO_LARGE"
  | "WATERMARK_FAILED"
  | "STORAGE_VERIFY_FAILED"
  | "CHECKSUM_MISMATCH"
  | "CANVAS_LIMIT_EXCEEDED"
  | "SHARP_RENDER_FAILED"
  | "PDF_RENDER_FAILED"
  | "COMPOSITION_INVALID"
  | "UNSUPPORTED_FORMAT";

export class RenderError extends Error {
  readonly code: UniversalRenderErrorCode | string;

  constructor(code: UniversalRenderErrorCode | string, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

export function isRetryable(err: unknown): boolean {
  if (!(err instanceof RenderError)) return false;
  // Transient errors that benefit from a retry
  const retryable: Array<UniversalRenderErrorCode | string> = [
    "STORAGE_VERIFY_FAILED",
    "SHARP_RENDER_FAILED",
    "PDF_RENDER_FAILED",
  ];
  return retryable.includes(err.code);
}
