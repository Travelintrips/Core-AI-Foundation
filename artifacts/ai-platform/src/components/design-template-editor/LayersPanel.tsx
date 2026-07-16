/**
 * LayersPanel — lists all scene elements, supports reorder/lock/visibility/delete
 */
import { Eye, EyeOff, Lock, Unlock, Trash2, ChevronUp, ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SceneElement } from "@/lib/designTemplateAdapter";

interface Props {
  elements: SceneElement[];
  selectedIds: string[];
  onSelect: (id: string, multi: boolean) => void;
  onUpdate: (id: string, changes: Partial<SceneElement>) => void;
  onDelete: (ids: string[]) => void;
  onReorder: (id: string, dir: "up" | "down") => void;
  readOnly?: boolean;
}

const TYPE_ICON: Record<string, string> = {
  text: "T", image: "🖼", shape: "▭", line: "—", qrcode: "▦",
};

export function LayersPanel({ elements, selectedIds, onSelect, onUpdate, onDelete, onReorder, readOnly }: Props) {
  const sorted = [...elements].sort((a, b) => b.zIndex - a.zIndex);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-3 py-2.5 border-b border-gray-200 flex items-center justify-between bg-white">
        <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Layers</span>
        <span className="text-xs text-slate-500 font-medium">{elements.length}</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {/* Empty state */}
          {sorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 px-3 gap-2">
              <Layers className="h-8 w-8 text-slate-300" />
              <p className="text-xs text-slate-400 text-center leading-relaxed">
                No elements yet.<br />Use the toolbar to add elements.
              </p>
            </div>
          )}

          {sorted.map((el) => {
            const isSelected = selectedIds.includes(el.id);
            return (
              <div
                key={el.id}
                className={cn(
                  "group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none text-xs transition-colors",
                  isSelected
                    ? "bg-violet-50 border-l-4 border-violet-600"
                    : "hover:bg-slate-50 border-l-4 border-transparent"
                )}
                onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey)}
              >
                {/* Type icon */}
                <span className="w-5 text-center text-slate-400 shrink-0 font-medium">
                  {TYPE_ICON[el.type] ?? "◆"}
                </span>

                {/* Element name */}
                <span className={cn(
                  "flex-1 truncate font-medium",
                  isSelected ? "text-violet-700" : "text-slate-800"
                )}>
                  {el.name ?? el.id}
                </span>

                {/* Action buttons — revealed on hover */}
                {!readOnly && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                      onClick={(e) => { e.stopPropagation(); onReorder(el.id, "up"); }}
                      title="Bring forward"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                      onClick={(e) => { e.stopPropagation(); onReorder(el.id, "down"); }}
                      title="Send backward"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                      onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { visible: !el.visible }); }}
                      title={el.visible ? "Hide" : "Show"}
                    >
                      {el.visible
                        ? <Eye className="h-3 w-3" />
                        : <EyeOff className="h-3 w-3 text-slate-400" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-slate-500 hover:text-slate-900 hover:bg-slate-200"
                      onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { locked: !el.locked }); }}
                      title={el.locked ? "Unlock" : "Lock"}
                    >
                      {el.locked
                        ? <Lock className="h-3 w-3 text-amber-500" />
                        : <Unlock className="h-3 w-3" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-red-400 hover:text-red-600 hover:bg-red-50"
                      onClick={(e) => { e.stopPropagation(); onDelete([el.id]); }}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
