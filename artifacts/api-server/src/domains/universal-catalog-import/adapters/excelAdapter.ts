/**
 * Universal Catalog Import — Excel Adapter
 * Supports .xlsx and .xls formats via the xlsx (SheetJS) library.
 * Reads the first non-empty sheet that looks like a product catalog.
 */

import * as XLSX from "xlsx";
import type { CatalogAdapter, AdapterInput, AdapterResult, RawExtractedItem } from "../types.js";

export class ExcelAdapter implements CatalogAdapter {
  readonly sourceType = "excel" as const;
  readonly displayName = "Excel File";
  readonly supportedMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream",
  ];

  async extract(input: AdapterInput): Promise<AdapterResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    if (!input.buffer) {
      return { rawItems: [], warnings, errors: ["No file buffer provided"], sourceMetadata: {} };
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(input.buffer, { type: "buffer", cellDates: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { rawItems: [], warnings, errors: [`Excel parse error: ${msg}`], sourceMetadata: {} };
    }

    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      return { rawItems: [], warnings: ["Workbook contains no sheets"], errors, sourceMetadata: {} };
    }

    // Use the first sheet (or the one explicitly requested via options)
    const targetSheet = (input.options?.["sheet"] as string) ?? sheetNames[0] ?? "";
    const sheet = workbook.Sheets[targetSheet];
    if (!sheet) {
      return {
        rawItems: [],
        warnings,
        errors: [`Sheet '${targetSheet}' not found. Available: ${sheetNames.join(", ")}`],
        sourceMetadata: { sheetNames },
      };
    }

    let rows: Record<string, unknown>[];
    try {
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
        blankrows: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { rawItems: [], warnings, errors: [`Excel sheet_to_json error: ${msg}`], sourceMetadata: {} };
    }

    if (rows.length === 0) {
      warnings.push(`Sheet '${targetSheet}' is empty`);
    }

    if (sheetNames.length > 1) {
      warnings.push(`Workbook has ${sheetNames.length} sheets; only '${targetSheet}' was processed. Other sheets: ${sheetNames.filter((s) => s !== targetSheet).join(", ")}`);
    }

    const rawItems: RawExtractedItem[] = rows.map((row, idx) => ({
      raw: row,
      sourceContext: {
        row: idx + 2, // +1 for header row, +1 for 1-based
        section: targetSheet,
        elementType: "excel_row",
      },
    }));

    return {
      rawItems,
      warnings,
      errors,
      sourceMetadata: {
        sheetNames,
        activeSheet: targetSheet,
        totalRows: rows.length,
        columns: rows[0] ? Object.keys(rows[0]) : [],
        filename: input.filename,
      },
    };
  }
}

export const excelAdapter = new ExcelAdapter();
