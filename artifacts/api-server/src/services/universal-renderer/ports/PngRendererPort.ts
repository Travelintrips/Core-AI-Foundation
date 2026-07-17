/**
 * PngRendererPort — Universal Renderer Team 14
 *
 * Contract for rasterising an SVG (or re-encoding an existing buffer)
 * to PNG, JPEG, or WebP.
 *
 * Implementations must:
 *   - Enforce MAX_PNG_BYTES size limit after encode
 *   - Return SHA-256 checksum of the output buffer
 *   - Never mutate the source buffer
 */

export type RasterFormat = "png" | "jpg" | "webp";

export interface PngRenderInput {
  source:
    | { kind: "svg"; svgString: string; canvasWidth: number; canvasHeight: number }
    | { kind: "buffer"; buffer: Buffer; mimeType: string };
  outputWidth?: number;
  outputHeight?: number;
  format?: RasterFormat;
  quality?: number; // 1-100, for jpg/webp
}

export interface PngRenderOutput {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  checksum: string; // SHA-256 hex
}

export interface PngRendererPort {
  render(input: PngRenderInput): Promise<PngRenderOutput>;
}
