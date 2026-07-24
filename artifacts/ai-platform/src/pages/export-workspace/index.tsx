/**
 * Export Workspace — Team 17
 *
 * Universal design export UI. Lets admin users:
 *  1. Choose a format (PDF, PPTX, PNG, JPEG, ZIP, …)
 *  2. Pick an optional preset
 *  3. Configure export settings (resolution, quality, pages, filename, …)
 *  4. Get a cost/time estimate before submitting
 *  5. Submit the export job and track progress
 *  6. Download the result via a signed URL
 *
 * Uses the existing design system (shadcn/ui). No demo data presented as live data.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileOutput,
  RefreshCw,
  XCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Info,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

// ── API base ──────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";


async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",

      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(String(body["error"] ?? `HTTP ${res.status}`));
  }
  return res.json() as Promise<T>;
}

// ── Types (mirrors backend contracts) ────────────────────────────────────────

interface ExportFormatDefinition {
  formatId: string;
  label: string;
  mimeType: string;
  extension: string;
  engineType: string;
  available: boolean;
  unavailableReason?: string;
  supportsResolution: boolean;
  supportsDimensions: boolean;
  supportsQuality: boolean;
  supportsCompression: boolean;
  supportsBackground: boolean;
  supportsPageSelection: boolean;
  supportsVersionSelection: boolean;
  supportsMetadata: boolean;
  supportsFilename: boolean;
}

interface ExportPreset {
  presetId: string;
  label: string;
  formatId: string;
  settings: Record<string, unknown>;
}

interface ExportEstimate {
  formatId: string;
  label: string;
  pageCount: number;
  estimatedCostCents: number;
  estimatedDurationSeconds: number;
  available: boolean;
  unavailableReason?: string;
  notes: string[];
}

interface ExportJobSummary {
  jobId: number;
  jobCode: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "canceled" | "retrying";
  formatId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  retryCount: number;
  canCancel: boolean;
  canRetry: boolean;
}

interface ExportResult {
  jobId: number;
  status: "succeeded" | "failed";
  formatId: string;
  filename: string;
  mimeType: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  downloadExpiresAt?: string;
  errorMessage?: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ExportJobSummary["status"] }) {
  const config: Record<
    ExportJobSummary["status"],
    { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
  > = {
    queued: { label: "Queued", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
    processing: { label: "Processing", variant: "default", icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
    succeeded: { label: "Succeeded", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
    canceled: { label: "Canceled", variant: "outline", icon: <XCircle className="h-3 w-3" /> },
    retrying: { label: "Retrying", variant: "secondary", icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  };

  const { label, variant, icon } = config[status] ?? config.queued;
  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {label}
    </Badge>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExportWorkspacePage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Form state ─────────────────────────────────────────────────────────────

  const [projectId, setProjectId] = useState("");
  const [formatId, setFormatId] = useState("");
  const [presetId, setPresetId] = useState("");
  const [filename, setFilename] = useState("");
  const [resolution, setResolution] = useState<string>("");
  const [quality, setQuality] = useState<string>("");
  const [compression, setCompression] = useState<string>("");
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [includeAnnotations, setIncludeAnnotations] = useState(false);
  const [pageCount, setPageCount] = useState<string>("1");

  // ── Active job tracking ─────────────────────────────────────────────────────

  const [activeJobId, setActiveJobId] = useState<number | null>(null);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: formatsData } = useQuery({
    queryKey: ["export-workspace", "formats"],
    queryFn: () => apiFetch<{ formats: ExportFormatDefinition[] }>("/api/ai/export-workspace/formats"),
  });

  const { data: presetsData } = useQuery({
    queryKey: ["export-workspace", "presets"],
    queryFn: () => apiFetch<{ presets: ExportPreset[] }>("/api/ai/export-workspace/presets"),
  });

  const selectedFormat = formatsData?.formats.find((f) => f.formatId === formatId);

  // Build request object for estimate / submit
  const buildRequest = useCallback(() => ({
    projectId,
    settings: {
      formatId,
      ...(resolution ? { resolution: parseInt(resolution) } : {}),
      ...(quality ? { quality: parseInt(quality) } : {}),
      ...(compression ? { compression: parseInt(compression) } : {}),
      includeMetadata,
      includeAnnotations,
      ...(filename ? { filename } : {}),
    },
  }), [projectId, formatId, resolution, quality, compression, includeMetadata, includeAnnotations, filename]);

  // Estimate query — re-runs when form changes
  const { data: estimateData, isFetching: estimating } = useQuery({
    queryKey: ["export-workspace", "estimate", buildRequest(), pageCount],
    queryFn: () =>
      apiFetch<{ estimate: ExportEstimate }>("/api/ai/export-workspace/estimate", {
        method: "POST",
        body: JSON.stringify({ request: buildRequest(), pageCount: parseInt(pageCount) || 1 }),
      }),
    enabled: !!formatId && !!projectId,
    retry: false,
  });

  // Job status polling
  const { data: jobData } = useQuery({
    queryKey: ["export-workspace", "job", activeJobId],
    queryFn: () =>
      apiFetch<ExportJobSummary>(`/api/ai/export-workspace/jobs/${activeJobId}`),
    enabled: activeJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" || status === "retrying" ? 3000 : false;
    },
  });

  // Job result
  const { data: resultData } = useQuery({
    queryKey: ["export-workspace", "result", activeJobId],
    queryFn: () =>
      apiFetch<ExportResult>(`/api/ai/export-workspace/jobs/${activeJobId}/result`),
    enabled: jobData?.status === "succeeded" || jobData?.status === "failed",
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ jobId: number; jobCode: string }>("/api/ai/export-workspace/submit", {
        method: "POST",
        body: JSON.stringify({ request: buildRequest() }),
      }),
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      qc.invalidateQueries({ queryKey: ["export-workspace", "job", data.jobId] });
      toast({ title: "Export submitted", description: `Job #${data.jobCode} is queued.` });
    },
    onError: (err: Error) => {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiFetch(`/api/ai/export-workspace/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["export-workspace", "job", activeJobId] });
      toast({ title: "Export cancelled" });
    },
    onError: (err: Error) => {
      toast({ title: "Cancel failed", description: err.message, variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiFetch<{ jobId: number; jobCode: string }>(`/api/ai/export-workspace/jobs/${jobId}/retry`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setActiveJobId(data.jobId);
      qc.invalidateQueries({ queryKey: ["export-workspace", "job", data.jobId] });
      toast({ title: "Export retried", description: `New job #${data.jobCode} queued.` });
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Preset apply ─────────────────────────────────────────────────────────────

  const applyPreset = (pid: string) => {
    const preset = presetsData?.presets.find((p) => p.presetId === pid);
    if (!preset) return;
    setFormatId(preset.settings["formatId"] as string ?? "");
    setPresetId(pid);
    if (typeof preset.settings["resolution"] === "number") {
      setResolution(String(preset.settings["resolution"]));
    }
    if (typeof preset.settings["quality"] === "number") {
      setQuality(String(preset.settings["quality"]));
    }
  };

  const estimate = estimateData?.estimate;
  const job = jobData;
  const result = resultData;
  const canSubmit = !!projectId && !!formatId && selectedFormat?.available !== false;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileOutput className="h-6 w-6" />
            Export Workspace
          </h1>
          <p className="text-muted-foreground mt-1">
            Select a format, configure export settings, and download your design assets.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ── Left: Configuration ───────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Project ID */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Project</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <Label htmlFor="projectId">Project ID</Label>
                  <Input
                    id="projectId"
                    placeholder="e.g. proj-abc123"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Preset picker */}
            {presetsData && presetsData.presets.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Preset</CardTitle>
                  <CardDescription>Apply a preset to fill in recommended settings.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select value={presetId} onValueChange={applyPreset}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a preset…" />
                    </SelectTrigger>
                    <SelectContent>
                      {presetsData.presets.map((p) => (
                        <SelectItem key={p.presetId} value={p.presetId}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            )}

            {/* Format picker */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Format</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {formatsData?.formats.map((fmt) => (
                    <button
                      key={fmt.formatId}
                      onClick={() => setFormatId(fmt.formatId)}
                      className={[
                        "rounded-lg border p-3 text-left transition-all",
                        !fmt.available
                          ? "opacity-50 cursor-not-allowed bg-muted"
                          : formatId === fmt.formatId
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:border-muted-foreground/50",
                      ].join(" ")}
                      disabled={!fmt.available}
                      aria-pressed={formatId === fmt.formatId}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{fmt.label}</span>
                        {!fmt.available && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p>{fmt.unavailableReason}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground uppercase mt-0.5">{fmt.extension}</p>
                    </button>
                  ))}
                </div>

                {selectedFormat && !selectedFormat.available && (
                  <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-800">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{selectedFormat.unavailableReason}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Settings — shown only when a format is selected */}
            {selectedFormat && selectedFormat.available && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Export Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {selectedFormat.supportsResolution && (
                      <div className="space-y-1">
                        <Label htmlFor="resolution">
                          Resolution (DPI)
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="inline h-3 w-3 ml-1 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>72–600 DPI. Higher = larger file.</TooltipContent>
                          </Tooltip>
                        </Label>
                        <Input
                          id="resolution"
                          type="number"
                          min={72}
                          max={600}
                          placeholder="e.g. 300"
                          value={resolution}
                          onChange={(e) => setResolution(e.target.value)}
                        />
                      </div>
                    )}

                    {selectedFormat.supportsQuality && (
                      <div className="space-y-1">
                        <Label htmlFor="quality">Quality (1–100)</Label>
                        <Input
                          id="quality"
                          type="number"
                          min={1}
                          max={100}
                          placeholder="e.g. 85"
                          value={quality}
                          onChange={(e) => setQuality(e.target.value)}
                        />
                      </div>
                    )}

                    {selectedFormat.supportsCompression && (
                      <div className="space-y-1">
                        <Label htmlFor="compression">Compression (0–9)</Label>
                        <Input
                          id="compression"
                          type="number"
                          min={0}
                          max={9}
                          placeholder="e.g. 6"
                          value={compression}
                          onChange={(e) => setCompression(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="space-y-1">
                      <Label htmlFor="pageCount">Page count (for estimate)</Label>
                      <Input
                        id="pageCount"
                        type="number"
                        min={1}
                        placeholder="1"
                        value={pageCount}
                        onChange={(e) => setPageCount(e.target.value)}
                      />
                    </div>
                  </div>

                  {selectedFormat.supportsFilename && (
                    <div className="space-y-1">
                      <Label htmlFor="filename">Output filename</Label>
                      <Input
                        id="filename"
                        placeholder={`export.${selectedFormat.extension}`}
                        value={filename}
                        onChange={(e) => setFilename(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="flex gap-4">
                    {selectedFormat.supportsMetadata && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="metadata"
                          checked={includeMetadata}
                          onCheckedChange={(v) => setIncludeMetadata(!!v)}
                        />
                        <Label htmlFor="metadata" className="cursor-pointer">Include metadata</Label>
                      </div>
                    )}
                    {selectedFormat.supportsAnnotations && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="annotations"
                          checked={includeAnnotations}
                          onCheckedChange={(v) => setIncludeAnnotations(!!v)}
                        />
                        <Label htmlFor="annotations" className="cursor-pointer">Include annotations</Label>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right: Estimate + submit + progress ─────────────────────── */}
          <div className="space-y-4">
            {/* Estimate panel */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Estimate</CardTitle>
              </CardHeader>
              <CardContent>
                {!formatId || !projectId ? (
                  <p className="text-sm text-muted-foreground">
                    Select a format and enter a project ID to see an estimate.
                  </p>
                ) : estimating ? (
                  <p className="text-sm text-muted-foreground">Calculating…</p>
                ) : estimate ? (
                  <div className="space-y-2 text-sm">
                    {!estimate.available ? (
                      <div className="flex gap-1.5 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{estimate.unavailableReason}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pages</span>
                          <span className="font-medium">{estimate.pageCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Est. time</span>
                          <span className="font-medium">{estimate.estimatedDurationSeconds}s</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Est. cost</span>
                          <span className="font-medium">
                            {estimate.estimatedCostCents === 0
                              ? "Free"
                              : `$${(estimate.estimatedCostCents / 100).toFixed(2)}`}
                          </span>
                        </div>
                        {estimate.notes.length > 0 && (
                          <>
                            <Separator />
                            <ul className="space-y-1 text-muted-foreground">
                              {estimate.notes.map((n, i) => (
                                <li key={i} className="flex gap-1.5">
                                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  {n}
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {/* Submit button */}
            <Button
              className="w-full"
              disabled={!canSubmit || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              {submitMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Submitting…</>
              ) : (
                <><ChevronRight className="h-4 w-4 mr-2" />Submit Export</>
              )}
            </Button>

            {/* Progress / result card */}
            {job && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Job #{job.jobCode}</CardTitle>
                    <StatusBadge status={job.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Format</span>
                      <span className="uppercase font-mono">{job.formatId}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Retries</span>
                      <span>{job.retryCount}</span>
                    </div>
                    {job.errorMessage && (
                      <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive text-xs">
                        {job.errorMessage}
                      </div>
                    )}
                  </div>

                  {/* Result download */}
                  {result?.status === "succeeded" && result.downloadUrl && (
                    <a
                      href={`/api/ai/storage/download?token=${encodeURIComponent(result.downloadUrl)}`}
                      download={result.filename}
                      className="block"
                    >
                      <Button variant="default" className="w-full">
                        <Download className="h-4 w-4 mr-2" />
                        Download {result.filename}
                      </Button>
                    </a>
                  )}

                  {result?.status === "succeeded" && !result.downloadUrl && (
                    <div className="text-sm text-muted-foreground">
                      Export completed. Download link not yet available — the engine may still be processing.
                    </div>
                  )}

                  {/* Failure diagnostics */}
                  {result?.status === "failed" && (
                    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      <strong>Failure:</strong> {result.errorMessage ?? "Unknown error"}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {job.canCancel && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(job.jobId)}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                    )}
                    {job.canRetry && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(job.jobId)}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        Retry
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
