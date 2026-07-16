/**
 * PropertyPanel — right sidebar showing properties of the selected element.
 * Sections: Position, Size, Rotation, Opacity, Typography, Fill, Border, Shadow, Binding, Visibility.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Unlink, Link2, Layers, Copy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorState, useEditorDispatch } from "@/state/design-editor/context";
import { SAFE_FONTS } from "@/utils/design-editor/constants";
import type {
  DesignElement, TextElement, ShapeElement, ImageElement,
  QrCodeElement, LineElement, TemplateVariable, VariableBinding,
} from "@/state/design-editor/types";

// ── Small field components ─────────────────────────────────────────────────────

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Label className="text-[10px] text-[#4F6494] w-14 shrink-0">{label}</Label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function NumInput({
  value, onChange, min, max, step = 1, className,
}: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      min={min} max={max} step={step}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className={cn("h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]", className)}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1.5 items-center">
      <input
        type="color"
        value={value || "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 rounded border-0 bg-transparent cursor-pointer p-0"
      />
      <Input
        value={value}
        onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
        className="flex-1 h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] font-mono"
      />
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#0D1528] cursor-pointer">
        <ChevronDown className={cn("size-3 text-[#4F6494] transition-transform", !open && "-rotate-90")} />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4F6494]">{title}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Binding section ────────────────────────────────────────────────────────────

function BindingSection({
  currentBinding,
  onBind,
  onUnbind,
  variables,
  fieldLabel = "Content",
}: {
  currentBinding?: VariableBinding;
  onBind: (binding: VariableBinding) => void;
  onUnbind: () => void;
  variables: TemplateVariable[];
  fieldLabel?: string;
}) {
  const [selectedKey, setSelectedKey] = useState(currentBinding?.variableKey ?? "");

  return (
    <Section title={`Bind ${fieldLabel}`} defaultOpen={!!currentBinding}>
      {currentBinding ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#1E3057] text-xs">
            <Link2 className="size-3 text-[#7C6EFA]" />
            <span className="text-[#9D91FB] font-mono flex-1">{currentBinding.variableKey}</span>
            <Button
              variant="ghost" size="sm" className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
              onClick={onUnbind}
            >
              <Unlink className="size-3" />
            </Button>
          </div>
          <Field label="Fallback">
            <Input
              value={currentBinding.fallback ?? ""}
              onChange={(e) => onBind({ ...currentBinding, fallback: e.target.value })}
              placeholder="fallback text"
              className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
            />
          </Field>
          <Field label="Format">
            <Select
              value={currentBinding.formatter ?? "none"}
              onValueChange={(v) => onBind({ ...currentBinding, formatter: v === "none" ? undefined : v as any })}
            >
              <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="uppercase">UPPERCASE</SelectItem>
                <SelectItem value="lowercase">lowercase</SelectItem>
                <SelectItem value="titlecase">Title Case</SelectItem>
                <SelectItem value="truncate">Truncate</SelectItem>
                <SelectItem value="currency">Currency</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="date">Date</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : (
        <div className="space-y-2">
          {variables.length === 0 ? (
            <p className="text-xs text-[#4F6494]">No variables. Add one in the Variables tab.</p>
          ) : (
            <>
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                  <SelectValue placeholder="Select variable..." />
                </SelectTrigger>
                <SelectContent>
                  {variables.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      {v.key} ({v.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="w-full h-6 text-xs gap-1"
                style={{ background: "#7C6EFA" }}
                disabled={!selectedKey}
                onClick={() => selectedKey && onBind({ variableKey: selectedKey })}
              >
                <Link2 className="size-3" /> Bind
              </Button>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Visibility section ─────────────────────────────────────────────────────────

function VisibilitySection({ el, dispatch }: { el: DesignElement; dispatch: any }) {
  const vis = el.visibleWhen;

  const update = (patch: any) =>
    dispatch({ type: "UPDATE_ELEMENT", id: el.id, patch: { visibleWhen: patch ? { ...vis, ...patch } : undefined } });

  return (
    <Section title="Conditional Visibility" defaultOpen={!!vis}>
      {vis ? (
        <div className="space-y-2">
          <Field label="Variable">
            <Input
              value={vis.variable}
              onChange={(e) => update({ variable: e.target.value })}
              className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
            />
          </Field>
          <Field label="Operator">
            <Select value={vis.operator} onValueChange={(v) => update({ operator: v })}>
              <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">equals</SelectItem>
                <SelectItem value="not_equals">not equals</SelectItem>
                <SelectItem value="is_empty">is empty</SelectItem>
                <SelectItem value="is_not_empty">is not empty</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {(vis.operator === "equals" || vis.operator === "not_equals") && (
            <Field label="Value">
              <Input
                value={String(vis.value ?? "")}
                onChange={(e) => update({ value: e.target.value })}
                className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
              />
            </Field>
          )}
          <Button
            size="sm" variant="ghost"
            className="text-xs text-red-400 hover:text-red-300 h-6 px-2 w-full"
            onClick={() => dispatch({ type: "UPDATE_ELEMENT", id: el.id, patch: { visibleWhen: undefined } })}
          >
            Remove Condition
          </Button>
        </div>
      ) : (
        <Button
          size="sm" variant="ghost"
          className="text-xs text-[#8899BB] h-6 px-2 w-full"
          onClick={() => dispatch({
            type: "UPDATE_ELEMENT",
            id: el.id,
            patch: { visibleWhen: { variable: "", operator: "equals", value: "" } },
          })}
        >
          + Add Condition
        </Button>
      )}
    </Section>
  );
}

// ── Main PropertyPanel ─────────────────────────────────────────────────────────

export function PropertyPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();

  if (state.selectedElementIds.length === 0) {
    return (
      <aside
        className="w-60 flex flex-col items-center justify-center flex-shrink-0 text-[#4F6494] text-xs"
        style={{ background: "#0A1020", borderLeft: "1px solid #1E3057" }}
      >
        Select an element to see its properties
      </aside>
    );
  }

  if (state.selectedElementIds.length > 1) {
    return (
      <aside
        className="w-60 flex flex-col items-center justify-center flex-shrink-0 text-[#4F6494] text-xs"
        style={{ background: "#0A1020", borderLeft: "1px solid #1E3057" }}
      >
        {state.selectedElementIds.length} elements selected
      </aside>
    );
  }

  const el = state.elements.find((e) => e.id === state.selectedElementIds[0]!);
  if (!el) return null;

  const upd = (patch: Partial<DesignElement>) =>
    dispatch({ type: "UPDATE_ELEMENT", id: el.id, patch });

  return (
    <aside
      className="w-60 flex flex-col flex-shrink-0"
      style={{ background: "#0A1020", borderLeft: "1px solid #1E3057" }}
    >
      {/* Header */}
      <div
        className="h-9 flex items-center gap-2 px-3 shrink-0"
        style={{ borderBottom: "1px solid #1E3057" }}
      >
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1E3057] text-[#8899BB]">
          {el.type}
        </Badge>
        <span className="text-xs text-[#F0F4FF] truncate flex-1">{el.name || el.id.slice(-8)}</span>
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0"
          onClick={() => dispatch({ type: "DUPLICATE_ELEMENTS", ids: [el.id] })}
          title="Duplicate"
        >
          <Copy className="size-3 text-[#4F6494]" />
        </Button>
        <Button
          variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
          onClick={() => dispatch({ type: "DELETE_ELEMENTS", ids: [el.id] })}
          title="Delete"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* Position & Size */}
        <Section title="Position & Size">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <Label className="text-[10px] text-[#4F6494]">X</Label>
              <NumInput value={el.x} onChange={(v) => upd({ x: v })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-[#4F6494]">Y</Label>
              <NumInput value={el.y} onChange={(v) => upd({ y: v })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-[#4F6494]">W</Label>
              <NumInput value={el.width} min={1} onChange={(v) => upd({ width: Math.max(1, v) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-[#4F6494]">H</Label>
              <NumInput value={el.height} min={1} onChange={(v) => upd({ height: Math.max(1, v) })} />
            </div>
          </div>
        </Section>

        <Separator className="bg-[#1E3057]" />

        {/* Transform */}
        <Section title="Transform">
          <Field label="Rotation">
            <NumInput value={el.rotation ?? 0} min={-360} max={360} step={1} onChange={(v) => upd({ rotation: v })} />
          </Field>
          <Field label="Opacity">
            <NumInput value={Math.round((el.opacity ?? 1) * 100)} min={0} max={100} step={1}
              onChange={(v) => upd({ opacity: v / 100 })} />
          </Field>
          <Field label="Lock">
            <input
              type="checkbox"
              checked={!!el.locked}
              onChange={(e) => upd({ locked: e.target.checked })}
              className="h-4 w-4 accent-violet-500"
            />
          </Field>
          <Field label="z-index">
            <div className="flex gap-1">
              <NumInput value={el.zIndex} min={1} onChange={(v) => upd({ zIndex: Math.max(1, v) })} />
            </div>
          </Field>
        </Section>

        <Separator className="bg-[#1E3057]" />

        {/* Typography — text elements only */}
        {el.type === "text" && (
          <>
            <Section title="Typography">
              <Field label="Font">
                <Select
                  value={(el as TextElement).fontFamily ?? "Inter"}
                  onValueChange={(v) => upd({ fontFamily: v } as Partial<TextElement>)}
                >
                  <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-48">
                    {SAFE_FONTS.map((f) => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="space-y-1">
                  <Label className="text-[10px] text-[#4F6494]">Size</Label>
                  <NumInput
                    value={(el as TextElement).fontSize ?? 24}
                    min={6} max={500}
                    onChange={(v) => upd({ fontSize: v } as Partial<TextElement>)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-[#4F6494]">Weight</Label>
                  <Select
                    value={String((el as TextElement).fontWeight ?? 400)}
                    onValueChange={(v) => upd({ fontWeight: parseInt(v) } as Partial<TextElement>)}
                  >
                    <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                        <SelectItem key={w} value={String(w)}>{w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Field label="Color">
                <ColorInput
                  value={(el as TextElement).color ?? "#000000"}
                  onChange={(v) => upd({ color: v } as Partial<TextElement>)}
                />
              </Field>
              <Field label="Align">
                <Select
                  value={(el as TextElement).textAlign ?? "left"}
                  onValueChange={(v) => upd({ textAlign: v as any } as Partial<TextElement>)}
                >
                  <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                    <SelectItem value="justify">Justify</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Overflow">
                <Select
                  value={(el as TextElement).overflow ?? "wrap"}
                  onValueChange={(v) => upd({ overflow: v as any } as Partial<TextElement>)}
                >
                  <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wrap">Wrap</SelectItem>
                    <SelectItem value="truncate">Truncate</SelectItem>
                    <SelectItem value="auto-shrink">Auto-shrink</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Italic">
                <input
                  type="checkbox"
                  checked={!!(el as TextElement).italic}
                  onChange={(e) => upd({ italic: e.target.checked } as Partial<TextElement>)}
                  className="h-4 w-4 accent-violet-500"
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />

            {/* Text variable binding */}
            <BindingSection
              currentBinding={typeof (el as TextElement).content === "object" && "binding" in ((el as TextElement).content as object)
                ? ((el as TextElement).content as { binding: VariableBinding }).binding
                : undefined}
              onBind={(binding) => upd({ content: { binding } } as Partial<TextElement>)}
              onUnbind={() => upd({ content: "Text" } as Partial<TextElement>)}
              variables={state.variables}
              fieldLabel="Content"
            />
            <Separator className="bg-[#1E3057]" />
          </>
        )}

        {/* Shape fill */}
        {el.type === "shape" && (
          <>
            <Section title="Fill">
              <ColorInput
                value={typeof (el as ShapeElement).fill === "string" ? (el as ShapeElement).fill as string : "#7C6EFA"}
                onChange={(v) => upd({ fill: v } as Partial<ShapeElement>)}
              />
            </Section>
            <Separator className="bg-[#1E3057]" />
            <Section title="Border" defaultOpen={false}>
              <Field label="Width">
                <NumInput
                  value={(el as ShapeElement).border?.width ?? 0}
                  min={0} max={20}
                  onChange={(v) => upd({ border: { ...((el as ShapeElement).border ?? { color: "#000000" }), width: v } } as Partial<ShapeElement>)}
                />
              </Field>
              <Field label="Color">
                <ColorInput
                  value={(el as ShapeElement).border?.color ?? "#000000"}
                  onChange={(v) => upd({ border: { ...((el as ShapeElement).border ?? { width: 1 }), color: v } } as Partial<ShapeElement>)}
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />
            <Section title="Shadow" defaultOpen={false}>
              <Field label="Blur">
                <NumInput
                  value={(el as ShapeElement).shadow?.blur ?? 0} min={0} max={100}
                  onChange={(v) => upd({ shadow: { ...((el as ShapeElement).shadow ?? { offsetX: 0, offsetY: 4, color: "rgba(0,0,0,0.3)" }), blur: v } } as Partial<ShapeElement>)}
                />
              </Field>
              <Field label="OffsetX">
                <NumInput
                  value={(el as ShapeElement).shadow?.offsetX ?? 0}
                  onChange={(v) => upd({ shadow: { ...((el as ShapeElement).shadow ?? { blur: 8, offsetY: 4, color: "rgba(0,0,0,0.3)" }), offsetX: v } } as Partial<ShapeElement>)}
                />
              </Field>
              <Field label="Color">
                <ColorInput
                  value={(el as ShapeElement).shadow?.color ?? "rgba(0,0,0,0.3)"}
                  onChange={(v) => upd({ shadow: { ...((el as ShapeElement).shadow ?? { blur: 8, offsetX: 0, offsetY: 4 }), color: v } } as Partial<ShapeElement>)}
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />
          </>
        )}

        {/* Line properties */}
        {el.type === "line" && (
          <>
            <Section title="Stroke">
              <Field label="Color">
                <ColorInput
                  value={(el as LineElement).stroke ?? "#000000"}
                  onChange={(v) => upd({ stroke: v } as Partial<LineElement>)}
                />
              </Field>
              <Field label="Width">
                <NumInput
                  value={(el as LineElement).strokeWidth ?? 2} min={1} max={50}
                  onChange={(v) => upd({ strokeWidth: v } as Partial<LineElement>)}
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />
          </>
        )}

        {/* Image binding */}
        {el.type === "image" && (
          <>
            <Section title="Image Source">
              <Field label="Fit">
                <Select
                  value={(el as ImageElement).objectFit ?? "cover"}
                  onValueChange={(v) => upd({ objectFit: v as any } as Partial<ImageElement>)}
                >
                  <SelectTrigger className="h-6 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                    <SelectItem value="fill">Fill</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Radius">
                <NumInput
                  value={(el as ImageElement).borderRadius ?? 0} min={0} max={500}
                  onChange={(v) => upd({ borderRadius: v } as Partial<ImageElement>)}
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />
            <BindingSection
              currentBinding={
                (el as ImageElement).src &&
                typeof (el as ImageElement).src === "object" &&
                "binding" in ((el as ImageElement).src as object)
                  ? ((el as ImageElement).src as { binding: VariableBinding }).binding
                  : undefined
              }
              onBind={(binding) => upd({ src: { binding } } as Partial<ImageElement>)}
              onUnbind={() => upd({ src: undefined } as Partial<ImageElement>)}
              variables={state.variables.filter((v) => v.type === "image" || v.type === "url")}
              fieldLabel="Image"
            />
            <Separator className="bg-[#1E3057]" />
          </>
        )}

        {/* QR binding */}
        {el.type === "qrcode" && (
          <>
            <Section title="QR Code">
              <Field label="FG Color">
                <ColorInput
                  value={(el as QrCodeElement).fgColor ?? "#000000"}
                  onChange={(v) => upd({ fgColor: v } as Partial<QrCodeElement>)}
                />
              </Field>
              <Field label="BG Color">
                <ColorInput
                  value={(el as QrCodeElement).bgColor ?? "#ffffff"}
                  onChange={(v) => upd({ bgColor: v } as Partial<QrCodeElement>)}
                />
              </Field>
            </Section>
            <Separator className="bg-[#1E3057]" />
            <BindingSection
              currentBinding={
                typeof (el as QrCodeElement).content === "object" && "binding" in ((el as QrCodeElement).content as object)
                  ? ((el as QrCodeElement).content as { binding: VariableBinding }).binding
                  : undefined
              }
              onBind={(binding) => upd({ content: { binding } } as Partial<QrCodeElement>)}
              onUnbind={() => upd({ content: "https://example.com" } as Partial<QrCodeElement>)}
              variables={state.variables.filter((v) => v.type === "url" || v.type === "text")}
              fieldLabel="Content"
            />
            <Separator className="bg-[#1E3057]" />
          </>
        )}

        {/* Conditional visibility */}
        <VisibilitySection el={el} dispatch={dispatch} />
      </ScrollArea>
    </aside>
  );
}
