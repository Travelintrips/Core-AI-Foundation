/**
 * SvgRendererPort — Universal Renderer Team 14
 *
 * Contract for producing a finalized SVG string from raw SVG input
 * or a design-template + data row combination.
 *
 * Implementations MUST NOT produce SVGs wider or taller than
 * DESIGN_LIMITS.MAX_CANVAS_WIDTH / MAX_CANVAS_HEIGHT.
 */

export interface SvgRenderInput {
  /** Raw SVG markup to pass through (validated + sanitised by adapter). */
  svgContent?: string;
  /** Canvas dimensions for the SVG viewport. */
  canvasWidth: number;
  canvasHeight: number;
  /** Optional scaling — output is resized to these dimensions after render. */
  outputWidth?: number;
  outputHeight?: number;
}

export interface SvgRenderOutput {
  /** Finalized SVG string ready for downstream encoding. */
  svgString: string;
  warnings: string[];
}

export interface SvgRendererPort {
  render(input: SvgRenderInput): Promise<SvgRenderOutput>;
}
