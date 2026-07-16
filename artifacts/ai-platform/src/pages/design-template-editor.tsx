/**
 * Design Template Editor — Main Page
 *
 * Route: /design-templates/:id/editor
 *
 * Layout:
 *   TopBar (undo/redo/save/publish/preview)
 *   LeftSidebar | Canvas | RightSidebar (PropertyPanel)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

import { EditorProvider, useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import { TopBar } from "@/components/design-editor/TopBar";
import { LeftSidebar } from "@/components/design-editor/LeftSidebar";
import { PropertyPanel } from "@/components/design-editor/PropertyPanel";
import { EditorCanvas } from "@/components/design-editor/EditorCanvas";
import { designEditorApi } from "@/services/design-editor-api";
import { schemaToEditor, editorToSchema, validateTemplate } from "@/utils/design-editor/adapter";

// ── Inner editor shell (needs EditorProvider context) ─────────────────────────

function EditorShell({ templateId }: { templateId: string }) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const hydrated = useRef(false);

  // ── Fetch template ──────────────────────────────────────────────────────────
  const { data: template, isLoading, error } = useQuery({
    queryKey: ["design-template", templateId],
    queryFn: () => designEditorApi.getTemplate(templateId),
    enabled: !!templateId,
  });

  const { data: versionsData } = useQuery({
    queryKey: ["design-template-versions", templateId],
    queryFn: () => designEditorApi.listVersions(templateId),
    enabled: !!templateId,
  });

  // ── Hydrate editor from latest version ─────────────────────────────────────
  useEffect(() => {
    if (!template || hydrated.current) return;
    const versions = versionsData?.items ?? [];
    const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0];

    if (latest?.templateJson) {
      const normalized = schemaToEditor({
        ...latest.templateJson,
        id: String(template.id),
        name: template.name,
        tenantId: template.tenantId,
      });
      dispatch({
        type: "LOAD_TEMPLATE",
        template: normalized,
        versionId: String(latest.id),
      });
    } else {
      // No versions yet — start with empty canvas
      dispatch({
        type: "LOAD_TEMPLATE",
        template: {
          schemaVersion: "1.0",
          id: String(template.id),
          tenantId: template.tenantId,
          name: template.name,
          canvas: { width: 1080, height: 1080, unit: "px", backgroundColor: "#ffffff" },
          elements: [],
          variables: [],
          metadata: { createdBy: "editor", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1 },
        },
      });
    }
    hydrated.current = true;
  }, [template, versionsData, dispatch]);

  // ── Container size observation ──────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Save draft ──────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const templateJson = editorToSchema(state);
    const validation = validateTemplate(templateJson);
    if (!validation.valid) {
      toast({
        title: "Cannot save",
        description: validation.errors.join(", "),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const version = await designEditorApi.saveDraft(templateId, templateJson, "Draft save");
      dispatch({ type: "MARK_SAVED", versionId: String(version.id) });
      setSavedAt(new Date());
      toast({ title: "Draft saved", description: `Version ${version.versionNumber} created` });
    } catch (e: any) {
      const msg = e?.message ?? "Save failed";
      setSaveError(msg);
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [state, templateId, dispatch, toast]);

  // ── Preview ─────────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      // Save first if dirty, then preview
      if (state.dirty) await handleSave();
      const templateJson = editorToSchema(state);
      const result = await designEditorApi.preview(templateId, templateJson, state.sampleData);
      setPreviewUrl(result.previewUrl ?? result.previewDataUrl ?? null);
    } catch (e: any) {
      toast({ title: "Preview failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [state, templateId, handleSave, toast]);

  // ── Publish ─────────────────────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    // Validate required variables
    const missing = state.variables.filter((v) => v.required && !state.sampleData[v.key]);
    if (missing.length > 0) {
      toast({
        title: "Cannot publish",
        description: `Required variables missing sample data: ${missing.map((v) => v.key).join(", ")}`,
        variant: "destructive",
      });
      return;
    }
    // Save first
    const templateJson = editorToSchema(state);
    const validation = validateTemplate(templateJson);
    if (!validation.valid) {
      toast({ title: "Cannot publish", description: validation.errors.join(", "), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const version = await designEditorApi.saveDraft(templateId, templateJson, "Pre-publish save");
      await designEditorApi.publish(templateId, version.id);
      dispatch({ type: "MARK_SAVED", versionId: String(version.id) });
      setSavedAt(new Date());
      toast({ title: "Published!", description: `Version ${version.versionNumber} is now live` });
    } catch (e: any) {
      toast({ title: "Publish failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [state, templateId, dispatch, toast]);

  // ── Loading / Error states ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[#8899BB]">
        <Loader2 className="size-5 animate-spin mr-2" /> Loading template…
      </div>
    );
  }
  if (error || !template) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-[#8899BB]">
        <AlertTriangle className="size-8 text-red-400" />
        <p className="text-sm">Could not load template</p>
        <Link href="/template-engine">
          <Button size="sm" variant="outline">← Back to Template Engine</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#060B18" }}>
      <TopBar
        onSave={handleSave}
        onPreview={handlePreview}
        onPublish={handlePublish}
        saving={saving}
        saveError={saveError}
        savedAt={savedAt}
      />

      <div className="flex flex-1 min-h-0">
        <LeftSidebar />

        {/* Center canvas */}
        <div ref={containerRef} className="flex-1 relative min-w-0 min-h-0 overflow-hidden">
          {state.canvas.width > 0 && (
            <EditorCanvas
              containerWidth={containerSize.w}
              containerHeight={containerSize.h}
            />
          )}
        </div>

        <PropertyPanel />
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] bg-[#0A1020] rounded-lg overflow-hidden border border-[#1E3057]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1E3057]">
              <span className="text-xs font-medium text-[#F0F4FF]">Final Renderer Preview</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPreviewOpen(false)}>
                ✕ Close
              </Button>
            </div>
            <div className="p-4 flex items-center justify-center min-w-[300px] min-h-[200px]">
              {previewLoading ? (
                <div className="flex flex-col items-center gap-3 text-[#8899BB]">
                  <Loader2 className="size-6 animate-spin" />
                  <p className="text-xs">Rendering via backend…</p>
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="max-w-full max-h-[80vh] object-contain"
                />
              ) : (
                <div className="text-[#8899BB] text-sm text-center space-y-2">
                  <p>Backend render not available</p>
                  <p className="text-xs">(Phase 2 renderer required)</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page wrapper ───────────────────────────────────────────────────────────────

export default function DesignTemplateEditor() {
  const [, params] = useRoute("/design-templates/:id/editor");
  const templateId = params?.id ?? "";

  return (
    <EditorProvider>
      <EditorShell templateId={templateId} />
    </EditorProvider>
  );
}
