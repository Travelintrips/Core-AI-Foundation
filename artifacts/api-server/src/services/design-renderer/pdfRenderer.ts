/**
 * Design Renderer — PDF Output (Strategy A: rasterised PNG embedded in pdf-lib)
 *
 * Renders the canvas to PNG first via Sharp, then wraps it in a single-page
 * PDF using pdf-lib. This is safe, deterministic, and requires no browser.
 *
 * Metadata note: the PDF is explicitly marked as containing a rasterised
 * canvas image, not a vector document.
 */

import { PDFDocument } from "pdf-lib";
import { RenderError } from "./errors.js";

/**
 * Embed a PNG buffer into a single-page PDF whose page dimensions match
 * the image's pixel dimensions (at 72 DPI = 1 pt per px for simplicity).
 *
 * For print-ready output, callers can scale pt dimensions appropriately.
 */
export async function pngToPdf(
  pngBuffer: Buffer,
  canvasWidthPx: number,
  canvasHeightPx: number,
  metadata?: {
    title?: string;
    creator?: string;
    rendererVersion?: string;
  },
): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.create();

    // Embed metadata
    pdfDoc.setTitle(metadata?.title ?? "Design Export");
    pdfDoc.setCreator(metadata?.creator ?? "Creative AI Studio");
    pdfDoc.setSubject("Rasterised canvas export");
    pdfDoc.setKeywords([
      "rasterised",
      metadata?.rendererVersion ?? "design-svg-renderer-v1",
    ]);

    // Embed PNG
    const pngImage = await pdfDoc.embedPng(pngBuffer);

    // Add page with dimensions matching the canvas (1 pt per px)
    const page = pdfDoc.addPage([canvasWidthPx, canvasHeightPx]);

    // Draw image filling the whole page
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: canvasWidthPx,
      height: canvasHeightPx,
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (err) {
    throw new RenderError(
      "PDF_RENDER_FAILED",
      `pdf-lib failed to embed PNG into PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
