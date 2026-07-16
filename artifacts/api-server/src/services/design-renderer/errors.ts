/**
 * Design Renderer — Structured Error Codes
 * Every renderer error carries a stable code so callers can distinguish
 * retryable transient failures from non-retryable logic errors.
 */

export type RenderErrorCode =
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_VERSION_NOT_FOUND"
  | "TEMPLATE_SCHEMA_INVALID"
  | "RENDER_ITEM_NOT_FOUND"
  | "RENDER_ITEM_ALREADY_CLAIMED"
  | "TENANT_MISMATCH"
  | "VARIABLE_VALIDATION_FAILED"
  | "ASSET_NOT_FOUND"
  | "ASSET_FETCH_FAILED"
  | "ASSET_FETCH_TIMEOUT"
  | "ASSET_TOO_LARGE"
  | "ASSET_TYPE_INVALID"
  | "ASSET_CORRUPTED"
  | "SSRF_BLOCKED"
  | "FONT_UNAVAILABLE"
  | "TEXT_LAYOUT_FAILED"
  | "QR_DATA_INVALID"
  | "CANVAS_LIMIT_EXCEEDED"
  | "SVG_BUILD_FAILED"
  | "SHARP_RENDER_FAILED"
  | "PDF_RENDER_FAILED"
  | "STORAGE_UPLOAD_FAILED"
  | "RENDER_CANCELLED"
  | "UNKNOWN_RENDER_ERROR";

/** Non-retryable errors — the same input will never produce a different outcome. */
const NON_RETRYABLE = new Set<RenderErrorCode>([
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_VERSION_NOT_FOUND",
  "TEMPLATE_SCHEMA_INVALID",
  "RENDER_ITEM_NOT_FOUND",
  "RENDER_ITEM_ALREADY_CLAIMED",
  "TENANT_MISMATCH",
  "VARIABLE_VALIDATION_FAILED",
  "ASSET_TYPE_INVALID",
  "SSRF_BLOCKED",
  "QR_DATA_INVALID",
  "CANVAS_LIMIT_EXCEEDED",
  "RENDER_CANCELLED",
]);

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly retryable: boolean;

  constructor(code: RenderErrorCode, message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
    this.retryable = !NON_RETRYABLE.has(code);
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof RenderError) return err.retryable;
  return true; // unknown errors are treated as transient by default
}

export function toErrorCode(err: unknown): RenderErrorCode {
  if (err instanceof RenderError) return err.code;
  return "UNKNOWN_RENDER_ERROR";
}

/** Sanitise an error message — never expose stack traces or internal paths. */
export function sanitiseErrorMessage(err: unknown): string {
  if (err instanceof RenderError) return err.message;
  if (err instanceof Error) {
    // Strip file paths and node internals
    return err.message.replace(/\/[^\s]+/g, "<path>").slice(0, 500);
  }
  return "An unexpected render error occurred";
}
