import { useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, Loader2, Lock, ArrowRight, RefreshCcw } from "lucide-react";
import {
  useStartLivePreview,
  useLivePreview,
  usePreviewSessionUsage,
  useContinueLivePreview,
  LIVE_PREVIEW_MAX,
  type LivePreviewConcept,
} from "@/hooks/use-portfolio";

function ConceptCard({
  label,
  concept,
  onContinue,
  continuing,
}: {
  label: "A" | "B";
  concept: LivePreviewConcept;
  onContinue: () => void;
  continuing: boolean;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      <div
        className="aspect-square bg-muted relative select-none"
        onContextMenu={(e) => e.preventDefault()}
      >
        {concept.imageDataUrl ? (
          <img
            src={concept.imageDataUrl}
            alt={`Concept ${label}`}
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-center p-4 text-sm text-muted-foreground"
            style={{ background: `linear-gradient(135deg, ${concept.color_recommendation.primary}22, ${concept.color_recommendation.secondary}22)` }}
          >
            {concept.name}
          </div>
        )}
        {/* Watermark overlay — free preview is never a clean, downloadable asset */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-white/70 text-2xl font-serif font-medium rotate-[-18deg] tracking-wide" style={{ textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>
            PREVIEW ONLY
          </span>
        </div>
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-background/80 backdrop-blur text-xs font-medium flex items-center gap-1">
          <Lock className="w-3 h-3" /> Not for download
        </div>
      </div>
      <div className="p-5 space-y-3">
        <p className="font-serif text-lg font-medium">Concept {label}: {concept.name}</p>
        <p className="text-sm text-muted-foreground">{concept.style_explanation}</p>
        <p className="text-xs text-muted-foreground italic">{concept.reasoning}</p>
        <div className="flex items-center gap-2 pt-1">
          {[concept.color_recommendation.primary, concept.color_recommendation.secondary, concept.color_recommendation.accent].filter(Boolean).map((c, i) => (
            <span key={i} className="w-6 h-6 rounded-full border border-border" style={{ background: c }} title={c} />
          ))}
          <span className="text-xs text-muted-foreground ml-2">{concept.typography_recommendation.heading} / {concept.typography_recommendation.body}</span>
        </div>
        <button
          onClick={onContinue}
          disabled={continuing}
          className="w-full mt-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
        >
          {continuing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          Continue With This Concept
        </button>
      </div>
    </div>
  );
}

export function LiveAiPreview({ serviceId }: { serviceId: number }) {
  const [, setLocation] = useLocation();
  const usage = usePreviewSessionUsage();
  const start = useStartLivePreview();
  const continueMutation = useContinueLivePreview();
  const [previewId, setPreviewId] = useState<number | undefined>(undefined);
  const [form, setForm] = useState({ companyName: "", industry: "", style: "", shortDescription: "" });
  const { data: preview } = useLivePreview(previewId, { poll: true });

  const remaining = usage.data?.remaining ?? LIVE_PREVIEW_MAX;
  const limitReached = remaining <= 0 && !!usage.data;

  const onGenerate = () => {
    if (!form.companyName || !form.industry || !form.style) return;
    start.mutate(
      { serviceId, ...form },
      { onSuccess: (res) => setPreviewId(res.id) },
    );
  };

  const onContinue = (concept: "A" | "B") => {
    if (!previewId) return;
    continueMutation.mutate(
      { previewId, concept },
      {
        onSuccess: (res) => {
          // Seed the existing catalog request/brief flow with the exact
          // generated concept — this never re-triggers generation.
          sessionStorage.setItem("live-preview-seed", JSON.stringify(res));
          setLocation(`/services/${serviceId}?seedPreview=${previewId}&concept=${concept}`);
        },
      },
    );
  };

  return (
    <section className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-6 md:p-8">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="font-serif text-lg font-medium">Try the AI — Free Live Preview</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
        See a real, personalized concept before you commit. Free, watermarked, and limited to {LIVE_PREVIEW_MAX} tries per visit — not a downloadable production asset.
      </p>

      {limitReached && !preview ? (
        <div className="rounded-2xl border border-border bg-muted/40 p-6 text-sm text-muted-foreground">
          You've used your {LIVE_PREVIEW_MAX} free previews for this visit. Pick a package below and our team will create your final concepts as part of the project.
        </div>
      ) : !preview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
          <input
            className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
            placeholder="Company / brand name *"
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
          />
          <input
            className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
            placeholder="Industry (e.g. coffee shop) *"
            value={form.industry}
            onChange={(e) => setForm({ ...form, industry: e.target.value })}
          />
          <input
            className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
            placeholder="Style (e.g. minimalist, luxury) *"
            value={form.style}
            onChange={(e) => setForm({ ...form, style: e.target.value })}
          />
          <input
            className="w-full px-4 py-3 rounded-xl border border-input bg-background text-sm"
            placeholder="Short description (optional)"
            value={form.shortDescription}
            onChange={(e) => setForm({ ...form, shortDescription: e.target.value })}
          />
          <button
            onClick={onGenerate}
            disabled={start.isPending || !form.companyName || !form.industry || !form.style}
            className="sm:col-span-2 px-4 py-3 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate my free preview ({remaining} left)
          </button>
          {start.isError && (
            <p className="sm:col-span-2 text-sm text-destructive">
              {start.error instanceof Error ? start.error.message : "Something went wrong."}
            </p>
          )}
        </div>
      ) : preview.status === "generating" ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Our AI Brand Strategist and Creative Director are working on your concepts…</p>
        </div>
      ) : preview.status === "failed" ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive space-y-3">
          <p>{preview.errorMessage ?? "Preview generation failed."}</p>
          <button onClick={() => setPreviewId(undefined)} className="inline-flex items-center gap-2 text-sm font-medium underline">
            <RefreshCcw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {preview.conceptA && (
            <ConceptCard label="A" concept={preview.conceptA} onContinue={() => onContinue("A")} continuing={continueMutation.isPending} />
          )}
          {preview.conceptB && (
            <ConceptCard label="B" concept={preview.conceptB} onContinue={() => onContinue("B")} continuing={continueMutation.isPending} />
          )}
        </div>
      )}
    </section>
  );
}
