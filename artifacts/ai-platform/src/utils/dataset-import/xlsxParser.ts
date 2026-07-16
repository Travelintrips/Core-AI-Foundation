/**
 * XLSX Parser — Phase 6A
 *
 * Uses SheetJS (xlsx) for Excel file parsing.
 * Handles: Excel date serials, number formats, booleans, formula cells (value only).
 *
 * Security: raw_cell is not used — only w (formatted text) or v (raw value).
 *           Formula results are read as data, formulas never executed.
 */
import * as XLSX from "xlsx";
import { DATASET_LIMITS, type ParsedDataset } from "./csvParser.js";

function excelValueToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";

  // For formula cells, use the cached result value (w = formatted, v = raw)
  // Never use cell.f (formula string)
  if (cell.w !== undefined && cell.w !== null) {
    return String(cell.w).trim();
  }
  if (cell.v !== undefined && cell.v !== null) {
    if (cell.t === "b") return cell.v ? "true" : "false";
    if (cell.t === "n") return String(cell.v);
    return String(cell.v).trim();
  }
  return "";
}

export function parseXLSX(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    if (file.size > DATASET_LIMITS.MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File too large. Maximum: ${DATASET_LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, {
          type: "array",
          cellDates: false,    // We'll handle date serials via formatted text
          cellNF: false,
          cellHTML: false,     // Never parse HTML
          cellFormula: false,  // Don't parse formulas — only cached values
          raw: false,
        });

        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          reject(new Error("Excel file has no sheets."));
          return;
        }
        const sheet = workbook.Sheets[sheetName]!;

        // Get range
        const ref = sheet["!ref"];
        if (!ref) {
          reject(new Error("Sheet is empty."));
          return;
        }

        const range = XLSX.utils.decode_range(ref);
        const maxCol = Math.min(range.e.c, DATASET_LIMITS.MAX_COLUMNS - 1);
        const maxRow = Math.min(range.e.r, DATASET_LIMITS.MAX_ROWS); // +1 for header

        const warnings: string[] = [];

        // Extract headers from row 0
        const rawHeaders: string[] = [];
        for (let c = range.s.c; c <= maxCol; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
          rawHeaders.push(excelValueToString(cell) || `Column_${c + 1}`);
        }

        if (range.e.c > DATASET_LIMITS.MAX_COLUMNS - 1) {
          warnings.push(`File has ${range.e.c + 1} columns; only first ${DATASET_LIMITS.MAX_COLUMNS} will be used.`);
        }

        // Deduplicate headers
        const seen: Record<string, number> = {};
        const headers = rawHeaders.map((h) => {
          const key = h.trim() || "(empty)";
          if (seen[key] !== undefined) {
            seen[key]!++;
            const renamed = `${key}_${seen[key]}`;
            warnings.push(`Duplicate column "${key}" renamed to "${renamed}"`);
            return renamed;
          }
          seen[key] = 0;
          return key;
        });

        // Data rows
        const rows: Record<string, string>[] = [];
        for (let r = range.s.r + 1; r <= maxRow; r++) {
          const obj: Record<string, string> = {};
          let hasValue = false;
          for (let c = range.s.c; c <= maxCol; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            let val = excelValueToString(cell);
            if (val.length > DATASET_LIMITS.MAX_CELL_LENGTH) {
              val = val.slice(0, DATASET_LIMITS.MAX_CELL_LENGTH);
            }
            // Strip CSV formula injection
            val = val.replace(/^[=+\-@\t\r]/, "'$&");
            obj[headers[c - range.s.c]!] = val;
            if (val) hasValue = true;
          }
          if (hasValue) rows.push(obj); // Skip completely empty rows
        }

        if (range.e.r > DATASET_LIMITS.MAX_ROWS) {
          warnings.push(`File has ${range.e.r} data rows; only first ${DATASET_LIMITS.MAX_ROWS} will be processed.`);
        }

        resolve({
          headers,
          rows,
          totalRows: rows.length,
          warnings,
          preview: rows.slice(0, DATASET_LIMITS.PREVIEW_ROWS),
        });
      } catch (err) {
        reject(new Error(`XLSX parse error: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsArrayBuffer(file);
  });
}
