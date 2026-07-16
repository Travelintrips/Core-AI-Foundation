/**
 * LayersPanel — lists all scene elements, supports reorder/lock/visibility/delete
 */
import { Eye, EyeOff, Lock, Unlock, Trash2, ChevronUp, ChevronDown } from "lucide-react";
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
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Layers</span>
        <span className="text-xs text-gray-400">{elements.length}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {sorted.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-8 px-3">
              No elements yet. Use the toolbar to add elements.
            </p>
          )}
          {sorted.map((el) => {
            const isSelected = selectedIds.includes(el.id);
            return (
              <div key={el.id}
                className={cn(
                  "group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-gray-50 select-none text-xs",
                  isSelected && "bg-indigo-50 border-l-2 border-indigo-400"
                )}
                onClick={(e) => onSelect(el.id, e.shiftKey || e.metaKey)}
              >
                <span className="w-5 text-center text-gray-400 shrink-0">{TYPE_ICON[el.type] ?? "◆"}</span>
                <span className="flex-1 truncate text-gray-700">{el.name ?? el.id}</span>

                {!readOnly && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <Button variant="ghost" size="icon" className="h-5 w-5"
                      onClick={(e) => { e.stopPropagation(); onReorder(el.id, "up"); }}
                      title="Bring forward"><ChevronUp className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5"
                      onClick={(e) => { e.stopPropagation(); onReorder(el.id, "down"); }}
                      title="Send backward"><ChevronDown className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5"
                      onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { visible: !el.visible }); }}
                      title={el.visible ? "Hide" : "Show"}>
                      {el.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 text-gray-400" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5"
                      onClick={(e) => { e.stopPropagation(); onUpdate(el.id, { locked: !el.locked }); }}
                      title={el.locked ? "Unlock" : "Lock"}>
                      {el.locked ? <Lock className="h-3 w-3 text-amber-500" /> : <Unlock className="h-3 w-3" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5 text-red-400 hover:text-red-600"
                      onClick={(e) => { e.stopPropagation(); onDelete([el.id]); }}
                      title="Delete"><Trash2 className="h-3 w-3" /></Button>
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
