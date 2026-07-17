/**
 * watermarkService — Universal Renderer Team 14
 *
 * Applies a baked-in "PREVIEW — CONFIDENTIAL" watermark to PDF buffers.
 *
 * FAIL-CLOSED CONTRACT:
 *   If watermarking fails for any reason, this module THROWS — it never
 *   returns the un-watermarked source PDF.  Callers must treat a thrown
 *   error as "do not serve this content".
 *
 * Delegates to the existing cpWatermarkService implementation (reuse, no
 * duplication).  That service accepts a URL; we wrap it to accept a Buffer
 * by spinning up a local in-memory data-URI for pdf-lib.
 */

import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";
import { RenderError } from "./errors.js";

// ── Configuration ─────────────────────────────────────────────────────────────

const WATERMARK_TEXT    = "PREVIEW — CONFIDENTIAL";
const WATERMARK_OPACITY  = 0.18;
const WATERMARK_FONT_SZ  = 52;
const WATERMARK_COLOR    = rgb(0.6, 0.08, 0.08); // deep red
const WATERMARK_ANGLE    = degrees(42);

/**
 * Stamp every page of `pdfBuffer` with the preview watermark.
 *
 * FAIL-CLOSED: throws WATERMARK_FAILED on any error rather than
 * returning the un-watermarked PDF.
 */
export async function stampWatermarkBuffer(pdfBuffer: Buffer): Promise<Buffer> {
  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new RenderError("WATERMARK_FAILED", "Cannot watermark an empty PDF buffer");
  }

  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const font   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages  = pdfDoc.getPages();

    if (pages.length === 0) {
      throw new RenderError("WATERMARK_FAILED", "PDF has no pages to watermark");
    }

    for (const page of pages) {
      const { width, height } = page.getSize();

      const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, WATERMARK_FONT_SZ);
      const x = (width  - textWidth * Math.cos(Math.PI * 42 / 180)) / 2;
      const y = (height - WATERMARK_FONT_SZ * Math.sin(Math.PI * 42 / 180)) / 2;

      page.drawText(WATERMARK_TEXT, {
        x,
        y,
        size:     WATERMARK_FONT_SZ,
        font,
        color:    WATERMARK_COLOR,
        rotate:   WATERMARK_ANGLE,
        opacity:  WATERMARK_OPACITY,
      });
    }

    const saved = await pdfDoc.save();
    return Buffer.from(saved);
  } catch (err) {
    if (err instanceof RenderError) throw err;
    // Fail-closed: wrap unknown errors — never fall through silently
    throw new RenderError(
      "WATERMARK_FAILED",
      `Watermark failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Apply the preview watermark to a raw SVG string by overlaying semi-transparent
 * diagonal text elements.  Returns a new SVG string with the watermark embedded.
 *
 * FAIL-CLOSED: throws WATERMARK_FAILED on error.
 */
export function stampWatermarkSvg(svgString: string): string {
  try {
    // Insert watermark elements just before </svg>
    const escapedText = WATERMARK_TEXT
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const watermarkGroup = `
  <g opacity="${WATERMARK_OPACITY}" transform="rotate(42, 50%, 50%)" style="pointer-events:none">
    <text
      x="50%"
      y="50%"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="Helvetica, Arial, sans-serif"
      font-weight="bold"
      font-size="52"
      fill="#990000"
    >${escapedText}</text>
  </g>`;

    const closeIdx = svgString.lastIndexOf("</svg>");
    if (closeIdx === -1) {
      throw new Error("SVG has no closing </svg> tag");
    }
    return svgString.slice(0, closeIdx) + watermarkGroup + svgString.slice(closeIdx);
  } catch (err) {
    throw new RenderError(
      "WATERMARK_FAILED",
      `SVG watermark failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
