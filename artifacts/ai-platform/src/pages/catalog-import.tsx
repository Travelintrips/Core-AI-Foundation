/**
 * Universal Catalog Import — Admin UI
 * Phase 4A: Preview only. No Import button. No Save button.
 * Shows extraction progress, detected products, duplicate summary, warnings, errors.
 */

import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Upload, Globe, FileText, Table, FileJson, Code2, Cpu, AlertTriangle, CheckCircle2, Info, Loader2, ChevronDown, ChevronRight, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";

type AdapterSourceType = "pdf" | "website" | "csv" | "excel" | "json" | "xml" | "api";

interface StagingItem {
  stagingId: string;
  status: string;
  // Identity
  brand?: string | null;
  collection?: string | null;
  series?: string | null;
  productCode?: string | null;
  productName?: string | null;
  variant?: string | null;
  // Classification
  category?: string | null;
  subcategory?: string | null;
  materialType?: string | null;
  // Description
  description?: string | null;
  // Appearance
  colors?: string[] | null;
  finish?: string[] | null;
  texture?: string | null;
  pattern?: string | null;
  // Dimensions
  workingSize?: string | null;
  thickness?: string | null;
  numberOfFaces?: number | null;
  // Tile
  peiRating?: number | null;
  shadeVariation?: string | null;
  // Technical
  application?: string[] | null;
  certifications?: string[] | null;
  // Provenance
  sourceType: string;
  sourceName?: string | null;
  sourcePage?: number | null;
  sourceVersion?: string | null;
  duplicateInfo?: { classification: string; matchedKey?: string; reason?: string } | null;
  validationErrors: string[];
  extractedAt?: string;
}

interface PreviewResult {
  jobId: string;
  status: string;
  sourceType: string;
  sourceName: string;
  counts: {
    totalRaw: number;
    totalNormalized: number;
    new: number;
    exact_duplicate: number;
    possible_duplicate: number;
    conflicting_identity: number;
    invalid: number;
    needs_review: number;
  };
  items: StagingItem[];
  warnings: string[];
  errors: string[];
  processedAt: string;
}

const SOURCE_OPTIONS: { value: AdapterSourceType; label: string; icon: React.ReactNode; requiresFile: boolean; requiresUrl: boolean; accept?: string }[] = [
  { value: "pdf", label: "PDF Catalog", icon: <FileText className="w-4 h-4" />, requiresFile: true, requiresUrl: false, accept: ".pdf,application/pdf" },
  { value: "website", label: "Public Website", icon: <Globe className="w-4 h-4" />, requiresFile: false, requiresUrl: true },
  { value: "csv", label: "CSV File", icon: <Table className="w-4 h-4" />, requiresFile: true, requiresUrl: false, accept: ".csv,text/csv" },
  { value: "excel", label: "Excel File", icon: <Table className="w-4 h-4" />, requiresFile: true, requiresUrl: false, accept: ".xlsx,.xls" },
  { value: "json", label: "JSON File", icon: <FileJson className="w-4 h-4" />, requiresFile: true, requiresUrl: false, accept: ".json,application/json" },
  { value: "xml", label: "XML File", icon: <Code2 className="w-4 h-4" />, requiresFile: true, requiresUrl: false, accept: ".xml,text/xml" },
  { value: "api", label: "Official API (Blocked)", icon: <Cpu className="w-4 h-4" />, requiresFile: false, requiresUrl: false },
];

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  normalized: { label: "New", variant: "default" },
  duplicate: { label: "Duplicate", variant: "secondary" },
  needs_review: { label: "Review", variant: "outline" },
  draft: { label: "Invalid", variant: "destructive" },
};

export default function CatalogImportPage() {
  const [, navigate] = useLocation();
  const [sourceType, setSourceType] = useState<AdapterSourceType>("csv");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [maxItems, setMaxItems] = useState(100);
  const [skipAI, setSkipAI] = useState(false);
  const [brandHint, setBrandHint] = useState("");
  const [categoryHint, setCategoryHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedSource = SOURCE_OPTIONS.find((s) => s.value === sourceType);

  const handleRunPreview = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("sourceType", sourceType);
      if (file) formData.append("file", file);
      if (url) formData.append("url", url);
      formData.append(
        "options",
        JSON.stringify({
          maxItems,
          skipAI,
          brandHint: brandHint || undefined,
          categoryHint: categoryHint || undefined,
        }),
      );

      const res = await fetch(`${API_BASE}/api/universal-catalog/preview`, {
        method: "POST",
        headers: { "x-admin-api-key": ADMIN_KEY },
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as PreviewResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const canRun = !loading && (
    (selectedSource?.requiresFile && file) ||
    (selectedSource?.requiresUrl && url) ||
    (!selectedSource?.requiresFile && !selectedSource?.requiresUrl)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Catalog Import Preview</h1>
        <p className="text-muted-foreground mt-1">
          Universal material catalog ingestion engine — Phase 4A. Preview only. No data enters the Material Library automatically.
        </p>
        <Alert className="mt-3 border-amber-500/40 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertDescription className="text-amber-200">
            This is a <strong>dry-run preview</strong>. Results are stored in a staging area only. No canonical materials are created or modified.
          </AlertDescription>
        </Alert>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Source Selector ─────────────────────────────────────────── */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source</CardTitle>
              <CardDescription>Select the catalog format</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Format</Label>
                <Select value={sourceType} onValueChange={(v) => { setSourceType(v as AdapterSourceType); setFile(null); setUrl(""); }}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-2">
                          {opt.icon}
                          {opt.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* File Upload */}
              {selectedSource?.requiresFile && (
                <div>
                  <Label>File</Label>
                  <div
                    className="mt-1 border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {file ? (
                      <div className="space-y-1">
                        <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" />
                        <p className="text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-5 h-5 mx-auto text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Click to upload {selectedSource.label}</p>
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept={selectedSource.accept}
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
              )}

              {/* URL Input */}
              {selectedSource?.requiresUrl && (
                <div>
                  <Label>Website URL (HTTPS only)</Label>
                  <Input
                    className="mt-1"
                    placeholder="https://example.com/catalog"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>
              )}

              {/* API stub notice */}
              {sourceType === "api" && (
                <Alert className="border-red-500/40 bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  <AlertDescription className="text-red-300 text-xs">
                    Official API integration is blocked pending prerequisite clearance. See Phase 5 task.
                  </AlertDescription>
                </Alert>
              )}

              {/* Options */}
              <div>
                <Label>Max Items</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min={1}
                  max={500}
                  value={maxItems}
                  onChange={(e) => setMaxItems(Math.min(500, Math.max(1, parseInt(e.target.value) || 100)))}
                />
              </div>

              {/* Advanced Options */}
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {showAdvanced ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Advanced options
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 mt-3">
                  <div>
                    <Label>Brand hint</Label>
                    <Input className="mt-1" placeholder="e.g. Niro Granite" value={brandHint} onChange={(e) => setBrandHint(e.target.value)} />
                  </div>
                  <div>
                    <Label>Category hint</Label>
                    <Input className="mt-1" placeholder="e.g. Flooring" value={categoryHint} onChange={(e) => setCategoryHint(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="skipAI" checked={skipAI} onChange={(e) => setSkipAI(e.target.checked)} className="rounded" />
                    <Label htmlFor="skipAI">Skip AI extraction (raw passthrough)</Label>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Button onClick={handleRunPreview} disabled={!canRun} className="w-full">
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processing…</> : "Run Preview"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ── Results ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <Card>
              <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin" />
                <p>Running extraction pipeline…</p>
                <p className="text-xs">PDF and website sources may take up to 30 seconds</p>
              </CardContent>
            </Card>
          )}

          {result && !loading && (
            <>
              {/* ── Extraction Summary ───────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Extraction Progress</CardTitle>
                  <CardDescription>
                    Job {result.jobId} · {result.sourceName} · {new Date(result.processedAt).toLocaleTimeString()}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Raw extracted" value={result.counts.totalRaw} color="text-blue-400" />
                    <Stat label="Normalized" value={result.counts.totalNormalized} color="text-green-400" />
                    <Stat label="New" value={result.counts.new} color="text-emerald-400" />
                    <Stat label="Needs review" value={result.counts.needs_review} color="text-amber-400" />
                  </div>
                </CardContent>
              </Card>

              {/* ── Duplicate Summary ────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Duplicate Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <DupStat label="Exact duplicate" value={result.counts.exact_duplicate} color="bg-gray-500/20 text-gray-300" />
                    <DupStat label="Possible duplicate" value={result.counts.possible_duplicate} color="bg-amber-500/20 text-amber-300" />
                    <DupStat label="Conflicting identity" value={result.counts.conflicting_identity} color="bg-orange-500/20 text-orange-300" />
                    <DupStat label="Invalid / incomplete" value={result.counts.invalid} color="bg-red-500/20 text-red-300" />
                  </div>
                </CardContent>
              </Card>

              {/* ── Detected Products ────────────────────────────── */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detected Products ({result.items.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {result.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm p-4">No products detected</p>
                  ) : (
                    <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                      {result.items.map((item) => (
                        <Collapsible
                          key={item.stagingId}
                          open={expandedItem === item.stagingId}
                          onOpenChange={(open) => setExpandedItem(open ? item.stagingId : null)}
                        >
                          <CollapsibleTrigger className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 text-left">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm truncate">{item.productName ?? "(no name)"}</span>
                                {item.brand && <span className="text-xs text-muted-foreground">{item.brand}</span>}
                                {item.productCode && <Badge variant="outline" className="text-xs">{item.productCode}</Badge>}
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {item.category && <span className="text-xs text-muted-foreground">{item.category}</span>}
                                {item.sourcePage && <span className="text-xs text-muted-foreground">p.{item.sourcePage}</span>}
                                <Badge
                                  variant={STATUS_BADGE[item.status]?.variant ?? "outline"}
                                  className="text-xs"
                                >
                                  {STATUS_BADGE[item.status]?.label ?? item.status}
                                </Badge>
                                {item.duplicateInfo && (
                                  <Badge variant="secondary" className="text-xs">
                                    {item.duplicateInfo.classification.replace(/_/g, " ")}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {expandedItem === item.stagingId
                              ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="px-4 pb-3 pt-1 space-y-1.5 bg-muted/20 text-xs">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                {item.collection && <p><span className="text-muted-foreground">Collection:</span> {item.collection}</p>}
                                {item.series && <p><span className="text-muted-foreground">Series:</span> {item.series}</p>}
                                {item.variant && <p><span className="text-muted-foreground">Variant:</span> {item.variant}</p>}
                                {item.materialType && <p><span className="text-muted-foreground">Type:</span> {item.materialType}</p>}
                                {item.subcategory && <p><span className="text-muted-foreground">Subcategory:</span> {item.subcategory}</p>}
                                {item.description && <p className="col-span-2"><span className="text-muted-foreground">Description:</span> {item.description}</p>}
                                {item.colors && item.colors.length > 0 && <p><span className="text-muted-foreground">Colors:</span> {item.colors.join(", ")}</p>}
                                {item.finish && item.finish.length > 0 && <p><span className="text-muted-foreground">Finish:</span> {item.finish.join(", ")}</p>}
                                {item.texture && <p><span className="text-muted-foreground">Texture:</span> {item.texture}</p>}
                                {item.pattern && <p><span className="text-muted-foreground">Pattern:</span> {item.pattern}</p>}
                                {item.workingSize && <p><span className="text-muted-foreground">Size:</span> {item.workingSize}</p>}
                                {item.thickness && <p><span className="text-muted-foreground">Thickness:</span> {item.thickness}</p>}
                                {item.peiRating != null && <p><span className="text-muted-foreground">PEI:</span> {item.peiRating}</p>}
                                {item.shadeVariation && <p><span className="text-muted-foreground">Shade:</span> {item.shadeVariation}</p>}
                                {item.application && item.application.length > 0 && <p><span className="text-muted-foreground">Application:</span> {item.application.join(", ")}</p>}
                                {item.certifications && item.certifications.length > 0 && <p><span className="text-muted-foreground">Certifications:</span> {item.certifications.join(", ")}</p>}
                              </div>
                              {item.duplicateInfo?.reason && (
                                <p className="text-amber-300"><span className="text-muted-foreground">Duplicate reason:</span> {item.duplicateInfo.reason}</p>
                              )}
                              {item.validationErrors.length > 0 && (
                                <div>
                                  <p className="text-red-400 font-medium">Validation errors:</p>
                                  {item.validationErrors.map((e, i) => (
                                    <p key={i} className="text-red-300 ml-2">· {e}</p>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-between pt-1">
                                <p className="text-muted-foreground font-mono">ID: {item.stagingId}</p>
                                {result && (
                                  <button
                                    onClick={(ev) => { ev.stopPropagation(); navigate(`/catalog-import-diff/${result.jobId}/${item.stagingId}`); }}
                                    className="flex items-center gap-1 text-purple-400 hover:text-purple-300 transition-colors"
                                  >
                                    <GitCompare className="w-3 h-3" />
                                    View Diff
                                  </button>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Warnings ─────────────────────────────────────── */}
              {result.warnings.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Info className="w-4 h-4 text-amber-400" />
                      Warnings ({result.warnings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {result.warnings.map((w, i) => (
                        <li key={i} className="text-sm text-amber-300 flex gap-2">
                          <span className="shrink-0">·</span>{w}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* ── Errors ───────────────────────────────────────── */}
              {result.errors.length > 0 && (
                <Card className="border-red-500/30">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      Errors ({result.errors.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {result.errors.map((e, i) => (
                        <li key={i} className="text-sm text-red-300 flex gap-2">
                          <span className="shrink-0">·</span>{e}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {!result && !loading && !error && (
            <Card>
              <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                <Upload className="w-10 h-10 opacity-30" />
                <p className="text-sm">Select a source and run the preview to see results</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/30">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function DupStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded px-3 py-2 flex items-center justify-between ${color}`}>
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
