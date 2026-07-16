/**
 * LayerList — shows all elements sorted by z-index (top = front).
 * Supports: select, rename, toggle visible, lock, bring forward, send backward, delete.
 */

import { useState } from "react";
import {
  Eye, EyeOff, Lock, Unlock, Trash2,
  ChevronUp, ChevronDown, Type, Image, Square, QrCode, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import type { DesignElement } from "@/state/design-editor/types";

function ElementIcon({ type }: { type: string }) {
  const cls = "size-3 shrink-0";
  switch (type) {
    case "text":    return <Type className={cls} />;
    case "image":   return <Image className={cls} />;
    case "shape":   return <Square className={cls} />;
    case "qrcode":  return <QrCode className={cls} />;
    case "line":    return <Minus className={cls} />;
    default:        return <Square className={cls} />;
  }
}

function getLabel(el: DesignElement): string {
  if (el.name) return el.name;
  if (el.type === "text") {
    const c = (el as any).content;
    if (typeof c === "string") return c.slice(0, 16) || "Text";
    if (c?.binding?.variableKey) return `{{${c.binding.variableKey}}}`;
  }
  return `${el.type} ${el.id.slice(-4)}`;
}

export function LayerList() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Render top-to-bottom (highest zIndex first)
  const sorted = [...state.elements].sort((a, b) => b.zIndex - a.zIndex);

  const isSelected = (id: string) => state.selectedElementIds.includes(id);

  const select = (id: string) => dispatch({ type: "SELECT_ELEMENTS", ids: [id] });
  const toggleVisible = (el: DesignElement) =>
    dispatch({ type: "UPDATE_ELEMENT", id: el.id, patch: { visible: !el.visible } });
  const toggleLock = (el: DesignElement) =>
    dispatch({ type: "UPDATE_ELEMENT", id: el.id, patch: { locked: !el.locked } });
  const del = (id: string) => dispatch({ type: "DELETE_ELEMENTS", ids: [id] });

  const startEdit = (el: DesignElement) => {
    setEditingId(el.id);
    setEditingName(el.name ?? getLabel(el));
  };
  const commitEdit = (id: string) => {
    if (editingName.trim()) {
      dispatch({ type: "UPDATE_ELEMENT", id, patch: { name: editingName.trim() } });
    }
    setEditingId(null);
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-2 space-y-0.5">
        {sorted.length === 0 && (
          <p className="text-xs text-[#4F6494] text-center py-6">No elements yet</p>
        )}
        {sorted.map((el) => (
          <div
            key={el.id}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer group text-xs transition-colors",
              isSelected(el.id)
                ? "bg-[#1E3057] text-[#9D91FB]"
                : "text-[#8899BB] hover:bg-[#0D1528]",
              !el.visible && "opacity-50",
            )}
            onClick={() => select(el.id)}
            onDoubleClick={() => startEdit(el)}
          >
            <ElementIcon type={el.type} />

            {editingId === el.id ? (
              <input
                autoFocus
                className="flex-1 bg-transparent outline-none text-[#F0F4FF] text-xs border-b border-[#7C6EFA] min-w-0"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => commitEdit(el.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit(el.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="flex-1 truncate">{getLabel(el)}</span>
            )}

            {/* Layer controls */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: "BRING_FORWARD", id: el.id }); }}
                  >
                    <ChevronUp className="size-2.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Bring Forward</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0"
                    onClick={(e) => { e.stopPropagation(); dispatch({ type: "SEND_BACKWARD", id: el.id }); }}
                  >
                    <ChevronDown className="size-2.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Send Backward</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0"
                    onClick={(e) => { e.stopPropagation(); toggleVisible(el); }}
                  >
                    {el.visible !== false ? <Eye className="size-2.5" /> : <EyeOff className="size-2.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{el.visible !== false ? "Hide" : "Show"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0"
                    onClick={(e) => { e.stopPropagation(); toggleLock(el); }}
                  >
                    {el.locked ? <Lock className="size-2.5" /> : <Unlock className="size-2.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{el.locked ? "Unlock" : "Lock"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
                    onClick={(e) => { e.stopPropagation(); del(el.id); }}
                  >
                    <Trash2 className="size-2.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
