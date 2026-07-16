/**
 * CSV Parser — Phase 6A
 *
 * Uses PapaParse for safe, robust CSV parsing.
 * Handles: delimiter detection, quoted fields, UTF-8 BOM, empty lines,
 *          duplicate headers, whitespace trimming.
 *
 * Security: does NOT execute formula cells (values treated as strings).
 * Formula injection guard: strips leading =, +, -, @ from cell values in display.
 */
import Papa from "papaparse";

export const DATASET_LIMITS = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_ROWS: 10_000,
  MAX_COLUMNS: 100,
  MAX_CELL_LENGTH: 2000,
  PREVIEW_ROWS: 50,
} as const;

export interface ParsedDataset {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  warnings: string[];
  /** First PREVIEW_ROWS rows for display */
  preview: Record<string, string>[];
}

function sanitizeCellValue(val: string): string {
  // Strip potential CSV formula injection characters for safe display
  return val.replace(/^[=+\-@\t\r]/, "'$&");
}

function deduplicateHeaders(headers: string[]): { headers: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen: Record<string, number> = {};
  const result = headers.map((h) => {
    const trimmed = h.trim() || "(empty)";
    if (seen[trimmed] !== undefined) {
      seen[trimmed]!++;
      const renamed = `${trimmed}_${seen[trimmed]}`;
      warnings.push(`Duplicate column "${trimmed}" renamed to "${renamed}"`);
      return renamed;
    }
    seen[trimmed] = 0;
    return trimmed;
  });
  return { headers: result, warnings };
}

export function parseCSV(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    if (file.size > DATASET_LIMITS.MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File too large. Maximum: ${DATASET_LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`));
      return;
    }

    const warnings: string[] = [];

    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      encoding: "UTF-8",
      complete(result) {
        const rawRows = result.data as string[][];
        if (rawRows.length === 0) {
          reject(new Error("CSV file is empty or has no data rows."));
          return;
        }

        // First row = headers
        const rawHeaders = rawRows[0]!;
        if (rawHeaders.length > DATASET_LIMITS.MAX_COLUMNS) {
          warnings.push(`File has ${rawHeaders.length} columns; only first ${DATASET_LIMITS.MAX_COLUMNS} will be used.`);
        }
        const clampedHeaders = rawHeaders.slice(0, DATASET_LIMITS.MAX_COLUMNS);
        const { headers, warnings: dupWarnings } = deduplicateHeaders(clampedHeaders);
        warnings.push(...dupWarnings);

        // Data rows
        const dataRows = rawRows.slice(1);
        if (dataRows.length > DATASET_LIMITS.MAX_ROWS) {
          warnings.push(`File has ${dataRows.length} rows; only first ${DATASET_LIMITS.MAX_ROWS} will be processed.`);
        }
        const cappedRows = dataRows.slice(0, DATASET_LIMITS.MAX_ROWS);

        const rows: Record<string, string>[] = cappedRows.map((rawRow, rowIdx) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, colIdx) => {
            let val = (rawRow[colIdx] ?? "").trim();
            if (val.length > DATASET_LIMITS.MAX_CELL_LENGTH) {
              val = val.slice(0, DATASET_LIMITS.MAX_CELL_LENGTH);
              if (rowIdx === 0) warnings.push(`Column "${h}": values truncated to ${DATASET_LIMITS.MAX_CELL_LENGTH} chars`);
            }
            obj[h] = sanitizeCellValue(val);
          });
          return obj;
        });

        if (result.errors.length > 0) {
          warnings.push(`Parse warnings: ${result.errors.slice(0, 3).map((e) => e.message).join("; ")}`);
        }

        resolve({
          headers,
          rows,
          totalRows: rows.length,
          warnings,
          preview: rows.slice(0, DATASET_LIMITS.PREVIEW_ROWS),
        });
      },
      error(err) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    });
  });
}
