import { useReducer, useState, useEffect, useCallback, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Download, Undo2, Redo2, ZoomIn, ZoomOut,
  Eye, History, GitCompare, Loader2, ChevronDown, Layout,
  AlignLeft as AlignElLeft, AlignCenter as AlignElCenter, AlignRight as AlignElRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  Columns2,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { Toolbar } from "@/components/design-studio/toolbar";
import { LayerPanel } from "@/components/design-studio/layer-panel";
import { PropertiesPanel } from "@/components/design-studio/properties-panel";
import { CanvasArea } from "@/components/design-studio/canvas-area";
import {
  historyReducer, makeElement,
  type DesignElement, type CanvasState, type ToolType, type ElementType, type HistoryState,
} from "@/components/design-studio/types";

// ── API helper ─────────────────────────────────────────────────────────────────

// Use empty string so fetch("/api/...") goes through the Vite /api proxy.
// Do NOT use BASE_URL here — that prepends "/admin" which breaks proxy routing.
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface CanvasResponse {
  projectId: number;
  versionId: number;
  versionNumber: number;
  canvasState: CanvasState;
  savedAt: string;
}

interface VersionItem {
  id: number;
  projectId: number;
  versionNumber: number;
  label: string | null;
  elementCount: number;
  createdAt: string;
}

interface DesignProject {
  id: number;
  name: string;
  status: string;
  canvasWidth: number;
  canvasHeight: number;
}

// ── Alignment helpers ─────────────────────────────────────────────────────────

function alignElements(elements: DesignElement[], selectedIds: string[], alignment: string, canvasW: number, canvasH: number): DesignElement[] {
  if (selectedIds.length === 0) return elements;
  const selected = elements.filter((e) => selectedIds.includes(e.id));
  if (selected.length === 0) return elements;

  const minX = Math.min(...selected.map((e) => e.x));
  const maxX = Math.max(...selected.map((e) => e.x + e.width));
  const minY = Math.min(...selected.map((e) => e.y));
  const maxY = Math.max(...selected.map((e) => e.y + e.height));
  const selW = maxX - minX;
  const selH = maxY - minY;

  return elements.map((el) => {
    if (!selectedIds.includes(el.id)) return el;
    switch (alignment) {
      case "left":   return { ...el, x: minX };
      case "center": return { ...el, x: minX + selW / 2 - el.width / 2 };
      case "right":  return { ...el, x: maxX - el.width };
      case "top":    return { ...el, y: minY };
      case "middle": return { ...el, y: minY + selH / 2 - el.height / 2 };
      case "bottom": return { ...el, y: maxY - el.height };
      // to canvas
      case "canvas-left":   return { ...el, x: 0 };
      case "canvas-hcenter": return { ...el, x: canvasW / 2 - el.width / 2 };
      case "canvas-right":  return { ...el, x: canvasW - el.width };
      case "canvas-top":    return { ...el, y: 0 };
      case "canvas-vcenter": return { ...el, y: canvasH / 2 - el.height / 2 };
      case "canvas-bottom": return { ...el, y: canvasH - el.height };
      default: return el;
    }
  });
}

// ── Main Editor ───────────────────────────────────────────────────────────────

export default function DesignStudioEditor() {
  const [, params] = useRoute("/design-studio/:id");
  const [, navigate] = useLocation();
  const projectId = parseInt(params?.id ?? "", 10);
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Fetch project + canvas ──────────────────────────────────────────────────
  const { data: project } = useQuery<DesignProject>({
    queryKey: ["design-project", projectId],
    queryFn: () => apiFetch(`/api/ai/design/projects/${projectId}`),
    enabled: !isNaN(projectId),
  });

  const { data: canvasData, isLoading: canvasLoading } = useQuery<CanvasResponse>({
    queryKey: ["design-canvas", projectId],
    queryFn: () => apiFetch(`/api/ai/design/projects/${projectId}/canvas`),
    enabled: !isNaN(projectId),
  });

  // ── History state (undo/redo) ────────────────────────────────────────────────
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: {
      width: project?.canvasWidth ?? 1920,
      height: project?.canvasHeight ?? 1080,
      background: "#ffffff",
      elements: [],
    },
    future: [],
  } as HistoryState);

  // Hydrate from server once canvas loads
  const hydrated = useRef(false);
  useEffect(() => {
    if (canvasData?.canvasState && !hydrated.current) {
      hydrated.current = true;
      dispatch({ type: "SET", state: canvasData.canvasState });
    }
  }, [canvasData]);

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [zoom, setZoom] = useState(0.5);
  const [showGrid, setShowGrid] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [projectName, setProjectName] = useState(project?.name ?? "Untitled");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<CanvasState | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);

  // Sync project name
  useEffect(() => {
    if (project?.name) setProjectName(project.name);
  }, [project?.name]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (payload: { canvasState: CanvasState; label?: string }) =>
      apiFetch<CanvasResponse>(`/api/ai/design/projects/${projectId}/canvas`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      qc.invalidateQueries({ queryKey: ["design-project", projectId] });
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => setSaveStatus("error"),
  });

  const updateProjectMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch(`/api/ai/design/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["design-project", projectId] }),
  });

  const exportMutation = useMutation({
    mutationFn: (format: string) =>
      apiFetch<{ format: string; dataUrl: string | null; url: string }>(`/api/ai/design/projects/${projectId}/export`, {
        method: "POST",
        body: JSON.stringify({ format }),
      }),
    onSuccess: (data) => {
      const url = data.dataUrl ?? data.url;
      const a = document.createElement("a");
      a.href = url;
      a.download = `design-${projectId}.${data.format}`;
      a.click();
      toast({ title: `Exported as ${data.format.toUpperCase()}` });
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  const { data: versions } = useQuery<{ items: VersionItem[]; total: number }>({
    queryKey: ["design-versions", projectId],
    queryFn: () => apiFetch(`/api/ai/design/projects/${projectId}/versions`),
    enabled: versionsOpen || compareOpen,
  });

  const restoreVersionMutation = useMutation({
    mutationFn: (versionId: number) =>
      apiFetch<CanvasResponse>(`/api/ai/design/projects/${projectId}/versions/${versionId}/restore`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      dispatch({ type: "SET", state: data.canvasState });
      setVersionsOpen(false);
      toast({ title: "Version restored!" });
    },
  });

  // ── Canvas mutations ──────────────────────────────────────────────────────────
  const canvas = history.present;

  function setCanvas(state: CanvasState) {
    dispatch({ type: "SET", state });
  }

  function updateElement(id: string, changes: Partial<DesignElement>) {
    setCanvas({
      ...canvas,
      elements: canvas.elements.map((el) => el.id === id ? { ...el, ...changes } : el),
    });
  }

  function addElement(element: DesignElement) {
    setCanvas({ ...canvas, elements: [...canvas.elements, element] });
    setSelectedIds([element.id]);
    setActiveTool("select");
  }

  function deleteElements(ids: string[]) {
    setCanvas({ ...canvas, elements: canvas.elements.filter((el) => !ids.includes(el.id)) });
    setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
  }

  function reorderElement(id: string, direction: "up" | "down") {
    const els = [...canvas.elements].sort((a, b) => a.zIndex - b.zIndex);
    const idx = els.findIndex((e) => e.id === id);
    if (idx === -1) return;

    if (direction === "up" && idx < els.length - 1) {
      const target = els[idx + 1]!;
      const cur = els[idx]!;
      const newEls = canvas.elements.map((el) =>
        el.id === id ? { ...el, zIndex: target.zIndex } :
        el.id === target.id ? { ...el, zIndex: cur.zIndex } : el
      );
      setCanvas({ ...canvas, elements: newEls });
    } else if (direction === "down" && idx > 0) {
      const target = els[idx - 1]!;
      const cur = els[idx]!;
      const newEls = canvas.elements.map((el) =>
        el.id === id ? { ...el, zIndex: target.zIndex } :
        el.id === target.id ? { ...el, zIndex: cur.zIndex } : el
      );
      setCanvas({ ...canvas, elements: newEls });
    }
  }

  function handleSelect(id: string | null, multi: boolean) {
    if (id === null) { setSelectedIds([]); return; }
    if (multi) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
      );
    } else {
      setSelectedIds([id]);
    }
  }

  function handleAlign(alignment: string) {
    const newEls = alignElements(canvas.elements, selectedIds, alignment, canvas.width, canvas.height);
    setCanvas({ ...canvas, elements: newEls });
  }

  function handleAddElementTool(type: ElementType) {
    const el = makeElement(type, canvas.width / 2 - 100, canvas.height / 2 - 60);
    const maxZ = canvas.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    addElement({ ...el, zIndex: maxZ + 1 });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "UNDO" }); }
      if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); dispatch({ type: "REDO" }); }
      if (mod && e.key === "s") { e.preventDefault(); handleSave(); }
      if (e.key === "v" || e.key === "V") setActiveTool("select");
      if (e.key === "h" || e.key === "H") setActiveTool("hand");
      if (e.key === "t" || e.key === "T") setActiveTool("text");
      if (e.key === "r" || e.key === "R") setActiveTool("rect");
      if (e.key === "e" || e.key === "E") setActiveTool("circle");
      if (e.key === "l" || e.key === "L") setActiveTool("line");
      if (e.key === "f" || e.key === "F") setActiveTool("frame");
      if (e.key === "i" || e.key === "I") setActiveTool("image");
      if (e.key === "=" || e.key === "+") setZoom((z) => Math.min(3, z + 0.1));
      if (e.key === "-") setZoom((z) => Math.max(0.1, z - 0.1));
      if (e.key === "0" && mod) { e.preventDefault(); setZoom(1); }
      if (e.key === "1" && mod) { e.preventDefault(); setZoom(0.5); }
    }

    function onDeleteSelected() { deleteElements(selectedIds); }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("design-delete-selected", onDeleteSelected);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("design-delete-selected", onDeleteSelected);
    };
  }, [selectedIds, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-save (debounced) ─────────────────────────────────────────────────────
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveMutation.mutate({ canvasState: canvas });
    }, 3000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [canvas]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave(label?: string) {
    saveMutation.mutate({ canvasState: canvas, label });
  }

  // ── Compare ───────────────────────────────────────────────────────────────────
  async function openCompare(versionId: number) {
    try {
      const v = await apiFetch<{ canvasState: CanvasState }>(`/api/ai/design/projects/${projectId}/versions/${versionId}`);
      setCompareVersion(v.canvasState);
      setCompareVersionId(versionId);
      setCompareOpen(true);
    } catch {
      toast({ title: "Failed to load version", variant: "destructive" });
    }
  }

  const selectedElement = selectedIds.length === 1
    ? canvas.elements.find((e) => e.id === selectedIds[0]) ?? null
    : null;

  const zoomPercent = Math.round(zoom * 100);

  if (isNaN(projectId)) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Invalid project ID
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-gray-100 overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-white border-b border-gray-200 shrink-0 h-12">
          {/* Back */}
          <Link href="/design-studio">
            <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>

          <Layout className="h-4 w-4 text-indigo-600 shrink-0" />

          {/* Project name */}
          {editingName ? (
            <Input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => {
                setEditingName(false);
                if (projectName.trim() !== project?.name) {
                  updateProjectMutation.mutate(projectName.trim() || "Untitled");
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              className="h-7 text-sm font-medium w-52"
            />
          ) : (
            <button
              className="text-sm font-medium text-gray-800 hover:text-indigo-600 transition-colors truncate max-w-[200px]"
              onDoubleClick={() => setEditingName(true)}
              title="Double-click to rename"
            >
              {projectName}
            </button>
          )}

          {/* Save status */}
          <span className={cn(
            "text-xs shrink-0",
            saveStatus === "saving" ? "text-yellow-500" :
            saveStatus === "saved" ? "text-green-500" :
            saveStatus === "error" ? "text-red-500" :
            "text-gray-400"
          )}>
            {saveStatus === "saving" && <Loader2 className="inline h-3 w-3 animate-spin mr-1" />}
            {saveStatus === "saving" ? "Saving…" :
             saveStatus === "saved" ? "Saved" :
             saveStatus === "error" ? "Save failed" :
             "Auto-save on"}
          </span>

          <Separator orientation="vertical" className="h-5" />

          {/* Undo/Redo */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => dispatch({ type: "UNDO" })} disabled={history.past.length === 0}>
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (⌘Z)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => dispatch({ type: "REDO" })} disabled={history.future.length === 0}>
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5" />

          {/* Alignment tools (visible when elements selected) */}
          {selectedIds.length > 0 && (
            <>
              <div className="flex items-center gap-0.5">
                {[
                  { id: "canvas-left", icon: <AlignElLeft className="h-3.5 w-3.5" />, label: "Align left to canvas" },
                  { id: "canvas-hcenter", icon: <AlignElCenter className="h-3.5 w-3.5" />, label: "Center horizontally" },
                  { id: "canvas-right", icon: <AlignElRight className="h-3.5 w-3.5" />, label: "Align right to canvas" },
                  { id: "canvas-top", icon: <AlignStartVertical className="h-3.5 w-3.5" />, label: "Align top to canvas" },
                  { id: "canvas-vcenter", icon: <AlignCenterVertical className="h-3.5 w-3.5" />, label: "Center vertically" },
                  { id: "canvas-bottom", icon: <AlignEndVertical className="h-3.5 w-3.5" />, label: "Align bottom to canvas" },
                ].map(({ id, icon, label }) => (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAlign(id)}>
                        {icon}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              {selectedIds.length > 1 && (
                <div className="flex items-center gap-0.5">
                  {[
                    { id: "left", icon: <AlignElLeft className="h-3.5 w-3.5" />, label: "Align left edges" },
                    { id: "center", icon: <AlignElCenter className="h-3.5 w-3.5" />, label: "Align horizontal centers" },
                    { id: "right", icon: <AlignElRight className="h-3.5 w-3.5" />, label: "Align right edges" },
                    { id: "top", icon: <AlignStartVertical className="h-3.5 w-3.5" />, label: "Align top edges" },
                    { id: "middle", icon: <AlignCenterVertical className="h-3.5 w-3.5" />, label: "Align vertical centers" },
                    { id: "bottom", icon: <AlignEndVertical className="h-3.5 w-3.5" />, label: "Align bottom edges" },
                  ].map(({ id, icon, label }) => (
                    <Tooltip key={id}>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleAlign(id)}>
                          {icon}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
              <Separator orientation="vertical" className="h-5" />
            </>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* Zoom control */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-100 min-w-[52px] text-center">
                    {zoomPercent}%
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  {[25, 50, 75, 100, 125, 150, 200].map((z) => (
                    <DropdownMenuItem key={z} onClick={() => setZoom(z / 100)}>
                      {z}%{z === 100 ? " (1:1)" : ""}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={() => setZoom(0.5)}>Fit to screen</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator orientation="vertical" className="h-5" />

            {/* Preview */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewOpen(true)}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview</TooltipContent>
            </Tooltip>

            {/* Versions */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setVersionsOpen(true)}>
                  <History className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Version History</TooltipContent>
            </Tooltip>

            {/* Compare */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCompareOpen(true)}>
                  <Columns2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Compare Versions</TooltipContent>
            </Tooltip>

            {/* Save */}
            <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleSave()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </Button>

            {/* Export */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                  <Download className="h-3 w-3" />
                  Export
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportMutation.mutate("json")}>
                  Download JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportMutation.mutate("svg")}>
                  Download SVG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportMutation.mutate("png")} className="text-gray-400">
                  PNG (via SVG)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">

          {/* Left: Toolbar + Layers */}
          <div className="flex shrink-0">
            <Toolbar
              activeTool={activeTool}
              onToolChange={setActiveTool}
              showGrid={showGrid}
              onToggleGrid={() => setShowGrid((v) => !v)}
              showGuides={showGuides}
              onToggleGuides={() => setShowGuides((v) => !v)}
              onAddElement={handleAddElementTool}
            />
            <div className="w-52 flex flex-col bg-white border-r border-gray-200 overflow-hidden">
              <LayerPanel
                elements={canvas.elements}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onUpdate={updateElement}
                onDelete={deleteElements}
                onReorder={reorderElement}
              />
            </div>
          </div>

          {/* Center: Canvas */}
          <div className="flex-1 overflow-auto bg-gray-200/60 flex items-start justify-start p-8">
            {canvasLoading ? (
              <div className="flex items-center justify-center w-full h-full">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : (
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  flexShrink: 0,
                }}
              >
                <CanvasArea
                  canvas={canvas}
                  selectedIds={selectedIds}
                  activeTool={activeTool}
                  zoom={zoom}
                  showGrid={showGrid}
                  onSelect={handleSelect}
                  onUpdate={updateElement}
                  onAdd={addElement}
                />
              </div>
            )}
          </div>

          {/* Right: Properties */}
          <div className="w-64 shrink-0 bg-white border-l border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {selectedElement ? selectedElement.name : "Canvas"}
              </span>
            </div>
            <div className="flex-1 overflow-hidden" style={{ height: "calc(100% - 36px)" }}>
              <PropertiesPanel
                element={selectedElement}
                canvas={canvas}
                projectId={isNaN(projectId) ? null : projectId}
                onUpdate={updateElement}
                onCanvasUpdate={(changes) => setCanvas({ ...canvas, ...changes })}
              />
            </div>
          </div>
        </div>

        {/* ── Version History Dialog ─────────────────────────────────────── */}
        <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="h-4 w-4" /> Version History
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-1 py-2">
                {(versions?.items ?? []).map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        v{v.versionNumber}{v.label ? ` — ${v.label}` : ""}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(v.createdAt).toLocaleString()} · {v.elementCount} elements
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openCompare(v.id)}
                      >
                        <GitCompare className="h-3 w-3 mr-1" /> Compare
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-indigo-600"
                        onClick={() => restoreVersionMutation.mutate(v.id)}
                        disabled={restoreVersionMutation.isPending}
                      >
                        Restore
                      </Button>
                    </div>
                  </div>
                ))}
                {versions?.items.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-6">No versions yet</p>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* ── Compare Dialog ─────────────────────────────────────────────── */}
        <Dialog open={compareOpen && !!compareVersion} onOpenChange={setCompareOpen}>
          <DialogContent className="max-w-5xl w-full">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Columns2 className="h-4 w-4" />
                Compare — Current vs v{versions?.items.find((v) => v.id === compareVersionId)?.versionNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="flex gap-4 overflow-auto">
              {/* Current */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-500 mb-2 text-center">Current</p>
                <div
                  className="border border-gray-200 rounded overflow-hidden"
                  style={{ aspectRatio: `${canvas.width}/${canvas.height}` }}
                >
                  <div style={{ transform: `scale(${320 / canvas.width})`, transformOrigin: "top left", width: canvas.width, height: canvas.height }}>
                    <CanvasArea
                      canvas={canvas}
                      selectedIds={[]}
                      activeTool="select"
                      zoom={1}
                      showGrid={false}
                      onSelect={() => {}}
                      onUpdate={() => {}}
                      onAdd={() => {}}
                    />
                  </div>
                </div>
              </div>
              {/* Compare version */}
              {compareVersion && (
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-500 mb-2 text-center">
                    v{versions?.items.find((v) => v.id === compareVersionId)?.versionNumber}
                  </p>
                  <div
                    className="border border-indigo-200 rounded overflow-hidden"
                    style={{ aspectRatio: `${compareVersion.width}/${compareVersion.height}` }}
                  >
                    <div style={{ transform: `scale(${320 / compareVersion.width})`, transformOrigin: "top left", width: compareVersion.width, height: compareVersion.height }}>
                      <CanvasArea
                        canvas={compareVersion}
                        selectedIds={[]}
                        activeTool="select"
                        zoom={1}
                        showGrid={false}
                        onSelect={() => {}}
                        onUpdate={() => {}}
                        onAdd={() => {}}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Preview Dialog ─────────────────────────────────────────────── */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl w-full">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4" /> Preview — {project?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center overflow-auto p-4 bg-gray-100 rounded-lg">
              <div style={{
                transform: `scale(${Math.min(800 / canvas.width, 500 / canvas.height)})`,
                transformOrigin: "top left",
                width: canvas.width,
                height: canvas.height,
                flexShrink: 0,
              }}>
                <CanvasArea
                  canvas={canvas}
                  selectedIds={[]}
                  activeTool="select"
                  zoom={1}
                  showGrid={false}
                  onSelect={() => {}}
                  onUpdate={() => {}}
                  onAdd={() => {}}
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 text-center">
              {canvas.width} × {canvas.height}px · {canvas.elements.filter(e => e.visible).length} visible elements
            </p>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
