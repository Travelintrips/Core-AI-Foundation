/**
 * Row Validator — Phase 6A
 *
 * Validates each dataset row against the template variable schema.
 * Returns valid rows, invalid rows with error details, and a summary.
 */

export interface TemplateVariableMeta {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "image" | "color" | "url" | "date" | "boolean";
  required?: boolean;
  defaultValue?: string | number | boolean;
  validation?: {
    maxLength?: number;
    minLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ColumnMapping {
  /** Template variable key */
  variableKey: string;
  /** Dataset column header (or null if unmapped) */
  columnName: string | null;
  /** Static default value override */
  defaultValue?: string;
}

export interface RowValidationError {
  variableKey: string;
  message: string;
}

export interface ValidatedRow {
  rowIndex: number;
  /** Resolved values keyed by variable key */
  data: Record<string, string>;
  errors: RowValidationError[];
  isValid: boolean;
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errorsByColumn: Record<string, number>;
  validatedRows: ValidatedRow[];
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HTTPS_URL = /^https?:\/\/.+/;
const ISO_DATE  = /^\d{4}-\d{2}-\d{2}/;

function validateCellValue(
  raw: string,
  variable: TemplateVariableMeta,
): string | null {
  if (!raw && !variable.required) return null; // OK — optional empty

  if (!raw && variable.required) return "Required field is empty";

  const v = variable.validation;
  switch (variable.type) {
    case "text":
      if (v?.maxLength && raw.length > v.maxLength) return `Exceeds max length of ${v.maxLength}`;
      if (v?.minLength && raw.length < v.minLength) return `Below min length of ${v.minLength}`;
      if (v?.pattern && !new RegExp(v.pattern).test(raw)) return `Does not match expected pattern`;
      return null;

    case "number":
    case "currency": {
      const num = parseFloat(raw.replace(/[,_]/g, ""));
      if (isNaN(num)) return "Must be a valid number";
      if (v?.min !== undefined && num < v.min) return `Must be ≥ ${v.min}`;
      if (v?.max !== undefined && num > v.max) return `Must be ≤ ${v.max}`;
      return null;
    }

    case "color":
      if (!HEX_COLOR.test(raw)) return "Must be a valid hex color (e.g. #FF5733)";
      return null;

    case "url":
    case "image":
      if (!HTTPS_URL.test(raw)) return "Must be a valid HTTPS URL";
      return null;

    case "date":
      if (!ISO_DATE.test(raw) && isNaN(Date.parse(raw))) return "Must be a valid date";
      return null;

    case "boolean":
      if (!["true","false","1","0","yes","no","ya","tidak"].includes(raw.toLowerCase())) {
        return "Must be true/false or yes/no";
      }
      return null;

    default:
      return null;
  }
}

function normalizeValue(raw: string, type: TemplateVariableMeta["type"]): string {
  switch (type) {
    case "number":
    case "currency":
      return raw.replace(/[,_\s]/g, "");
    case "boolean": {
      const lower = raw.toLowerCase();
      return ["true","1","yes","ya"].includes(lower) ? "true" : "false";
    }
    default:
      return raw;
  }
}

export function validateDataset(
  rows: Record<string, string>[],
  variables: TemplateVariableMeta[],
  mappings: ColumnMapping[],
): ValidationSummary {
  const errorsByColumn: Record<string, number> = {};
  const validatedRows: ValidatedRow[] = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const raw = rows[rowIndex]!;
    const data: Record<string, string> = {};
    const errors: RowValidationError[] = [];

    for (const variable of variables) {
      const mapping = mappings.find((m) => m.variableKey === variable.key);
      const columnName = mapping?.columnName ?? null;

      // Resolve raw value: mapped column > default from mapping > variable default
      let rawValue = "";
      if (columnName && raw[columnName] !== undefined) {
        rawValue = raw[columnName]!;
      } else if (mapping?.defaultValue !== undefined) {
        rawValue = mapping.defaultValue;
      } else if (variable.defaultValue !== undefined) {
        rawValue = String(variable.defaultValue);
      }

      const error = validateCellValue(rawValue, variable);
      if (error) {
        errors.push({ variableKey: variable.key, message: error });
        errorsByColumn[variable.key] = (errorsByColumn[variable.key] ?? 0) + 1;
      }

      data[variable.key] = rawValue ? normalizeValue(rawValue, variable.type) : rawValue;
    }

    validatedRows.push({ rowIndex, data, errors, isValid: errors.length === 0 });
  }

  const validRows = validatedRows.filter((r) => r.isValid).length;

  return {
    totalRows: rows.length,
    validRows,
    invalidRows: rows.length - validRows,
    errorsByColumn,
    validatedRows,
  };
}

/** Suggest column-to-variable mappings based on name similarity */
export function suggestMappings(
  headers: string[],
  variables: TemplateVariableMeta[],
): ColumnMapping[] {
  return variables.map((v) => {
    const vKey = v.key.toLowerCase().replace(/[_\-]/g, " ");
    const vLabel = v.label.toLowerCase();

    // Exact match first
    let best = headers.find((h) => h.toLowerCase() === vKey || h.toLowerCase() === vLabel);

    // Partial match
    if (!best) {
      best = headers.find(
        (h) =>
          h.toLowerCase().includes(vKey) ||
          vKey.includes(h.toLowerCase()) ||
          h.toLowerCase().includes(vLabel) ||
          vLabel.includes(h.toLowerCase()),
      );
    }

    return {
      variableKey: v.key,
      columnName: best ?? null,
      defaultValue: v.defaultValue !== undefined ? String(v.defaultValue) : undefined,
    };
  });
}
