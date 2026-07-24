/**
 * Bulk Create Page — /design-templates/:id/bulk-create
 *
 * Upload CSV/XLSX → column mapping → row validation → POST batch
 *
 * Safety:
 *  - Strip leading =, +, -, @ from cell values (formula injection prevention)
 *  - XLSX: reads .w (formatted text), skips formula cells
 *  - Rows > 10,000: NOT all rendered in DOM (virtual count + first/last 20 preview)
 *  - Invalid rows shown to user, NOT silently dropped
 */

import { useState, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Upload, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  ArrowLeft, Loader2, FileText, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { v4 as uuidv4 } from "uuid";

// ── API helper ────────────────────────────────────────────────────────────────

const API_BASE = "";
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),

      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateVariable {
  key: string;
  label: string;
  type: string;
  required?: boolean;
}

interface TemplateVersion {
  id: number;
  versionNumber: number;
  templateJson: {
    variables: TemplateVariable[];
    canvas: { width: number; height: number };
    name: string;
  };
}

interface Template {
  id: number;
  name: string;
  activeVersionId: number | null;
}

interface ParsedRow {
  rowIndex: number;
  rawValues: Record<string, string>;
  valid: boolean;
  errors: string[];
}

interface ColumnMapping {
  csvHeader: string;
  templateVariableKey: string | null; // null = unmapped
}

type RenderDataRow = Record<string, string | number | boolean | null>;

const MAX_INLINE_ROWS = 10_000;
const PREVIEW_ROW_COUNT = 20;

// ── Formula injection prevention ──────────────────────────────────────────────

/** Strip leading formula chars: =, +, -, @ */
export function stripFormulaChars(value: string): string {
  return value.replace(/^[=+\-@]+/, "");
}

// ── XLSX parser ────────────────────────────────────────────────────────────────

export function parseXlsxFile(buffer: ArrayBuffer): { headers: string[]; rows: Record<string, string>[] } {
  const wb = XLSX.read(buffer, { type: "array", cellFormula: false });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;

  // Get the range
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const headers: string[] = [];

  // Read header row (row 0)
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = ws[cellAddr];
    const val = cell ? (cell.w ?? String(cell.v ?? "")) : "";
    headers.push(stripFormulaChars(String(val)).trim());
  }

  // Read data rows
  const rows: Record<string, string>[] = [];
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const dataRow: Record<string, string> = {};
    let hasData = false;
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellAddr];
      const header = headers[col - range.s.c] ?? String(col);

      if (!cell) {
        dataRow[header] = "";
        continue;
      }

      // Skip formula cells — use .w (formatted) or .v for safe types only
      if (cell.t === "e") {
        // error cell
        dataRow[header] = "";
        continue;
      }

      // If it's a formula cell that has been cached, use .w (formatted text)
      let rawVal: string;
      if (typeof cell.f !== "undefined") {
        // Formula cell — use .w if available, otherwise empty
        rawVal = cell.w ?? "";
      } else if (cell.t === "s" || cell.t === "n" || cell.t === "b") {
        rawVal = cell.w ?? String(cell.v ?? "");
      } else {
        rawVal = String(cell.v ?? "");
      }

      dataRow[header] = stripFormulaChars(rawVal.trim());
      hasData = true;
    }
    if (hasData) rows.push(dataRow);
  }

  return { headers: headers.filter(Boolean), rows };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // keep as strings to prevent formula execution
    transform: (value) => stripFormulaChars(String(value).trim()),
  });

  const headers = result.meta.fields ?? [];
  // Deduplicate headers
  const seen = new Set<string>();
  const uniqueHeaders: string[] = [];
  for (const h of headers) {
    if (!seen.has(h)) { seen.add(h); uniqueHeaders.push(h); }
  }

  return { headers: uniqueHeaders, rows: result.data as Record<string, string>[] };
}

// ── Row validator ─────────────────────────────────────────────────────────────

function validateRow(
  rawValues: Record<string, string>,
  mapping: ColumnMapping[],
  variables: TemplateVariable[],
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  const variableMap = new Map(variables.map((v) => [v.key, v]));

  for (const col of mapping) {
    if (!col.templateVariableKey) continue;
    const variable = variableMap.get(col.templateVariableKey);
    if (!variable) continue;

    const rawVal = rawValues[col.csvHeader] ?? "";

    if (variable.required && !rawVal) {
      errors.push(`Required field "${variable.label}" is empty`);
      continue;
    }

    // Type checks
    if (rawVal) {
      if (variable.type === "number" || variable.type === "currency") {
        if (isNaN(Number(rawVal))) {
          errors.push(`Field "${variable.label}" expects a number, got "${rawVal}"`);
        }
      } else if (variable.type === "url" || variable.type === "image") {
        try {
          const u = new URL(rawVal);
          if (!["https:", "http:"].includes(u.protocol)) {
            errors.push(`Field "${variable.label}" must be a valid URL`);
          }
        } catch {
          errors.push(`Field "${variable.label}" must be a valid URL`);
        }
      } else if (variable.type === "boolean") {
        const lower = rawVal.toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(lower)) {
          errors.push(`Field "${variable.label}" expects boolean (true/false), got "${rawVal}"`);
        }
      } else if (variable.type === "date") {
        const d = new Date(rawVal);
        if (isNaN(d.getTime())) {
          errors.push(`Field "${variable.label}" expects a date, got "${rawVal}"`);
        }
      }
    }
  }

  return { rowIndex, rawValues, valid: errors.length === 0, errors };
}

// ── coerce row to RenderDataRow ───────────────────────────────────────────────

function toRenderDataRow(
  parsedRow: ParsedRow,
  mapping: ColumnMapping[],
  variables: TemplateVariable[],
): RenderDataRow {
  const variableMap = new Map(variables.map((v) => [v.key, v]));
  const result: RenderDataRow = {};

  for (const col of mapping) {
    if (!col.templateVariableKey) continue;
    const variable = variableMap.get(col.templateVariableKey);
    if (!variable) continue;

    const rawVal = parsedRow.rawValues[col.csvHeader] ?? "";

    if (variable.type === "number" || variable.type === "currency") {
      result[col.templateVariableKey] = rawVal ? Number(rawVal) : null;
    } else if (variable.type === "boolean") {
      const lower = rawVal.toLowerCase();
      result[col.templateVariableKey] = ["true", "1", "yes"].includes(lower);
    } else {
      result[col.templateVariableKey] = rawVal || null;
    }
  }

  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BulkCreatePage() {
  const [, params] = useRoute("/design-templates/:id/bulk-create");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const templateId = parseInt(params?.id ?? "0", 10);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "mapping" | "review" | "creating">("upload");
  const [fileName, setFileName] = useState<string>("");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [allRawRows, setAllRawRows] = useState<Record<string, string>[]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [showInvalidRows, setShowInvalidRows] = useState(false);
  const [batchName, setBatchName] = useState(`Batch ${new Date().toLocaleDateString()}`);
  const [isCreating, setIsCreating] = useState(false);

  // Load template + active version
  const { data: template, isLoading: templateLoading } = useQuery<Template>({
    queryKey: ["design-template", templateId],
    queryFn: () => apiFetch(`/api/ai/design-templates/${templateId}`),
    enabled: !!templateId,
  });

  const { data: versionsData } = useQuery<{ versions: TemplateVersion[] }>({
    queryKey: ["design-template-versions", templateId],
    queryFn: () => apiFetch(`/api/ai/design-templates/${templateId}/versions`),
    enabled: !!templateId,
  });

  const activeVersion = versionsData?.versions?.find(
    (v) => v.id === template?.activeVersionId,
  ) ?? versionsData?.versions?.[0];
  const variables: TemplateVariable[] = activeVersion?.templateJson?.variables ?? [];

  // ── File upload handler ────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    let headers: string[] = [];
    let rows: Record<string, string>[] = [];

    try {
      if (file.name.endsWith(".csv") || file.type === "text/csv") {
        const text = await file.text();
        ({ headers, rows } = parseCsvText(text));
      } else if (file.name.match(/\.xlsx?$/i)) {
        const buf = await file.arrayBuffer();
        ({ headers, rows } = parseXlsxFile(buf));
      } else {
        toast({ title: "Unsupported file type", description: "Please upload a CSV or XLSX file.", variant: "destructive" });
        return;
      }
    } catch (err) {
      toast({ title: "Parse error", description: String(err), variant: "destructive" });
      return;
    }

    // Deduplicate headers
    const seen = new Set<string>();
    const uniqueHeaders: string[] = [];
    for (const h of headers) {
      const key = seen.has(h) ? `${h}_${seen.size}` : h;
      seen.add(key);
      uniqueHeaders.push(key);
    }

    setParsedHeaders(uniqueHeaders);
    setAllRawRows(rows);

    // Auto-map: if CSV header matches template variable key exactly (case-insensitive)
    const autoMappings: ColumnMapping[] = uniqueHeaders.map((h) => {
      const match = variables.find(
        (v) => v.key.toLowerCase() === h.toLowerCase() || v.label.toLowerCase() === h.toLowerCase(),
      );
      return { csvHeader: h, templateVariableKey: match?.key ?? null };
    });
    setColumnMappings(autoMappings);
    setStep("mapping");
  }, [variables, toast]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Run validation when mapping changes ───────────────────────────────────

  const runValidation = useCallback(() => {
    const validated = allRawRows.map((row, idx) =>
      validateRow(row, columnMappings, variables, idx),
    );
    setParsedRows(validated);
    setStep("review");
  }, [allRawRows, columnMappings, variables]);

  // ── Create batch ──────────────────────────────────────────────────────────

  const handleCreateBatch = useCallback(async () => {
    if (!activeVersion) return;

    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      toast({ title: "No valid rows", description: "All rows have validation errors.", variant: "destructive" });
      return;
    }

    setIsCreating(true);
    setStep("creating");

    const items = validRows.map((r) => toRenderDataRow(r, columnMappings, variables));
    const idempotencyKey = uuidv4();

    try {
      const batch = await apiFetch<{ id: number }>("/api/ai/design-render-batches", {
        method: "POST",
        body: JSON.stringify({
          templateId,
          templateVersionId: activeVersion.id,
          name: batchName,
          format: "png",
          items,
        }),
        headers: { "X-Idempotency-Key": idempotencyKey },
      });

      toast({ title: "Batch created!", description: `Batch #${batch.id} with ${items.length} items.` });
      navigate(`/design-render-batches/${batch.id}`);
    } catch (err) {
      toast({ title: "Failed to create batch", description: String(err), variant: "destructive" });
      setIsCreating(false);
      setStep("review");
    }
  }, [activeVersion, parsedRows, columnMappings, variables, templateId, batchName, navigate, toast]);

  // ── Computed ──────────────────────────────────────────────────────────────

  const totalRows = allRawRows.length;
  const validRows = parsedRows.filter((r) => r.valid);
  const invalidRows = parsedRows.filter((r) => !r.valid);
  const requiredVarKeys = variables.filter((v) => v.required).map((v) => v.key);
  const mappedKeys = columnMappings.map((m) => m.templateVariableKey).filter(Boolean);
  const allRequiredMapped = requiredVarKeys.every((k) => mappedKeys.includes(k));
  const isMegaDataset = totalRows > MAX_INLINE_ROWS;

  const previewRows = isMegaDataset
    ? [
        ...parsedRows.slice(0, PREVIEW_ROW_COUNT),
        ...parsedRows.slice(Math.max(0, parsedRows.length - PREVIEW_ROW_COUNT)),
      ]
    : parsedRows;

  if (templateLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/design-studio")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Bulk Create</h1>
          <p className="text-sm text-muted-foreground">
            Template: <strong>{template?.name ?? "Loading…"}</strong>
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex gap-2">
        {(["upload", "mapping", "review", "creating"] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <Badge variant={step === s ? "default" : parsedRows.length > 0 && i < ["upload","mapping","review","creating"].indexOf(step) ? "secondary" : "outline"}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </Badge>
          </div>
        ))}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div
          className="border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-primary transition-colors"
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium mb-1">Drop a CSV or XLSX file here</p>
          <p className="text-sm text-muted-foreground">or click to browse</p>
          <p className="text-xs text-muted-foreground mt-2">Max 10,000 rows recommended. Formula cells are skipped for safety.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={onFileSelect}
          />
        </div>
      )}

      {/* Step: Column Mapping */}
      {step === "mapping" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Column Mapping</h2>
              <p className="text-sm text-muted-foreground">
                File: <strong>{fileName}</strong> · {totalRows.toLocaleString()} rows detected
                {isMegaDataset && <span className="ml-1 text-amber-600 font-medium">(large dataset — preview only)</span>}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setStep("upload"); setFileName(""); }}>
              <X className="h-4 w-4 mr-1" /> Change file
            </Button>
          </div>

          {variables.length === 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              This template version has no defined variables. Rows will be submitted as-is.
            </div>
          )}

          <div className="border rounded-lg divide-y">
            {parsedHeaders.map((header) => {
              const mapping = columnMappings.find((m) => m.csvHeader === header)!;
              return (
                <div key={header} className="flex items-center gap-4 p-3">
                  <div className="flex-1">
                    <span className="text-sm font-medium font-mono">{header}</span>
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex-1">
                    <Select
                      value={mapping?.templateVariableKey ?? "__none__"}
                      onValueChange={(val) => {
                        setColumnMappings((prev) =>
                          prev.map((m) =>
                            m.csvHeader === header
                              ? { ...m, templateVariableKey: val === "__none__" ? null : val }
                              : m,
                          ),
                        );
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="— skip —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— skip column —</SelectItem>
                        {variables.map((v) => (
                          <SelectItem key={v.key} value={v.key}>
                            {v.label} ({v.key}){v.required ? " *" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Required variable coverage */}
          {requiredVarKeys.length > 0 && (
            <div className={cn(
              "p-3 rounded-lg text-sm",
              allRequiredMapped ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-800",
            )}>
              {allRequiredMapped
                ? "✓ All required variables are mapped."
                : `✗ Required variables not mapped: ${requiredVarKeys.filter((k) => !mappedKeys.includes(k)).join(", ")}`}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={runValidation} disabled={!allRequiredMapped && requiredVarKeys.length > 0}>
              Validate Rows →
            </Button>
          </div>
        </div>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Review & Confirm</h2>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{validRows.length.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Valid rows</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{invalidRows.length.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Invalid rows (excluded)</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{totalRows.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total rows</p>
            </div>
          </div>

          {isMegaDataset && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                Dataset has {totalRows.toLocaleString()} rows — only first/last {PREVIEW_ROW_COUNT} shown in preview to avoid DOM overload. All valid rows will be submitted.
              </span>
            </div>
          )}

          {/* Invalid rows summary */}
          {invalidRows.length > 0 && (
            <div className="border border-red-200 rounded-lg">
              <button
                className="w-full flex items-center justify-between p-3 text-sm font-medium text-red-800"
                onClick={() => setShowInvalidRows(!showInvalidRows)}
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {invalidRows.length} invalid rows will be excluded (shown below)
                </span>
                {showInvalidRows ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showInvalidRows && (
                <div className="border-t border-red-200 divide-y divide-red-100 max-h-64 overflow-y-auto">
                  {invalidRows.slice(0, 10).map((row) => (
                    <div key={row.rowIndex} className="p-3 text-xs">
                      <span className="font-medium">Row {row.rowIndex + 2}:</span>{" "}
                      {row.errors.join(" · ")}
                    </div>
                  ))}
                  {invalidRows.length > 10 && (
                    <div className="p-3 text-xs text-muted-foreground">
                      … and {invalidRows.length - 10} more invalid rows
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Data preview */}
          <div className="border rounded-lg overflow-hidden">
            <div className="p-2 bg-muted text-xs font-medium">
              Row preview
              {isMegaDataset && ` (first & last ${PREVIEW_ROW_COUNT} of ${totalRows.toLocaleString()})`}
            </div>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 text-left">#</th>
                    {parsedHeaders.slice(0, 6).map((h) => (
                      <th key={h} className="p-2 text-left font-mono">{h}</th>
                    ))}
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 40).map((row) => (
                    <tr key={row.rowIndex} className={cn("border-b", row.valid ? "" : "bg-red-50")}>
                      <td className="p-2 text-muted-foreground">{row.rowIndex + 2}</td>
                      {parsedHeaders.slice(0, 6).map((h) => (
                        <td key={h} className="p-2 max-w-24 truncate">{row.rawValues[h] ?? ""}</td>
                      ))}
                      <td className="p-2">
                        {row.valid
                          ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                          : <AlertTriangle className="h-3 w-3 text-red-600" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Batch name */}
          <div className="space-y-1">
            <Label>Batch name</Label>
            <input
              type="text"
              value={batchName}
              onChange={(e) => setBatchName(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              placeholder="Batch name…"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep("mapping")}>
              ← Back
            </Button>
            <Button
              onClick={handleCreateBatch}
              disabled={validRows.length === 0 || isCreating || !batchName.trim()}
            >
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Batch ({validRows.length.toLocaleString()} rows)
            </Button>
          </div>
        </div>
      )}

      {/* Step: Creating */}
      {step === "creating" && (
        <div className="flex flex-col items-center justify-center h-48 gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Creating batch…</p>
        </div>
      )}
    </div>
  );
}
