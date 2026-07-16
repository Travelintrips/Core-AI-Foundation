/**
 * EditorToolbar — top toolbar: add elements, zoom, undo/redo, save, preview
 */
import {
  Type, Image, Square, Minus, QrCode, Undo2, Redo2,
  ZoomIn, ZoomOut, Save, Eye, ChevronDown, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SceneElement } from "@/lib/designTemplateAdapter";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  readOnly: boolean;
  isSaving: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onSaveDraft: () => void;
  onPreview: () => void;
  onAddElement: (type: SceneElement["type"]) => void;
}

const ELEMENT_TYPES: { type: SceneElement["type"]; label: string; icon: React.ReactNode }[] = [
  { type: "text",   label: "Text",      icon: <Type className="h-4 w-4" /> },
  { type: "image",  label: "Image",     icon: <Image className="h-4 w-4" /> },
  { type: "shape",  label: "Shape",     icon: <Square className="h-4 w-4" /> },
  { type: "line",   label: "Line",      icon: <Minus className="h-4 w-4" /> },
  { type: "qrcode", label: "QR Code",   icon: <QrCode className="h-4 w-4" /> },
];

export function EditorToolbar({
  canUndo, canRedo, zoom, readOnly, isSaving,
  onUndo, onRedo, onZoomIn, onZoomOut, onZoomReset,
  onSaveDraft, onPreview, onAddElement,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-white">
      {/* Add element */}
      {!readOnly && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Add <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ELEMENT_TYPES.map(({ type, label, icon }) => (
                <DropdownMenuItem key={type} onClick={() => onAddElement(type)} className="gap-2">
                  {icon} {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="h-6" />
        </>
      )}

      {/* Undo / Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onUndo} disabled={!canUndo || readOnly}>
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRedo} disabled={!canRedo || readOnly}>
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6" />

      {/* Zoom */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom Out</TooltipContent>
      </Tooltip>
      <button
        onClick={onZoomReset}
        className="text-xs font-mono text-gray-600 hover:text-gray-900 w-12 text-center"
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom In</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Preview */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={onPreview}>
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
        </TooltipTrigger>
        <TooltipContent>Backend-rendered preview (PNG)</TooltipContent>
      </Tooltip>

      {/* Save Draft */}
      {!readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onSaveDraft} disabled={isSaving}>
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "Saving…" : "Save Draft"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save as new draft version (POST /versions)</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
