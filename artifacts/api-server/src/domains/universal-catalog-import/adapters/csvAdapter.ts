/**
 * Universal Catalog Import — CSV Adapter
 * Parses comma/semicolon/tab-delimited files into raw extracted items.
 * Uses csv-parse for RFC-compliant CSV handling.
 */

import { parse } from "csv-parse/sync";
import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

export class CsvAdapter implements CatalogAdapter {
  readonly sourceType = "csv" as const;
  readonly displayName = "CSV File";
  readonly supportedMimeTypes = ["text/csv", "text/plain", "application/csv"];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.buffer) {
      return {
        rawItems: [],
        warnings,
        errors: ["No file buffer provided for CSV adapter"],
        sourceMetadata: {},
      };
    }

    const text = input.buffer.toString("utf-8");
    if (!text.trim()) {
      return {
        rawItems: [],
        warnings: ["CSV file is empty"],
        errors,
        sourceMetadata: {},
      };
    }

    // Auto-detect delimiter
    const delimiter = detectDelimiter(text);

    let records: Record<string, string>[];
    try {
      records = parse(text, {
        delimiter,
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        cast: false,
      }) as Record<string, string>[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        rawItems: [],
        warnings,
        errors: [`CSV parse error: ${msg}`],
        sourceMetadata: { delimiter },
      };
    }

    if (records.length === 0) {
      warnings.push("CSV parsed successfully but contains no data rows");
    }

    const rawItems: RawExtractedItem[] = records.map((record, idx) => ({
      raw: record as Record<string, unknown>,
      sourceContext: {
        row: idx + 2, // +1 for header, +1 for 1-based
        elementType: "csv_row",
      },
    }));

    return {
      rawItems,
      warnings,
      errors,
      sourceMetadata: {
        delimiter,
        totalRows: records.length,
        columns: records[0] ? Object.keys(records[0]) : [],
        filename: input.filename,
      },
    };
  }
}

function detectDelimiter(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  const counts = {
    ",": (firstLine.match(/,/g) ?? []).length,
    ";": (firstLine.match(/;/g) ?? []).length,
    "\t": (firstLine.match(/\t/g) ?? []).length,
    "|": (firstLine.match(/\|/g) ?? []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

export const csvAdapter = new CsvAdapter();
