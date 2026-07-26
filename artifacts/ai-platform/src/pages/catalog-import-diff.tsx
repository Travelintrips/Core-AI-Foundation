/**
 * Extraction Diff Viewer — Phase 4B
 * Admin-only read-only panel showing the 4-stage extraction pipeline
 * for a single staging item:
 *
 *   SOURCE → EXTRACTED → NORMALIZED → STAGED
 *
 * Highlights: missing values, changed values, normalized values, warnings.
 * No editing allowed.
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, AlertTriangle, CheckCircle2, Info, Loader2, MinusCircle, RefreshCw, GitCompare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";

interface FieldDiff {
  field: string;
  source: unknown;
  extracted: unknown;
  normalized: unknown;
  staged: unknown;
  isMissing: boolean;
  isChanged: boolean;
  isNormalized: boolean;
  hasWarning: boolean;
}

interface DiffResult {
  stagingId: string;
  jobId: string;
  status: string;
  sourcePage: number | null;
  sourceType: string;
  stages: {
    source: Record<string, unknown>;
    extracted: Record<string, unknown>;
    normalized: Record<string, unknown>;
    staged: Record<string, unknown>;
  };
  fieldDiffs: FieldDiff[];
  warnings: string[];
  duplicateInfo: { classification: string; matchedKey?: string; reason?: string } | null;
  extractedAt: string;
}

const STAGE_LABELS = ["SOURCE", "EXTRACTED", "NORMALIZED", "STAGED"];
const STAGE_KEYS = ["source", "extracted", "normalized", "staged"] as const;

const STAGE_COLORS = [
  "border-blue-500/40 bg-blue-500/5",
  "border-purple-500/40 bg-purple-500/5",
  "border-amber-500/40 bg-amber-500/5",
  "border-green-500/40 bg-green-500/5",
];

const STAGE_BADGE_COLORS = [
  "bg-blue-500/20 text-blue-300",
  "bg-purple-500/20 text-purple-300",
  "bg-amber-500/20 text-amber-300",
  "bg-green-500/20 text-green-300",
];

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.join(", ");
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function isMeaningful(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

/** Parse jobId and stagingId from the current path: /catalog-import-diff/:jobId/:stagingId */
function useParams(): { jobId: string; stagingId: string } {
  const [location] = useLocation();
  const parts = location.split("/").filter(Boolean);
  // /catalog-import-diff/:jobId/:stagingId
  const idx = parts.findIndex((p) => p === "catalog-import-diff");
  return {
    jobId: idx >= 0 ? (parts[idx + 1] ?? "") : "",
    stagingId: idx >= 0 ? (parts[idx + 2] ?? "") : "",
  };
}

export default function CatalogImportDiffPage() {
  const { jobId, stagingId } = useParams();
  const [, navigate] = useLocation();
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "missing" | "changed" | "warning">("all");

  const fetchDiff = async () => {
    if (!jobId || !stagingId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/universal-catalog/jobs/${jobId}/items/${stagingId}/diff`,
        { headers: { "x-admin-api-key": ADMIN_KEY } },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as DiffResult;
      setDiff(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDiff(); }, [jobId, stagingId]);

  if (!jobId || !stagingId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Invalid URL — jobId and stagingId are required.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const filteredDiffs = diff?.fieldDiffs.filter((d) => {
    if (filter === "missing") return d.isMissing;
    if (filter === "changed") return d.isChanged;
    if (filter === "warning") return d.hasWarning;
    return true;
  }) ?? [];

  // Summary counts
  const missingCount = diff?.fieldDiffs.filter((d) => d.isMissing).length ?? 0;
  const changedCount = diff?.fieldDiffs.filter((d) => d.isChanged).length ?? 0;
  const warningCount = diff?.fieldDiffs.filter((d) => d.hasWarning).length ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/catalog-import?jobId=${jobId}`)}
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Import
            </Button>
          </div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="w-6 h-6 text-purple-400" />
            Extraction Diff Viewer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compare SOURCE → EXTRACTED → NORMALIZED → STAGED for one material item.
            Read-only. No canonical write.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchDiff} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
            <p>Loading extraction diff…</p>
          </CardContent>
        </Card>
      )}

      {diff && !loading && (
        <>
          {/* ── Item Summary ─────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Item Summary</CardTitle>
              <CardDescription>
                Staging ID: <code className="font-mono text-xs">{diff.stagingId}</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge variant="outline">{diff.sourceType.toUpperCase()}</Badge>
              {diff.sourcePage !== null && (
                <Badge variant="outline">Page {diff.sourcePage}</Badge>
              )}
              <Badge
                variant={
                  diff.status === "normalized" ? "default"
                  : diff.status === "duplicate" ? "secondary"
                  : "destructive"
                }
              >
                {diff.status}
              </Badge>
              {diff.duplicateInfo && (
                <Badge variant="secondary">
                  {diff.duplicateInfo.classification.replace(/_/g, " ")}
                </Badge>
              )}
              {diff.warnings.length > 0 && (
                <Badge variant="destructive">
                  {diff.warnings.length} validation error{diff.warnings.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardContent>
          </Card>

          {/* ── Pipeline Stage Overview ──────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STAGE_KEYS.map((k, i) => {
              const stageData = diff.stages[k];
              const fieldCount = Object.keys(stageData).filter(
                (key) => isMeaningful(stageData[key]),
              ).length;
              return (
                <Card key={k} className={`border ${STAGE_COLORS[i]}`}>
                  <CardContent className="p-3 text-center">
                    <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${STAGE_BADGE_COLORS[i].split(" ")[1]}`}>
                      {STAGE_LABELS[i]}
                    </p>
                    <p className="text-2xl font-bold">{fieldCount}</p>
                    <p className="text-xs text-muted-foreground">fields present</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* ── Diff Summary Chips ───────────────────────────────────── */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all" as const, label: `All fields (${diff.fieldDiffs.length})`, color: "" },
              { key: "missing" as const, label: `Missing in STAGED (${missingCount})`, color: "text-red-400" },
              { key: "changed" as const, label: `Changed from EXTRACTED (${changedCount})`, color: "text-amber-400" },
              { key: "warning" as const, label: `Has warning (${warningCount})`, color: "text-orange-400" },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  filter === key
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border hover:border-muted-foreground text-muted-foreground"
                } ${color}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Field-by-Field Diff Table ────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Field Comparison</CardTitle>
              <CardDescription>
                Each row shows the same field across all 4 pipeline stages.
                Highlights: <span className="text-red-400">missing</span>,{" "}
                <span className="text-amber-400">changed</span>,{" "}
                <span className="text-green-400">normalized</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {filteredDiffs.length === 0 ? (
                <p className="text-muted-foreground text-sm p-4">
                  No fields match the current filter.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-2 px-3 font-medium w-36">Field</th>
                        {STAGE_LABELS.map((l, i) => (
                          <th key={l} className={`text-left py-2 px-3 font-medium ${STAGE_BADGE_COLORS[i].split(" ")[1]}`}>
                            {l}
                          </th>
                        ))}
                        <th className="py-2 px-3 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredDiffs.map((d) => (
                        <DiffRow key={d.field} diff={d} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Validation Errors ────────────────────────────────────── */}
          {diff.warnings.length > 0 && (
            <Card className="border-red-500/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Validation Errors ({diff.warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {diff.warnings.map((e, i) => (
                    <li key={i} className="text-sm text-red-300 flex gap-2">
                      <span>·</span>{e}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* ── Duplicate Info ───────────────────────────────────────── */}
          {diff.duplicateInfo && (
            <Card className="border-amber-500/30">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="w-4 h-4 text-amber-400" />
                  Duplicate Detection
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Classification:</span>{" "}
                  <Badge variant="secondary">
                    {diff.duplicateInfo.classification.replace(/_/g, " ")}
                  </Badge>
                </p>
                {diff.duplicateInfo.matchedKey && (
                  <p>
                    <span className="text-muted-foreground">Matched key:</span>{" "}
                    <code className="font-mono text-xs">{diff.duplicateInfo.matchedKey}</code>
                  </p>
                )}
                {diff.duplicateInfo.reason && (
                  <p>
                    <span className="text-muted-foreground">Reason:</span>{" "}
                    {diff.duplicateInfo.reason}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Raw Stage Data ────────────────────────────────────────── */}
          <details className="group">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground py-2 select-none">
              ▸ View raw stage data (JSON)
            </summary>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
              {STAGE_KEYS.map((k, i) => (
                <Card key={k} className={`border ${STAGE_COLORS[i]}`}>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className={`text-xs uppercase tracking-wider ${STAGE_BADGE_COLORS[i].split(" ")[1]}`}>
                      {STAGE_LABELS[i]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <pre className="text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap break-all text-muted-foreground">
                      {JSON.stringify(diff.stages[k], null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          </details>
        </>
      )}

      {!diff && !loading && !error && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
            <GitCompare className="w-10 h-10 opacity-30" />
            <p className="text-sm">Loading diff data…</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── DiffRow ───────────────────────────────────────────────────────────────────

function DiffRow({ diff: d }: { diff: FieldDiff }) {
  const stageValues = [d.source, d.extracted, d.normalized, d.staged];

  const rowBg = d.isMissing
    ? "bg-red-500/5"
    : d.hasWarning
      ? "bg-orange-500/5"
      : d.isChanged
        ? "bg-amber-500/5"
        : "";

  return (
    <tr className={`${rowBg} hover:bg-muted/20`}>
      <td className="py-2 px-3 font-mono font-medium text-muted-foreground align-top">
        {d.field}
      </td>
      {stageValues.map((v, i) => {
        const meaningful = isMeaningful(v);
        const isLastStage = i === 3;
        const prevMeaningful = i > 0 && isMeaningful(stageValues[i - 1]);
        const valueChanged =
          meaningful && prevMeaningful &&
          JSON.stringify(v) !== JSON.stringify(stageValues[i - 1]);

        return (
          <td
            key={i}
            className={`py-2 px-3 align-top max-w-xs ${
              !meaningful
                ? "text-muted-foreground/30"
                : isLastStage && d.isMissing
                  ? "text-red-400"
                  : valueChanged
                    ? "text-amber-300"
                    : d.isNormalized && i >= 2
                      ? "text-green-300"
                      : ""
            }`}
          >
            <span className="break-all whitespace-pre-wrap">
              {formatValue(v)}
            </span>
          </td>
        );
      })}
      <td className="py-2 px-3 align-top">
        {d.isMissing && (
          <Tooltip>
            <TooltipTrigger>
              <MinusCircle className="w-3 h-3 text-red-400" />
            </TooltipTrigger>
            <TooltipContent>Missing in STAGED</TooltipContent>
          </Tooltip>
        )}
        {!d.isMissing && d.isChanged && (
          <Tooltip>
            <TooltipTrigger>
              <AlertTriangle className="w-3 h-3 text-amber-400" />
            </TooltipTrigger>
            <TooltipContent>Value changed during normalization</TooltipContent>
          </Tooltip>
        )}
        {!d.isMissing && !d.isChanged && isMeaningful(d.staged) && (
          <Tooltip>
            <TooltipTrigger>
              <CheckCircle2 className="w-3 h-3 text-green-400" />
            </TooltipTrigger>
            <TooltipContent>Field persisted successfully</TooltipContent>
          </Tooltip>
        )}
      </td>
    </tr>
  );
}
