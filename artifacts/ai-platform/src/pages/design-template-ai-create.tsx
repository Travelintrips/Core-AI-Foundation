/**
 * Phase 7 — AI Template Assistant
 * Route: /design-templates/ai-create
 *
 * Flow:
 *   1. User fills prompt form
 *   2. Backend generates + validates + saves as draft
 *   3. Frontend shows proposal summary + warnings
 *   4. User can open in editor or regenerate
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles, ArrowRight, RotateCcw, ExternalLink, AlertTriangle,
  CheckCircle2, Loader2, ChevronDown, ChevronUp, Info, Wand2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { templateApi, type AiAssistResult, type AiTemplateProposal } from "@/services/design-batch-api";

// ── Proposal display ───────────────────────────────────────────────────────────

function ProposalCard({ result, onRegenerate, onOpenEditor }: {
  result: AiAssistResult;
  onRegenerate: () => void;
  onOpenEditor: () => void;
}) {
  const [showElements, setShowElements] = useState(false);
  const { proposal } = result;

  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/5 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
            <CheckCircle2 className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{proposal.template.name}</h3>
            <p className="text-xs text-gray-400">
              {proposal.template.canvas.width}×{proposal.template.canvas.height}px ·
              {proposal.template.elements.length} elements ·
              {proposal.variables.length} variables
            </p>
          </div>
        </div>
        <div className="text-right">
          <Badge className="text-[10px]" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.3)" }}>
            {result.aiMeta.model}
          </Badge>
          <p className="text-[10px] text-gray-600 mt-1">
            {result.aiMeta.inputTokens + result.aiMeta.outputTokens} tokens
          </p>
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-300 mb-4">{proposal.summary}</p>

      {/* Assumptions */}
      {proposal.assumptions.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assumptions</p>
          <ul className="space-y-1">
            {proposal.assumptions.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                <Info className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Variables */}
      {proposal.variables.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Template Variables</p>
          <div className="flex flex-wrap gap-1.5">
            {proposal.variables.map((v) => (
              <span key={v.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-800 text-xs text-gray-300">
                <span className="font-mono text-indigo-400">{v.key}</span>
                <span className="text-gray-600">·</span>
                <span className="text-gray-400">{v.type}</span>
                {v.required && <span className="text-red-400">*</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {proposal.warnings.length > 0 && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-xs font-semibold text-amber-400 mb-1 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Warnings
          </p>
          {proposal.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300">{w}</p>
          ))}
        </div>
      )}

      {/* Elements toggle */}
      <button
        onClick={() => setShowElements((p) => !p)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 mb-4"
      >
        {showElements ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {showElements ? "Hide" : "Show"} element list ({proposal.template.elements.length})
      </button>

      {showElements && (
        <div className="mb-4 rounded-lg border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-900/80">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500">ID</th>
                <th className="px-3 py-2 text-left text-gray-500">Type</th>
                <th className="px-3 py-2 text-left text-gray-500">Position</th>
                <th className="px-3 py-2 text-left text-gray-500">Size</th>
              </tr>
            </thead>
            <tbody>
              {(proposal.template.elements as any[]).map((el, i) => (
                <tr key={el.id ?? i} className="border-t border-gray-800">
                  <td className="px-3 py-1.5 font-mono text-indigo-400">{el.id}</td>
                  <td className="px-3 py-1.5 text-gray-400">{el.type}</td>
                  <td className="px-3 py-1.5 text-gray-500">{el.x}, {el.y}</td>
                  <td className="px-3 py-1.5 text-gray-500">{el.width}×{el.height}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Saved notice */}
      {result.draftSaved && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400 mb-4 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved as draft · Template #{result.templateId} · Version #{result.versionId}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={onOpenEditor} className="flex-1">
          <ExternalLink className="h-4 w-4 mr-2" /> Open in Editor
        </Button>
        <Button variant="outline" onClick={onRegenerate}>
          <RotateCcw className="h-4 w-4 mr-2" /> Regenerate
        </Button>
      </div>
    </div>
  );
}

// ── Prompt form ────────────────────────────────────────────────────────────────

interface PromptFormValues {
  prompt: string;
  sizePreset: string;
  canvasWidth: string;
  canvasHeight: string;
  industry: string;
  brandColors: string;
  desiredVariables: string;
  language: string;
}

const EMPTY_FORM: PromptFormValues = {
  prompt: "",
  sizePreset: "instagram-square",
  canvasWidth: "1080",
  canvasHeight: "1080",
  industry: "",
  brandColors: "",
  desiredVariables: "",
  language: "id",
};

const EXAMPLE_PROMPTS = [
  "Buat template logo profesional 800×800px untuk bisnis teknologi, warna biru navy dan putih, font modern",
  "Template Instagram 1080×1350 untuk produk ekspor dengan foto produk besar, nama produk, harga, dan QR code",
  "Desain flyer promosi toko makanan dengan judul besar, gambar produk, harga, dan tombol CTA",
  "Template kartu nama digital minimalist dengan nama, jabatan, nomor telepon, dan email",
];

export default function DesignTemplateAiCreatePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [form, setForm] = useState<PromptFormValues>(EMPTY_FORM);
  const [result, setResult] = useState<AiAssistResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmedRegenerate, setConfirmedRegenerate] = useState(false);

  // Presets
  const { data: presets } = useQuery({
    queryKey: ["ai-template-presets"],
    queryFn: () => templateApi.aiPresets(),
    staleTime: Infinity,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const brandColors = form.brandColors
        .split(",").map((c) => c.trim()).filter(Boolean);
      const desiredVariables = form.desiredVariables
        .split(",").map((v) => v.trim()).filter(Boolean);

      return templateApi.aiAssist({
        prompt: form.prompt,
        sizePreset: form.sizePreset !== "custom" ? form.sizePreset as any : undefined,
        canvasWidth: form.sizePreset === "custom" ? parseInt(form.canvasWidth, 10) : undefined,
        canvasHeight: form.sizePreset === "custom" ? parseInt(form.canvasHeight, 10) : undefined,
        industry: form.industry || undefined,
        brandColors: brandColors.length > 0 ? brandColors : undefined,
        desiredVariables: desiredVariables.length > 0 ? desiredVariables : undefined,
        language: form.language,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setConfirmedRegenerate(false);
      toast({ title: "Template generated!", description: `"${data.proposal.template.name}" saved as draft.` });
    },
    onError: (e: Error) => {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    },
  });

  function setField(key: keyof PromptFormValues, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleRegenerate() {
    if (!confirmedRegenerate) { setConfirmedRegenerate(true); return; }
    setResult(null);
    setConfirmedRegenerate(false);
    generateMutation.mutate();
  }

  const selectedPreset = presets?.presets.find((p) => p.id === form.sizePreset);

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate("/design-studio")} className="text-gray-500 hover:text-gray-300">
          <X className="h-4 w-4" />
        </button>
        <div>
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-indigo-400" />
            <h1 className="text-xl font-bold text-white">AI Template Assistant</h1>
          </div>
          <p className="text-sm text-gray-500">Describe what you need — AI will design a complete template</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Form */}
        <div>
          {/* Prompt */}
          <div className="mb-4">
            <Label className="text-xs text-gray-400 mb-1.5 block">Design Prompt *</Label>
            <textarea
              value={form.prompt}
              onChange={(e) => setField("prompt", e.target.value)}
              placeholder="Describe your template: size, style, industry, elements needed, colors, language…"
              rows={5}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
            <p className="text-[11px] text-gray-600 mt-1">{form.prompt.length}/4000 characters</p>
          </div>

          {/* Example prompts */}
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1.5">Example prompts:</p>
            <div className="flex flex-col gap-1">
              {EXAMPLE_PROMPTS.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => setField("prompt", ex)}
                  className="text-left text-xs text-indigo-400 hover:text-indigo-300 hover:underline truncate"
                >
                  "{ex}"
                </button>
              ))}
            </div>
          </div>

          {/* Size */}
          <div className="mb-4">
            <Label className="text-xs text-gray-400 mb-1.5 block">Canvas Size</Label>
            <select
              value={form.sizePreset}
              onChange={(e) => setField("sizePreset", e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-3 py-2 mb-2"
            >
              {(presets?.presets ?? [
                { id: "instagram-square", label: "Instagram Square (1080×1080)" },
                { id: "instagram-portrait", label: "Instagram Portrait (1080×1350)" },
                { id: "a4", label: "A4 Document" },
                { id: "custom", label: "Custom Size" },
              ]).map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.label}{p.width ? ` (${p.width}×${p.height}px)` : ""}
                </option>
              ))}
            </select>
            {form.sizePreset === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-gray-500 mb-1 block">Width (px)</Label>
                  <Input value={form.canvasWidth} onChange={(e) => setField("canvasWidth", e.target.value)} type="number" min="10" max="8000" className="bg-gray-800 border-gray-700 text-gray-200" />
                </div>
                <div>
                  <Label className="text-[11px] text-gray-500 mb-1 block">Height (px)</Label>
                  <Input value={form.canvasHeight} onChange={(e) => setField("canvasHeight", e.target.value)} type="number" min="10" max="8000" className="bg-gray-800 border-gray-700 text-gray-200" />
                </div>
              </div>
            )}
          </div>

          {/* Advanced options */}
          <button
            onClick={() => setShowAdvanced((p) => !p)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-400 mb-3"
          >
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Advanced options
          </button>

          {showAdvanced && (
            <div className="space-y-3 mb-4 p-4 rounded-xl bg-gray-900/40 border border-gray-800">
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">Industry / Category</Label>
                <Input
                  value={form.industry}
                  onChange={(e) => setField("industry", e.target.value)}
                  placeholder="e.g. Food & Beverage, Technology, Fashion"
                  className="bg-gray-800 border-gray-700 text-gray-200"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">Brand Colors (comma-separated hex)</Label>
                <Input
                  value={form.brandColors}
                  onChange={(e) => setField("brandColors", e.target.value)}
                  placeholder="#1E40AF, #FFFFFF, #F59E0B"
                  className="bg-gray-800 border-gray-700 text-gray-200"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">Desired Variables (comma-separated)</Label>
                <Input
                  value={form.desiredVariables}
                  onChange={(e) => setField("desiredVariables", e.target.value)}
                  placeholder="product_name, price, image_url, country"
                  className="bg-gray-800 border-gray-700 text-gray-200"
                />
              </div>
              <div>
                <Label className="text-xs text-gray-400 mb-1 block">Output Language</Label>
                <select
                  value={form.language}
                  onChange={(e) => setField("language", e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 px-3 py-2"
                >
                  <option value="id">Indonesian</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          )}

          {/* Generate button */}
          <Button
            className="w-full"
            onClick={() => generateMutation.mutate()}
            disabled={!form.prompt.trim() || generateMutation.isPending}
          >
            {generateMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating with AI…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" /> Generate Template</>
            )}
          </Button>

          {/* Security notice */}
          <p className="text-[11px] text-gray-600 mt-2 text-center">
            AI output is validated and sanitized before saving. Scripts and unsafe URLs are blocked.
          </p>
        </div>

        {/* Right: Result */}
        <div>
          {generateMutation.isPending && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-8 flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-indigo-400 animate-pulse" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-300">Generating your template…</p>
                <p className="text-xs text-gray-500 mt-1">AI is designing elements, variables, and layout</p>
              </div>
            </div>
          )}

          {result && !generateMutation.isPending && (
            <div>
              {confirmedRegenerate && (
                <div className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Regenerating will create a new draft. Click "Regenerate" again to confirm.
                </div>
              )}
              <ProposalCard
                result={result}
                onRegenerate={handleRegenerate}
                onOpenEditor={() => navigate(`/design-templates/${result!.templateId}/editor`)}
              />
            </div>
          )}

          {!result && !generateMutation.isPending && (
            <div className="rounded-2xl border border-dashed border-gray-800 p-8 flex flex-col items-center gap-3 text-center">
              <Wand2 className="h-10 w-10 text-gray-700" />
              <div>
                <p className="text-sm text-gray-400 font-medium">AI result will appear here</p>
                <p className="text-xs text-gray-600 mt-1">Fill in the prompt and click Generate</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
