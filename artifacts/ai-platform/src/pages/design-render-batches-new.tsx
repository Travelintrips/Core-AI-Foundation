/**
 * Phase 6A — Bulk Create Wizard
 * Route: /design-render-batches/new?templateId=&versionId=
 *
 * Steps:
 *   1. Upload dataset (CSV / XLSX)
 *   2. Map columns → template variables
 *   3. Review validation + submit batch
 */
import { useState, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileText, ArrowRight, ArrowLeft, CheckCircle2,
  AlertTriangle, X, ChevronDown, ChevronUp, Loader2, Table,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { templateApi, batchApi, type TemplateVariableMeta } from "@/services/design-batch-api";
import { parseCSV, DATASET_LIMITS, type ParsedDataset } from "@/utils/dataset-import/csvParser";
import { parseXLSX } from "@/utils/dataset-import/xlsxParser";
import {
  validateDataset, suggestMappings,
  type ColumnMapping, type ValidationSummary,
} from "@/utils/dataset-import/validator";

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = ["Upload Dataset", "Map Columns", "Review & Submit"] as const;
type Step = 0 | 1 | 2;

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-none">
          <div className={`flex items-center gap-2 ${i <= current ? "text-indigo-400" : "text-gray-600"}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              i < current ? "bg-indigo-600 border-indigo-600 text-white"
              : i === current ? "border-indigo-500 text-indigo-400 bg-indigo-500/10"
              : "border-gray-700 text-gray-600"
            }`}>
              {i < current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className="text-xs font-medium hidden sm:block">{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`flex-1 h-px mx-3 ${i < current ? "bg-indigo-600" : "bg-gray-800"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Step 1: Upload Dataset ─────────────────────────────────────────────────────

function UploadStep({
  onParsed,
}: { onParsed: (ds: ParsedDataset) => void }) {
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setParsing(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let dataset: ParsedDataset;
      if (ext === "csv" || ext === "txt") {
        dataset = await parseCSV(file);
      } else if (ext === "xlsx" || ext === "xls") {
        dataset = await parseXLSX(file);
      } else {
        throw new Error("Unsupported file type. Please upload a CSV or XLSX file.");
      }
      onParsed(dataset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setParsing(false);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, []);

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Upload Dataset</h2>
      <p className="text-sm text-gray-400 mb-6">
        Upload a CSV or Excel file. Max {DATASET_LIMITS.MAX_ROWS.toLocaleString()} rows, {DATASET_LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          dragging ? "border-indigo-500 bg-indigo-500/10" : "border-gray-700 hover:border-gray-600 bg-gray-900/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.txt"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        {parsing ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
            <span className="text-sm text-gray-400">Parsing file…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="h-10 w-10 text-gray-600" />
            <div>
              <p className="text-sm font-medium text-gray-300">Drop file here or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">CSV, XLSX supported</p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Format guide */}
      <div className="mt-6 p-4 rounded-lg bg-gray-900/60 border border-gray-800">
        <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Format Guide</p>
        <ul className="text-xs text-gray-500 space-y-1">
          <li>• First row must be column headers</li>
          <li>• UTF-8 encoding recommended</li>
          <li>• Image columns should contain HTTPS URLs</li>
          <li>• Formula cells are read as their computed value</li>
        </ul>
      </div>
    </div>
  );
}

// ── Step 2: Column Mapping ─────────────────────────────────────────────────────

function MappingStep({
  dataset,
  variables,
  mappings,
  onMappingsChange,
}: {
  dataset: ParsedDataset;
  variables: TemplateVariableMeta[];
  mappings: ColumnMapping[];
  onMappingsChange: (m: ColumnMapping[]) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);

  function setColumnForVariable(variableKey: string, columnName: string | null) {
    onMappingsChange(mappings.map((m) =>
      m.variableKey === variableKey ? { ...m, columnName } : m,
    ));
  }

  function setDefaultForVariable(variableKey: string, val: string) {
    onMappingsChange(mappings.map((m) =>
      m.variableKey === variableKey ? { ...m, defaultValue: val } : m,
    ));
  }

  const unmappedRequired = variables.filter(
    (v) => v.required && !mappings.find((m) => m.variableKey === v.key)?.columnName,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-white">Map Columns</h2>
        <Badge className="text-xs" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}>
          {dataset.totalRows} rows · {dataset.headers.length} columns
        </Badge>
      </div>
      <p className="text-sm text-gray-400 mb-4">Match dataset columns to template variables.</p>

      {unmappedRequired.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-300">
            Required variables not mapped: {unmappedRequired.map((v) => v.label).join(", ")}
          </p>
        </div>
      )}

      {/* Mapping table */}
      <div className="rounded-xl border border-gray-800 overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900/80 text-xs text-gray-500 uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-semibold w-1/3">Template Variable</th>
              <th className="text-left px-4 py-3 font-semibold w-1/3">Dataset Column</th>
              <th className="text-left px-4 py-3 font-semibold w-1/3">Default Value</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((v, idx) => {
              const mapping = mappings.find((m) => m.variableKey === v.key);
              const isMapped = !!mapping?.columnName;
              return (
                <tr key={v.key} className={`border-t border-gray-800 ${idx % 2 === 0 ? "" : "bg-gray-900/30"}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-200">{v.label}</span>
                      {v.required && <Badge className="text-[10px] px-1.5 bg-red-500/20 text-red-400 border-red-500/30">required</Badge>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-mono">{v.key}</span> · {v.type}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={mapping?.columnName ?? ""}
                      onChange={(e) => setColumnForVariable(v.key, e.target.value || null)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">— unmapped —</option>
                      {dataset.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                    {isMapped && (
                      <p className="text-xs text-indigo-400 mt-1">
                        Sample: "{dataset.preview[0]?.[mapping!.columnName!] ?? ""}"
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      placeholder="Optional default"
                      value={mapping?.defaultValue ?? ""}
                      onChange={(e) => setDefaultForVariable(v.key, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dataset warnings */}
      {dataset.warnings.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-gray-800/60 border border-gray-700">
          <p className="text-xs font-semibold text-gray-400 mb-1">Parse Notices</p>
          {dataset.warnings.map((w, i) => (
            <p key={i} className="text-xs text-gray-500">{w}</p>
          ))}
        </div>
      )}

      {/* Preview toggle */}
      <button
        onClick={() => setShowPreview((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300"
      >
        <Table className="h-3.5 w-3.5" />
        {showPreview ? "Hide" : "Show"} dataset preview (first {Math.min(dataset.preview.length, 5)} rows)
        {showPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {showPreview && (
        <div className="mt-2 rounded-xl border border-gray-800 overflow-x-auto">
          <table className="text-xs min-w-full">
            <thead>
              <tr className="bg-gray-900/80">
                {dataset.headers.slice(0, 8).map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold whitespace-nowrap">{h}</th>
                ))}
                {dataset.headers.length > 8 && <th className="px-3 py-2 text-gray-600">…</th>}
              </tr>
            </thead>
            <tbody>
              {dataset.preview.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t border-gray-800">
                  {dataset.headers.slice(0, 8).map((h) => (
                    <td key={h} className="px-3 py-2 text-gray-400 max-w-[120px] truncate">{row[h] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Step 3: Review & Submit ────────────────────────────────────────────────────

function ReviewStep({
  summary,
  batchName,
  setBatchName,
  format,
  setFormat,
  onlyValid,
  setOnlyValid,
}: {
  summary: ValidationSummary;
  batchName: string;
  setBatchName: (v: string) => void;
  format: string;
  setFormat: (v: string) => void;
  onlyValid: boolean;
  setOnlyValid: (v: boolean) => void;
}) {
  const [showInvalid, setShowInvalid] = useState(false);
  const invalidRows = summary.validatedRows.filter((r) => !r.isValid);

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-1">Review & Submit</h2>
      <p className="text-sm text-gray-400 mb-6">Confirm batch settings before creating.</p>

      {/* Validation summary */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total Rows", value: summary.totalRows, color: "text-gray-300" },
          { label: "Valid", value: summary.validRows, color: "text-green-400" },
          { label: "Invalid", value: summary.invalidRows, color: summary.invalidRows > 0 ? "text-red-400" : "text-gray-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-4 bg-gray-900/60 border border-gray-800 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Invalid rows toggle */}
      {invalidRows.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={onlyValid}
                  onChange={(e) => setOnlyValid(e.target.checked)}
                />
                <div className="w-9 h-5 bg-gray-700 rounded-full peer peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
              </label>
              <span className="text-sm text-gray-300">Render valid rows only ({summary.validRows} rows)</span>
            </div>
            <button
              onClick={() => setShowInvalid((p) => !p)}
              className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
            >
              {showInvalid ? "Hide" : "Show"} invalid rows
              {showInvalid ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {!onlyValid && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
              Submission is blocked when invalid rows are included. Toggle the option above to render valid rows only.
            </div>
          )}

          {showInvalid && (
            <div className="mt-2 rounded-xl border border-red-500/20 overflow-hidden max-h-60 overflow-y-auto">
              <table className="text-xs w-full">
                <thead className="bg-gray-900/80">
                  <tr>
                    <th className="px-3 py-2 text-left text-gray-500">Row #</th>
                    <th className="px-3 py-2 text-left text-gray-500">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {invalidRows.slice(0, 100).map((row) => (
                    <tr key={row.rowIndex} className="border-t border-gray-800">
                      <td className="px-3 py-2 text-gray-400 font-mono">{row.rowIndex + 1}</td>
                      <td className="px-3 py-2 text-red-400">
                        {row.errors.map((e) => `${e.variableKey}: ${e.message}`).join(" · ")}
                      </td>
                    </tr>
                  ))}
                  {invalidRows.length > 100 && (
                    <tr className="border-t border-gray-800">
                      <td colSpan={2} className="px-3 py-2 text-gray-600 text-center">
                        …and {invalidRows.length - 100} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Batch settings */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">Batch Name *</Label>
          <Input
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="e.g. Product Launch Batch"
            className="bg-gray-800 border-gray-700 text-gray-200"
          />
        </div>
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">Output Format</Label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="png">PNG</option>
            <option value="jpg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────────

export default function DesignRenderBatchesNewPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const templateId = params.get("templateId") ? parseInt(params.get("templateId")!, 10) : null;
  const versionId  = params.get("versionId")  ? parseInt(params.get("versionId")!,  10) : null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>(0);
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [batchName, setBatchName] = useState("");
  const [format, setFormat]     = useState("png");
  const [onlyValid, setOnlyValid] = useState(true);

  // Fetch template + version info
  const { data: templates } = useQuery({
    queryKey: ["design-templates-list"],
    queryFn: () => templateApi.list({ pageSize: 100 }),
    enabled: !templateId,
  });

  const [selectedTemplateId, setSelectedTemplateId] = useState(templateId);
  const [selectedVersionId, setSelectedVersionId]   = useState(versionId);

  const { data: versions } = useQuery({
    queryKey: ["design-template-versions", selectedTemplateId],
    queryFn: () => selectedTemplateId ? templateApi.listVersions(selectedTemplateId) : null,
    enabled: !!selectedTemplateId,
  });

  const selectedVersion = versions?.versions.find((v) => v.id === selectedVersionId)
    ?? versions?.versions.find((v) => v.status === "published")
    ?? versions?.versions[0];

  const variables: TemplateVariableMeta[] = selectedVersion?.variables ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTemplateId || !selectedVersion) throw new Error("No template selected");
      if (!dataset || !summary) throw new Error("No dataset loaded");

      const rows = onlyValid
        ? summary.validatedRows.filter((r) => r.isValid).map((r) => r.data)
        : summary.validatedRows.map((r) => r.data);

      if (rows.length === 0) throw new Error("No valid rows to render");

      const idempotencyKey = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const batch = await batchApi.create({
        templateId: selectedTemplateId,
        templateVersionId: selectedVersion.id,
        name: batchName || `Batch ${new Date().toLocaleDateString()}`,
        format: format as "png" | "jpg" | "webp" | "pdf",
        items: rows,
        idempotencyKey,
      });

      // Auto-start
      await batchApi.start(batch.id);
      return batch;
    },
    onSuccess: (batch) => {
      qc.invalidateQueries({ queryKey: ["design-render-batches"] });
      toast({ title: "Batch created & queued!", description: `${summary?.validRows} items enqueued.` });
      navigate(`/design-render-batches/${batch.id}`);
    },
    onError: (e: Error) => toast({ title: "Failed to create batch", description: e.message, variant: "destructive" }),
  });

  function handleDatasetParsed(ds: ParsedDataset) {
    setDataset(ds);
    if (variables.length > 0) {
      const suggested = suggestMappings(ds.headers, variables);
      setMappings(suggested);
    }
    setStep(1);
  }

  function handleGoToReview() {
    if (!dataset || variables.length === 0) return;
    const result = validateDataset(dataset.rows, variables, mappings);
    setSummary(result);
    setStep(2);
  }

  const canProceedToReview = () => {
    const unmappedRequired = variables.filter(
      (v) => v.required && !mappings.find((m) => m.variableKey === v.key)?.columnName,
    );
    return unmappedRequired.length === 0 && !!dataset;
  };

  const canSubmit = () => summary !== null && batchName.trim() &&
    (summary.invalidRows === 0 || onlyValid) &&
    (onlyValid ? summary.validRows > 0 : summary.totalRows > 0);

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate("/design-render-batches")}
          className="text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">New Bulk Render Batch</h1>
          <p className="text-sm text-gray-500">Upload dataset → map variables → render at scale</p>
        </div>
      </div>

      {/* Template selector (if not pre-selected) */}
      {!templateId && (
        <div className="mb-6 p-4 rounded-xl bg-gray-900/60 border border-gray-800">
          <Label className="text-xs text-gray-400 mb-2 block">Select Template</Label>
          <div className="grid grid-cols-2 gap-3">
            <select
              value={selectedTemplateId ?? ""}
              onChange={(e) => { setSelectedTemplateId(e.target.value ? parseInt(e.target.value, 10) : null); setSelectedVersionId(null); }}
              className="bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-3 py-2"
            >
              <option value="">— Select template —</option>
              {templates?.items.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {versions?.versions && (
              <select
                value={selectedVersionId ?? ""}
                onChange={(e) => setSelectedVersionId(e.target.value ? parseInt(e.target.value, 10) : null)}
                className="bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-3 py-2"
              >
                {versions.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} — {v.status} ({v.canvasWidth}×{v.canvasHeight}px)
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-gray-900/40 border border-gray-800 p-8">
        <StepBar current={step} />

        {step === 0 && <UploadStep onParsed={handleDatasetParsed} />}

        {step === 1 && dataset && (
          <>
            <MappingStep
              dataset={dataset}
              variables={variables}
              mappings={mappings}
              onMappingsChange={setMappings}
            />
            <div className="flex justify-between mt-8">
              <Button variant="ghost" onClick={() => { setDataset(null); setStep(0); }}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button onClick={handleGoToReview} disabled={!canProceedToReview()}>
                Next: Review <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </>
        )}

        {step === 2 && summary && (
          <>
            <ReviewStep
              summary={summary}
              batchName={batchName}
              setBatchName={setBatchName}
              format={format}
              setFormat={setFormat}
              onlyValid={onlyValid}
              setOnlyValid={setOnlyValid}
            />
            <div className="flex justify-between mt-8">
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit() || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating…</>
                ) : (
                  <><CheckCircle2 className="h-4 w-4 mr-2" /> Create & Start Batch</>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
