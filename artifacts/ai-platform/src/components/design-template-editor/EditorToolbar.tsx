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
  { type: "text",   label: "Text",    icon: <Type className="h-4 w-4" /> },
  { type: "image",  label: "Image",   icon: <Image className="h-4 w-4" /> },
  { type: "shape",  label: "Shape",   icon: <Square className="h-4 w-4" /> },
  { type: "line",   label: "Line",    icon: <Minus className="h-4 w-4" /> },
  { type: "qrcode", label: "QR Code", icon: <QrCode className="h-4 w-4" /> },
];

export function EditorToolbar({
  canUndo, canRedo, zoom, readOnly, isSaving,
  onUndo, onRedo, onZoomIn, onZoomOut, onZoomReset,
  onSaveDraft, onPreview, onAddElement,
}: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white shrink-0">
      {/* Add element */}
      {!readOnly && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs font-medium text-slate-700 border-gray-300 hover:bg-slate-50 hover:text-slate-900"
              >
                <Plus className="h-3.5 w-3.5" /> Add <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {ELEMENT_TYPES.map(({ type, label, icon }) => (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onAddElement(type)}
                  className="gap-2 text-slate-700 cursor-pointer"
                >
                  {icon} {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="h-6" />
        </>
      )}

      {/* Undo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onUndo}
            disabled={!canUndo || readOnly}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>

      {/* Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onRedo}
            disabled={!canRedo || readOnly}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6" />

      {/* Zoom out */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={onZoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom Out</TooltipContent>
      </Tooltip>

      {/* Zoom % */}
      <button
        onClick={onZoomReset}
        className="text-xs font-mono font-semibold text-slate-800 hover:text-slate-900 w-12 text-center rounded hover:bg-slate-100 py-1 transition-colors"
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>

      {/* Zoom in */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={onZoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Zoom In</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Preview */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs font-medium text-slate-700 border-gray-300 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            onClick={onPreview}
          >
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
        </TooltipTrigger>
        <TooltipContent>Backend-rendered preview (PNG)</TooltipContent>
      </Tooltip>

      {/* Save Draft */}
      {!readOnly && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50"
              onClick={onSaveDraft}
              disabled={isSaving}
            >
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "Saving…" : "Save Draft"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save as new draft version</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
