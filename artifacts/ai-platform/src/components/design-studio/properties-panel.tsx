import { useState } from "react";
import { Sparkles, Loader2, ChevronDown, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { DesignElement, CanvasState } from "./types";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),

      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface AiSuggestion { id: string; content: string; reasoning: string | null }

interface Props {
  element: DesignElement | null;
  canvas: CanvasState;
  projectId: number | null;
  onUpdate: (id: string, changes: Partial<DesignElement>) => void;
  onCanvasUpdate: (changes: Partial<CanvasState>) => void;
}

function ColorSwatch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded border border-gray-300 cursor-pointer shrink-0"
        style={{ backgroundColor: value }}
        onClick={() => document.getElementById(`color-${value}`)?.click()}
      />
      <input
        id={`color-${value}`}
        type="color"
        value={value.startsWith("#") ? value : "#000000"}
        className="sr-only"
        onChange={(e) => onChange(e.target.value)}
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs font-mono"
      />
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max, step = 1, unit = "" }: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs text-gray-500 w-6 shrink-0">{label}</Label>
      <div className="relative flex-1">
        <Input
          type="number"
          value={Math.round(value * 100) / 100}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-7 text-xs pr-6"
        />
        {unit && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">{unit}</span>
        )}
      </div>
    </div>
  );
}

export function PropertiesPanel({ element, canvas, projectId, onUpdate, onCanvasUpdate }: Props) {
  const { toast } = useToast();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiOpen, setAiOpen] = useState(false);

  const u = (changes: Partial<DesignElement>) => {
    if (element) onUpdate(element.id, changes);
  };

  async function handleAiRegenerate() {
    if (!element || !projectId || !aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const result = await apiFetch<{ suggestions: AiSuggestion[] }>(
        `/api/ai/design/projects/${projectId}/ai/regenerate`,
        {
          method: "POST",
          body: JSON.stringify({
            elementId: element.id,
            elementType: element.type === "text" ? "text" : "style",
            prompt: aiPrompt,
            currentContent: element.text,
          }),
        }
      );
      setAiSuggestions(result.suggestions ?? []);
    } catch {
      toast({ title: "AI regeneration failed", variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion(s: AiSuggestion) {
    if (!element) return;
    if (element.type === "text") {
      u({ text: s.content });
    }
    setAiSuggestions([]);
    setAiPrompt("");
    toast({ title: "Applied!", description: s.content.slice(0, 60) });
  }

  if (!element) {
    // Show canvas properties
    return (
      <ScrollArea className="h-full">
        <div className="p-3 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Canvas</p>
          <div className="space-y-2">
            <NumberInput label="W" value={canvas.width} onChange={(v) => onCanvasUpdate({ width: v })} min={100} />
            <NumberInput label="H" value={canvas.height} onChange={(v) => onCanvasUpdate({ height: v })} min={100} />
          </div>
          <div>
            <Label className="text-xs text-gray-500">Background</Label>
            <div className="mt-1">
              <ColorSwatch value={canvas.background} onChange={(v) => onCanvasUpdate({ background: v })} />
            </div>
          </div>

          {/* Preset sizes */}
          <div>
            <Label className="text-xs text-gray-500">Preset Sizes</Label>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {[
                { label: "1080×1920", w: 1080, h: 1920 },
                { label: "1920×1080", w: 1920, h: 1080 },
                { label: "1080×1080", w: 1080, h: 1080 },
                { label: "1200×630", w: 1200, h: 630 },
                { label: "A4 Print", w: 2480, h: 3508 },
                { label: "Presentation", w: 1280, h: 720 },
              ].map(({ label, w, h }) => (
                <button
                  key={label}
                  className="text-xs px-2 py-1 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600 transition-colors"
                  onClick={() => onCanvasUpdate({ width: w, height: h })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Element name */}
        <div>
          <Input
            value={element.name}
            onChange={(e) => u({ name: e.target.value })}
            className="h-7 text-xs font-medium"
            placeholder="Layer name"
          />
        </div>

        {/* Position & Size */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Position & Size</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <NumberInput label="X" value={element.x} onChange={(v) => u({ x: v })} step={0.5} />
            <NumberInput label="Y" value={element.y} onChange={(v) => u({ y: v })} step={0.5} />
            <NumberInput label="W" value={element.width} onChange={(v) => u({ width: Math.max(1, v) })} min={1} step={0.5} />
            <NumberInput label="H" value={element.height} onChange={(v) => u({ height: Math.max(1, v) })} min={1} step={0.5} />
          </div>
          <div className="mt-2 space-y-2">
            <NumberInput label="°" value={element.rotation} onChange={(v) => u({ rotation: v })} unit="deg" />
            <div className="flex items-center gap-2">
              <Label className="text-xs text-gray-500 w-6 shrink-0">Op</Label>
              <Slider
                value={[Math.round(element.opacity * 100)]}
                min={0} max={100}
                onValueChange={([v]) => u({ opacity: (v ?? 100) / 100 })}
                className="flex-1"
              />
              <span className="text-xs text-gray-500 w-8 text-right">{Math.round(element.opacity * 100)}%</span>
            </div>
          </div>
        </div>

        <Separator />

        {/* Style */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Style</p>
          <div className="space-y-2">
            {element.type !== "line" && element.type !== "text" && (
              <div>
                <Label className="text-xs text-gray-500">Fill</Label>
                <div className="mt-1">
                  <ColorSwatch value={element.fill || "#6366f1"} onChange={(v) => u({ fill: v })} />
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs text-gray-500">Stroke</Label>
              <div className="mt-1">
                <ColorSwatch value={element.stroke || "transparent"} onChange={(v) => u({ stroke: v })} />
              </div>
            </div>
            <NumberInput label="SW" value={element.strokeWidth ?? 0} onChange={(v) => u({ strokeWidth: v })} min={0} max={20} unit="px" />
            {element.type !== "circle" && element.type !== "line" && (
              <NumberInput label="R" value={element.borderRadius ?? 0} onChange={(v) => u({ borderRadius: v })} min={0} unit="px" />
            )}
          </div>
        </div>

        {/* Text-specific */}
        {element.type === "text" && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Text</p>
              <div className="space-y-2">
                <Textarea
                  value={element.text ?? ""}
                  onChange={(e) => u({ text: e.target.value })}
                  className="text-xs min-h-[60px]"
                  placeholder="Enter text..."
                />
                <div>
                  <Label className="text-xs text-gray-500">Color</Label>
                  <div className="mt-1">
                    <ColorSwatch value={element.color || "#111827"} onChange={(v) => u({ color: v })} />
                  </div>
                </div>
                <NumberInput label="Sz" value={element.fontSize ?? 16} onChange={(v) => u({ fontSize: v })} min={6} max={400} unit="px" />
                <div>
                  <Label className="text-xs text-gray-500">Font</Label>
                  <select
                    value={element.fontFamily ?? "Inter, sans-serif"}
                    onChange={(e) => u({ fontFamily: e.target.value })}
                    className="mt-1 w-full h-7 text-xs border border-gray-200 rounded px-2 bg-white"
                  >
                    {["Inter, sans-serif", "Georgia, serif", "Courier New, monospace", "Arial, sans-serif", "Playfair Display, serif"].map(f => (
                      <option key={f} value={f}>{f.split(",")[0]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Weight</Label>
                  <select
                    value={element.fontWeight ?? "400"}
                    onChange={(e) => u({ fontWeight: e.target.value })}
                    className="mt-1 w-full h-7 text-xs border border-gray-200 rounded px-2 bg-white"
                  >
                    <option value="300">Light</option>
                    <option value="400">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semibold</option>
                    <option value="700">Bold</option>
                    <option value="800">ExtraBold</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Align</Label>
                  <div className="flex gap-1 mt-1">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => u({ textAlign: a })}
                        className={cn(
                          "flex-1 h-7 rounded border flex items-center justify-center",
                          element.textAlign === a
                            ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                            : "border-gray-200 hover:border-gray-400"
                        )}
                      >
                        {a === "left" && <AlignLeft className="h-3 w-3" />}
                        {a === "center" && <AlignCenter className="h-3 w-3" />}
                        {a === "right" && <AlignRight className="h-3 w-3" />}
                      </button>
                    ))}
                  </div>
                </div>
                <NumberInput label="LH" value={element.lineHeight ?? 1.4} onChange={(v) => u({ lineHeight: v })} min={0.5} max={5} step={0.05} />
              </div>
            </div>
          </>
        )}

        {/* Image-specific */}
        {element.type === "image" && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Image</p>
              <div className="space-y-2">
                <div>
                  <Label className="text-xs text-gray-500">URL</Label>
                  <Input
                    value={element.src ?? ""}
                    onChange={(e) => u({ src: e.target.value })}
                    className="h-7 text-xs mt-1"
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Fit</Label>
                  <select
                    value={element.objectFit ?? "cover"}
                    onChange={(e) => u({ objectFit: e.target.value as "cover" | "contain" | "fill" })}
                    className="mt-1 w-full h-7 text-xs border border-gray-200 rounded px-2 bg-white"
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="fill">Fill</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        <Separator />

        {/* AI Regenerate */}
        <div>
          <button
            className="flex items-center gap-1.5 w-full text-xs font-semibold text-gray-500 uppercase tracking-wide"
            onClick={() => setAiOpen(!aiOpen)}
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            AI Regenerate
            <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", aiOpen && "rotate-180")} />
          </button>

          {aiOpen && (
            <div className="mt-2 space-y-2">
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={
                  element.type === "text"
                    ? "e.g. 'Make it more professional and concise'"
                    : "Describe the style change you want..."
                }
                className="text-xs min-h-[60px]"
              />
              <Button
                size="sm"
                className="w-full h-7 text-xs"
                onClick={handleAiRegenerate}
                disabled={aiLoading || !aiPrompt.trim()}
              >
                {aiLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Generate
              </Button>

              {aiSuggestions.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Suggestions — click to apply:</p>
                  {aiSuggestions.map((s) => (
                    <button
                      key={s.id}
                      className="w-full text-left text-xs p-2 rounded border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-colors"
                      onClick={() => applySuggestion(s)}
                    >
                      <p className="text-gray-800">{s.content}</p>
                      {s.reasoning && <p className="text-gray-400 mt-0.5 text-[10px]">{s.reasoning}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
