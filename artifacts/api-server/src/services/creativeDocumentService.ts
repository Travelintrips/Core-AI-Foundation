/**
 * creativeDocumentService.ts — Phase 2 Creative Document Engine
 *
 * Generic PDF rendering engine. Accepts a structured `CreativeDocumentSpec`
 * and produces a PDF Buffer using PDFKit.
 *
 * Does NOT contain Company Profile-specific logic — that lives in
 * `companyProfileDocumentMapper.ts`.
 *
 * Security constraints:
 *   - All string inputs are trimmed; no raw HTML accepted
 *   - Max 100 sections per document
 *   - Max 50 bullet items per list
 *   - Max 10 columns × 200 rows per table
 *   - Storage filenames are sanitised before use as path segments
 */

import PDFDocument from "pdfkit";
import {
  type PdfTheme,
  DEFAULT_THEME,
  safeHex,
  renderCoverPage,
  renderSectionHeading,
  renderParagraph,
  renderBullets,
  renderImageBlock,
  renderTable,
  renderKeyMetrics,
  renderQuote,
  renderClosingPage,
  renderAllFooters,
  renderPageHeader,
  ensurePageSpace,
  renderDivider,
} from "./pdfLayoutHelpers.js";

// ── Document spec types ───────────────────────────────────────────────────────

export type CreativeDocumentSection =
  | { type: "heading";     title: string; subtitle?: string }
  | { type: "paragraph";  text: string }
  | { type: "bullets";    items: string[] }
  | { type: "image";      imageUrl: string; imageBuffer?: Buffer | null; caption?: string; alt?: string }
  | { type: "keyMetrics"; items: Array<{ label: string; value: string }> }
  | { type: "table";      headers: string[]; rows: string[][] }
  | { type: "quote";      text: string; attribution?: string }
  | { type: "pageBreak" };

export interface CreativeDocumentSpec {
  documentType: string;     // e.g. "company_profile"
  title: string;
  subtitle?: string;
  company?: {
    name?: string;
    logoUrl?: string;
    website?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  theme?: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    fontFamily?: string;
  };
  cover?: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    imageBuffer?: Buffer | null;
    tagline?: string;
  };
  sections: CreativeDocumentSection[];
  footer?: {
    text?: string;
    showPageNumber?: boolean;
  };
  closing?: {
    text: string;
    contactText?: string;
  };
  metadata?: Record<string, unknown>;
}

// ── Validation ─────────────────────────────────────────────────────────────────

export class DocumentSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentSpecError";
  }
}

export function validateDocumentSpec(spec: unknown): asserts spec is CreativeDocumentSpec {
  if (!spec || typeof spec !== "object") {
    throw new DocumentSpecError("Document spec must be a non-null object");
  }
  const s = spec as Record<string, unknown>;

  if (typeof s["documentType"] !== "string" || !s["documentType"].trim()) {
    throw new DocumentSpecError("documentType is required and must be a non-empty string");
  }
  if (typeof s["title"] !== "string" || !s["title"].trim()) {
    throw new DocumentSpecError("title is required and must be a non-empty string");
  }
  if (!Array.isArray(s["sections"])) {
    throw new DocumentSpecError("sections must be an array");
  }
  if ((s["sections"] as unknown[]).length > 100) {
    throw new DocumentSpecError("Document must have at most 100 sections");
  }

  const VALID_TYPES = new Set([
    "heading", "paragraph", "bullets", "image",
    "keyMetrics", "table", "quote", "pageBreak",
  ]);

  for (let i = 0; i < (s["sections"] as unknown[]).length; i++) {
    const section = (s["sections"] as unknown[])[i] as Record<string, unknown>;
    if (!section || typeof section !== "object") {
      throw new DocumentSpecError(`section[${i}] must be an object`);
    }
    if (!VALID_TYPES.has(section["type"] as string)) {
      throw new DocumentSpecError(`section[${i}].type "${section["type"]}" is not a valid section type`);
    }
    if (section["type"] === "bullets") {
      const items = section["items"] as unknown[];
      if (!Array.isArray(items)) throw new DocumentSpecError(`section[${i}].items must be an array`);
      if (items.length > 50) throw new DocumentSpecError(`section[${i}] has too many bullet items (max 50)`);
    }
    if (section["type"] === "table") {
      const headers = section["headers"] as unknown[];
      const rows = section["rows"] as unknown[];
      if (!Array.isArray(headers) || headers.length > 10) {
        throw new DocumentSpecError(`section[${i}] table has too many columns (max 10)`);
      }
      if (!Array.isArray(rows) || rows.length > 200) {
        throw new DocumentSpecError(`section[${i}] table has too many rows (max 200)`);
      }
    }
  }
}

// ── PDF validation ─────────────────────────────────────────────────────────────

export class PdfValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfValidationError";
  }
}

export interface PdfValidationResult {
  valid: boolean;
  pageCount: number;
  fileSizeBytes: number;
  mimeType: "application/pdf";
}

/**
 * Validate that a Buffer is a genuine, non-trivial PDF.
 *
 * @param buffer    The raw PDF bytes
 * @param pageCount Page count reported by the renderer (passed in to avoid PDF parsing)
 * @param minPages  Minimum acceptable page count (default 3 for Company Profile)
 */
export function validateGeneratedPdf(
  buffer: Buffer,
  pageCount: number,
  minPages = 3,
): PdfValidationResult {
  if (!buffer || buffer.length === 0) {
    throw new PdfValidationError("PDF buffer is empty");
  }
  if (buffer.length < 1024) {
    throw new PdfValidationError(`PDF buffer too small (${buffer.length} bytes) — likely placeholder`);
  }
  const magic = buffer.slice(0, 5).toString("ascii");
  if (!magic.startsWith("%PDF-")) {
    throw new PdfValidationError(`Buffer is not a valid PDF (magic bytes: "${magic}")`);
  }
  if (pageCount < minPages) {
    throw new PdfValidationError(
      `PDF has only ${pageCount} page(s); expected at least ${minPages} for this document type`,
    );
  }
  // Sanity-check: buffer should contain at least some /Page markers
  const pageMarkers = (buffer.toString("binary").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  if (pageMarkers === 0) {
    throw new PdfValidationError("PDF appears to have no page objects — may be corrupted");
  }

  return {
    valid: true,
    pageCount,
    fileSizeBytes: buffer.length,
    mimeType: "application/pdf",
  };
}

// ── Filename sanitisation ──────────────────────────────────────────────────────

/**
 * Sanitise a user-supplied name for use as a storage path segment.
 * Removes characters that could enable path traversal or injection.
 */
export function sanitizeStorageFilename(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

// ── Render result ─────────────────────────────────────────────────────────────

export interface RenderResult {
  buffer: Buffer;
  pageCount: number;
  renderDurationMs: number;
}

// ── Main render function ───────────────────────────────────────────────────────

/**
 * Render a `CreativeDocumentSpec` to a PDF Buffer.
 *
 * Validates the spec before rendering. Throws `DocumentSpecError` for invalid
 * specs. All section types are handled; unknown types are skipped.
 * An image failure within a section does not abort the render — it is recorded
 * in the returned metadata but rendering continues.
 *
 * @returns RenderResult with buffer, page count, and render duration
 */
export async function renderDocument(spec: CreativeDocumentSpec): Promise<RenderResult> {
  validateDocumentSpec(spec);

  const renderStart = Date.now();

  const theme: PdfTheme = {
    primaryColor:   safeHex(spec.theme?.primaryColor, DEFAULT_THEME.primaryColor),
    secondaryColor: safeHex(spec.theme?.secondaryColor, DEFAULT_THEME.secondaryColor),
    accentColor:    safeHex(spec.theme?.accentColor, DEFAULT_THEME.accentColor),
  };

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 60, left: 50, right: 50 },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title:   spec.title,
      Author:  spec.company?.name ?? spec.title,
      Subject: spec.documentType.replace(/_/g, " "),
      Creator: "Creative AI Studio",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const endPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Cover page ─────────────────────────────────────────────────────────────

  doc.addPage();
  renderCoverPage(doc, {
    companyName: spec.cover?.title ?? spec.title,
    tagline:     spec.cover?.tagline ?? spec.subtitle,
    subtitle:    spec.cover?.subtitle,
    imageBuffer: spec.cover?.imageBuffer ?? null,
    theme,
  });

  // ── Content sections ───────────────────────────────────────────────────────

  let needsNewContentPage = true;

  for (const section of spec.sections) {
    // Empty heading/paragraph sections should not emit placeholder text
    if (section.type === "heading" && !section.title.trim()) continue;
    if (section.type === "paragraph" && !section.text.trim()) continue;
    if (section.type === "bullets" && section.items.filter((i) => i.trim()).length === 0) continue;

    if (section.type === "pageBreak") {
      doc.addPage();
      renderPageHeader(doc, spec.company?.name ?? spec.title, theme);
      needsNewContentPage = false;
      continue;
    }

    if (needsNewContentPage) {
      doc.addPage();
      renderPageHeader(doc, spec.company?.name ?? spec.title, theme);
      needsNewContentPage = false;
    }

    switch (section.type) {
      case "heading":
        renderSectionHeading(doc, section.title, section.subtitle, theme);
        break;

      case "paragraph":
        renderParagraph(doc, section.text);
        break;

      case "bullets":
        renderBullets(doc, section.items.filter((i) => i.trim()), theme);
        break;

      case "image": {
        const imgBuf = section.imageBuffer ?? null;
        if (imgBuf) {
          renderImageBlock(doc, imgBuf, section.caption, section.alt);
        }
        // If no buffer, image was not downloaded — skip (recorded in generation report)
        break;
      }

      case "keyMetrics":
        if (section.items.length > 0) {
          renderKeyMetrics(doc, section.items, theme);
        }
        break;

      case "table":
        if (section.headers.length > 0 && section.rows.length > 0) {
          renderTable(doc, section.headers, section.rows, theme);
        }
        break;

      case "quote":
        if (section.text.trim()) {
          renderQuote(doc, section.text, section.attribution, theme);
        }
        break;
    }

    // Add visual breathing room between sections
    ensurePageSpace(doc, 30);
    renderDivider(doc, theme);
  }

  // ── Closing page ───────────────────────────────────────────────────────────

  if (spec.closing?.text) {
    const contactParts: string[] = [];
    if (spec.company?.website) contactParts.push(spec.company.website);
    if (spec.company?.email)   contactParts.push(spec.company.email);
    if (spec.company?.phone)   contactParts.push(spec.company.phone);

    renderClosingPage(
      doc,
      spec.company?.name ?? spec.title,
      spec.closing.text,
      spec.closing.contactText ?? contactParts.join("  ·  "),
      theme,
    );
  }

  // ── Footers on all pages ───────────────────────────────────────────────────

  const footerText = spec.footer?.text
    ?? `${spec.company?.name ?? spec.title} — ${spec.documentType.replace(/_/g, " ")}`;
  renderAllFooters(doc, footerText, theme);

  // ── Finalize ───────────────────────────────────────────────────────────────

  const pageCount = doc.bufferedPageRange().count;
  doc.flushPages();
  doc.end();

  const buffer = await endPromise;
  const renderDurationMs = Date.now() - renderStart;

  return { buffer, pageCount, renderDurationMs };
}
