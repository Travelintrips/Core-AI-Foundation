/**
 * Design Template Visual Editor — Phase 5 MVP
 *
 * Routes:
 *   /design-templates/:id/edit                  (loads latest version)
 *   /design-templates/:id/versions/:versionId/edit
 *
 * Features:
 *   - Canvas-based editor (CSS/DOM) with drag/resize/rotate
 *   - All 5 element types: text, image, shape, line, qrcode
 *   - Property panel (right sidebar) with variable binding
 *   - Layers panel (left sidebar) with z-index / lock / visibility
 *   - Undo/redo (max 50 steps)
 *   - Save Draft → POST /ai/design-templates/:id/versions
 *   - Published version → read-only with banner
 *   - Backend preview via POST /ai/design-templates/:id/preview
 *   - Conditional visibility editor
 */

import { useReducer, useCallback, useEffect, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, AlertTriangle, Loader2, Eye, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

import { apiFetch } from "@/lib/apiFetch";
import { canonicalToScene, sceneToCanonical } from "@/lib/designTemplateAdapter";
import type { Scene, SceneElement } from "@/lib/designTemplateAdapter";
import type { DesignTemplate, TemplateVariable } from "@/lib/designTemplateTypes";
import { historyReducer, makeDefaultElement } from "@/components/design-template-editor/types";
import { EditorCanvas } from "@/components/design-template-editor/EditorCanvas";
import { EditorToolbar } from "@/components/design-template-editor/EditorToolbar";
import { ElementPropertiesPanel } from "@/components/design-template-editor/ElementPropertiesPanel";
import { LayersPanel } from "@/components/design-template-editor/LayersPanel";
import { useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TemplateVersion {
  id: number;
  templateId: number;
  versionNumber: number;
  publishedAt: string | null;
  templateJson: DesignTemplate;
  createdAt: string;
  tenantId: string;
}

interface TemplateRecord {
  id: number;
  name: string;
  status: string;
  activeVersionId: number | null;
  tenantId: string;
}

// ── Empty scene factory ───────────────────────────────────────────────────────

function makeEmptyScene(templateId: string, tenantId: string, name: string): Scene {
  const now = new Date().toISOString();
  return {
    canvas: { width: 800, height: 600, backgroundColor: "#ffffff" },
    elements: [],
    variables: [],
    _meta: {
      schemaVersion: "1.0",
      id: templateId,
      tenantId,
      name,
      metadata: { createdBy: "editor", createdAt: now, updatedAt: now, version: 1 },
    },
  };
}

// ── Main Editor Component ─────────────────────────────────────────────────────

export default function DesignTemplateEditor() {
  // Three route patterns — /edit (manual), /editor (AI-assist shortcut), /versions/:id/edit
  const [matchV, paramsV] = useRoute("/design-templates/:id/versions/:versionId/edit");
  const [matchE, paramsE] = useRoute("/design-templates/:id/edit");
  const [matchEd, paramsEd] = useRoute("/design-templates/:id/editor");

  const templateId = matchV ? paramsV?.id : matchE ? paramsE?.id : paramsEd?.id;
  const versionIdParam = matchV ? paramsV?.versionId : undefined;

  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [zoom, setZoom] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Load template record ─────────────────────────────────────────────────
  const { data: template } = useQuery<TemplateRecord>({
    queryKey: ["dt-record", templateId],
    queryFn: () => apiFetch(`/api/ai/design-templates/${templateId}`),
    enabled: !!templateId,
  });

  // ── Load version ──────────────────────────────────────────────────────────
  const versionQuery = useQuery<TemplateVersion>({
    queryKey: ["dt-version", templateId, versionIdParam],
    queryFn: async () => {
      if (versionIdParam) {
        // load specific version
        const versions = await apiFetch<{ versions: TemplateVersion[] }>(
          `/api/ai/design-templates/${templateId}/versions`
        );
        const v = versions.versions.find((v) => String(v.id) === versionIdParam);
        if (!v) throw new Error("Version not found");
        return v;
      } else {
        // load latest version
        const versions = await apiFetch<{ versions: TemplateVersion[] }>(
          `/api/ai/design-templates/${templateId}/versions`
        );
        if (versions.versions.length === 0) return null as unknown as TemplateVersion;
        return versions.versions[0]!;
      }
    },
    enabled: !!templateId,
  });

  const version = versionQuery.data;
  const isPublished = !!version?.publishedAt;
  const readOnly = isPublished;

  // ── History / editor state ─────────────────────────────────────────────────
  const initialized = useRef(false);

  const initialScene: Scene = makeEmptyScene(
    String(templateId ?? ""),
    template?.tenantId ?? "unknown",
    template?.name ?? "Untitled"
  );

  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { scene: initialScene, selectedIds: [] },
    future: [],
  });

  // Initialize scene from loaded version
  useEffect(() => {
    if (initialized.current) return;
    if (!version) return;

    let scene: Scene;
    if (version.templateJson) {
      try {
        scene = canonicalToScene(version.templateJson as DesignTemplate);
      } catch (err) {
        console.error("[editor] Failed to parse template_json:", err);
        scene = makeEmptyScene(
          String(templateId ?? ""),
          template?.tenantId ?? "unknown",
          template?.name ?? "Untitled"
        );
      }
    } else {
      scene = makeEmptyScene(
        String(templateId ?? ""),
        template?.tenantId ?? "unknown",
        template?.name ?? "Untitled"
      );
    }
    dispatch({ type: "SET_SCENE", scene });
    initialized.current = true;
  }, [version, template, templateId]);

  // Also initialize if there are no versions
  useEffect(() => {
    if (initialized.current) return;
    if (versionQuery.isSuccess && !version && template) {
      const scene = makeEmptyScene(String(templateId ?? ""), template.tenantId, template.name);
      dispatch({ type: "SET_SCENE", scene });
      initialized.current = true;
    }
  }, [versionQuery.isSuccess, version, template, templateId]);

  const { scene, selectedIds } = history.present;

  // ── Scene mutations ────────────────────────────────────────────────────────

  const setScene = useCallback((newScene: Scene) => {
    dispatch({ type: "SET_SCENE", scene: newScene });
  }, []);

  const updateElement = useCallback((id: string, changes: Partial<SceneElement>) => {
    const newElements = scene.elements.map((el) =>
      el.id === id ? { ...el, ...changes } as SceneElement : el
    );
    setScene({ ...scene, elements: newElements });
  }, [scene, setScene]);

  const addElement = useCallback((type: SceneElement["type"]) => {
    const el = makeDefaultElement(type, scene.canvas.width, scene.canvas.height);
    const maxZ = scene.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const newEl = { ...el, zIndex: maxZ + 1 };
    const newScene = { ...scene, elements: [...scene.elements, newEl] };
    setScene(newScene);
    dispatch({ type: "SELECT", ids: [newEl.id] });
  }, [scene, setScene]);

  const deleteElements = useCallback((ids: string[]) => {
    const newScene = { ...scene, elements: scene.elements.filter((el) => !ids.includes(el.id)) };
    setScene(newScene);
    dispatch({ type: "SELECT", ids: [] });
  }, [scene, setScene]);

  const reorderElement = useCallback((id: string, dir: "up" | "down") => {
    const el = scene.elements.find((e) => e.id === id);
    if (!el) return;
    const delta = dir === "up" ? 1 : -1;
    const newZ = Math.max(0, el.zIndex + delta);
    updateElement(id, { zIndex: newZ });
  }, [scene.elements, updateElement]);

  const handleSelect = useCallback((id: string | null, multi: boolean) => {
    if (id === null) {
      dispatch({ type: "SELECT", ids: [] });
    } else if (multi) {
      const already = selectedIds.includes(id);
      dispatch({ type: "SELECT", ids: already ? selectedIds.filter((s) => s !== id) : [...selectedIds, id] });
    } else {
      dispatch({ type: "SELECT", ids: [id] });
    }
  }, [selectedIds]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault(); dispatch({ type: "UNDO" });
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault(); dispatch({ type: "REDO" });
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0 && !readOnly) {
        e.preventDefault(); deleteElements(selectedIds);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds, deleteElements, readOnly]);

  // ── Save Draft ────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      const canonical = sceneToCanonical(scene);
      return apiFetch(`/api/ai/design-templates/${templateId}/versions`, {
        method: "POST",
        body: JSON.stringify({ templateJson: canonical }),
      });
    },
    onSuccess: () => {
      toast({ title: "Draft saved", description: "New draft version created successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Preview ───────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    setPreviewUrl(null);
    try {
      const canonical = sceneToCanonical(scene);
      const sampleData: Record<string, unknown> = {};
      for (const v of canonical.variables) {
        sampleData[v.key] = v.defaultValue ?? `[${v.label}]`;
      }

      // Preview returns image/blob or JSON — use raw fetch with credentials: "include"
      // (apiFetch<T> parses JSON only; blob responses need res.blob() instead)
      const res = await fetch(`/api/ai/design-templates/${templateId}/preview`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ templateJson: canonical, data: sampleData, format: "png" }),
      });

      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any)?.error ?? `HTTP ${res.status}`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("image")) {
        const blob = await res.blob();
        setPreviewUrl(URL.createObjectURL(blob));
      } else {
        const data = await res.json() as { previewUrl?: string; imageBase64?: string; imageDataUrl?: string };
        if (data.imageDataUrl) setPreviewUrl(data.imageDataUrl);
        else if (data.imageBase64) setPreviewUrl(`data:image/png;base64,${data.imageBase64}`);
        else if (data.previewUrl) setPreviewUrl(data.previewUrl);
        else throw new Error("No preview image returned");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Preview failed";
      toast({ title: "Preview failed", description: msg, variant: "destructive" });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [scene, templateId, toast]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!templateId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Invalid template URL.</p>
      </div>
    );
  }

  if (versionQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-screen gap-2 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading template…
      </div>
    );
  }

  const selectedEl = selectedIds.length === 1
    ? scene.elements.find((el) => el.id === selectedIds[0]) ?? null
    : null;

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-white shrink-0">
          <Link href="/design-templates">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-slate-900 truncate">{template?.name ?? "Design Template Editor"}</h1>
            {version && (
              <p className="text-xs text-slate-500">
                Version {version.versionNumber}
                {version.publishedAt && ` · Published ${new Date(version.publishedAt).toLocaleDateString()}`}
              </p>
            )}
          </div>
          {isPublished && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 gap-1">
              <Eye className="h-3 w-3" /> Published
            </Badge>
          )}
          {!version && (
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">New</Badge>
          )}
        </div>

        {/* Read-only banner */}
        {isPublished && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs shrink-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This version is <strong>published and immutable</strong>. You are viewing it in read-only mode.
              To make changes, go back and create a new draft from this template.
            </span>
          </div>
        )}

        {/* Toolbar */}
        <EditorToolbar
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          zoom={zoom}
          readOnly={readOnly}
          isSaving={saveMut.isPending}
          onUndo={() => dispatch({ type: "UNDO" })}
          onRedo={() => dispatch({ type: "REDO" })}
          onZoomIn={() => setZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)))}
          onZoomOut={() => setZoom((z) => Math.max(0.1, +(z - 0.1).toFixed(2)))}
          onZoomReset={() => setZoom(1)}
          onSaveDraft={() => saveMut.mutate()}
          onPreview={handlePreview}
          onAddElement={addElement}
        />

        {/* Main layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Layers panel */}
          <div className="w-52 border-r border-gray-200 bg-white shrink-0 overflow-hidden flex flex-col">
            <LayersPanel
              elements={scene.elements}
              selectedIds={selectedIds}
              onSelect={(id, multi) => handleSelect(id, multi)}
              onUpdate={updateElement}
              onDelete={deleteElements}
              onReorder={reorderElement}
              readOnly={readOnly}
            />
          </div>

          {/* Canvas area */}
          <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center p-8">
            <EditorCanvas
              scene={scene}
              selectedIds={selectedIds}
              zoom={zoom}
              onSelect={handleSelect}
              onUpdate={updateElement}
              readOnly={readOnly}
            />
          </div>

          {/* Properties panel */}
          <div className="w-64 border-l border-gray-200 bg-white shrink-0 overflow-hidden flex flex-col">
            <ElementPropertiesPanel
              element={selectedEl}
              variables={scene.variables}
              onUpdate={updateElement}
              readOnly={readOnly}
            />
          </div>
        </div>

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-4xl w-full">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="h-4 w-4" /> Backend Preview — {template?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center justify-center min-h-64 bg-gray-100 rounded-lg overflow-auto">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="h-5 w-5 animate-spin" /> Rendering…
                </div>
              ) : previewUrl ? (
                <img src={previewUrl} alt="Template preview" className="max-w-full max-h-[70vh] object-contain rounded" />
              ) : (
                <div className="flex items-center gap-2 text-gray-400">
                  <X className="h-4 w-4" /> No preview available
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center">
              Preview rendered by backend renderer · {scene.canvas.width}×{scene.canvas.height}px
            </p>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
