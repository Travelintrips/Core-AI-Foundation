/**
 * ElementPropertiesPanel — right sidebar for selected element properties
 */
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Lock, Unlock, Eye, EyeOff, MousePointer } from "lucide-react";
import type { SceneElement } from "@/lib/designTemplateAdapter";
import type { TemplateVariable, VariableOperator } from "@/lib/designTemplateTypes";
import { cn } from "@/lib/utils";

interface Props {
  element: SceneElement | null;
  variables: TemplateVariable[];
  onUpdate: (id: string, changes: Partial<SceneElement>) => void;
  readOnly?: boolean;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">{children}</p>
  );
}

function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Label className={cn("text-xs text-slate-700 w-20 shrink-0", className)}>{children}</Label>
  );
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1.5 flex-1">
        <input
          type="color"
          value={value.startsWith("#") ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded border border-gray-300 cursor-pointer p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 text-xs font-mono flex-1 text-slate-800"
        />
      </div>
    </div>
  );
}

function NumInput({ label, value, onChange, min, max, step = 1, unit = "" }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-1 flex-1">
        <Input
          type="number"
          value={Math.round(value * 100) / 100}
          min={min} max={max} step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-7 text-xs flex-1 text-slate-800"
        />
        {unit && <span className="text-xs text-slate-500 shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function BoolRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-slate-700">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ── Panels ────────────────────────────────────────────────────────────────────

function PositionSizePanel({ el, onUpdate }: { el: SceneElement; onUpdate: (id: string, c: Partial<SceneElement>) => void }) {
  const u = (c: Partial<SceneElement>) => onUpdate(el.id, c);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="X" value={el.x} onChange={(v) => u({ x: v })} step={1} />
        <NumInput label="Y" value={el.y} onChange={(v) => u({ y: v })} step={1} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumInput label="W" value={el.width} onChange={(v) => u({ width: Math.max(1, v) })} step={1} min={1} />
        <NumInput label="H" value={el.height} onChange={(v) => u({ height: Math.max(1, v) })} step={1} min={1} />
      </div>
      <NumInput label="Rotation" value={el.rotation} onChange={(v) => u({ rotation: v })} step={1} min={-360} max={360} unit="°" />
      <div className="flex items-center gap-2">
        <FieldLabel>Opacity</FieldLabel>
        <Slider
          value={[el.opacity * 100]}
          min={0} max={100}
          onValueChange={([v]) => u({ opacity: (v ?? 100) / 100 })}
          className="flex-1"
        />
        <span className="text-xs text-slate-600 w-8 text-right font-medium">{Math.round(el.opacity * 100)}%</span>
      </div>
      <NumInput label="Z-Index" value={el.zIndex} onChange={(v) => u({ zIndex: Math.max(0, Math.round(v)) })} step={1} min={0} />
    </div>
  );
}

function ConditionalVisibilityPanel({ el, variables, onUpdate }: {
  el: SceneElement; variables: TemplateVariable[];
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const cv = el.visibleWhen;
  const hasCondition = !!cv;
  const OPERATORS: VariableOperator[] = ["equals", "not_equals", "is_empty", "is_not_empty"];

  const setCondition = (changes: Partial<NonNullable<typeof cv>>) => {
    if (!cv) {
      onUpdate(el.id, { visibleWhen: { variable: variables[0]?.key ?? "", operator: "equals", ...changes } });
    } else {
      onUpdate(el.id, { visibleWhen: { ...cv, ...changes } });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold text-slate-800">Conditional Visibility</Label>
        <Switch
          checked={hasCondition}
          onCheckedChange={(v) => { if (!v) onUpdate(el.id, { visibleWhen: undefined }); else setCondition({}); }}
        />
      </div>
      {hasCondition && cv && (
        <div className="space-y-1.5 pl-2 border-l-2 border-violet-200">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-slate-700 w-14 shrink-0">Variable</Label>
            <Select value={cv.variable} onValueChange={(v) => setCondition({ variable: v })}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {variables.map((v) => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-slate-700 w-14 shrink-0">Operator</Label>
            <Select value={cv.operator} onValueChange={(v) => setCondition({ operator: v as VariableOperator })}>
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((op) => <SelectItem key={op} value={op}>{op.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(cv.operator === "equals" || cv.operator === "not_equals") && (
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-slate-700 w-14 shrink-0">Value</Label>
              <Input
                value={String(cv.value ?? "")}
                onChange={(e) => setCondition({ value: e.target.value })}
                className="h-7 text-xs flex-1"
                placeholder="value…"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TextPanel({ el, variables, onUpdate }: {
  el: Extract<SceneElement, { type: "text" }>; variables: TemplateVariable[];
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const u = (c: Partial<typeof el>) => onUpdate(el.id, c as Partial<SceneElement>);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FieldLabel>Mode</FieldLabel>
        <div className="flex gap-1">
          <Button size="sm" variant={el.contentMode === "static" ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ contentMode: "static" })}>Static</Button>
          <Button size="sm" variant={el.contentMode === "variable" ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ contentMode: "variable" })}>Variable</Button>
        </div>
      </div>

      {el.contentMode === "static" ? (
        <div className="flex items-start gap-2">
          <FieldLabel className="mt-1.5">Content</FieldLabel>
          <textarea
            value={el.staticContent}
            onChange={(e) => u({ staticContent: e.target.value })}
            className="flex-1 text-xs text-slate-800 border border-gray-300 rounded p-1.5 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Variable</FieldLabel>
            <Select
              value={el.variableBinding?.variableKey ?? ""}
              onValueChange={(v) => u({ variableBinding: { ...el.variableBinding, variableKey: v } })}
            >
              <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select variable…" /></SelectTrigger>
              <SelectContent>
                {variables.map((v) => <SelectItem key={v.key} value={v.key}>{v.label} ({v.key})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <FieldLabel>Fallback</FieldLabel>
            <Input
              value={el.variableBinding?.fallback ?? ""}
              onChange={(e) => u({ variableBinding: { ...el.variableBinding!, variableKey: el.variableBinding?.variableKey ?? "", fallback: e.target.value } })}
              className="h-7 text-xs flex-1"
              placeholder="fallback text…"
            />
          </div>
        </div>
      )}

      <Separator />
      <div className="flex items-center gap-1.5">
        <FieldLabel>Font</FieldLabel>
        <Select value={el.fontFamily} onValueChange={(v) => u({ fontFamily: v })}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Inter","Roboto","Open Sans","Montserrat","Lato","Poppins","Georgia","Times New Roman","Arial"].map((f) =>
              <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <NumInput label="Size" value={el.fontSize} onChange={(v) => u({ fontSize: Math.max(6, v) })} min={6} max={500} unit="px" />
      <ColorInput label="Color" value={el.color} onChange={(v) => u({ color: v })} />
      <div className="flex items-center gap-1.5">
        <FieldLabel>Weight</FieldLabel>
        <Select value={String(el.fontWeight)} onValueChange={(v) => u({ fontWeight: isNaN(Number(v)) ? v as any : Number(v) })}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["100","200","300","400","500","600","700","800","900","bold","normal"].map((w) =>
              <SelectItem key={w} value={w}>{w}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1.5">
        <FieldLabel>Align</FieldLabel>
        <div className="flex gap-1">
          {(["left","center","right","justify"] as const).map((a) => (
            <Button key={a} size="sm" variant={el.textAlign === a ? "default" : "outline"}
              className="h-6 text-xs px-2 capitalize" onClick={() => u({ textAlign: a })}>{a[0]?.toUpperCase()}</Button>
          ))}
        </div>
      </div>
      <BoolRow label="Italic" value={el.italic} onChange={(v) => u({ italic: v })} />
      <BoolRow label="Underline" value={el.underline} onChange={(v) => u({ underline: v })} />
      <NumInput label="Line Height" value={el.lineHeight} onChange={(v) => u({ lineHeight: v })} step={0.1} min={0.5} max={5} />
      <NumInput label="Letter Spacing" value={el.letterSpacing} onChange={(v) => u({ letterSpacing: v })} step={0.1} min={-10} max={100} />
    </div>
  );
}

function ImagePanel({ el, variables, onUpdate }: {
  el: Extract<SceneElement, { type: "image" }>; variables: TemplateVariable[];
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const u = (c: Partial<typeof el>) => onUpdate(el.id, c as Partial<SceneElement>);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FieldLabel>Source</FieldLabel>
        <div className="flex gap-1">
          <Button size="sm" variant={!el.variableBinding ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ variableBinding: undefined })}>URL/Storage</Button>
          <Button size="sm" variant={el.variableBinding ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ variableBinding: { variableKey: variables[0]?.key ?? "" } })}>Variable</Button>
        </div>
      </div>

      {el.variableBinding ? (
        <div className="flex items-center gap-1.5">
          <FieldLabel>Variable</FieldLabel>
          <Select
            value={el.variableBinding.variableKey}
            onValueChange={(v) => u({ variableBinding: { ...el.variableBinding!, variableKey: v } })}
          >
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {variables.filter(v => v.type === "image" || v.type === "url").map((v) =>
                <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          <FieldLabel className="mt-1.5">URL</FieldLabel>
          <Input
            value={el.previewUrl ?? ""}
            onChange={(e) => {
              const url = e.target.value;
              u({ previewUrl: url, assetRef: url ? { type: "url", url } : undefined });
            }}
            className="h-7 text-xs flex-1"
            placeholder="https://…"
          />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <FieldLabel>Fit</FieldLabel>
        <Select value={el.objectFit} onValueChange={(v) => u({ objectFit: v as any })}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["cover","contain","fill"] as const).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <NumInput label="Border Radius" value={el.borderRadius} onChange={(v) => u({ borderRadius: Math.max(0, v) })} min={0} unit="px" />
    </div>
  );
}

function ShapePanel({ el, onUpdate }: {
  el: Extract<SceneElement, { type: "shape" }>;
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const u = (c: Partial<typeof el>) => onUpdate(el.id, c as Partial<SceneElement>);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <FieldLabel>Shape</FieldLabel>
        <Select value={el.shapeKind} onValueChange={(v) => u({ shapeKind: v as any })}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rectangle">Rectangle</SelectItem>
            <SelectItem value="circle">Circle / Ellipse</SelectItem>
            <SelectItem value="rounded-rectangle">Rounded Rectangle</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ColorInput label="Fill" value={el.fillColor} onChange={(v) => u({ fillColor: v })} />
      <ColorInput label="Stroke" value={el.strokeColor} onChange={(v) => u({ strokeColor: v })} />
      <NumInput label="Stroke W." value={el.strokeWidth} onChange={(v) => u({ strokeWidth: Math.max(0, v) })} min={0} unit="px" />
      {el.shapeKind !== "circle" && (
        <NumInput label="Radius" value={el.cornerRadius} onChange={(v) => u({ cornerRadius: Math.max(0, v) })} min={0} unit="px" />
      )}
    </div>
  );
}

function LinePanel({ el, onUpdate }: {
  el: Extract<SceneElement, { type: "line" }>;
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const u = (c: Partial<typeof el>) => onUpdate(el.id, c as Partial<SceneElement>);
  return (
    <div className="space-y-2">
      <ColorInput label="Color" value={el.strokeColor} onChange={(v) => u({ strokeColor: v })} />
      <NumInput label="Width" value={el.strokeWidth} onChange={(v) => u({ strokeWidth: Math.max(1, v) })} min={1} unit="px" />
      <div className="flex items-center gap-1.5">
        <FieldLabel>Dash</FieldLabel>
        <Input
          value={el.dashArray.join(",")}
          onChange={(e) => {
            const vals = e.target.value.split(",").map(Number).filter(n => !isNaN(n) && n >= 0);
            u({ dashArray: vals });
          }}
          className="h-7 text-xs flex-1"
          placeholder="e.g. 8,4"
        />
      </div>
    </div>
  );
}

function QrCodePanel({ el, variables, onUpdate }: {
  el: Extract<SceneElement, { type: "qrcode" }>; variables: TemplateVariable[];
  onUpdate: (id: string, c: Partial<SceneElement>) => void;
}) {
  const u = (c: Partial<typeof el>) => onUpdate(el.id, c as Partial<SceneElement>);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FieldLabel>Mode</FieldLabel>
        <div className="flex gap-1">
          <Button size="sm" variant={el.contentMode === "static" ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ contentMode: "static" })}>Static</Button>
          <Button size="sm" variant={el.contentMode === "variable" ? "default" : "outline"}
            className="h-6 text-xs px-2" onClick={() => u({ contentMode: "variable" })}>Variable</Button>
        </div>
      </div>

      {el.contentMode === "static" ? (
        <div className="flex items-start gap-1.5">
          <FieldLabel className="mt-1.5">Content</FieldLabel>
          <Input
            value={el.staticContent}
            onChange={(e) => u({ staticContent: e.target.value })}
            className="h-7 text-xs flex-1"
            placeholder="https://…"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <FieldLabel>Variable</FieldLabel>
          <Select
            value={el.variableBinding?.variableKey ?? ""}
            onValueChange={(v) => u({ variableBinding: { variableKey: v } })}
          >
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {variables.map((v) => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <ColorInput label="Foreground" value={el.fgColor} onChange={(v) => u({ fgColor: v })} />
      <ColorInput label="Background" value={el.bgColor} onChange={(v) => u({ bgColor: v })} />
      <div className="flex items-center gap-1.5">
        <FieldLabel>Error Lvl</FieldLabel>
        <Select value={el.errorLevel} onValueChange={(v) => u({ errorLevel: v as any })}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["L","M","Q","H"] as const).map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ElementPropertiesPanel({ element, variables, onUpdate, readOnly }: Props) {
  // Empty state — no element selected
  if (!element) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2.5 border-b border-gray-200 bg-white">
          <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Properties</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <MousePointer className="h-5 w-5 text-slate-400" />
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Select an element to edit its properties
          </p>
        </div>
      </div>
    );
  }

  const u = (c: Partial<SceneElement>) => { if (!readOnly) onUpdate(element.id, c); };

  return (
    <ScrollArea className="h-full">
      {/* Sticky header */}
      <div className="px-3 py-2.5 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
        <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Properties</span>
        <Badge variant="outline" className="text-xs capitalize text-slate-700 border-gray-300">{element.type}</Badge>
      </div>

      <div className="p-3 space-y-4">
        {/* Name + lock/visibility */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <FieldLabel>Name</FieldLabel>
            <Input
              value={element.name ?? ""}
              onChange={(e) => u({ name: e.target.value })}
              className="h-7 text-xs flex-1 text-slate-800"
              disabled={readOnly}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm" variant="outline"
              className="flex-1 h-7 text-xs gap-1 text-slate-700 border-gray-300 hover:bg-slate-50"
              onClick={() => u({ locked: !element.locked })}
              disabled={readOnly}
            >
              {element.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              {element.locked ? "Locked" : "Lock"}
            </Button>
            <Button
              size="sm" variant="outline"
              className="flex-1 h-7 text-xs gap-1 text-slate-700 border-gray-300 hover:bg-slate-50"
              onClick={() => u({ visible: !element.visible })}
              disabled={readOnly}
            >
              {element.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {element.visible ? "Visible" : "Hidden"}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Position & Size */}
        <div>
          <SectionTitle>Position & Size</SectionTitle>
          <PositionSizePanel el={element} onUpdate={!readOnly ? onUpdate : () => {}} />
        </div>

        <Separator />

        {/* Type-specific */}
        <div>
          <SectionTitle>
            {element.type === "text" ? "Text" : element.type === "image" ? "Image" :
             element.type === "shape" ? "Shape" : element.type === "line" ? "Line" : "QR Code"}
          </SectionTitle>
          {element.type === "text"   && <TextPanel    el={element} variables={variables} onUpdate={!readOnly ? onUpdate : () => {}} />}
          {element.type === "image"  && <ImagePanel   el={element} variables={variables} onUpdate={!readOnly ? onUpdate : () => {}} />}
          {element.type === "shape"  && <ShapePanel   el={element} onUpdate={!readOnly ? onUpdate : () => {}} />}
          {element.type === "line"   && <LinePanel    el={element} onUpdate={!readOnly ? onUpdate : () => {}} />}
          {element.type === "qrcode" && <QrCodePanel  el={element} variables={variables} onUpdate={!readOnly ? onUpdate : () => {}} />}
        </div>

        {variables.length > 0 && (
          <>
            <Separator />
            <div>
              <SectionTitle>Conditional Visibility</SectionTitle>
              <ConditionalVisibilityPanel el={element} variables={variables} onUpdate={!readOnly ? onUpdate : () => {}} />
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
