import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GitBranch,
  GitCompare,
  History,
  Loader2,
  LockKeyhole,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ConceptDraft, ItemAssetImage, ReviewState } from "./InteriorDesignEditor";

type ReviewStage = "not_applicable" | "pending" | "approved" | "revision_requested";

export interface InteriorVersionSnapshot {
  schemaVersion: "interior-design-review-v1";
  projectUuid: string;
  concept: string | null;
  spacePlan: unknown;
  materials: unknown;
  furniture: unknown;
  lighting: unknown;
  moodboard: { projectUuid: string; reference: "interior-design-moodboard" };
  render: { projectUuid: string; reference: "interior-render-outputs" };
  assetRefs: Array<{ id: number; itemType: string; itemId: string; storagePath: string | null }>;
  review: {
    state: ReviewState;
    reviewerNotes: string | null;
    customerApproval: ReviewStage;
  };
  metadata: {
    draftId: number;
    source: "interior_design_concept";
    updatedAt: string;
  };
}

interface VersionRecord {
  id: number;
  entityType: string;
  entityId: string;
  versionNumber: number;
  versionLabel: string | null;
  contentHash: string;
  contentSnapshot: InteriorVersionSnapshot;
  parentVersionId: number | null;
  reason: string | null;
  revisionReason: string | null;
  actorId: string | null;
  actorType: string;
  isApproved: boolean;
  isCurrent: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  createdAt: string;
}

interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "modified";
  oldValue?: string;
  newValue?: string;
}

interface DiffResponse {
  versionA: number;
  versionB: number;
  changes: DiffEntry[];
  changedPaths: string[];
}

interface ReviewVersionsPanelProps {
  projectUuid: string;
  draft: ConceptDraft;
  assetImages: Record<string, ItemAssetImage>;
  adminKey?: string;
  onSetReviewState: (state: ReviewState) => Promise<void>;
  onApplySnapshot: (snapshot: InteriorVersionSnapshot) => Promise<void>;
  onToast: (title: string, description?: string, destructive?: boolean) => void;
}

const VERSION_ENTITY = "design_spec";

function headers(adminKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
  };
}

function safeSnapshot(
  draft: ConceptDraft,
  projectUuid: string,
  assetImages: Record<string, ItemAssetImage>,
  reviewerNotes: string | null = null,
  customerApproval: ReviewStage = "not_applicable",
): InteriorVersionSnapshot {
  return {
    schemaVersion: "interior-design-review-v1",
    projectUuid,
    concept: draft.visualConceptDraft,
    spacePlan: draft.spacePlanDraft,
    materials: draft.materialsDraft,
    furniture: draft.furnitureDraft,
    lighting: draft.lightingDraft,
    moodboard: { projectUuid, reference: "interior-design-moodboard" },
    render: { projectUuid, reference: "interior-render-outputs" },
    assetRefs: Object.values(assetImages).map((asset) => ({
      id: asset.id,
      itemType: asset.itemType,
      itemId: asset.itemId,
      storagePath: asset.storagePath,
    })),
    review: {
      state: draft.reviewState,
      reviewerNotes,
      customerApproval,
    },
    metadata: {
      draftId: draft.id,
      source: "interior_design_concept",
      updatedAt: draft.updatedAt,
    },
  };
}

function displayValue(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function stageLabel(stage: ReviewStage): string {
  return {
    not_applicable: "Not applicable",
    pending: "Pending",
    approved: "Approved",
    revision_requested: "Revision requested",
  }[stage];
}

function stageTone(stage: ReviewStage): string {
  return {
    not_applicable: "border-border/50 text-muted-foreground",
    pending: "border-amber-500/30 text-amber-300",
    approved: "border-emerald-500/30 text-emerald-300",
    revision_requested: "border-red-500/30 text-red-300",
  }[stage];
}

export function buildInteriorVersionSnapshot(
  draft: ConceptDraft,
  projectUuid: string,
  assetImages: Record<string, ItemAssetImage>,
): InteriorVersionSnapshot {
  return safeSnapshot(draft, projectUuid, assetImages);
}

export function ReviewVersionsPanel({
  projectUuid,
  draft,
  assetImages,
  adminKey,
  onSetReviewState,
  onApplySnapshot,
  onToast,
}: ReviewVersionsPanelProps) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<VersionRecord | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [customerApproval, setCustomerApproval] = useState<ReviewStage>("not_applicable");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipNextSync = useRef(false);

  const selected = useMemo(
    () => versions.find((version) => version.id === selectedId) ?? null,
    [selectedId, versions],
  );
  const compare = useMemo(
    () => versions.find((version) => version.id === compareId) ?? null,
    [compareId, versions],
  );

  const request = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { ...init, headers: { ...headers(adminKey), ...(init?.headers ?? {}) } });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body as T;
  }, [adminKey]);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request<{ versions: VersionRecord[] }>(
        `/api/ai/design-versioning/versions/${VERSION_ENTITY}/${encodeURIComponent(projectUuid)}`,
      );
      let loaded = result.versions ?? [];
      setVersions(loaded);
      setSelectedId((current) => current && loaded.some((version) => version.id === current) ? current : loaded[0]?.id ?? null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load version history");
    } finally {
      setLoading(false);
    }
  }, [assetImages, draft, projectUuid, request]);

  const syncDraftVersion = useCallback(async () => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    try {
      const current = await request<{ versions: VersionRecord[] }>(
        `/api/ai/design-versioning/versions/${VERSION_ENTITY}/${encodeURIComponent(projectUuid)}`,
      );
      const idempotencyKey = `interior:${draft.id}:draft:${draft.updatedAt}`;
      if (current.versions.some((version) => version.contentSnapshot?.metadata?.updatedAt === draft.updatedAt)) return;
      const created = await request<{ version: VersionRecord }>(
        "/api/ai/design-versioning/versions",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: VERSION_ENTITY,
            entityId: projectUuid,
            contentSnapshot: safeSnapshot(draft, projectUuid, assetImages),
            revisionReason: draft.reviewState === "ai_generated" ? "initial" : "human_edit",
            actorId: "admin",
            actorType: "human",
            idempotencyKey,
          }),
        },
      );
      let version = created.version;
      if (draft.reviewState === "approved_for_rendering") {
        const approved = await request<{ version: VersionRecord }>(
          `/api/ai/design-versioning/versions/${version.id}/approve`,
          {
            method: "POST",
            body: JSON.stringify({ approvedBy: "admin" }),
          },
        );
        version = approved.version;
      }
      const promoted = await request<{ version: VersionRecord }>(
        `/api/ai/design-versioning/versions/${version.id}/promote`,
        { method: "POST", body: JSON.stringify({ actorId: "admin" }) },
      );
      version = promoted.version;
      setVersions((items) => [version, ...items.filter((item) => item.id !== version.id)]);
      setSelectedId(version.id);
    } catch {
      // History is additive to the editor; the editor remains usable if the history service is unavailable.
    }
  }, [assetImages, draft, projectUuid, request]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  useEffect(() => {
    void syncDraftVersion();
  }, [syncDraftVersion]);

  const loadDetail = async (id: number) => {
    setWorking(true);
    try {
      const result = await request<{ version: VersionRecord }>(`/api/ai/design-versioning/versions/v/${id}`);
      setSelectedDetail(result.version);
      setReviewNotes(result.version.contentSnapshot?.review?.reviewerNotes ?? "");
      setCustomerApproval(result.version.contentSnapshot?.review?.customerApproval ?? "not_applicable");
    } catch (cause) {
      onToast("Version detail gagal dimuat", cause instanceof Error ? cause.message : "Unknown error", true);
    } finally {
      setWorking(false);
    }
  };

  const loadDiff = async () => {
    if (!selected || !compare) return;
    setWorking(true);
    try {
      const result = await request<{ diff: DiffResponse }>(
        `/api/ai/design-versioning/diff/${selected.id}/${compare.id}`,
      );
      setDiff(result.diff);
    } catch (cause) {
      onToast("Perbandingan gagal dimuat", cause instanceof Error ? cause.message : "Unknown error", true);
    } finally {
      setWorking(false);
    }
  };

  const createReviewVersion = async (nextNotes: string, nextCustomerApproval: ReviewStage) => {
    setWorking(true);
    try {
      const created = await request<{ version: VersionRecord }>(
        "/api/ai/design-versioning/versions",
        {
          method: "POST",
          body: JSON.stringify({
            entityType: VERSION_ENTITY,
            entityId: projectUuid,
            contentSnapshot: safeSnapshot(draft, projectUuid, assetImages, nextNotes.trim() || null, nextCustomerApproval),
            revisionReason: "admin_correction",
            reason: nextNotes.trim() || `Customer approval: ${nextCustomerApproval}`,
            actorId: "admin",
            actorType: "human",
            idempotencyKey: `interior:${draft.id}:review:${draft.updatedAt}:${nextCustomerApproval}:${nextNotes.trim()}`,
          }),
        },
      );
      const promoted = await request<{ version: VersionRecord }>(
        `/api/ai/design-versioning/versions/${created.version.id}/promote`,
        { method: "POST", body: JSON.stringify({ actorId: "admin" }) },
      );
      const version = promoted.version;
      setVersions((items) => [version, ...items.filter((item) => item.id !== version.id)]);
      setSelectedId(version.id);
      setSelectedDetail(version);
      onToast("Review metadata tersimpan", "Catatan dan status customer disimpan sebagai versi baru.");
    } catch (cause) {
      onToast("Review metadata gagal disimpan", cause instanceof Error ? cause.message : "Unknown error", true);
    } finally {
      setWorking(false);
    }
  };

  const restoreSelected = async () => {
    if (!selected) return;
    setWorking(true);
    try {
      const result = await request<{ version: VersionRecord }>(
        `/api/ai/design-versioning/versions/${selected.id}/restore`,
        {
          method: "POST",
          body: JSON.stringify({ actorId: "admin", reason: `Restored from ${selected.versionLabel ?? `v${selected.versionNumber}`}` }),
        },
      );
      const promoted = await request<{ version: VersionRecord }>(
        `/api/ai/design-versioning/versions/${result.version.id}/promote`,
        { method: "POST", body: JSON.stringify({ actorId: "admin" }) },
      );
      skipNextSync.current = true;
      await onApplySnapshot(promoted.version.contentSnapshot);
      setVersions((items) => [promoted.version, ...items.filter((item) => item.id !== promoted.version.id)]);
      setSelectedId(promoted.version.id);
      setSelectedDetail(promoted.version);
      onToast("Versi dipulihkan", "History tetap utuh; pemulihan dibuat sebagai versi baru.");
    } catch (cause) {
      onToast("Restore gagal", cause instanceof Error ? cause.message : "Unknown error", true);
    } finally {
      setWorking(false);
    }
  };

  const statusLabel = selected?.contentSnapshot?.review?.state ?? draft.reviewState;
  const currentLabel = versions.find((version) => version.isCurrent)?.versionLabel;

  return (
    <section className="rounded-lg border border-violet-500/20 bg-violet-500/[0.035] p-3.5" data-testid="review-versions-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-violet-300/20 bg-violet-300/10">
            <History className="size-3.5 text-violet-200" />
          </div>
          <div>
            <p className="font-mono text-sm font-semibold">Review &amp; Versions</p>
            <p className="text-[10px] text-muted-foreground">Immutable history for the interior concept</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {currentLabel && <Badge variant="outline" className="h-5 text-[9px] font-mono">{currentLabel} current</Badge>}
          <Badge variant="outline" className="h-5 text-[9px] font-mono">{statusLabel}</Badge>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[10px] text-red-300">
          {error}
        </div>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Timeline</span>
            <span className="text-[10px] text-muted-foreground">{versions.length} version{versions.length === 1 ? "" : "s"}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-auto pr-1">
            {loading && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading history…</div>
            )}
            {!loading && versions.length === 0 && (
              <p className="rounded border border-dashed border-border/50 px-2.5 py-4 text-xs text-muted-foreground">No versions yet.</p>
            )}
            {versions.map((version) => (
              <button
                key={version.id}
                type="button"
                onClick={() => { setSelectedId(version.id); void loadDetail(version.id); }}
                className={cn(
                  "w-full rounded border px-2.5 py-2 text-left transition-colors",
                  selectedId === version.id ? "border-violet-400/40 bg-violet-400/10" : "border-border/40 hover:border-violet-400/30 hover:bg-muted/10",
                )}
                data-testid={`version-row-${version.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-mono font-semibold">
                    {version.parentVersionId && <GitBranch className="size-3 text-violet-300" />}
                    {version.versionLabel ?? `v${version.versionNumber}`}
                  </span>
                  <span className="text-[9px] text-muted-foreground">{new Date(version.createdAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span>{version.revisionReason ?? "review"}</span>
                  {version.isApproved && <span className="text-emerald-300">approved/read-only</span>}
                  {version.isCurrent && <span className="text-violet-300">current</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Review stages</span>
            <div className="flex flex-wrap gap-1">
              <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" disabled={working || draft.reviewState === "ai_generated"} onClick={() => void onSetReviewState("ready_for_review")}>
                <ShieldCheck className="size-3" /> Submit
              </Button>
              <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" disabled={working || draft.reviewState !== "ready_for_review"} onClick={() => void onSetReviewState("approved_for_rendering")}>
                <LockKeyhole className="size-3" /> Admin approve
              </Button>
            </div>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="rounded border border-border/40 px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-[10px] font-medium"><ShieldCheck className="size-3 text-violet-300" /> Admin review</p>
              <Badge variant="outline" className={cn("mt-1 h-5 text-[9px]", draft.reviewState === "approved_for_rendering" ? stageTone("approved") : stageTone("pending"))}>
                {draft.reviewState === "approved_for_rendering" ? "Approved" : draft.reviewState === "ready_for_review" ? "Pending decision" : "In progress"}
              </Badge>
            </div>
            <div className="rounded border border-border/40 px-2.5 py-2">
              <p className="flex items-center gap-1.5 text-[10px] font-medium"><UserCheck className="size-3 text-violet-300" /> Customer review</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {(["not_applicable", "pending", "approved"] as ReviewStage[]).map((stage) => (
                  <Button key={stage} variant="ghost" size="sm" className={cn("h-5 px-1.5 text-[9px]", customerApproval === stage && "bg-violet-400/10 text-violet-200")} onClick={() => setCustomerApproval(stage)}>
                    {stageLabel(stage)}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded border border-border/40 p-2.5">
            <label className="flex items-center gap-1.5 text-[10px] font-medium"><MessageSquare className="size-3 text-violet-300" /> Reviewer notes</label>
            <Textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} className="mt-1.5 min-h-16 resize-y text-xs" placeholder="Add context for the next reviewer…" maxLength={2000} />
            <Button variant="outline" size="sm" className="mt-1.5 h-6 gap-1 text-[10px]" disabled={working} onClick={() => void createReviewVersion(reviewNotes, customerApproval)}>
              <MessageSquare className="size-3" /> Save review metadata
            </Button>
          </div>
        </div>
      </div>

      {selectedDetail && (
        <div className="mt-3 rounded border border-border/40 bg-background/20 p-2.5" data-testid="version-detail">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Version detail</p>
              <p className="text-xs font-semibold">{selectedDetail.versionLabel ?? `v${selectedDetail.versionNumber}`}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" disabled={working || selectedDetail.isCurrent} onClick={() => void restoreSelected()}>
                <RotateCcw className="size-3" /> Restore as new version
              </Button>
              <Button variant="outline" size="sm" className="h-6 gap-1 text-[10px]" disabled={working || !selected || !compare || selected.id === compare.id} onClick={() => void loadDiff()}>
                <GitCompare className="size-3" /> Compare selected
              </Button>
            </div>
          </div>
          {(selectedDetail.isApproved || selectedDetail.contentSnapshot?.review?.state === "approved_for_rendering") && (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-emerald-300"><LockKeyhole className="size-3" /> Approved historical snapshot is read-only.</p>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <div><p className="text-[9px] text-muted-foreground">Lineage</p><p className="text-[10px] font-mono">{selectedDetail.parentVersionId ? `from #${selectedDetail.parentVersionId}` : "root version"}</p></div>
            <div><p className="text-[9px] text-muted-foreground">Content hash</p><p className="truncate text-[10px] font-mono">{selectedDetail.contentHash}</p></div>
            <div><p className="text-[9px] text-muted-foreground">Review status</p><p className="text-[10px]">{selectedDetail.contentSnapshot?.review?.state ?? "—"}</p></div>
          </div>
          <pre className="mt-2 max-h-44 overflow-auto rounded bg-black/20 p-2 text-[9px] leading-relaxed text-muted-foreground">{displayValue(selectedDetail.contentSnapshot)}</pre>
        </div>
      )}

      <div className="mt-3 rounded border border-border/40 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"><GitCompare className="size-3" /> Compare two versions</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Version A" value={selectedId ?? ""} onChange={(event) => setSelectedId(Number(event.target.value) || null)} className="h-6 rounded border border-border/50 bg-background px-1.5 text-[10px]">
              <option value="">Version A</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel ?? `v${version.versionNumber}`}</option>)}
            </select>
            <select aria-label="Version B" value={compareId ?? ""} onChange={(event) => setCompareId(Number(event.target.value) || null)} className="h-6 rounded border border-border/50 bg-background px-1.5 text-[10px]">
              <option value="">Version B</option>
              {versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel ?? `v${version.versionNumber}`}</option>)}
            </select>
            <Button variant="outline" size="sm" className="h-6 text-[10px]" disabled={working || !selected || !compare} onClick={() => void loadDiff()}>View diff</Button>
          </div>
        </div>
        {diff && (
          <div className="mt-2 space-y-1" data-testid="version-diff">
            <p className="text-[10px] text-muted-foreground">{diff.changes.length} change{diff.changes.length === 1 ? "" : "s"} · v{diff.versionA} → v{diff.versionB}</p>
            {diff.changes.length === 0 ? <p className="text-[10px] text-emerald-300">Snapshots are identical.</p> : diff.changes.map((change, index) => (
              <div key={`${change.path}-${index}`} className="rounded border border-border/30 px-2 py-1.5 text-[10px]">
                <span className="font-mono text-violet-200">{change.kind}</span> <span className="font-mono">{change.path}</span>
                {change.kind !== "removed" && <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">{change.newValue ?? "—"}</pre>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}