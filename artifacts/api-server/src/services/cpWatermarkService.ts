/**
 * cpWatermarkService.ts — Company Profile V4.2C
 *
 * Server-rendered PDF watermarking using pdf-lib.
 * Fetches an existing PDF from a URL (Supabase signed URL / public URL),
 * overlays "PREVIEW — CONFIDENTIAL" diagonally across every page,
 * and returns the watermarked PDF as a Buffer.
 *
 * This is NOT a CSS overlay — the watermark is baked into the PDF file bytes.
 */

import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";

// ── Configuration ─────────────────────────────────────────────────────────────

const WATERMARK_TEXT   = "PREVIEW — CONFIDENTIAL";
const WATERMARK_OPACITY = 0.18;   // translucent enough to read content through
const WATERMARK_FONT_SIZE = 52;
const WATERMARK_COLOR  = rgb(0.6, 0.08, 0.08); // deep red
const WATERMARK_ANGLE  = degrees(42);           // diagonal

/** Fetch timeout for the source PDF (ms). */
const FETCH_TIMEOUT_MS = 12_000;

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Download a PDF from `sourceUrl`, stamp every page with the watermark,
 * and return the modified PDF bytes.
 *
 * @throws on network error, non-200 response, or invalid PDF bytes.
 */
export async function stampWatermark(sourceUrl: string): Promise<Buffer> {
  // 1. Fetch the original PDF.
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let pdfBytes: ArrayBuffer;
  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF from storage: HTTP ${response.status}`);
    }
    pdfBytes = await response.arrayBuffer();
  } finally {
    clearTimeout(timeoutId);
  }

  // 2. Load the PDF document.
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  // 3. Embed a standard font — no external font needed.
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // 4. Stamp every page.
  const pages = pdfDoc.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();

    // Measure text so we can centre it.
    const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, WATERMARK_FONT_SIZE);

    // Centre of the page.
    const x = width  / 2 - (textWidth / 2) * Math.cos(Math.PI * 42 / 180);
    const y = height / 2 - (WATERMARK_FONT_SIZE / 2) * Math.sin(Math.PI * 42 / 180);

    page.drawText(WATERMARK_TEXT, {
      x,
      y,
      size:     WATERMARK_FONT_SIZE,
      font,
      color:    WATERMARK_COLOR,
      opacity:  WATERMARK_OPACITY,
      rotate:   WATERMARK_ANGLE,
    });

    // Second pass — smaller text in the corners for extra security
    const cornerTexts = [
      { tx: 20,          ty: 20           },
      { tx: width - 160, ty: 20           },
      { tx: 20,          ty: height - 30  },
      { tx: width - 160, ty: height - 30  },
    ];
    for (const { tx, ty } of cornerTexts) {
      page.drawText("PREVIEW", {
        x: tx, y: ty,
        size: 11, font,
        color: WATERMARK_COLOR,
        opacity: WATERMARK_OPACITY + 0.1,
      });
    }
  }

  // 5. Serialise and return.
  const watermarkedBytes = await pdfDoc.save();
  return Buffer.from(watermarkedBytes);
}

/**
 * Determine whether a review/project should serve a watermarked PDF.
 * Returns true when the project has not yet been fully paid.
 */
export function shouldWatermark(opts: {
  filesUnlocked: boolean | null;
  paymentStatus?: string | null;
}): boolean {
  if (opts.filesUnlocked === true) return false;
  // Treat any partial / unpaid status as watermarked
  return true;
}
