/**
 * Universal Property Panel — Built-in Field Renderers
 *
 * All 14 built-in types: text, textarea, number, boolean, select,
 * multi-select, color, date, dimensions, percentage, range,
 * asset-reference, enum, readonly-metadata, custom (fallback).
 *
 * Security rules:
 * - Labels rendered as text — no dangerouslySetInnerHTML anywhere.
 * - No complex color engine — native <input type="color"> + text input.
 * - No rich text editor.
 */

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sanitizeLabel } from "../security";
import type {
  PropertyFieldRenderer,
  PropertyFieldRendererProps,
  DimensionsValue,
  AssetReference,
} from "../types";

// ── helpers ───────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function asBoolean(v: unknown): boolean {
  return Boolean(v);
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

// ── text ──────────────────────────────────────────────────────────────────────

function TextRenderer({ fieldDef, value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  return (
    <Input
      id={inputId}
      value={asString(value)}
      readOnly={isReadOnly}
      disabled={isDisabled}
      placeholder={fieldDef.placeholder}
      onBlur={onBlur}
      onChange={(e) => !isReadOnly && onChange(e.target.value)}
      className="h-7 text-xs"
      aria-readonly={isReadOnly || undefined}
    />
  );
}

// ── textarea ──────────────────────────────────────────────────────────────────

function TextareaRenderer({ fieldDef, value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  return (
    <Textarea
      id={inputId}
      value={asString(value)}
      readOnly={isReadOnly}
      disabled={isDisabled}
      placeholder={fieldDef.placeholder}
      onBlur={onBlur}
      onChange={(e) => !isReadOnly && onChange(e.target.value)}
      className="text-xs min-h-[60px]"
      aria-readonly={isReadOnly || undefined}
    />
  );
}

// ── number ────────────────────────────────────────────────────────────────────

function NumberRenderer({ fieldDef, value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const num = asNumber(value);
  return (
    <div className="relative flex items-center gap-1">
      <Input
        id={inputId}
        type="number"
        value={num}
        readOnly={isReadOnly}
        disabled={isDisabled}
        min={fieldDef.min}
        max={fieldDef.max}
        step={fieldDef.step ?? 1}
        onBlur={onBlur}
        onChange={(e) => {
          if (isReadOnly) return;
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) {
            const clamped =
              fieldDef.min !== undefined && v < fieldDef.min ? fieldDef.min
              : fieldDef.max !== undefined && v > fieldDef.max ? fieldDef.max
              : v;
            onChange(clamped);
          }
        }}
        className="h-7 text-xs"
        aria-readonly={isReadOnly || undefined}
      />
      {fieldDef.unit && (
        <span className="text-xs text-muted-foreground shrink-0">{sanitizeLabel(fieldDef.unit)}</span>
      )}
    </div>
  );
}

// ── boolean ───────────────────────────────────────────────────────────────────

function BooleanRenderer({ value, onChange, isReadOnly, isDisabled, inputId, fieldDef }: PropertyFieldRendererProps) {
  const checked = asBoolean(value);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={inputId}
        checked={checked}
        disabled={isReadOnly || isDisabled}
        onCheckedChange={(v) => {
          if (!isReadOnly) onChange(Boolean(v));
        }}
        aria-readonly={isReadOnly || undefined}
      />
      {fieldDef.description && (
        <span className="text-xs text-muted-foreground">{sanitizeLabel(fieldDef.description)}</span>
      )}
    </div>
  );
}

// ── select ────────────────────────────────────────────────────────────────────

function SelectRenderer({ fieldDef, value, onChange, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const options = fieldDef.options ?? [];
  const selected = asString(value);
  return (
    <Select
      value={selected}
      disabled={isReadOnly || isDisabled}
      onValueChange={(v) => !isReadOnly && onChange(v)}
    >
      <SelectTrigger id={inputId} className="h-7 text-xs" aria-readonly={isReadOnly || undefined}>
        <SelectValue placeholder={fieldDef.placeholder ?? "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
            {/* Text node — never HTML */}
            {sanitizeLabel(opt.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── multi-select ──────────────────────────────────────────────────────────────

function MultiSelectRenderer({ fieldDef, value, onChange, isReadOnly, isDisabled }: PropertyFieldRendererProps) {
  const options = fieldDef.options ?? [];
  const selected = new Set(asStringArray(value));

  function toggle(optValue: string) {
    if (isReadOnly || isDisabled) return;
    const next = new Set(selected);
    if (next.has(optValue)) next.delete(optValue);
    else next.add(optValue);
    onChange(Array.from(next));
  }

  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={sanitizeLabel(fieldDef.label)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={isReadOnly || isDisabled || opt.disabled}
          onClick={() => toggle(opt.value)}
          className={cn(
            "text-xs px-2 py-0.5 rounded border transition-colors",
            selected.has(opt.value)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:border-primary text-muted-foreground",
            (isReadOnly || isDisabled) && "opacity-50 cursor-not-allowed",
          )}
          aria-pressed={selected.has(opt.value)}
        >
          {sanitizeLabel(opt.label)}
        </button>
      ))}
    </div>
  );
}

// ── color ─────────────────────────────────────────────────────────────────────

function ColorRenderer({ value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const color = asString(value, "#000000");
  const safeColor = /^#[0-9a-fA-F]{3,6}$/.test(color) ? color : "#000000";

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        id={inputId}
        value={safeColor}
        disabled={isReadOnly || isDisabled}
        onChange={(e) => !isReadOnly && onChange(e.target.value)}
        onBlur={onBlur}
        className="h-7 w-7 cursor-pointer border border-border rounded p-0.5"
        aria-readonly={isReadOnly || undefined}
      />
      <Input
        value={color}
        readOnly={isReadOnly}
        disabled={isDisabled}
        onBlur={onBlur}
        onChange={(e) => {
          if (!isReadOnly && /^#[0-9a-fA-F]{0,8}$/.test(e.target.value)) {
            onChange(e.target.value);
          }
        }}
        className="h-7 text-xs font-mono flex-1"
        placeholder="#000000"
        aria-label="Color hex value"
      />
    </div>
  );
}

// ── date ──────────────────────────────────────────────────────────────────────

function DateRenderer({ value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  return (
    <Input
      id={inputId}
      type="date"
      value={asString(value)}
      readOnly={isReadOnly}
      disabled={isDisabled}
      onBlur={onBlur}
      onChange={(e) => !isReadOnly && onChange(e.target.value)}
      className="h-7 text-xs"
      aria-readonly={isReadOnly || undefined}
    />
  );
}

// ── dimensions ────────────────────────────────────────────────────────────────

function DimensionsRenderer({ fieldDef, value, onChange, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const dims = (value as DimensionsValue | null | undefined) ?? { width: 0, height: 0 };
  const unit = fieldDef.unit ?? dims.unit ?? "px";

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1">
        <label htmlFor={`${inputId}-w`} className="text-[10px] text-muted-foreground">W</label>
        <Input
          id={`${inputId}-w`}
          type="number"
          value={dims.width}
          readOnly={isReadOnly}
          disabled={isDisabled}
          min={fieldDef.min ?? 0}
          onChange={(e) => {
            if (isReadOnly) return;
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange({ ...dims, width: v, unit });
          }}
          className="h-7 text-xs"
        />
      </div>
      <span className="text-muted-foreground text-xs">×</span>
      <div className="flex items-center gap-1 flex-1">
        <label htmlFor={`${inputId}-h`} className="text-[10px] text-muted-foreground">H</label>
        <Input
          id={`${inputId}-h`}
          type="number"
          value={dims.height}
          readOnly={isReadOnly}
          disabled={isDisabled}
          min={fieldDef.min ?? 0}
          onChange={(e) => {
            if (isReadOnly) return;
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange({ ...dims, height: v, unit });
          }}
          className="h-7 text-xs"
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{sanitizeLabel(unit)}</span>
    </div>
  );
}

// ── percentage ────────────────────────────────────────────────────────────────

function PercentageRenderer({ fieldDef, value, onChange, onBlur, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const pct = asNumber(value, 0);
  return (
    <div className="flex items-center gap-2">
      <Input
        id={inputId}
        type="number"
        value={pct}
        readOnly={isReadOnly}
        disabled={isDisabled}
        min={fieldDef.min ?? 0}
        max={fieldDef.max ?? 100}
        step={fieldDef.step ?? 1}
        onBlur={onBlur}
        onChange={(e) => {
          if (isReadOnly) return;
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) {
            const min = fieldDef.min ?? 0;
            const max = fieldDef.max ?? 100;
            onChange(Math.min(max, Math.max(min, v)));
          }
        }}
        className="h-7 text-xs flex-1"
        aria-readonly={isReadOnly || undefined}
      />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  );
}

// ── range ─────────────────────────────────────────────────────────────────────

function RangeRenderer({ fieldDef, value, onChange, isReadOnly, isDisabled, inputId }: PropertyFieldRendererProps) {
  const num = asNumber(value, fieldDef.min ?? 0);
  return (
    <div className="flex items-center gap-2">
      <Slider
        id={inputId}
        value={[num]}
        min={fieldDef.min ?? 0}
        max={fieldDef.max ?? 100}
        step={fieldDef.step ?? 1}
        disabled={isReadOnly || isDisabled}
        onValueChange={([v]) => !isReadOnly && onChange(v ?? 0)}
        className="flex-1"
        aria-label={sanitizeLabel(fieldDef.label)}
        aria-readonly={isReadOnly || undefined}
      />
      <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
        {num}{fieldDef.unit ? sanitizeLabel(fieldDef.unit) : ""}
      </span>
    </div>
  );
}

// ── asset-reference ───────────────────────────────────────────────────────────

function AssetReferenceRenderer({ value, onChange, isReadOnly, isDisabled, inputId, fieldDef }: PropertyFieldRendererProps) {
  const ref = value as AssetReference | null | undefined;
  return (
    <div className="space-y-1">
      {ref?.url && (
        <div className="text-xs text-muted-foreground truncate" title={sanitizeLabel(ref.name ?? ref.id)}>
          {sanitizeLabel(ref.name ?? ref.id)}
        </div>
      )}
      {!isReadOnly && (
        <Input
          id={inputId}
          type="text"
          value={ref?.id ?? ""}
          disabled={isDisabled}
          placeholder="Asset ID…"
          onChange={(e) => {
            const id = e.target.value.trim();
            onChange(id ? { id } : null);
          }}
          className="h-7 text-xs"
          aria-label={`${sanitizeLabel(fieldDef.label)} asset ID`}
        />
      )}
      {isReadOnly && (
        <Badge variant="outline" className="text-xs">
          {ref ? sanitizeLabel(ref.name ?? ref.id) : "—"}
        </Badge>
      )}
    </div>
  );
}

// ── enum (semantically typed select) ─────────────────────────────────────────

// Enum is rendered identically to select, but carries semantic enum meaning.
// The label rendering is always plain text.
function EnumRenderer(props: PropertyFieldRendererProps) {
  return <SelectRenderer {...props} />;
}

// ── readonly-metadata ─────────────────────────────────────────────────────────

function ReadonlyMetadataRenderer({ value, fieldDef }: PropertyFieldRendererProps) {
  const display = value === null || value === undefined
    ? "—"
    : typeof value === "object"
    ? JSON.stringify(value)
    : String(value);

  return (
    <div
      className="text-xs text-muted-foreground font-mono bg-muted/30 rounded px-2 py-1 break-all select-all"
      aria-label={sanitizeLabel(fieldDef.label)}
      aria-readonly="true"
    >
      {/* text node — safe */}
      {sanitizeLabel(display)}
    </div>
  );
}

// ── custom (fallback — signals missing renderer) ───────────────────────────────

function CustomFallbackRenderer({ fieldDef }: PropertyFieldRendererProps) {
  return (
    <div
      className="text-xs text-destructive/80 italic border border-destructive/30 rounded px-2 py-1"
      role="alert"
    >
      No renderer for type: {sanitizeLabel(fieldDef.type)}
    </div>
  );
}

// ── Built-in renderer definitions ─────────────────────────────────────────────

export const BUILT_IN_RENDERERS: PropertyFieldRenderer[] = [
  { type: "text", render: (p) => <TextRenderer {...p} /> },
  { type: "textarea", render: (p) => <TextareaRenderer {...p} /> },
  { type: "number", render: (p) => <NumberRenderer {...p} /> },
  { type: "boolean", render: (p) => <BooleanRenderer {...p} /> },
  { type: "select", render: (p) => <SelectRenderer {...p} /> },
  { type: "multi-select", render: (p) => <MultiSelectRenderer {...p} /> },
  { type: "color", render: (p) => <ColorRenderer {...p} /> },
  { type: "date", render: (p) => <DateRenderer {...p} /> },
  { type: "dimensions", render: (p) => <DimensionsRenderer {...p} /> },
  { type: "percentage", render: (p) => <PercentageRenderer {...p} /> },
  { type: "range", render: (p) => <RangeRenderer {...p} /> },
  { type: "asset-reference", render: (p) => <AssetReferenceRenderer {...p} /> },
  { type: "enum", render: (p) => <EnumRenderer {...p} /> },
  { type: "readonly-metadata", render: (p) => <ReadonlyMetadataRenderer {...p} /> },
  { type: "custom", render: (p) => <CustomFallbackRenderer {...p} /> },
];
