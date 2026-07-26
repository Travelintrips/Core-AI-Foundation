/**
 * Universal Catalog Import — PDF Adapter
 * Extracts text from PDF catalogs using pdf-parse.
 * Falls back to per-page image description hint when a page has no embedded text.
 * Does NOT perform OCR itself — marks OCR-needed pages for the AI extractor.
 *
 * Safety: never makes network calls; operates entirely on the provided buffer.
 */

// pdf-parse uses CJS; load at runtime to avoid ESM interop issues
type PdfParseResult = { numpages: number; text: string; info?: Record<string, unknown> };
type PdfParseFn = (buffer: Buffer, options?: Record<string, unknown>) => Promise<PdfParseResult>;
const pdfParse: PdfParseFn = (await import("pdf-parse" as string)).default as PdfParseFn;
import crypto from "node:crypto";
import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

const MIN_TEXT_LENGTH_PER_PAGE = 50; // below this we suspect image-only page

export class PdfAdapter implements CatalogAdapter {
  readonly sourceType = "pdf" as const;
  readonly displayName = "PDF Catalog";
  readonly supportedMimeTypes = ["application/pdf"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.buffer) {
      return { rawItems: [], warnings, errors: ["No file buffer provided for PDF adapter"], sourceMetadata: {} };
    }

    const checksum = crypto.createHash("sha256").update(input.buffer).digest("hex").slice(0, 16);

    let parsed: Awaited<ReturnType<typeof pdfParse>>;
    try {
      parsed = await pdfParse(input.buffer, {
        // Render each page — collect page-level text
        pagerender: renderPage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        rawItems: [],
        warnings,
        errors: [`PDF parse error: ${msg}`],
        sourceMetadata: { checksum, filename: input.filename },
      };
    }

    const pageTexts: string[] = (parsed as unknown as { pageTexts?: string[] }).pageTexts ?? [];
    const totalPages = parsed.numpages ?? 0;

    // Detect catalog version from first 2 pages
    const firstPageText = pageTexts[0] ?? parsed.text?.slice(0, 2000) ?? "";
    const catalogVersion = detectCatalogVersion(firstPageText);

    if (catalogVersion) {
      warnings.push(`Detected catalog version: ${catalogVersion}`);
    }

    const rawItems: RawExtractedItem[] = [];
    let ocrNeededPages = 0;

    for (let pageIdx = 0; pageIdx < Math.max(pageTexts.length, 1); pageIdx++) {
      const pageText = pageTexts[pageIdx] ?? (pageIdx === 0 ? parsed.text : "");
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

      // Split page text into logical product blocks
      const blocks = splitIntoProductBlocks(pageText);
      if (blocks.length === 0) {
        rawItems.push({
          raw: { _pageText: pageText.trim(), _pageNumber: pageNumber, _catalogVersion: catalogVersion ?? undefined },
          sourceContext: { page: pageNumber, elementType: "pdf_page_text" },
        });
      } else {
        for (const block of blocks) {
          rawItems.push({
            raw: { _pageText: block.trim(), _pageNumber: pageNumber, _catalogVersion: catalogVersion ?? undefined },
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
      processedPages: totalPages,
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

/** Accumulate per-page text during pdf-parse rendering */
const pageTextAccumulator: string[] = [];

function renderPage(pageData: { getTextContent: () => Promise<{ items: Array<{ str: string }> }> }) {
  return pageData.getTextContent().then((textContent) => {
    const pageText = textContent.items.map((item) => item.str).join(" ");
    pageTextAccumulator.push(pageText);
    return pageText;
  });
}

// Extend the parsed result with the per-page texts
const origPdfParse = pdfParse;
async function pdfParseWithPageTexts(
  buffer: Buffer,
  options?: Parameters<typeof pdfParse>[1],
): Promise<ReturnType<typeof pdfParse> & { pageTexts: string[] }> {
  pageTextAccumulator.length = 0;
  const result = await origPdfParse(buffer, { ...options, pagerender: renderPage });
  const pageTexts = [...pageTextAccumulator];
  pageTextAccumulator.length = 0;
  return Object.assign(result, { pageTexts });
}

// Override the extract method to use the enhanced parser
PdfAdapter.prototype.extract = async function (input: AdapterInput): Promise<AdapterResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!input.buffer) {
    return { rawItems: [], warnings, errors: ["No file buffer provided for PDF adapter"], sourceMetadata: {} };
  }

  const checksum = crypto.createHash("sha256").update(input.buffer).digest("hex").slice(0, 16);

  let parsed: Awaited<ReturnType<typeof pdfParseWithPageTexts>>;
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

  const firstPageText = pageTexts[0] ?? "";
  const catalogVersion = detectCatalogVersion(firstPageText);
  if (catalogVersion) warnings.push(`Detected catalog version: ${catalogVersion}`);

  const rawItems: RawExtractedItem[] = [];
  let ocrNeededPages = 0;

  const pagesToProcess = pageTexts.length > 0 ? pageTexts.length : 1;
  for (let pageIdx = 0; pageIdx < pagesToProcess; pageIdx++) {
    const pageText = pageTexts[pageIdx] ?? (pageIdx === 0 ? parsed.text : "");
    const pageNumber = pageIdx + 1;

    if (!pageText || pageText.trim().length < MIN_TEXT_LENGTH_PER_PAGE) {
      ocrNeededPages++;
      rawItems.push({
        raw: {
          _pageNumber: pageNumber,
          _ocrNeeded: true,
          _hint: "Image-only page: no embedded text detected.",
          _catalogVersion: catalogVersion ?? undefined,
        },
        sourceContext: { page: pageNumber, elementType: "pdf_image_page" },
      });
      continue;
    }

    const blocks = splitIntoProductBlocks(pageText);
    if (blocks.length === 0) {
      rawItems.push({
        raw: { _pageText: pageText.trim(), _pageNumber: pageNumber, _catalogVersion: catalogVersion ?? undefined },
        sourceContext: { page: pageNumber, elementType: "pdf_page_text" },
      });
    } else {
      for (const block of blocks) {
        rawItems.push({
          raw: { _pageText: block.trim(), _pageNumber: pageNumber, _catalogVersion: catalogVersion ?? undefined },
          sourceContext: { page: pageNumber, elementType: "pdf_product_block" },
        });
      }
    }
  }

  if (ocrNeededPages > 0) {
    warnings.push(
      `${ocrNeededPages} of ${totalPages} page(s) appear image-only. AI extraction attempted but may be limited.`,
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
};

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
