/**
 * Universal Catalog Import — PDF Adapter
 * Extracts text from PDF catalogs using pdf-parse.
 * Falls back to per-page image description hint when a page has no embedded text.
 * Does NOT perform OCR itself — marks OCR-needed pages for the AI extractor.
 *
 * Safety: never makes network calls; operates entirely on the provided buffer.
 *
 * CJS/ESM interop note:
 *   pdf-parse is a CommonJS module. esbuild externalises it (see build.mjs) so
 *   it is loaded by Node.js at runtime via require(). When a CJS module is
 *   imported through ESM dynamic import() the function may land on .default OR
 *   be the module object itself (depending on the bundler / Node version). We
 *   always try .default first and fall back to the module root.
 */

import crypto from "node:crypto";
import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

// ── CJS/ESM interop ───────────────────────────────────────────────────────────

type PdfParseOptions = {
  pagerender?: (pageData: PageData) => Promise<string>;
  max?: number;
};
type PageData = { getTextContent(): Promise<{ items: Array<{ str: string }> }> };
type PdfParseResult = {
  numpages: number;
  text: string;
  info?: Record<string, unknown>;
};
type PdfParseFn = (buffer: Buffer, options?: PdfParseOptions) => Promise<PdfParseResult>;

// Dynamic import so esbuild keeps pdf-parse external (runtime require).
// Guard handles both `.default` (ESM wrapper) and bare module (require interop).
const _pdfMod = await import("pdf-parse" as string);
const pdfParseFn: PdfParseFn = (
  typeof (_pdfMod as { default?: unknown }).default === "function"
    ? (_pdfMod as { default: PdfParseFn }).default
    : (_pdfMod as unknown as PdfParseFn)
);

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_TEXT_LENGTH_PER_PAGE = 50; // chars below which we suspect an image-only page

// ── Adapter ───────────────────────────────────────────────────────────────────

export class PdfAdapter implements CatalogAdapter {
  readonly sourceType = "pdf" as const;
  readonly displayName = "PDF Catalog";
  readonly supportedMimeTypes = ["application/pdf"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.buffer) {
      return {
        rawItems: [],
        warnings,
        errors: ["No file buffer provided for PDF adapter"],
        sourceMetadata: {},
      };
    }

    const checksum = crypto
      .createHash("sha256")
      .update(input.buffer)
      .digest("hex")
      .slice(0, 16);

    // ── Parse PDF with per-page text capture ───────────────────────────────
    let parsed: PdfParseResult & { pageTexts: string[] };
    try {
      parsed = await pdfParseWithPageTexts(input.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        rawItems: [],
        warnings,
        errors: [`PDF parse error: ${msg}`],
        sourceMetadata: { checksum, filename: input.filename },
      };
    }

    const pageTexts: string[] = parsed.pageTexts;
    const totalPages: number = parsed.numpages ?? 0;

    // ── Detect catalog version ─────────────────────────────────────────────
    const firstPageText = pageTexts[0] ?? parsed.text?.slice(0, 2000) ?? "";
    const catalogVersion = detectCatalogVersion(firstPageText);
    if (catalogVersion) {
      warnings.push(`Detected catalog version: ${catalogVersion}`);
    }

    // ── Build raw items ────────────────────────────────────────────────────
    const rawItems: RawExtractedItem[] = [];
    let ocrNeededPages = 0;
    const pagesToProcess = pageTexts.length > 0 ? pageTexts.length : Math.max(totalPages, 1);

    for (let pageIdx = 0; pageIdx < pagesToProcess; pageIdx++) {
      const pageText = pageTexts[pageIdx] ?? (pageIdx === 0 ? (parsed.text ?? "") : "");
      const pageNumber = pageIdx + 1;

      if (!pageText || pageText.trim().length < MIN_TEXT_LENGTH_PER_PAGE) {
        ocrNeededPages++;
        rawItems.push({
          raw: {
            _pageNumber: pageNumber,
            _ocrNeeded: true,
            _hint: "Image-only page: no embedded text detected. AI extractor should treat as visual content.",
            _catalogVersion: catalogVersion ?? undefined,
          },
          sourceContext: { page: pageNumber, elementType: "pdf_image_page" },
        });
        continue;
      }

      const blocks = splitIntoProductBlocks(pageText);
      if (blocks.length === 0) {
        rawItems.push({
          raw: {
            _pageText: pageText.trim(),
            _pageNumber: pageNumber,
            _catalogVersion: catalogVersion ?? undefined,
          },
          sourceContext: { page: pageNumber, elementType: "pdf_page_text" },
        });
      } else {
        for (const block of blocks) {
          rawItems.push({
            raw: {
              _pageText: block.trim(),
              _pageNumber: pageNumber,
              _catalogVersion: catalogVersion ?? undefined,
            },
            sourceContext: { page: pageNumber, elementType: "pdf_product_block" },
          });
        }
      }
    }

    if (ocrNeededPages > 0) {
      warnings.push(
        `${ocrNeededPages} of ${totalPages} page(s) appear to be image-only (no embedded text). ` +
          `AI extraction will be attempted on these pages but results may be limited without OCR.`,
      );
    }

    return {
      rawItems,
      totalPages,
      processedPages: pagesToProcess,
      warnings,
      errors,
      sourceMetadata: {
        checksum,
        filename: input.filename,
        totalPages,
        ocrNeededPages,
        catalogVersion: catalogVersion ?? undefined,
        pdfInfo: {
          author: (parsed.info as Record<string, unknown>)?.["Author"],
          title: (parsed.info as Record<string, unknown>)?.["Title"],
          creator: (parsed.info as Record<string, unknown>)?.["Creator"],
        },
      },
    };
  }
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a PDF buffer and collect per-page text via the pagerender callback.
 * pageTextAccumulator is scoped to each call (closure) — safe for concurrency.
 */
async function pdfParseWithPageTexts(
  buffer: Buffer,
): Promise<PdfParseResult & { pageTexts: string[] }> {
  const pageTexts: string[] = [];

  function renderPage(pageData: PageData): Promise<string> {
    return pageData.getTextContent().then((textContent) => {
      const text = textContent.items.map((item) => item.str).join(" ");
      pageTexts.push(text);
      return text;
    });
  }

  const result = await pdfParseFn(buffer, { pagerender: renderPage });
  return Object.assign(result, { pageTexts: [...pageTexts] });
}

/**
 * Detect catalog version string from page text.
 * Looks for patterns like "Catalog 2024", "Version 3.0", "Edition 2025/26".
 */
function detectCatalogVersion(text: string): string | null {
  const patterns = [
    /catalog(?:\s+version)?\s+([\d]{4}(?:\/\d{2,4})?)/i,
    /(?:version|ver\.?|v)\s*([\d]+\.[\d.]+)/i,
    /edition\s+([\d]{4}(?:\/\d{2,4})?)/i,
    /\b(20\d\d(?:\/\d{2,4})?)\b/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m[1] ?? null;
  }
  return null;
}

/**
 * Split a page's text into logical product blocks.
 * Products are typically separated by double newlines or repeated delimiters.
 */
function splitIntoProductBlocks(pageText: string): string[] {
  const blocks = pageText
    .split(/\n{2,}|\r\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 20); // filter out header/footer fragments

  // If we get exactly 1 "block", it's probably the whole page — return empty to treat as whole page
  if (blocks.length <= 1) return [];
  return blocks;
}

export const pdfAdapter = new PdfAdapter();
