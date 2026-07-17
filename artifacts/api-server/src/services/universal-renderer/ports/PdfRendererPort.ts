/**
 * PdfRendererPort — Universal Renderer Team 14
 *
 * Contract for producing a PDF Buffer from various source formats.
 * Implementations must:
 *   - Enforce MAX_PDF_BYTES size limit
 *   - Return SHA-256 checksum of the output buffer
 *   - Support print-ready flag (300 DPI target, embedded colour profile)
 */

export interface PdfRenderInput {
  source:
    | { kind: "svg"; svgString: string; width: number; height: number }
    | { kind: "pngBuffer"; buffer: Buffer; width: number; height: number }
    | { kind: "rawPdf"; buffer: Buffer }; // passthrough with watermark/print post-processing
  metadata?: {
    title?: string;
    creator?: string;
    subject?: string;
    rendererVersion?: string;
  };
  /** When true, target 300 DPI and embed sRGB ICC profile hint in metadata. */
  printReady?: boolean;
}

export interface PdfRenderOutput {
  buffer: Buffer;
  pageCount: number;
  fileSizeBytes: number;
  checksum: string; // SHA-256 hex
}

export interface PdfRendererPort {
  render(input: PdfRenderInput): Promise<PdfRenderOutput>;
}
