/**
 * TopBar — editor header with undo/redo, zoom, save, preview, publish.
 */

import { useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Save, Undo2, Redo2, ZoomIn, ZoomOut, Eye,
  Loader2, CheckCircle2, AlertCircle, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";

interface Props {
  onSave: () => Promise<void>;
  onPreview: () => Promise<void>;
  onPublish: () => Promise<void>;
  saving?: boolean;
  saveError?: string | null;
  savedAt?: Date | null;
}

export function TopBar({ onSave, onPreview, onPublish, saving, saveError, savedAt }: Props) {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const canUndo = state.history.past.length > 0;
  const canRedo = state.history.future.length > 0;
  const zoomPct = Math.round(state.zoom * 100);

  const handleZoomIn = () => dispatch({ type: "SET_ZOOM", zoom: Math.min(state.zoom + 0.1, 5) });
  const handleZoomOut = () => dispatch({ type: "SET_ZOOM", zoom: Math.max(state.zoom - 0.1, 0.1) });
  const handleZoom100 = () => dispatch({ type: "SET_ZOOM", zoom: 1 });

  return (
    <header
      className="h-12 flex items-center gap-2 px-3 flex-shrink-0 z-10"
      style={{ background: "#0A1020", borderBottom: "1px solid #1E3057" }}
    >
      {/* Back */}
      <Link href="/template-engine">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
          <ArrowLeft className="size-3.5" />
        </Button>
      </Link>

      <Separator orientation="vertical" className="h-5 bg-[#1E3057]" />

      {/* Template name */}
      <span className="text-sm font-medium text-[#F0F4FF] truncate max-w-[200px]">
        {state.templateName}
      </span>

      {/* Status badge */}
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] h-4 px-1.5",
          state.templateStatus === "published"
            ? "border-green-600 text-green-400"
            : "border-[#7C6EFA] text-[#9D91FB]",
        )}
      >
        {state.templateStatus}
      </Badge>

      {state.dirty && (
        <span className="text-[10px] text-amber-400">●unsaved</span>
      )}

      <div className="flex-1" />

      {/* Undo / Redo */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="sm" className="h-7 w-7 p-0"
            onClick={() => dispatch({ type: "UNDO" })}
            disabled={!canUndo}
          >
            <Undo2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="sm" className="h-7 w-7 p-0"
            onClick={() => dispatch({ type: "REDO" })}
            disabled={!canRedo}
          >
            <Redo2 className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-5 bg-[#1E3057]" />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleZoomOut}>
          <ZoomOut className="size-3" />
        </Button>
        <Button
          variant="ghost" size="sm"
          className="h-7 px-2 text-xs text-[#9D91FB] min-w-[48px]"
          onClick={handleZoom100}
        >
          {zoomPct}%
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleZoomIn}>
          <ZoomIn className="size-3" />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-5 bg-[#1E3057]" />

      {/* Preview */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" onClick={onPreview}>
            <Eye className="size-3.5" />
            Preview
          </Button>
        </TooltipTrigger>
        <TooltipContent>Final Renderer Preview (backend)</TooltipContent>
      </Tooltip>

      {/* Save */}
      <Button
        size="sm"
        className="h-7 gap-1.5 px-3 text-xs"
        style={{ background: "#7C6EFA" }}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        Save Draft
      </Button>

      {/* Publish */}
      <Button
        size="sm" variant="outline"
        className="h-7 gap-1.5 px-3 text-xs border-green-700 text-green-400 hover:bg-green-950"
        onClick={() => setShowPublishConfirm(true)}
        disabled={saving}
      >
        <Send className="size-3.5" />
        Publish
      </Button>

      {/* Save status indicators */}
      {savedAt && !state.dirty && (
        <Tooltip>
          <TooltipTrigger>
            <CheckCircle2 className="size-3.5 text-green-400" />
          </TooltipTrigger>
          <TooltipContent>Saved at {savedAt.toLocaleTimeString()}</TooltipContent>
        </Tooltip>
      )}
      {saveError && (
        <Tooltip>
          <TooltipTrigger>
            <AlertCircle className="size-3.5 text-red-400" />
          </TooltipTrigger>
          <TooltipContent className="text-red-400">{saveError}</TooltipContent>
        </Tooltip>
      )}

      {/* Publish confirmation dialog */}
      <AlertDialog open={showPublishConfirm} onOpenChange={setShowPublishConfirm}>
        <AlertDialogContent className="bg-[#0A1020] border-[#1E3057]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#F0F4FF]">Publish Template Version</AlertDialogTitle>
            <AlertDialogDescription className="text-[#8899BB]">
              Publishing creates an <strong className="text-[#F0F4FF]">immutable</strong> version that cannot be edited.
              Your current draft will be saved first, then published.
              <br /><br />
              Existing published versions will not be changed — a new published version will be created.
              <br /><br />
              Check that all required variables have valid default values before publishing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#1E3057] text-[#8899BB]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-700 hover:bg-green-600 text-white"
              onClick={() => { setShowPublishConfirm(false); onPublish(); }}
            >
              Save & Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
