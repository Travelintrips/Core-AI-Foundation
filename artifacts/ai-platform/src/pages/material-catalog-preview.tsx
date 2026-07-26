/**
 * Material Catalog Preview — Phase 4 Admin UI
 *
 * Admin-only page for dry-run preview of the official material catalog provider.
 * Calls POST /api/material-catalog/import-preview (always dryRun: true).
 *
 * PREVIEW ONLY — no import, save, sync, overwrite, or merge actions.
 */

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Database,
  Eye,
  FileJson,
  Info,
  Loader2,
  PackageSearch,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────

const ADMIN_KEY = (import.meta as unknown as { env: Record<string, string> }).env?.["VITE_ADMIN_API_KEY"] ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-admin-api-key": ADMIN_KEY,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProviderStatus {
  catalogEnabled: boolean;
  niroGraniteEnabled: boolean;
  registeredProviders: Array<{
    providerId: string;
    displayName: string;
    sourceType: string;
    capabilities: {
      supportedBrands: string[];
      supportedCountries: string[];
      supportsPagination: boolean;
      supportsFiltering: boolean;
      maxItemsPerFetch: number;
      requiresCredentials: boolean;
    };
  }>;
  totalRegistered: number;
}

interface MediaReference {
  kind: string;
  url?: string;
  assetId?: string;
  fixturePath?: string;
  rawValue?: string;
}

interface ClassifiedItem {
  item: {
    externalId: string;
    providerId: string;
    productName: string;
    brand?: string;
    category?: string;
    subcategory?: string;
    materialType?: string;
    color?: string[];
    finish?: string[];
    texture?: string;
    priceTier?: string;
    thumbnailReference?: MediaReference;
    previewReferences?: MediaReference[];
    sourceUrl?: string;
    sourceMetadata?: Record<string, unknown>;
    country?: string;
    locale?: string;
  };
  classification: "new" | "exact_duplicate" | "possible_duplicate" | "invalid" | "conflicting_identity";
  normalizationWarnings: string[];
}

interface ImportReport {
  runId: string;
  providerId: string;
  startedAt: string;
  completedAt: string;
  status: "completed" | "completed_with_warnings" | "failed" | "rejected";
  counts: {
    totalReceived: number;
    validCount: number;
    invalidCount: number;
    newCount: number;
    exactDuplicateCount: number;
    possibleDuplicateCount: number;
  };
  warnings: string[];
  validationErrors: string[];
  providerErrors: string[];
  previewSummary: string;
  items: ClassifiedItem[];
  nextCursor?: string;
  payloadSizeBytes?: number;
  sourceMetadata?: Record<string, unknown>;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ClassificationBadge({ c }: { c: ClassifiedItem["classification"] }) {
  const map: Record<ClassifiedItem["classification"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    new: { label: "New", variant: "default" },
    exact_duplicate: { label: "Exact Duplicate", variant: "destructive" },
    possible_duplicate: { label: "Possible Duplicate", variant: "secondary" },
    invalid: { label: "Invalid", variant: "destructive" },
    conflicting_identity: { label: "Conflicting", variant: "secondary" },
  };
  const { label, variant } = map[c] ?? { label: c, variant: "outline" };
  return <Badge variant={variant} className="text-[10px] whitespace-nowrap">{label}</Badge>;
}

function StatusBadge({ status }: { status: ImportReport["status"] }) {
  const map = {
    completed: { icon: CheckCircle2, label: "Completed", color: "text-green-500" },
    completed_with_warnings: { icon: TriangleAlert, label: "Completed (Warnings)", color: "text-yellow-500" },
    failed: { icon: XCircle, label: "Failed", color: "text-red-500" },
    rejected: { icon: XCircle, label: "Rejected", color: "text-red-500" },
  };
  const { icon: Icon, label, color } = map[status] ?? { icon: Info, label: status, color: "text-muted-foreground" };
  return (
    <span className={`flex items-center gap-1 font-medium ${color}`}>
      <Icon className="size-4" /> {label}
    </span>
  );
}

function MediaPreview({ ref: mediaRef }: { ref?: MediaReference }) {
  if (!mediaRef) return <span className="text-xs text-muted-foreground">—</span>;
  if (mediaRef.kind === "remote_url" && mediaRef.url) {
    return (
      <a href={mediaRef.url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={mediaRef.url}
          alt="material preview"
          className="h-10 w-10 object-cover rounded border border-border"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      </a>
    );
  }
  return (
    <span className="text-xs text-muted-foreground font-mono">
      {mediaRef.kind}
      {mediaRef.assetId ? `: ${mediaRef.assetId}` : ""}
      {mediaRef.rawValue ? `: ${mediaRef.rawValue}` : ""}
    </span>
  );
}

function ProviderStatusPanel({ status, loading, error }: {
  status: ProviderStatus | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading provider status…</div>;
  if (error) return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Provider status error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!status) return null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            {status.catalogEnabled
              ? <CheckCircle2 className="size-4 text-green-500" />
              : <XCircle className="size-4 text-muted-foreground" />}
            <span className="text-xs font-medium">Catalog Integration</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {status.catalogEnabled ? "Enabled" : "Disabled"} <code className="text-[10px]">MATERIAL_CATALOG_INTEGRATION_ENABLED</code>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            {status.niroGraniteEnabled
              ? <CheckCircle2 className="size-4 text-green-500" />
              : <XCircle className="size-4 text-muted-foreground" />}
            <span className="text-xs font-medium">Niro Granite Provider</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {status.niroGraniteEnabled ? "Enabled" : "Disabled"} <code className="text-[10px]">MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED</code>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium">Registered Providers</span>
          </div>
          <p className="text-2xl font-bold mt-1">{status.totalRegistered}</p>
        </div>
      </div>

      {status.registeredProviders.map((p) => (
        <div key={p.providerId} className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-500" />
            <span className="font-medium text-sm">{p.displayName}</span>
            <Badge variant="outline" className="text-[10px]">{p.sourceType}</Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
            <span>Brands: {p.capabilities.supportedBrands.join(", ") || "—"}</span>
            <span>Countries: {p.capabilities.supportedCountries.join(", ") || "—"}</span>
            <span>Max per fetch: {p.capabilities.maxItemsPerFetch}</span>
            <span>Pagination: {p.capabilities.supportsPagination ? "Yes" : "No"}</span>
            <span>Filtering: {p.capabilities.supportsFiltering ? "Yes" : "No"}</span>
            <span>Credentials: {p.capabilities.requiresCredentials ? "Required" : "None"}</span>
          </div>
        </div>
      ))}

      {status.totalRegistered === 0 && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>No providers registered</AlertTitle>
          <AlertDescription>
            Both <code>MATERIAL_CATALOG_INTEGRATION_ENABLED</code> and <code>MATERIAL_NIRO_GRANITE_PROVIDER_ENABLED</code> must be set to <code>true</code> for preview to be available.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ReportSummary({ report }: { report: ImportReport }) {
  const { counts } = report;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={report.status} />
        <span className="text-xs text-muted-foreground font-mono">{report.runId}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(report.startedAt).toLocaleTimeString()} — {report.previewSummary}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          { label: "Received", value: counts.totalReceived, color: "" },
          { label: "Valid", value: counts.validCount, color: "text-green-600" },
          { label: "Invalid", value: counts.invalidCount, color: counts.invalidCount > 0 ? "text-red-500" : "" },
          { label: "New", value: counts.newCount, color: "text-blue-500" },
          { label: "Exact Dup.", value: counts.exactDuplicateCount, color: counts.exactDuplicateCount > 0 ? "text-orange-500" : "" },
          { label: "Possible Dup.", value: counts.possibleDuplicateCount, color: counts.possibleDuplicateCount > 0 ? "text-yellow-600" : "" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-3 py-2 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-[10px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {report.payloadSizeBytes !== undefined && (
        <p className="text-xs text-muted-foreground">
          Payload size: {(report.payloadSizeBytes / 1024).toFixed(1)} KB
          {" · "}Execution: {Math.round((new Date(report.completedAt).getTime() - new Date(report.startedAt).getTime()))}ms
        </p>
      )}
    </div>
  );
}

function WarningsErrors({ warnings, validationErrors, providerErrors }: {
  warnings: string[];
  validationErrors: string[];
  providerErrors: string[];
}) {
  const hasAny = warnings.length + validationErrors.length + providerErrors.length > 0;
  if (!hasAny) return null;

  return (
    <div className="space-y-2">
      {providerErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Provider errors ({providerErrors.length})</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {providerErrors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {validationErrors.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Validation errors ({validationErrors.length})</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {validationErrors.slice(0, 10).map((e, i) => <li key={i}>• {e}</li>)}
              {validationErrors.length > 10 && <li className="text-muted-foreground">… and {validationErrors.length - 10} more</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertTitle>Warnings ({warnings.length})</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {warnings.slice(0, 10).map((w, i) => <li key={i}>• {w}</li>)}
              {warnings.length > 10 && <li className="text-muted-foreground">… and {warnings.length - 10} more</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ItemsTable({ items }: { items: ClassifiedItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">No items to display.</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">Media</TableHead>
            <TableHead>ID / Name</TableHead>
            <TableHead>Brand / Category</TableHead>
            <TableHead>Classification</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((ci, idx) => (
            <TableRow key={ci.item.externalId || idx} className={ci.classification === "invalid" ? "opacity-50" : ""}>
              <TableCell>
                <MediaPreview ref={ci.item.thumbnailReference} />
              </TableCell>
              <TableCell>
                <div className="font-medium text-sm">{ci.item.productName || <span className="text-muted-foreground italic">—</span>}</div>
                <div className="text-[10px] text-muted-foreground font-mono">{ci.item.externalId || "—"}</div>
                {ci.item.sourceUrl && (
                  <a href={ci.item.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline truncate block max-w-[180px]">
                    {ci.item.sourceUrl}
                  </a>
                )}
              </TableCell>
              <TableCell>
                <div className="text-xs">{ci.item.brand ?? "—"}</div>
                <div className="text-[10px] text-muted-foreground">{[ci.item.category, ci.item.subcategory].filter(Boolean).join(" › ") || "—"}</div>
                {ci.item.materialType && <div className="text-[10px] text-muted-foreground">{ci.item.materialType}</div>}
              </TableCell>
              <TableCell>
                <ClassificationBadge c={ci.classification} />
                {ci.normalizationWarnings.length > 0 && (
                  <div className="mt-1 text-[10px] text-yellow-600">⚠ {ci.normalizationWarnings.length} norm. warning(s)</div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {ci.item.color?.map((c) => <Badge key={c} variant="outline" className="text-[9px]">{c}</Badge>)}
                  {ci.item.finish?.map((f) => <Badge key={f} variant="outline" className="text-[9px]">{f}</Badge>)}
                  {ci.item.priceTier && <Badge variant="secondary" className="text-[9px]">{ci.item.priceTier}</Badge>}
                </div>
                {ci.item.country && <div className="text-[10px] text-muted-foreground mt-0.5">{ci.item.country} · {ci.item.locale ?? ""}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SourceMetadataPanel({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
        <FileJson className="size-3.5" /> Source metadata
      </p>
      <pre className="text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MaterialCatalogPreview() {
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [report, setReport] = useState<ImportReport | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Pagination
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  // Controls
  const [providerId, setProviderId] = useState("niro-granite-official");
  const [maxRecords, setMaxRecords] = useState(50);
  const [filterBrand, setFilterBrand] = useState("");
  const [filterCountry, setFilterCountry] = useState("");

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const data = await apiFetch<ProviderStatus>("/api/material-catalog/providers");
      setProviderStatus(data);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const runPreview = useCallback(async (nextCursor?: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const body = {
        providerId,
        options: {
          dryRun: true,
          maxRecords,
          cursor: nextCursor,
          brand: filterBrand || undefined,
          country: filterCountry || undefined,
        },
      };
      const data = await apiFetch<{ report: ImportReport }>("/api/material-catalog/import-preview", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReport(data.report);
      setCursor(data.report.nextCursor);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }, [providerId, maxRecords, filterBrand, filterCountry]);

  const handleFirstPage = () => {
    setCursorHistory([]);
    runPreview(undefined);
  };

  const handleNextPage = () => {
    if (!cursor) return;
    setCursorHistory((prev) => [...prev, cursor]);
    runPreview(cursor);
  };

  const handlePrevPage = () => {
    const prev = [...cursorHistory];
    const lastCursor = prev.pop();
    setCursorHistory(prev);
    runPreview(lastCursor);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <PackageSearch className="size-5" /> Material Catalog Provider Preview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dry-run preview only — no data is imported, saved, or written to the database.
          </p>
        </div>
        <Badge variant="outline" className="text-xs bg-yellow-50 border-yellow-300 text-yellow-700">
          Preview Only · No DB Writes
        </Badge>
      </div>

      {/* Provider Status */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Provider Status</h2>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={loadStatus} disabled={statusLoading}>
            {statusLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            {providerStatus ? "Refresh" : "Check Status"}
          </Button>
        </div>
        <ProviderStatusPanel status={providerStatus} loading={statusLoading} error={statusError} />
      </div>

      {/* Preview Controls */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <h2 className="text-sm font-medium">Preview Configuration</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Provider ID</label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="niro-granite-official">niro-granite-official</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Records (1–500)</label>
            <Input
              type="number"
              min={1}
              max={500}
              value={maxRecords}
              onChange={(e) => setMaxRecords(Math.min(500, Math.max(1, Number(e.target.value))))}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Brand filter (optional)</label>
            <Input
              placeholder="e.g. Niro Granite"
              value={filterBrand}
              onChange={(e) => setFilterBrand(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Country filter (optional)</label>
            <Input
              placeholder="e.g. ID"
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleFirstPage}
            disabled={previewLoading}
            className="gap-1.5"
          >
            {previewLoading ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            Run Preview
          </Button>
          <p className="text-xs text-muted-foreground">
            Always dry-run · Zero database writes · Zero canonical mutations
          </p>
        </div>
      </div>

      {/* Preview error */}
      {previewError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Preview failed</AlertTitle>
          <AlertDescription>{previewError}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {report && (
        <div className="space-y-4">
          {/* Summary */}
          <ReportSummary report={report} />

          {/* Warnings / Errors */}
          <WarningsErrors
            warnings={report.warnings}
            validationErrors={report.validationErrors}
            providerErrors={report.providerErrors}
          />

          {/* Accordion: items / metadata / raw report */}
          <Accordion type="multiple" defaultValue={["items"]} className="space-y-2">
            <AccordionItem value="items" className="border border-border rounded-lg px-4">
              <AccordionTrigger className="text-sm font-medium py-3">
                Normalized Items ({report.items.length})
              </AccordionTrigger>
              <AccordionContent>
                <ItemsTable items={report.items} />

                {/* Pagination */}
                {(report.nextCursor || cursorHistory.length > 0) && (
                  <div className="flex items-center justify-between pt-3 border-t border-border mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePrevPage}
                      disabled={cursorHistory.length === 0 || previewLoading}
                      className="gap-1"
                    >
                      ← Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {cursorHistory.length + 1}
                      {report.nextCursor ? "" : " (last)"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleNextPage}
                      disabled={!report.nextCursor || previewLoading}
                      className="gap-1"
                    >
                      Next <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="metadata" className="border border-border rounded-lg px-4">
              <AccordionTrigger className="text-sm font-medium py-3">
                Source Metadata
              </AccordionTrigger>
              <AccordionContent>
                <SourceMetadataPanel metadata={report.sourceMetadata} />
                {!report.sourceMetadata && <p className="text-xs text-muted-foreground">No source metadata returned by provider.</p>}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="raw" className="border border-border rounded-lg px-4">
              <AccordionTrigger className="text-sm font-medium py-3">
                Export Preview Report (raw JSON)
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-lg bg-muted/30 p-3">
                  <pre className="text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-96">
                    {JSON.stringify({ ...report, items: `[${report.items.length} items — omitted for brevity]` }, null, 2)}
                  </pre>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </div>
  );
}
