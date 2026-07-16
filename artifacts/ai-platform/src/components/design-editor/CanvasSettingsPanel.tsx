/**
 * CanvasSettingsPanel — configure canvas dimensions and background.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import { DESIGN_LIMITS } from "@/utils/design-editor/constants";

const PRESETS = [
  { label: "Square 1:1", w: 1080, h: 1080 },
  { label: "Portrait 4:5", w: 1080, h: 1350 },
  { label: "Story 9:16", w: 1080, h: 1920 },
  { label: "Landscape 16:9", w: 1920, h: 1080 },
  { label: "A4 Portrait", w: 2480, h: 3508 },
  { label: "Banner", w: 1200, h: 628 },
];

export function CanvasSettingsPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const canvas = state.canvas;

  const update = (patch: Partial<typeof canvas>) =>
    dispatch({ type: "SET_CANVAS", patch });

  const applyPreset = (w: number, h: number) => update({ width: w, height: h });

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Presets</p>
        <div className="grid grid-cols-1 gap-1">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              className="justify-between h-7 px-2 text-xs text-[#8899BB] hover:text-[#F0F4FF]"
              onClick={() => applyPreset(p.w, p.h)}
            >
              <span>{p.label}</span>
              <span className="text-[10px] text-[#4F6494]">{p.w}×{p.h}</span>
            </Button>
          ))}
        </div>

        <div style={{ borderTop: "1px solid #1E3057" }} className="pt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Size</p>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-[#4F6494]">Width (px)</Label>
              <Input
                type="number"
                value={canvas.width}
                min={1}
                max={DESIGN_LIMITS.MAX_CANVAS_WIDTH}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= DESIGN_LIMITS.MAX_CANVAS_WIDTH) update({ width: v });
                }}
                className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] text-[#4F6494]">Height (px)</Label>
              <Input
                type="number"
                value={canvas.height}
                min={1}
                max={DESIGN_LIMITS.MAX_CANVAS_HEIGHT}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1 && v <= DESIGN_LIMITS.MAX_CANVAS_HEIGHT) update({ height: v });
                }}
                className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
              />
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #1E3057" }} className="pt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">Background</p>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={canvas.backgroundColor ?? "#ffffff"}
              onChange={(e) => update({ backgroundColor: e.target.value })}
              className="h-8 w-8 rounded cursor-pointer border-0 bg-transparent"
            />
            <Input
              value={canvas.backgroundColor ?? "#ffffff"}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                  update({ backgroundColor: e.target.value });
                }
              }}
              className="flex-1 h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] font-mono"
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
