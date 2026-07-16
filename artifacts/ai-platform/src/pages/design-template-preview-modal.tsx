/**
 * Preview Modal — renders a template with user-supplied variable data.
 *
 * Flow:
 *  1. GET /api/ai/design-templates/:id/preview → variables + sample data
 *  2. User fills the variable form (auto-built from template variables)
 *  3. POST /api/ai/design-templates/:id/preview → binary image (png)
 *  4. Display rendered image with canvas dimensions + any renderer warnings
 */

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Eye, Loader2, AlertCircle, RotateCcw, ZoomIn, ZoomOut,
} from "lucide-react";
import { getPreviewData, renderPreview } from "@/services/design-template-api";
import type { TemplateVariable, RenderedPreview } from "@/types/design-template-ui";

// ── Variable field ────────────────────────────────────────────────────────────

interface VariableFieldProps {
  variable: TemplateVariable;
  value: string;
  onChange: (v: string) => void;
}

function VariableField({ variable, value, onChange }: VariableFieldProps) {
  const id = `var-${variable.key}`;
  const label = (
    <Label htmlFor={id} className="text-xs font-medium">
      {variable.label}
      {variable.required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
      <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 align-middle">
        {variable.type}
      </Badge>
    </Label>
  );

  const commonProps = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    className: "mt-1 h-8 text-xs",
    required: variable.required,
    "aria-required": variable.required,
  };

  let field: React.ReactNode;

  switch (variable.type) {
    case "number":
    case "currency":
      field = (
        <Input
          {...commonProps}
          type="number"
          min={variable.validation?.min}
          max={variable.validation?.max}
          step={variable.type === "currency" ? "0.01" : "1"}
          placeholder={variable.type === "currency" ? "0.00" : "0"}
        />
      );
      break;
    case "color":
      field = (
        <div className="flex items-center gap-2 mt-1">
          <input
            id={id}
            type="color"
            value={value || "#000000"}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-12 rounded border border-gray-200 cursor-pointer p-0.5"
            aria-required={variable.required}
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#000000"
            className="h-8 text-xs font-mono"
          />
        </div>
      );
      break;
    case "url":
    case "image":
      field = (
        <Input
          {...commonProps}
          type="url"
          placeholder={variable.type === "image" ? "https://… (image URL)" : "https://…"}
          maxLength={variable.validation?.maxLength ?? 2048}
        />
      );
      break;
    case "date":
      field = <Input {...commonProps} type="date" />;
      break;
    case "boolean":
      field = (
        <div className="flex items-center gap-2 mt-2">
          <input
            id={id}
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
            className="h-4 w-4 rounded"
            aria-required={variable.required}
          />
          <span className="text-xs text-gray-600">{value === "true" ? "Yes" : "No"}</span>
        </div>
      );
      break;
    default: // text
      field = (
        <Input
          {...commonProps}
          type="text"
          placeholder={`Enter ${variable.label.toLowerCase()}`}
          maxLength={variable.validation?.maxLength ?? 500}
        />
      );
  }

  return (
    <div>
      {label}
      {field}
    </div>
  );
}

// ── Preview Modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  templateId: number;
  templateName: string;
  onClose: () => void;
  initialVersionId?: number;
}

export default function PreviewModal({ templateId, templateName, onClose, initialVersionId }: PreviewModalProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<RenderedPreview | null>(null);
  const [zoom, setZoom] = useState(1);
  const prevObjectUrl = useRef<string | null>(null);

  // Load preview data (template JSON + sample data)
  const { data: previewData, isLoading: loadingMeta, isError: metaError } = useQuery({
    queryKey: ["design-template-preview-meta", templateId],
    queryFn: () => getPreviewData(templateId),
  });

  // Seed form with sample data when loaded
  useEffect(() => {
    if (previewData?.sampleData) {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(previewData.sampleData)) {
        seed[k] = String(v ?? "");
      }
      setFormData(seed);
    }
  }, [previewData]);

  // Cleanup object URL on unmount / re-render
  useEffect(() => {
    return () => {
      if (prevObjectUrl.current) URL.revokeObjectURL(prevObjectUrl.current);
    };
  }, []);

  const renderMutation = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(formData)) {
        data[k] = v === "" ? null : v;
      }
      return renderPreview(templateId, data, { templateVersionId: initialVersionId });
    },
    onSuccess: (result) => {
      // Revoke previous blob URL to avoid memory leaks
      if (prevObjectUrl.current) URL.revokeObjectURL(prevObjectUrl.current);
      prevObjectUrl.current = result.objectUrl;
      setPreview(result);
    },
  });

  function handleReset() {
    if (previewData?.sampleData) {
      const seed: Record<string, string> = {};
      for (const [k, v] of Object.entries(previewData.sampleData)) {
        seed[k] = String(v ?? "");
      }
      setFormData(seed);
    }
    setPreview(null);
  }

  const variables = previewData?.templateJson?.variables ?? [];
  const canvas = previewData?.templateJson?.canvas;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-indigo-600" />
            Preview — {templateName}
          </DialogTitle>
          <DialogDescription>
            Fill in the variable values below, then click Render to see the output.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── Left: Variable Form ── */}
          <div className="w-72 shrink-0 border-r overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                Variables
              </h3>
              <button
                onClick={handleReset}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                aria-label="Reset to sample data"
              >
                <RotateCcw className="h-3 w-3" /> Reset
              </button>
            </div>

            {loadingMeta && (
              <div className="flex items-center gap-2 text-gray-400 text-xs py-4">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading template…
              </div>
            )}

            {metaError && (
              <div className="flex items-center gap-2 text-red-600 text-xs py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>No active version — publish a version first before previewing.</span>
              </div>
            )}

            {!loadingMeta && !metaError && variables.length === 0 && (
              <p className="text-xs text-gray-400 py-2">
                This template has no variables. Click Render to see the static output.
              </p>
            )}

            {variables.map((v: TemplateVariable) => (
              <VariableField
                key={v.key}
                variable={v}
                value={formData[v.key] ?? ""}
                onChange={(val) => setFormData((prev) => ({ ...prev, [v.key]: val }))}
              />
            ))}

            {canvas && (
              <div className="pt-3 border-t text-[10px] text-gray-400 space-y-0.5">
                <p>Canvas: {canvas.width} × {canvas.height} px</p>
                {canvas.backgroundColor && (
                  <p className="flex items-center gap-1">
                    Background:
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-gray-200"
                      style={{ background: canvas.backgroundColor }}
                    />
                    {canvas.backgroundColor}
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={() => renderMutation.mutate()}
              disabled={renderMutation.isPending || loadingMeta || metaError as boolean}
              className="w-full mt-2"
              size="sm"
            >
              {renderMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Rendering…</>
                : <><Eye className="h-3.5 w-3.5 mr-2" /> Render Preview</>}
            </Button>

            {renderMutation.isError && (
              <div className="flex items-start gap-2 p-2 bg-red-50 rounded text-red-700 text-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{(renderMutation.error as Error)?.message}</span>
              </div>
            )}
          </div>

          {/* ── Right: Preview Area ── */}
          <div className="flex-1 overflow-auto bg-gray-100 flex flex-col">
            {/* Zoom controls */}
            {preview && (
              <div className="flex items-center gap-2 px-4 py-2 bg-white border-b shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.1, z - 0.1))} aria-label="Zoom out">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} aria-label="Zoom in">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <span className="text-xs text-gray-400 ml-2">
                  {preview.canvasWidth} × {preview.canvasHeight} px
                </span>
                {preview.warnings > 0 && (
                  <Badge variant="outline" className="ml-auto text-[10px] text-yellow-600 border-yellow-300 bg-yellow-50">
                    {preview.warnings} renderer warning{preview.warnings !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            )}

            {/* Canvas area */}
            <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
              {!preview && !renderMutation.isPending && (
                <div className="text-center text-gray-400">
                  <Eye className="h-12 w-12 mx-auto mb-3 opacity-20" aria-hidden />
                  <p className="text-sm">Fill in the variables and click Render Preview</p>
                  <p className="text-xs mt-1 opacity-70">Preview uses the real backend renderer</p>
                </div>
              )}
              {renderMutation.isPending && (
                <div className="text-center text-gray-400">
                  <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin opacity-40" />
                  <p className="text-sm">Rendering with backend…</p>
                </div>
              )}
              {preview && !renderMutation.isPending && (
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}>
                  <img
                    src={preview.objectUrl}
                    alt="Rendered template preview"
                    className="block shadow-xl max-w-none"
                    style={{ maxWidth: "none" }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
