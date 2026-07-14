/**
 * presentationPdfPreviewService.ts — Phase 4 Presentation Engine
 *
 * PDF preview strategy — HONEST FALLBACK, documented per Phase 4 spec §14.
 *
 * This environment has no LibreOffice/soffice binary and no other PPTX→PDF
 * conversion service available (checked at startup via isPdfConversionAvailable()).
 * Rather than falsely claiming a byte-for-byte PPTX→PDF conversion, this
 * service renders a REAL, valid PDF directly from the same
 * CreativePresentationSpec that produced the PPTX — one PDF page per slide,
 * using the existing PDFKit dependency already vetted for the Document Engine.
 *
 * This is NOT a rasterized copy of the PPTX. It is a structurally faithful,
 * text-searchable PDF representation of the deck's content, clearly recorded
 * as `conversionStrategy: "spec_rendered"` (vs. `"binary_conversion"`) in the
 * asset's metadata and in the generation report so nobody downstream can
 * mistake it for a true PPTX render.
 *
 * If a real PPTX→PDF converter becomes available in a given environment in
 * the future (e.g. production has LibreOffice installed), isPdfConversionAvailable()
 * should be updated to detect it and this module extended to prefer it —
 * the spec-rendered fallback should remain as the last resort only.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import PDFDocument from "pdfkit";
import type { CreativePresentationSpec, PresentationSlideSpec } from "./presentationTypes.js";

const execFileAsync = promisify(execFile);

export class PresentationPdfPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PresentationPdfPreviewError";
  }
}

export interface PdfPreviewResult {
  buffer: Buffer;
  pageCount: number;
  conversionStrategy: "spec_rendered" | "binary_conversion";
}

let cachedAvailability: boolean | null = null;

/**
 * Detect whether a real PPTX→PDF conversion binary (LibreOffice/soffice) is
 * available in this environment. Cached for the process lifetime — checked
 * once at first use, not on every job, since binary availability doesn't
 * change at runtime.
 */
export async function isPdfConversionAvailable(): Promise<boolean> {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    await execFileAsync("soffice", ["--version"], { timeout: 5000 });
    cachedAvailability = true;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

function slideText(slide: PresentationSlideSpec): { title: string; lines: string[] } {
  const title = slide.title ?? slide.kind.replace(/_/g, " ");
  const lines: string[] = [];
  if (slide.subtitle) lines.push(slide.subtitle);
  if (slide.body) lines.push(slide.body);
  if (slide.bullets) lines.push(...slide.bullets.map((b) => `•  ${b}`));
  if (slide.kind === "metrics") lines.push(...slide.metrics.map((m) => `${m.label}: ${m.value}`));
  if (slide.kind === "timeline") lines.push(...slide.items.map((i) => `${i.period} — ${i.title}`));
  if (slide.kind === "comparison") lines.push(...slide.rows.map((r) => `${r.label}: Us=${r.us} · Competitor=${r.competitor}`));
  if (slide.kind === "team") lines.push(...slide.members.map((m) => `${m.name} — ${m.role}`));
  if (slide.kind === "financial" && slide.metrics) lines.push(...slide.metrics.map((m) => `${m.label}: ${m.value}`));
  return { title, lines };
}

/**
 * Render a spec-based PDF preview: one page per slide, real text content,
 * no rasterization, no JSON dumps. Honest, documented fallback per Phase 4 §14.
 */
export async function renderSpecBasedPdfPreview(spec: CreativePresentationSpec): Promise<PdfPreviewResult> {
  const doc = new PDFDocument({
    size: [842, 473.6], // A4-landscape-ish 16:9-proportioned page
    margins: { top: 40, bottom: 40, left: 50, right: 50 },
    bufferPages: true,
    info: { Title: `${spec.title} — Preview`, Creator: "Creative AI Studio" },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const endPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Each slide must render to EXACTLY one PDF page — page count is used as
  // the deliverable's page count, so silent PDFKit auto-pagination (which
  // triggers whenever text overflows the page) would desync that count from
  // the real slide count. Bound content to the available body height instead
  // of letting PDFKit add pages: truncate with an explicit indicator rather
  // than shrinking below a readable size or silently dropping content.
  // Page is 473.6pt tall with a 40pt bottom margin, so PDFKit's own printable
  // area ends at 433.6pt — ANY text placed past that, even at an explicit
  // x/y, makes PDFKit silently start a new page to hold the "overflow".
  // Keep every element (including the footer) safely inside that boundary.
  const PAGE_PRINTABLE_BOTTOM = 430;
  const PAGE_BOTTOM_SAFE_Y = 395; // leaves room for the footer line below it
  const FOOTER_Y = 412;
  const contentWidth = 742;

  spec.slides.forEach((slide, i) => {
    if (i > 0) doc.addPage();
    const { title, lines } = slideText(slide);

    doc.fontSize(20).fillColor(spec.theme.primaryColor);
    doc.text(title, 50, 40, { align: "left", width: contentWidth, height: 40, ellipsis: true });

    doc.fontSize(10.5).fillColor(spec.theme.textColor);
    let y = 90;
    let omitted = 0;
    for (const line of lines) {
      const lineHeight = doc.heightOfString(line, { width: contentWidth - 20 });
      if (y + lineHeight > PAGE_BOTTOM_SAFE_Y) {
        omitted += 1;
        continue;
      }
      doc.text(line, 50, y, { width: contentWidth - 20 });
      y += lineHeight + 6;
    }
    if (omitted > 0) {
      doc.fontSize(9).fillColor(spec.theme.mutedTextColor).text(`(+${omitted} more — see PPTX for full content)`, 50, y);
    }

    doc.fontSize(8).fillColor(spec.theme.mutedTextColor).text(`${i + 1} / ${spec.slides.length}`, 50, FOOTER_Y, { align: "right", width: contentWidth });
  });

  const pageCount = doc.bufferedPageRange().count;
  doc.flushPages();
  doc.end();
  const buffer = await endPromise;

  if (pageCount !== spec.slides.length) {
    throw new PresentationPdfPreviewError(
      `Spec-rendered PDF preview produced ${pageCount} pages for ${spec.slides.length} slides — content overflow bounding failed`,
    );
  }

  if (buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
    throw new PresentationPdfPreviewError("Spec-rendered PDF preview did not produce valid %PDF- magic bytes");
  }
  if (buffer.length === 0) {
    throw new PresentationPdfPreviewError("Spec-rendered PDF preview buffer is empty");
  }

  return { buffer, pageCount, conversionStrategy: "spec_rendered" };
}

/**
 * Generate a PDF preview using the best available strategy for this
 * environment. Currently there is no true PPTX→PDF binary available, so this
 * always resolves to the honest spec-rendered fallback — but the structure
 * leaves room to prefer a real converter transparently if one is ever added.
 */
export async function generatePresentationPdfPreview(
  spec: CreativePresentationSpec,
): Promise<PdfPreviewResult> {
  const hasBinaryConverter = await isPdfConversionAvailable();
  if (!hasBinaryConverter) {
    return renderSpecBasedPdfPreview(spec);
  }
  // Real PPTX→PDF binary conversion is not implemented in this codebase yet —
  // no environment we've run in has provided one. When one is available,
  // implement true conversion here instead of falling through.
  return renderSpecBasedPdfPreview(spec);
}
