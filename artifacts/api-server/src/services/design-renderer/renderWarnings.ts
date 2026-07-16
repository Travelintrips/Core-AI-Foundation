/**
 * Design Renderer — Warning Accumulator
 *
 * Warnings are non-fatal events during render (font fallback, text truncation, etc.).
 * They are collected and stored in design_render_items.render_warnings — never cause failure.
 */

export type RenderWarningCode =
  | "VARIABLE_FALLBACK_USED"
  | "OPTIONAL_VARIABLE_MISSING"
  | "IMAGE_FALLBACK_USED"
  | "IMAGE_CROPPED"
  | "TEXT_AUTO_SHRINK_APPLIED"
  | "TEXT_TRUNCATED"
  | "FONT_FALLBACK_USED"
  | "ELEMENT_OUTSIDE_CANVAS"
  | "ELEMENT_SKIPPED"
  | "UNSUPPORTED_FONT_FALLBACK"
  | "MAX_LINES_EXCEEDED"
  | "QR_TOO_LONG";

export type RendererWarning = {
  elementId: string;
  code: RenderWarningCode;
  message: string;
};

export class WarningAccumulator {
  private readonly _warnings: RendererWarning[] = [];

  add(elementId: string, code: RenderWarningCode, message: string): void {
    this._warnings.push({ elementId, code, message });
  }

  toArray(): RendererWarning[] {
    return [...this._warnings];
  }

  toStringArray(): string[] {
    return this._warnings.map((w) => `[${w.code}] ${w.elementId}: ${w.message}`);
  }

  get count(): number {
    return this._warnings.length;
  }
}
