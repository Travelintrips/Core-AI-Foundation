/**
 * Team 15 — Version Timeline & History Experience
 * Route: /version-timeline
 *
 * Displays a chronological version history for Design Studio projects and
 * Design Templates. Supports selection, comparison, and restore requests.
 *
 * INTEGRATION NOTES:
 * - Team 09: Replace adaptProjectVersion/adaptTemplateVersion in utils.ts once
 *   the canonical history contract is available.
 * - Team 11: Emit VersionSelection events via the `onVersionSelect` callback
 *   prop when embedding this component inside the main editor.
 * - Team 16: `entry.status` carries the review status string for badge display.
 * - Team 18: `entry.branchLabel` can carry annotation-version compatibility.
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  History, GitBranch, Clock, User, RefreshCw, ArrowLeftRight,
  ChevronLeft, ChevronRight, Loader2, AlertTriangle, RotateCcw,
  CheckCircle, Tag, Layers, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { VersionTimelineEntry, ResourceType, VersionComparisonRequest } from "./types";
import {
  adaptProjectVersion, adaptTemplateVersion,
  sortVersionsChronological, paginateEntries, totalPages, PAGE_SIZE,
  validateComparisonRequest, canRestore, formatTimestamp,
  formatTimestampReadable, availabilityLabel,
  type RawProjectVersion, type RawTemplateVersion,
} from "./utils";

// ── API helper (same pattern as the rest of ai-platform) ─────────────────────
const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
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

// ── Status / source badge styles ──────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  saved:     "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  draft:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  published: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  active:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  archived:  "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

const SOURCE_LABELS: Record<string, string> = {
  design_project: "Project",
  design_template: "Template",
  manual:  "Manual",
  ai_generated: "AI",
  restore: "Restore",
  unknown: "Unknown",
};

const AVAILABILITY_STYLES: Record<string, string> = {
  deprecated: "border-orange-500/40 opacity-70",
  deleted:    "border-red-500/40 opacity-50",
  unavailable:"border-zinc-500/40 opacity-60",
};

// ── Compare metadata diff ─────────────────────────────────────────────────────

interface CompareField {
  label: string;
  base: string;
  target: string;
  changed: boolean;
}

function buildCompareDiff(
  base: VersionTimelineEntry,
  target: VersionTimelineEntry,
): CompareField[] {
  const f = (label: string, a: string, b: string): CompareField => ({
    label, base: a, target: b, changed: a !== b,
  });
  return [
    f("Version", `v${base.versionNumber}`, `v${target.versionNumber}`),
    f("Status", base.status, target.status),
    f("Source", SOURCE_LABELS[base.source] ?? base.source, SOURCE_LABELS[target.source] ?? target.source),
    f("Actor", base.actor.displayName, target.actor.displayName),
    f("Elements", String(base.changeSummary.elementCount ?? "–"), String(target.changeSummary.elementCount ?? "–")),
    f("Changelog", base.changeSummary.changelog ?? base.changeSummary.label ?? "–", target.changeSummary.changelog ?? target.changeSummary.label ?? "–"),
    f("Availability", base.availability, target.availability),
    f("Created", formatTimestamp(base.createdAt), formatTimestamp(target.createdAt)),
    f("Published", base.publishedAt ? formatTimestamp(base.publishedAt) : "–", target.publishedAt ? formatTimestamp(target.publishedAt) : "–"),
  ];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EntryAvailabilityBadge({ availability }: { availability: string }) {
  const label = availabilityLabel(availability as never);
  if (!label) return null;
  return (
    <Badge
      variant="outline"
      className="text-[10px] px-1.5 py-0 border-orange-500/40 text-orange-400"
      aria-label={`Version availability: ${label}`}
    >
      {label}
    </Badge>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span className="text-xs text-zinc-500" aria-label={`Source: ${SOURCE_LABELS[source] ?? source}`}>
      via {SOURCE_LABELS[source] ?? source}
    </span>
  );
}

interface TimelineEntryCardProps {
  entry: VersionTimelineEntry;
  isSelectedForCompare: boolean;
  onSelectForCompare: (entry: VersionTimelineEntry) => void;
  onRestoreClick: (entry: VersionTimelineEntry) => void;
  hasRestorePermission: boolean;
  index: number;
  totalVisible: number;
}

function TimelineEntryCard({
  entry,
  isSelectedForCompare,
  onSelectForCompare,
  onRestoreClick,
  hasRestorePermission,
  index,
  totalVisible,
}: TimelineEntryCardProps) {
  const isUnavailable = entry.availability !== "available";
  const restoreAllowed = canRestore(entry, hasRestorePermission);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectForCompare(entry);
    }
  }

  return (
    <div
      role="listitem"
      aria-setsize={totalVisible}
      aria-posinset={index + 1}
      aria-current={entry.isCurrent ? "true" : undefined}
      aria-label={`Version ${entry.versionNumber}${entry.isCurrent ? ", current version" : ""}${isSelectedForCompare ? ", selected for comparison" : ""}`}
      data-testid={`timeline-entry-${entry.id}`}
      className={[
        "relative border rounded-lg p-4 transition-colors",
        isSelectedForCompare
          ? "border-violet-500/60 bg-violet-500/5"
          : entry.isCurrent
            ? "border-emerald-500/40 bg-emerald-500/5"
            : `border-white/10 hover:border-white/20 bg-white/2 ${AVAILABILITY_STYLES[entry.availability] ?? ""}`,
      ].join(" ")}
    >
      {/* Timeline connector */}
      <div className="flex gap-3">
        {/* Left: version dot + line */}
        <div className="flex flex-col items-center gap-0 pt-1">
          <div
            className={[
              "w-3 h-3 rounded-full flex-shrink-0 mt-0.5",
              entry.isCurrent
                ? "bg-emerald-400 ring-2 ring-emerald-400/30"
                : isUnavailable
                  ? "bg-zinc-600"
                  : "bg-violet-400",
            ].join(" ")}
            aria-hidden="true"
          />
          {index < totalVisible - 1 && (
            <div className="w-px flex-1 min-h-4 mt-1 bg-white/10" aria-hidden="true" />
          )}
        </div>

        {/* Right: content */}
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-start flex-wrap gap-2 mb-2">
            <span
              className="font-mono font-semibold text-sm text-white"
              data-testid={`version-number-${entry.id}`}
            >
              v{entry.versionNumber}
            </span>

            {entry.isCurrent && (
              <Badge
                className="text-[10px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                data-testid={`current-badge-${entry.id}`}
              >
                <CheckCircle className="w-2.5 h-2.5 mr-1" aria-hidden="true" />
                Current
              </Badge>
            )}

            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 border ${STATUS_STYLES[entry.status] ?? STATUS_STYLES["saved"]}`}
              data-testid={`status-badge-${entry.id}`}
            >
              {entry.status}
            </Badge>

            <EntryAvailabilityBadge availability={entry.availability} />

            {entry.branchLabel && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-400">
                <GitBranch className="w-2.5 h-2.5 mr-1" aria-hidden="true" />
                {entry.branchLabel}
              </Badge>
            )}

            {isSelectedForCompare && (
              <Badge className="text-[10px] px-1.5 py-0 bg-violet-500/20 text-violet-300 border-violet-500/30">
                Selected
              </Badge>
            )}
          </div>

          {/* Change summary */}
          {(entry.changeSummary.changelog || entry.changeSummary.label) && (
            <p className="text-sm text-zinc-300 mb-2 line-clamp-2" data-testid={`summary-${entry.id}`}>
              {entry.changeSummary.changelog ?? entry.changeSummary.label}
            </p>
          )}
          {entry.changeSummary.elementCount !== undefined && (
            <p className="text-xs text-zinc-500 mb-2">
              <Layers className="inline w-3 h-3 mr-1" aria-hidden="true" />
              {entry.changeSummary.elementCount} elements
            </p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-3">
            <span aria-label={`Created at: ${formatTimestampReadable(entry.createdAt)}`}>
              <Clock className="inline w-3 h-3 mr-1" aria-hidden="true" />
              {formatTimestamp(entry.createdAt)}
            </span>
            <span>
              <User className="inline w-3 h-3 mr-1" aria-hidden="true" />
              {entry.actor.displayName}
            </span>
            <SourceBadge source={entry.source} />
            {entry.publishedAt && (
              <span>
                <Tag className="inline w-3 h-3 mr-1" aria-hidden="true" />
                Published {formatTimestamp(entry.publishedAt)}
              </span>
            )}
          </div>

          {/* Actions */}
          {!isUnavailable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className={[
                  "h-7 text-xs",
                  isSelectedForCompare
                    ? "border-violet-500/60 text-violet-300 bg-violet-500/10"
                    : "border-white/15 text-zinc-300 hover:text-white",
                ].join(" ")}
                onClick={() => onSelectForCompare(entry)}
                onKeyDown={handleKeyDown}
                aria-pressed={isSelectedForCompare}
                data-testid={`compare-toggle-${entry.id}`}
              >
                <ArrowLeftRight className="w-3 h-3 mr-1" aria-hidden="true" />
                {isSelectedForCompare ? "Deselect" : "Compare"}
              </Button>

              {restoreAllowed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-amber-500/30 text-amber-400 hover:border-amber-500/60 hover:bg-amber-500/10"
                  onClick={() => onRestoreClick(entry)}
                  data-testid={`restore-btn-${entry.id}`}
                  aria-label={`Restore version ${entry.versionNumber}`}
                >
                  <RotateCcw className="w-3 h-3 mr-1" aria-hidden="true" />
                  Restore
                </Button>
              )}

              {!restoreAllowed && !entry.isCurrent && entry.resourceType === "template" && (
                <span className="text-xs text-zinc-600 italic self-center">
                  Restore: admin action required
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compare panel ─────────────────────────────────────────────────────────────

interface ComparePanelProps {
  a: VersionTimelineEntry;
  b: VersionTimelineEntry;
  request: VersionComparisonRequest;
  onClose: () => void;
}

function ComparePanel({ a, b, onClose }: ComparePanelProps) {
  const [base, target] =
    a.versionNumber < b.versionNumber ? [a, b] : [b, a];
  const diff = buildCompareDiff(base, target);

  return (
    <Card
      className="border-violet-500/30 bg-violet-500/5"
      data-testid="compare-panel"
      role="region"
      aria-label="Version comparison"
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4 text-violet-400" aria-hidden="true" />
            Comparing v{base.versionNumber} → v{target.versionNumber}
          </CardTitle>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose} data-testid="compare-close">
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" role="table" aria-label="Metadata comparison table">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-1.5 pr-4 text-zinc-400 font-medium w-24" scope="col">Field</th>
                <th className="text-left py-1.5 pr-4 text-zinc-400 font-medium" scope="col">v{base.versionNumber} (base)</th>
                <th className="text-left py-1.5 text-zinc-400 font-medium" scope="col">v{target.versionNumber} (target)</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((row) => (
                <tr
                  key={row.label}
                  className={row.changed ? "bg-amber-500/5" : ""}
                  data-testid={`diff-row-${row.label.toLowerCase()}`}
                >
                  <td className="py-1.5 pr-4 text-zinc-500 font-medium">{row.label}</td>
                  <td className="py-1.5 pr-4 text-zinc-300 font-mono break-all">{row.base}</td>
                  <td className={["py-1.5 font-mono break-all", row.changed ? "text-amber-300" : "text-zinc-300"].join(" ")}>
                    {row.target}
                    {row.changed && (
                      <span className="ml-1 text-amber-500" aria-label="changed">↑</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-500 mt-3">
          <Info className="inline w-3 h-3 mr-1" aria-hidden="true" />
          Pixel/vector/document diff is handled by a dedicated diff engine (out of scope for this view).
        </p>
      </CardContent>
    </Card>
  );
}

// ── Restore dialog ────────────────────────────────────────────────────────────

interface RestoreDialogProps {
  entry: VersionTimelineEntry;
  open: boolean;
  onConfirm: (entry: VersionTimelineEntry) => void;
  onCancel: () => void;
  isPending: boolean;
}

function RestoreDialog({ entry, open, onConfirm, onCancel, isPending }: RestoreDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent aria-describedby="restore-description">
        <DialogHeader>
          <DialogTitle>Restore Version {entry.versionNumber}?</DialogTitle>
          <DialogDescription id="restore-description">
            This will create a <strong>new version</strong> of this project based on v{entry.versionNumber}.
            The current state will not be overwritten — it remains in the history.
            This action cannot be undone without using the timeline again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            A new version will be created. If the project has been modified since you opened this
            timeline, the restore may reflect a state different from what you see here.
          </span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isPending} data-testid="restore-cancel">
            Cancel
          </Button>
          <Button
            variant="default"
            className="bg-amber-600 hover:bg-amber-500 text-white"
            onClick={() => onConfirm(entry)}
            disabled={isPending}
            data-testid="restore-confirm"
            aria-label={`Confirm restore of version ${entry.versionNumber}`}
          >
            {isPending
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Restoring…</>
              : <><RotateCcw className="w-4 h-4 mr-2" aria-hidden="true" />Restore v{entry.versionNumber}</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pagination controls ───────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  total: number;
  onPageChange: (p: number) => void;
}

function PaginationControls({ page, total, onPageChange }: PaginationProps) {
  if (total <= 1) return null;
  return (
    <nav
      className="flex items-center justify-center gap-2 mt-4"
      aria-label="Version history pagination"
    >
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0 border-white/15"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        data-testid="pagination-prev"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </Button>
      <span className="text-xs text-zinc-400" aria-live="polite" aria-atomic="true">
        Page {page} of {total}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-7 p-0 border-white/15"
        disabled={page >= total}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        data-testid="pagination-next"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </Button>
    </nav>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

interface LoadedResource {
  type: ResourceType;
  id: number;
}

export default function VersionTimelinePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Resource picker state
  const [inputType, setInputType] = useState<ResourceType>("project");
  const [inputId, setInputId] = useState("");
  const [loaded, setLoaded] = useState<LoadedResource | null>(null);

  // Timeline state
  const [page, setPage] = useState(1);
  const [compareSelection, setCompareSelection] = useState<VersionTimelineEntry[]>([]);
  const [compareResult, setCompareResult] = useState<{ a: VersionTimelineEntry; b: VersionTimelineEntry; request: VersionComparisonRequest } | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionTimelineEntry | null>(null);

  // Admin permission: in a real integration, derive from authenticated user role.
  // Here we grant restore permission to all logged-in staff (admin portal is already auth-gated).
  const hasRestorePermission = true;

  // For keyboard navigation between cards
  const listRef = useRef<HTMLDivElement>(null);

  // ── Fetch versions ──────────────────────────────────────────────────────────

  const projectQuery = useQuery({
    queryKey: ["version-timeline", "project", loaded?.id],
    enabled: loaded?.type === "project" && loaded.id > 0,
    queryFn: async () => {
      const data = await apiFetch<{ items: RawProjectVersion[]; total: number }>(
        `/api/ai/design/projects/${loaded!.id}/versions`,
      );
      return sortVersionsChronological(
        data.items.map((v) => adaptProjectVersion(v)),
      );
    },
  });

  const templateQuery = useQuery({
    queryKey: ["version-timeline", "template", loaded?.id],
    enabled: loaded?.type === "template" && loaded.id > 0,
    queryFn: async () => {
      const data = await apiFetch<{ versions: RawTemplateVersion[] }>(
        `/api/ai/design-templates/${loaded!.id}/versions`,
      );
      return sortVersionsChronological(
        data.versions.map((v) => adaptTemplateVersion(v)),
      );
    },
  });

  const activeQuery = loaded?.type === "project" ? projectQuery : templateQuery;
  const allEntries: VersionTimelineEntry[] = activeQuery.data ?? [];
  const pages = totalPages(allEntries.length, PAGE_SIZE);
  const visibleEntries = paginateEntries(allEntries, page, PAGE_SIZE);

  // ── Restore mutation ────────────────────────────────────────────────────────

  const restoreMutation = useMutation({
    mutationFn: async (entry: VersionTimelineEntry) => {
      if (entry.resourceType !== "project") {
        throw new Error("Restore is only available for design projects.");
      }
      return apiFetch(`/api/ai/design/projects/${entry.resourceId}/versions/${entry.id}/restore`, {
        method: "POST",
        body: JSON.stringify({ expectedVersionNumber: entry.versionNumber }),
      });
    },
    onSuccess: (_data, entry) => {
      toast({
        title: "Version restored",
        description: `A new version was created based on v${entry.versionNumber}.`,
      });
      setRestoreTarget(null);
      // Invalidate to reload the timeline
      void queryClient.invalidateQueries({
        queryKey: ["version-timeline", "project", entry.resourceId],
      });
    },
    onError: (err: Error) => {
      if (err.message.includes("409") || err.message.toLowerCase().includes("conflict")) {
        toast({
          title: "Restore conflict",
          description: "The project has been modified since you opened this timeline. Refresh and try again.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Restore failed", description: err.message, variant: "destructive" });
      }
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleLoad = useCallback(() => {
    const id = parseInt(inputId.trim(), 10);
    if (isNaN(id) || id <= 0) {
      toast({ title: "Invalid ID", description: "Enter a positive integer ID.", variant: "destructive" });
      return;
    }
    setPage(1);
    setCompareSelection([]);
    setCompareResult(null);
    setCompareError(null);
    setLoaded({ type: inputType, id });
  }, [inputId, inputType, toast]);

  const handleCompareToggle = useCallback((entry: VersionTimelineEntry) => {
    setCompareError(null);
    setCompareResult(null);
    setCompareSelection((prev) => {
      const already = prev.find((e) => e.id === entry.id);
      if (already) return prev.filter((e) => e.id !== entry.id);
      if (prev.length >= 2) return [prev[1]!, entry]; // rotate
      return [...prev, entry];
    });
  }, []);

  const handleCompare = useCallback(() => {
    const [a, b] = compareSelection;
    const result = validateComparisonRequest(a ?? null, b ?? null);
    if (!result.ok) { setCompareError(result.error); return; }
    const [base, target] =
      (a!.versionNumber < b!.versionNumber) ? [a!, b!] : [b!, a!];
    setCompareResult({ a: base, b: target, request: result.request });
    setCompareError(null);
  }, [compareSelection]);

  const handleRestoreConfirm = useCallback((entry: VersionTimelineEntry) => {
    restoreMutation.mutate(entry);
  }, [restoreMutation]);

  // Keyboard navigation across the list
  const handleListKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const cards = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-testid^='timeline-entry-']") ?? [],
    );
    const idx = cards.findIndex((c) => c === document.activeElement || c.contains(document.activeElement));
    if (e.key === "ArrowDown" && idx < cards.length - 1) {
      e.preventDefault();
      cards[idx + 1]?.focus();
    } else if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      cards[idx - 1]?.focus();
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="w-6 h-6 text-violet-400" aria-hidden="true" />
          Version Timeline
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Browse, compare, and restore historical versions of design projects and templates.
        </p>
      </div>

      {/* Resource picker */}
      <Card className="border-white/10 bg-white/2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-zinc-300">Select Resource</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="resource-type" className="text-xs text-zinc-400">Type</Label>
              <Select
                value={inputType}
                onValueChange={(v) => setInputType(v as ResourceType)}
              >
                <SelectTrigger
                  id="resource-type"
                  className="h-9 w-44 bg-transparent border-white/15"
                  data-testid="resource-type-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project">Design Project</SelectItem>
                  <SelectItem value="template">Design Template</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="resource-id" className="text-xs text-zinc-400">ID</Label>
              <Input
                id="resource-id"
                className="h-9 w-32 bg-transparent border-white/15"
                placeholder="e.g. 42"
                value={inputId}
                onChange={(e) => setInputId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleLoad(); }}
                data-testid="resource-id-input"
                aria-label="Resource ID"
              />
            </div>
            <Button
              className="h-9 bg-violet-600 hover:bg-violet-500 text-white"
              onClick={handleLoad}
              disabled={activeQuery.isFetching}
              data-testid="load-btn"
            >
              {activeQuery.isFetching
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Loading…</>
                : "Load History"
              }
            </Button>
            {loaded && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 border-white/15 text-zinc-400"
                onClick={() => activeQuery.refetch()}
                aria-label="Refresh timeline"
                data-testid="refresh-btn"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline area */}
      {loaded && (
        <>
          {/* Compare toolbar */}
          {compareSelection.length > 0 && (
            <Card className="border-violet-500/30 bg-violet-500/5">
              <CardContent className="py-3 flex flex-wrap items-center gap-3">
                <span className="text-sm text-zinc-300">
                  {compareSelection.length === 1
                    ? `v${compareSelection[0]!.versionNumber} selected — pick one more to compare`
                    : `v${compareSelection[0]!.versionNumber} & v${compareSelection[1]!.versionNumber} selected`}
                </span>
                {compareSelection.length === 2 && (
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-violet-600 hover:bg-violet-500 text-white"
                    onClick={handleCompare}
                    data-testid="compare-action"
                  >
                    <ArrowLeftRight className="w-3 h-3 mr-1" aria-hidden="true" />
                    Compare
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-zinc-400"
                  onClick={() => { setCompareSelection([]); setCompareResult(null); setCompareError(null); }}
                  data-testid="compare-clear"
                >
                  Clear
                </Button>
                {compareError && (
                  <p className="text-xs text-red-400" role="alert" data-testid="compare-error">
                    {compareError}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Comparison result */}
          {compareResult && (
            <ComparePanel
              a={compareResult.a}
              b={compareResult.b}
              request={compareResult.request}
              onClose={() => { setCompareResult(null); setCompareSelection([]); }}
            />
          )}

          {/* Loading */}
          {activeQuery.isLoading && (
            <div
              className="flex flex-col items-center justify-center py-16 text-zinc-500"
              role="status"
              aria-live="polite"
              aria-label="Loading version history"
              data-testid="loading-state"
            >
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-violet-400" aria-hidden="true" />
              <p className="text-sm">Loading version history…</p>
            </div>
          )}

          {/* Error */}
          {activeQuery.isError && (
            <div
              className="flex flex-col items-center justify-center py-16 text-red-400"
              role="alert"
              data-testid="error-state"
            >
              <AlertTriangle className="w-8 h-8 mb-3" aria-hidden="true" />
              <p className="text-sm font-medium">Failed to load version history</p>
              <p className="text-xs text-zinc-500 mt-1">
                {(activeQuery.error as Error)?.message ?? "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 border-white/15"
                onClick={() => activeQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          )}

          {/* Empty */}
          {activeQuery.isSuccess && allEntries.length === 0 && (
            <div
              className="flex flex-col items-center justify-center py-16 text-zinc-500"
              data-testid="empty-state"
              role="status"
              aria-live="polite"
            >
              <History className="w-8 h-8 mb-3" aria-hidden="true" />
              <p className="text-sm">No version history found for this resource.</p>
            </div>
          )}

          {/* Timeline list */}
          {activeQuery.isSuccess && allEntries.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500" aria-live="polite">
                  {allEntries.length} version{allEntries.length !== 1 ? "s" : ""} total
                  {pages > 1 && ` — page ${page} of ${pages}`}
                </p>
              </div>

              <div
                ref={listRef}
                role="list"
                aria-label={`Version history for ${loaded.type} ${loaded.id}`}
                className="space-y-2 outline-none"
                onKeyDown={handleListKeyDown}
                tabIndex={-1}
              >
                {visibleEntries.map((entry, idx) => (
                  <TimelineEntryCard
                    key={entry.id}
                    entry={entry}
                    isSelectedForCompare={compareSelection.some((e) => e.id === entry.id)}
                    onSelectForCompare={handleCompareToggle}
                    onRestoreClick={setRestoreTarget}
                    hasRestorePermission={hasRestorePermission}
                    index={idx}
                    totalVisible={visibleEntries.length}
                  />
                ))}
              </div>

              <PaginationControls page={page} total={pages} onPageChange={setPage} />
            </>
          )}
        </>
      )}

      {/* Restore dialog */}
      {restoreTarget && (
        <RestoreDialog
          entry={restoreTarget}
          open={restoreTarget !== null}
          onConfirm={handleRestoreConfirm}
          onCancel={() => setRestoreTarget(null)}
          isPending={restoreMutation.isPending}
        />
      )}
    </div>
  );
}
