/**
 * PdfRendererAdapter — Universal Renderer Team 14
 *
 * Implements PdfRendererPort by delegating to the existing design-renderer
 * pdfRenderer (pngToPdf via pdf-lib) for SVG/PNG sources, and to pdf-lib
 * directly for rawPdf passthrough.
 *
 * Does NOT duplicate PDF rendering logic from creativeDocumentService.
 */

import { createHash } from "crypto";
import { PDFDocument } from "pdf-lib";
import { pngToPdf } from "../../design-renderer/pdfRenderer.js";
import { RenderError } from "../errors.js";
import type { PdfRendererPort, PdfRenderInput, PdfRenderOutput } from "../ports/PdfRendererPort.js";
import { encodeSvg } from "../../design-renderer/outputEncoder.js";

// 50 MB limit
const MAX_PDF_BYTES = 50 * 1024 * 1024;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function countPdfPages(buf: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 1;
  }
}

export class PdfRendererAdapter implements PdfRendererPort {
  async render(input: PdfRenderInput): Promise<PdfRenderOutput> {
    const { source, metadata, printReady } = input;

    let pdfBuf: Buffer;

    if (source.kind === "svg") {
      // Rasterise SVG → PNG → PDF (Strategy A, same as design-renderer)
      const dpi = printReady ? 300 : 72;
      const scale = dpi / 72;
      const outW = Math.round(source.width  * scale);
      const outH = Math.round(source.height * scale);

      const encoded = await encodeSvg(
        source.svgString,
        "png",
        source.width,
        source.height,
        { outputWidth: outW, outputHeight: outH },
      );

      pdfBuf = await pngToPdf(encoded.buffer, outW, outH, {
        title:           metadata?.title,
        creator:         metadata?.creator ?? "Creative AI Studio — Universal Renderer",
        rendererVersion: metadata?.rendererVersion ?? "universal-renderer-v1",
      });

    } else if (source.kind === "pngBuffer") {
      pdfBuf = await pngToPdf(source.buffer, source.width, source.height, {
        title:   metadata?.title,
        creator: metadata?.creator ?? "Creative AI Studio — Universal Renderer",
      });

    } else {
      // rawPdf passthrough — validate it's a real PDF then return as-is
      const header = source.buffer.subarray(0, 5).toString("ascii");
      if (!header.startsWith("%PDF-")) {
        throw new RenderError("PDF_INVALID", "rawPdf source does not begin with %PDF-");
      }
      pdfBuf = source.buffer;
    }

    if (pdfBuf.length > MAX_PDF_BYTES) {
      throw new RenderError(
        "PDF_TOO_LARGE",
        `PDF output is ${pdfBuf.length} bytes — exceeds ${MAX_PDF_BYTES} byte limit`,
      );
    }

    const pageCount = await countPdfPages(pdfBuf);

    return {
      buffer:        pdfBuf,
      pageCount,
      fileSizeBytes: pdfBuf.length,
      checksum:      sha256(pdfBuf),
    };
  }
}
