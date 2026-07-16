/**
 * AI Template Assistant — accessible from Template Library
 *
 * Free-text prompt → POST /ai/design-templates/ai-assist → structured proposal
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2, ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const API_BASE = "";
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /**/ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface AiAssistResult {
  draftVersionId: number;
  templateId: number;
  templateJson: {
    name: string;
    description?: string;
    category?: string;
    canvas: { width: number; height: number };
    elements: unknown[];
    variables: { key: string; label: string; type: string; required?: boolean }[];
  };
}

export default function AiAssistPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("");
  const [canvasWidth, setCanvasWidth] = useState(1200);
  const [canvasHeight, setCanvasHeight] = useState(628);
  const [result, setResult] = useState<AiAssistResult | null>(null);

  const mutation = useMutation({
    mutationFn: (body: object) =>
      apiFetch<AiAssistResult>("/api/ai/design-templates/ai-assist", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Template generated!", description: `Saved as draft template #${data.templateId}` });
    },
    onError: (err) =>
      toast({ title: "AI generation failed", description: String(err), variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    mutation.mutate({ prompt, category: category || undefined, canvasWidth, canvasHeight });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/design-studio")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-500" /> AI Template Assistant
          </h1>
          <p className="text-sm text-muted-foreground">Describe a template and AI will generate the structure for you.</p>
        </div>
      </div>

      {!result ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Describe your template *</label>
            <textarea
              className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              placeholder="e.g. A social media banner for a product launch with a bold headline, product image, and call-to-action button…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground text-right">{prompt.length}/2000</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Category (optional)</label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                placeholder="e.g. social-media, banner…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Canvas size</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  className="flex h-9 w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={canvasWidth}
                  min={100}
                  max={8000}
                  onChange={(e) => setCanvasWidth(parseInt(e.target.value) || 1200)}
                />
                <span className="text-muted-foreground text-sm">×</span>
                <input
                  type="number"
                  className="flex h-9 w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
                  value={canvasHeight}
                  min={100}
                  max={8000}
                  onChange={(e) => setCanvasHeight(parseInt(e.target.value) || 628)}
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={!prompt.trim() || mutation.isPending} className="w-full">
            {mutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating template…</>
              : <><Sparkles className="h-4 w-4 mr-2" /> Generate Template</>}
          </Button>

          {mutation.isPending && (
            <p className="text-xs text-center text-muted-foreground">
              AI is designing your template structure. This may take 10–20 seconds…
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">Template generated successfully!</p>
              <p className="text-xs text-green-700">Saved as draft — Template #{result.templateId}, Version #{result.draftVersionId}</p>
            </div>
          </div>

          <div className="border rounded-xl p-4 space-y-3">
            <h2 className="font-semibold text-lg">{result.templateJson.name}</h2>
            {result.templateJson.description && (
              <p className="text-sm text-muted-foreground">{result.templateJson.description}</p>
            )}
            <div className="flex gap-2 flex-wrap text-xs">
              {result.templateJson.category && (
                <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded">{result.templateJson.category}</span>
              )}
              <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                {result.templateJson.canvas.width}×{result.templateJson.canvas.height}px
              </span>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                {result.templateJson.elements.length} elements
              </span>
              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">
                {result.templateJson.variables.length} variables
              </span>
            </div>

            {result.templateJson.variables.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Template Variables:</p>
                <div className="space-y-1">
                  {result.templateJson.variables.map((v) => (
                    <div key={v.key} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-violet-700">{v.key}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>{v.label}</span>
                      <span className="px-1 py-0.5 bg-gray-100 rounded">{v.type}</span>
                      {v.required && <span className="text-red-600 font-medium">required</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate(`/design-studio/${result.templateId}`)}
              className="flex-1"
            >
              <ExternalLink className="h-4 w-4 mr-1" /> Open in Editor
            </Button>
            <Button
              variant="outline"
              onClick={() => { setResult(null); setPrompt(""); }}
            >
              Generate Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
