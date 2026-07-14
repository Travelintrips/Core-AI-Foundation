import { Eye, EyeOff, Lock, Unlock, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DesignElement } from "./types";

interface Props {
  elements: DesignElement[];
  selectedIds: string[];
  onSelect: (id: string, multi: boolean) => void;
  onUpdate: (id: string, changes: Partial<DesignElement>) => void;
  onDelete: (ids: string[]) => void;
  onReorder: (id: string, direction: "up" | "down") => void;
}

function elementTypeIcon(type: string) {
  const icons: Record<string, string> = {
    text: "T", rect: "▭", circle: "○", image: "🖼", line: "—", frame: "▢",
  };
  return icons[type] ?? "◆";
}

export function LayerPanel({ elements, selectedIds, onSelect, onUpdate, onDelete, onReorder }: Props) {
  // Sorted by zIndex descending (top layers first in panel)
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Layers</span>
        <span className="text-xs text-gray-400">{elements.length}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {sorted.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6 px-3">
              No layers yet. Use a tool to add elements.
            </p>
          )}
          {sorted.map((el) => {
            const isSelected = selectedIds.includes(el.id);
            return (
              <div
                key={el.id}
                className={cn(
                  "group flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-gray-50 select-none",
                  isSelected && "bg-indigo-50"
                )}
                onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey)}
              >
                {/* Type icon */}
                <span className="text-xs w-4 text-center text-gray-400 font-mono shrink-0">
                  {elementTypeIcon(el.type)}
                </span>

                {/* Name */}
                <span className={cn(
                  "flex-1 text-xs truncate",
                  isSelected ? "text-indigo-700 font-medium" : "text-gray-700"
                )}>
                  {el.name}
                </span>

                {/* Actions (shown on hover) */}
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <button
                    className="p-0.5 rounded hover:bg-gray-200"
                    onClick={(e) => { e.stopPropagation(); onReorder(el.id, "up"); }}
                    title="Move up"
                  >
                    <ChevronUp className="h-3 w-3 text-gray-500" />
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-gray-200"
                    onClick={(e) => { e.stopPropagation(); onReorder(el.id, "down"); }}
                    title="Move down"
                  >
                    <ChevronDown className="h-3 w-3 text-gray-500" />
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-gray-200"
                    onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { visible: !el.visible }); }}
                    title={el.visible ? "Hide" : "Show"}
                  >
                    {el.visible
                      ? <Eye className="h-3 w-3 text-gray-500" />
                      : <EyeOff className="h-3 w-3 text-gray-400" />
                    }
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-gray-200"
                    onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { locked: !el.locked }); }}
                    title={el.locked ? "Unlock" : "Lock"}
                  >
                    {el.locked
                      ? <Lock className="h-3 w-3 text-gray-500" />
                      : <Unlock className="h-3 w-3 text-gray-400" />
                    }
                  </button>
                  <button
                    className="p-0.5 rounded hover:bg-red-100"
                    onClick={(e) => { e.stopPropagation(); onDelete([el.id]); }}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3 text-gray-500 hover:text-red-500" />
                  </button>
                </div>

                {/* Static visibility/lock icons */}
                {!el.visible && (
                  <EyeOff className="h-3 w-3 text-gray-300 shrink-0 group-hover:hidden" />
                )}
                {el.locked && (
                  <Lock className="h-3 w-3 text-gray-300 shrink-0 group-hover:hidden" />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Delete selected */}
      {selectedIds.length > 0 && (
        <div className="px-2 py-2 border-t border-gray-200">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-red-500 hover:text-red-600 hover:bg-red-50 h-7"
            onClick={() => onDelete(selectedIds)}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete {selectedIds.length > 1 ? `${selectedIds.length} layers` : "layer"}
          </Button>
        </div>
      )}
    </div>
  );
}
