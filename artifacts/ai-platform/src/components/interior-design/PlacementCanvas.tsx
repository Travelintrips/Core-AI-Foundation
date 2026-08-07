import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Lock, LockOpen, RotateCw, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CanvasPlacement {
  id: string;
  label?: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDeg?: number;
  anchorX?: number;
  anchorY?: number;
  clearanceFrontCm?: number;
  clearanceSideCm?: number;
  clearanceBackCm?: number;
  isArchived?: boolean;
  version?: number;
  metadata?: Record<string, unknown>;
}

export interface PlacementCandidate {
  candidateId: string;
  strategy: string;
  rank: number;
  score: number;
  valid: boolean;
  targetPlacementId: string;
  placement: CanvasPlacement;
  warnings: string[];
  explanation: string;
}

interface PlacementCanvasProps {
  room: { widthCm: number; depthCm: number };
  placements: CanvasPlacement[];
  candidates: PlacementCandidate[];
  selectedCandidateId: string | null;
  isSuggesting: boolean;
  isApplying: boolean;
  readOnly?: boolean;
  dirty: boolean;
  onSuggest: (placements: CanvasPlacement[], targetPlacementId: string) => void;
  onSelectCandidate: (candidateId: string) => void;
  onApply: (candidateId: string) => void;
  onReset: () => void;
}

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 470;

function rotatedFootprint(item: CanvasPlacement) {
  const quarterTurn = Math.round((item.rotationDeg ?? 0) / 90) % 2 !== 0;
  return {
    width: quarterTurn ? item.depthCm : item.widthCm,
    depth: quarterTurn ? item.widthCm : item.depthCm,
  };
}

function isOutside(item: CanvasPlacement, room: { widthCm: number; depthCm: number }) {
  const footprint = rotatedFootprint(item);
  return item.xCm < 0 || item.yCm < 0 ||
    item.xCm + footprint.width > room.widthCm ||
    item.yCm + footprint.depth > room.depthCm;
}

export function PlacementCanvas({
  room,
  placements,
  candidates,
  selectedCandidateId,
  isSuggesting,
  isApplying,
  readOnly = false,
  dirty,
  onSuggest,
  onSelectCandidate,
  onApply,
  onReset,
}: PlacementCanvasProps) {
  const [preview, setPreview] = useState(placements);
  const [localDirty, setLocalDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(placements[0]?.id ?? "");
  const [lockedIds, setLockedIds] = useState<Set<string>>(
    () => new Set(placements.filter((item) => item.metadata?.locked === true).map((item) => item.id)),
  );
  const scale = Math.min(CANVAS_WIDTH / Math.max(room.widthCm, 1), CANVAS_HEIGHT / Math.max(room.depthCm, 1));
  const selected = preview.find((item) => item.id === selectedId) ?? preview[0];
  const selectedCandidate = candidates.find((candidate) => candidate.candidateId === selectedCandidateId);
  const isDirty = dirty || localDirty;

  useEffect(() => {
    setPreview(placements);
    setSelectedId((current) => placements.some((item) => item.id === current) ? current : (placements[0]?.id ?? ""));
    setLockedIds(new Set(placements.filter((item) => item.metadata?.locked === true).map((item) => item.id)));
    setLocalDirty(false);
  }, [placements]);

  const previewWithCandidate = useMemo(() => {
    if (!selectedCandidate) return preview;
    return preview.map((item) => item.id === selectedCandidate.targetPlacementId ? selectedCandidate.placement : item);
  }, [preview, selectedCandidate]);

  function updateSelected(patch: Partial<CanvasPlacement>) {
    if (!selected || readOnly || lockedIds.has(selected.id)) return;
    setLocalDirty(true);
    setPreview((current) => current.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  }

  function toggleLock(id: string) {
    setLockedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function moveSelected(dx: number, dy: number) {
    if (!selected || lockedIds.has(selected.id) || readOnly) return;
    updateSelected({ xCm: Math.max(0, selected.xCm + dx), yCm: Math.max(0, selected.yCm + dy) });
  }

  function handleDrag(event: ReactPointerEvent<HTMLDivElement>, item: CanvasPlacement) {
    if (readOnly || lockedIds.has(item.id)) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = item.xCm;
    const initialY = item.yCm;
    const onMove = (moveEvent: PointerEvent) => {
      setPreview((current) => current.map((candidate) => candidate.id === item.id ? {
        ...candidate,
        xCm: Math.max(0, initialX + (moveEvent.clientX - startX) / scale),
        yCm: Math.max(0, initialY + (moveEvent.clientY - startY) / scale),
      } : candidate));
      setLocalDirty(true);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card/50 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Placement Canvas</h2>
            {isDirty && <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">Unsaved preview</span>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Preview lokal · {room.widthCm / 100} × {room.depthCm / 100} m · {preview.length} item
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setPreview(placements); setLocalDirty(false); onReset(); }} disabled={!isDirty || readOnly}>
            <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
          <Button
            size="sm"
            onClick={() => selected && onSuggest(preview, selected.id)}
            disabled={!selected || readOnly || isSuggesting}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {isSuggesting ? "Mencari..." : "Suggest Placement"}
          </Button>
        </div>
      </div>

      {readOnly && (
        <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          Layout sudah disetujui untuk rendering dan bersifat immutable.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div className="overflow-auto rounded-lg border border-border/70 bg-[#091225] p-3">
          <div
            className="relative mx-auto overflow-hidden rounded-md border border-cyan-300/30"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, maxWidth: "100%", aspectRatio: `${CANVAS_WIDTH}/${CANVAS_HEIGHT}`, backgroundImage: "linear-gradient(rgba(103,232,249,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.08) 1px, transparent 1px)", backgroundSize: `${Math.max(scale * 50, 14)}px ${Math.max(scale * 50, 14)}px` }}
            aria-label="Room placement preview"
          >
            {previewWithCandidate.map((item) => {
              const footprint = rotatedFootprint(item);
              const outside = isOutside(item, room);
              const active = item.id === selectedId;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(item.id)}
                  onPointerDown={(event) => { setSelectedId(item.id); handleDrag(event, item); }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedId(item.id);
                    if (event.key === "ArrowLeft") moveSelected(-25, 0);
                    if (event.key === "ArrowRight") moveSelected(25, 0);
                    if (event.key === "ArrowUp") moveSelected(0, -25);
                    if (event.key === "ArrowDown") moveSelected(0, 25);
                  }}
                  className={`absolute cursor-move select-none rounded-md border text-[10px] font-medium transition-shadow ${outside ? "border-rose-300 bg-rose-500/25" : active ? "border-cyan-200 bg-cyan-400/25 shadow-[0_0_0_2px_rgba(103,232,249,.25)]" : "border-violet-300/60 bg-violet-500/25"}`}
                  style={{ left: item.xCm * scale, top: item.yCm * scale, width: Math.max(18, footprint.width * scale), height: Math.max(18, footprint.depth * scale), minWidth: 18, minHeight: 18 }}
                  title={`${item.label || "Furniture"} · ${outside ? "di luar room" : "klik untuk memilih"}`}
                >
                  <span className="flex h-full items-center justify-center gap-1 overflow-hidden px-1 text-center">
                    {outside && <span aria-label="out of bounds">!</span>}
                    <span className="truncate">{item.label || "Furniture"}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-background/40 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Selected item</p>
            {selected ? (
              <>
                <p className="text-sm font-medium">{selected.label || "Furniture"}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{selected.xCm.toFixed(0)} × {selected.yCm.toFixed(0)} cm</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => toggleLock(selected.id)} disabled={readOnly}>
                    {lockedIds.has(selected.id) ? <Lock className="mr-1 h-3 w-3" /> : <LockOpen className="mr-1 h-3 w-3" />}
                    {lockedIds.has(selected.id) ? "Locked" : "Lock"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => updateSelected({ rotationDeg: ((selected.rotationDeg ?? 0) + 90) % 360 })} disabled={readOnly || lockedIds.has(selected.id)}>
                    <RotateCw className="mr-1 h-3 w-3" /> 90°
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => moveSelected(-25, 0)} disabled={readOnly || lockedIds.has(selected.id)}>← 25</Button>
                  <Button variant="outline" size="sm" onClick={() => moveSelected(25, 0)} disabled={readOnly || lockedIds.has(selected.id)}>25 →</Button>
                  <Button variant="outline" size="sm" onClick={() => moveSelected(0, -25)} disabled={readOnly || lockedIds.has(selected.id)}>↑ 25</Button>
                  <Button variant="outline" size="sm" onClick={() => moveSelected(0, 25)} disabled={readOnly || lockedIds.has(selected.id)}>↓ 25</Button>
                </div>
              </>
            ) : <p className="text-xs text-muted-foreground">Belum ada placement.</p>}
          </div>

          {candidates.length > 0 && (
            <div className="rounded-lg border border-violet-300/20 bg-violet-400/5 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-violet-200">Alternatives</p>
              <div className="space-y-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.candidateId}
                    type="button"
                    className={`w-full rounded-md border p-2 text-left transition-colors ${candidate.candidateId === selectedCandidateId ? "border-violet-300 bg-violet-400/15" : "border-border/60 bg-background/30 hover:bg-background/60"}`}
                    onClick={() => onSelectCandidate(candidate.candidateId)}
                    disabled={!candidate.valid || readOnly}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium">{candidate.strategy.replaceAll("_", " ")}</span>
                      <span className={candidate.valid ? "text-emerald-300" : "text-rose-300"}>{candidate.score.toFixed(0)}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">{candidate.valid ? candidate.explanation : (candidate.warnings[0] || candidate.explanation)}</p>
                  </button>
                ))}
              </div>
              <Button
                className="mt-3 w-full"
                size="sm"
                onClick={() => selectedCandidateId && onApply(selectedCandidateId)}
                disabled={!selectedCandidate?.valid || isApplying || readOnly}
              >
                {isApplying ? "Applying..." : "Apply selected placement"}
              </Button>
              <p className="mt-2 text-[10px] text-muted-foreground">Pilih kandidat valid, lalu Apply untuk menyimpan ke layout.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}