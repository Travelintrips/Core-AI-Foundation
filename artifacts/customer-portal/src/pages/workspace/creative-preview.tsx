/**
 * Creative Preview Selection Page
 *
 * Shown after AI generates preview concepts.
 * Customer can: Approve, Reject, Compare, Favorite, Request Revision,
 * Generate More Previews, then select one concept for final rendering.
 */

import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, XCircle, Loader2, Sparkles, Star, StarOff,
  RefreshCcw, ChevronRight, Info, Clock, DollarSign,
  ImageIcon, ArrowLeft, Send, Zap, SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── API helpers ───────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/creative-ai/sessions/${sessionId}`);
  if (!res.ok) throw new Error(`Failed to load session: ${res.statusText}`);
  return res.json();
}

async function selectConcept(sessionId: string, conceptAssetId: number, feedback?: string) {
  const res = await fetch(`${API_BASE}/api/creative-ai/sessions/${sessionId}/select-concept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conceptAssetId, feedback }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to select concept");
  }
  return res.json();
}

async function generateFinal(sessionId: string, requestedCount?: number) {
  const res = await fetch(`${API_BASE}/api/creative-ai/sessions/${sessionId}/generate-final`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestedCount }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to start final generation");
  }
  return res.json();
}

async function requestMorePreviews(sessionId: string, count = 4) {
  const res = await fetch(`${API_BASE}/api/creative-ai/sessions/${sessionId}/more-previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Failed to generate more previews");
  }
  return res.json();
}

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  planning:           { label: "Planning",         color: "bg-blue-500/20 text-blue-300" },
  preview_generating: { label: "Generating Previews", color: "bg-yellow-500/20 text-yellow-300" },
  preview_ready:      { label: "Ready for Review", color: "bg-green-500/20 text-green-300" },
  waiting_customer:   { label: "Awaiting Selection", color: "bg-purple-500/20 text-purple-300" },
  concept_selected:   { label: "Concept Selected", color: "bg-blue-500/20 text-blue-300" },
  final_generating:   { label: "Final Rendering",  color: "bg-orange-500/20 text-orange-300" },
  quality_check:      { label: "Quality Check",    color: "bg-indigo-500/20 text-indigo-300" },
  completed:          { label: "Completed",         color: "bg-emerald-500/20 text-emerald-300" },
  failed:             { label: "Failed",            color: "bg-red-500/20 text-red-300" },
};

const TIER_LABELS: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
  enterprise: "Enterprise",
};

// ── Concept Card ──────────────────────────────────────────────────────────────

interface ConceptCardProps {
  concept: {
    id: number;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    status: string;
    aiExplanation: string | null;
    conceptIndex: number | null;
    estimatedFinalCostUsd: number | null;
    estimatedRenderTimeMs: number | null;
    metadata: Record<string, unknown> | null;
    prompt: string;
  };
  selected: boolean;
  favorited: boolean;
  onSelect: (id: number) => void;
  onFavorite: (id: number) => void;
  disabled: boolean;
}

function ConceptCard({ concept, selected, favorited, onSelect, onFavorite, disabled }: ConceptCardProps) {
  const isGenerating = concept.status === "generating";
  const isFailed = concept.status === "failed";
  const estimatedStyle = (concept.metadata?.["estimatedStyle"] as string) ?? "Modern";
  const estimatedTemplate = (concept.metadata?.["estimatedTemplate"] as string) ?? "Clean Grid";
  const estimatedMs = concept.estimatedRenderTimeMs;
  const estimatedCost = concept.estimatedFinalCostUsd;

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 transition-all duration-200 overflow-hidden cursor-pointer group",
        selected
          ? "border-violet-500 ring-2 ring-violet-500/30 shadow-lg shadow-violet-500/10"
          : "border-white/10 hover:border-white/30",
        disabled && "opacity-60 cursor-not-allowed",
      )}
      onClick={() => !disabled && !isGenerating && !isFailed && onSelect(concept.id)}
    >
      {/* Image area */}
      <div className="aspect-square bg-white/5 relative overflow-hidden">
        {isGenerating ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400 mx-auto" />
              <p className="text-xs text-white/50">Generating concept…</p>
            </div>
          </div>
        ) : isFailed ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-2">
              <XCircle className="h-8 w-8 text-red-400 mx-auto" />
              <p className="text-xs text-red-300/70">Generation failed</p>
            </div>
          </div>
        ) : concept.imageUrl ? (
          <img
            src={concept.imageUrl}
            alt={`Concept ${concept.conceptIndex ?? concept.id}`}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-white/20" />
          </div>
        )}

        {/* Selection badge */}
        {selected && (
          <div className="absolute top-2 right-2">
            <div className="bg-violet-500 rounded-full p-1">
              <CheckCircle2 className="h-4 w-4 text-white" />
            </div>
          </div>
        )}

        {/* Concept index */}
        <div className="absolute top-2 left-2">
          <span className="bg-black/60 text-white/80 text-xs px-2 py-0.5 rounded-full">
            Concept {concept.conceptIndex ?? concept.id}
          </span>
        </div>

        {/* Favorite button */}
        <button
          className="absolute bottom-2 right-2 p-1.5 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onFavorite(concept.id); }}
        >
          {favorited
            ? <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400" />
            : <StarOff className="h-3.5 w-3.5 text-white/60" />}
        </button>
      </div>

      {/* Info area */}
      <div className="p-3 bg-white/5 space-y-2">
        {/* Style + Template tags */}
        <div className="flex flex-wrap gap-1">
          <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">{estimatedStyle}</span>
          <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">{estimatedTemplate}</span>
        </div>

        {/* AI Explanation */}
        {concept.aiExplanation && (
          <p className="text-xs text-white/60 leading-relaxed line-clamp-3">
            {concept.aiExplanation}
          </p>
        )}

        {/* Cost + Time estimates */}
        <div className="flex gap-3 pt-1">
          {estimatedCost != null && (
            <div className="flex items-center gap-1 text-xs text-white/40">
              <DollarSign className="h-3 w-3" />
              <span>${estimatedCost.toFixed(3)}/img (final)</span>
            </div>
          )}
          {estimatedMs != null && (
            <div className="flex items-center gap-1 text-xs text-white/40">
              <Clock className="h-3 w-3" />
              <span>~{Math.round(estimatedMs / 1000)}s</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Progress steps ────────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { status: "preview_generating", label: "Preview Generation" },
  { status: "preview_ready",      label: "Concept Review" },
  { status: "concept_selected",   label: "Concept Selected" },
  { status: "final_generating",   label: "Final Rendering" },
  { status: "quality_check",      label: "Quality Check" },
  { status: "completed",          label: "Delivered" },
];

const STATUS_ORDER = ["planning", "preview_generating", "preview_ready", "waiting_customer",
  "concept_selected", "final_generating", "quality_check", "completed"];

function getStepIndex(status: string): number {
  return STATUS_ORDER.indexOf(status);
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CreativePreviewPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedConceptId, setSelectedConceptId] = useState<number | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const QUERY_KEY = ["render-session", sessionId];

  const { data: session, isLoading, error } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSession(sessionId ?? ""),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = (query.state.data as { sessionStatus?: string })?.sessionStatus;
      if (!status) return 3000;
      if (["preview_generating", "final_generating", "quality_check", "planning"].includes(status)) return 3000;
      return false;
    },
  });

  const selectMutation = useMutation({
    mutationFn: ({ conceptId, fb }: { conceptId: number; fb?: string }) =>
      selectConcept(sessionId ?? "", conceptId, fb),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Concept selected!", description: "Ready to generate final images." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Failed to select concept", description: err.message });
    },
  });

  const finalMutation = useMutation({
    mutationFn: () => generateFinal(sessionId ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Final generation started!", description: "High-resolution images are rendering now." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Failed to start final render", description: err.message });
    },
  });

  const morePreviewsMutation = useMutation({
    mutationFn: () => requestMorePreviews(sessionId ?? "", 4),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Generating more concepts!", description: "4 new preview concepts are on the way." });
    },
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "Failed to generate more previews", description: err.message });
    },
  });

  if (!sessionId) return <div className="p-8 text-white/50">No session ID provided.</div>;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin text-violet-400 mx-auto" />
          <p className="text-white/60">Loading preview session…</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-3">
          <XCircle className="h-10 w-10 text-red-400 mx-auto" />
          <p className="text-white/60">Failed to load session. Please try again.</p>
        </div>
      </div>
    );
  }

  const sessionStatus = (session as { sessionStatus: string }).sessionStatus;
  const concepts = ((session as { previewConcepts?: unknown[] }).previewConcepts ?? []) as Array<{
    id: number; imageUrl: string | null; thumbnailUrl: string | null; status: string;
    aiExplanation: string | null; conceptIndex: number | null;
    estimatedFinalCostUsd: number | null; estimatedRenderTimeMs: number | null;
    metadata: Record<string, unknown> | null; prompt: string;
  }>;
  const finalAssets = ((session as { finalAssets?: unknown[] }).finalAssets ?? []) as Array<{
    id: number; imageUrl: string | null; status: string; qcScore: number | null;
    qcNotes: string | null; cost: number | null; createdAt: string;
  }>;
  const packageTier = (session as { packageTier: string }).packageTier ?? "standard";
  const currentStepIdx = getStepIndex(sessionStatus);
  const isGenerating = ["preview_generating", "final_generating", "quality_check", "planning"].includes(sessionStatus);
  const isReadyForSelection = ["preview_ready", "waiting_customer"].includes(sessionStatus);
  const isConceptSelected = sessionStatus === "concept_selected";
  const isCompleted = sessionStatus === "completed";
  const canSelectMore = isReadyForSelection || isGenerating;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0f]/90 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              className="text-white/40 hover:text-white transition-colors"
              onClick={() => navigate("/workspace/projects")}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-lg font-semibold">Preview Selection</h1>
              <p className="text-xs text-white/40">Session #{sessionId} · {TIER_LABELS[packageTier] ?? packageTier} tier</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge className={cn("text-xs", STATUS_LABELS[sessionStatus]?.color ?? "bg-white/10 text-white/60")}>
              {STATUS_LABELS[sessionStatus]?.label ?? sessionStatus}
            </Badge>
            {isGenerating && <Loader2 className="h-4 w-4 animate-spin text-violet-400" />}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Pipeline progress */}
        <div className="hidden md:flex items-center gap-0">
          {PIPELINE_STEPS.map((step, i) => {
            const stepIdx = getStepIndex(step.status);
            const done = currentStepIdx > stepIdx;
            const active = currentStepIdx === stepIdx;
            return (
              <div key={step.status} className="flex items-center flex-1">
                <div className={cn(
                  "flex-shrink-0 h-2 w-2 rounded-full",
                  done ? "bg-violet-500" : active ? "bg-violet-400 animate-pulse" : "bg-white/20",
                )} />
                <div className="flex-1 mx-1">
                  <div className={cn("h-0.5", done ? "bg-violet-500" : "bg-white/10")} />
                </div>
                {i === PIPELINE_STEPS.length - 1 && (
                  <div className={cn(
                    "flex-shrink-0 h-2 w-2 rounded-full",
                    done ? "bg-violet-500" : "bg-white/20",
                  )} />
                )}
              </div>
            );
          })}
        </div>
        <div className="hidden md:flex justify-between text-xs text-white/40">
          {PIPELINE_STEPS.map((step) => (
            <span key={step.status}>{step.label}</span>
          ))}
        </div>

        {/* Generating state */}
        {isGenerating && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-6 text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400 mx-auto" />
            <p className="text-violet-300 font-medium">
              {sessionStatus === "preview_generating" && "AI is generating your preview concepts…"}
              {sessionStatus === "final_generating" && "Rendering final high-resolution images…"}
              {sessionStatus === "quality_check" && "Running quality control…"}
              {sessionStatus === "planning" && "Preparing your creative brief…"}
            </p>
            <p className="text-white/40 text-sm">This page will auto-update when ready.</p>
          </div>
        )}

        {/* Preview concepts grid */}
        {concepts.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Preview Concepts</h2>
                <p className="text-sm text-white/50">
                  {isReadyForSelection
                    ? "Select the concept you'd like to develop into final images."
                    : isConceptSelected
                    ? "You've selected a concept. Generate final images when ready."
                    : "Review your AI-generated concepts below."}
                </p>
              </div>

              {isReadyForSelection && !isGenerating && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/50 hover:text-white border border-white/10"
                  onClick={() => morePreviewsMutation.mutate()}
                  disabled={morePreviewsMutation.isPending}
                >
                  {morePreviewsMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                    : <RefreshCcw className="h-3.5 w-3.5 mr-2" />}
                  More concepts
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {concepts.map((concept) => (
                <ConceptCard
                  key={concept.id}
                  concept={concept}
                  selected={selectedConceptId === concept.id}
                  favorited={favorites.has(concept.id)}
                  onSelect={(id) => {
                    setSelectedConceptId((prev) => prev === id ? null : id);
                    setShowFeedback(true);
                  }}
                  onFavorite={(id) => setFavorites((prev) => {
                    const next = new Set(prev);
                    next.has(id) ? next.delete(id) : next.add(id);
                    return next;
                  })}
                  disabled={!isReadyForSelection || selectMutation.isPending}
                />
              ))}
            </div>
          </div>
        )}

        {/* Concept selection action */}
        {selectedConceptId && isReadyForSelection && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-violet-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-violet-300">Concept {concepts.find((c) => c.id === selectedConceptId)?.conceptIndex ?? selectedConceptId} selected</p>
                <p className="text-sm text-white/50 mt-0.5">
                  Add any optional direction, then confirm your selection.
                </p>
              </div>
            </div>

            {showFeedback && (
              <div className="space-y-2">
                <label className="text-sm text-white/60 flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Direction / feedback (optional)
                </label>
                <Textarea
                  placeholder="e.g. 'Make it warmer and more vibrant. Emphasize the product more.'"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none h-20"
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={() => {
                  if (!selectedConceptId) return;
                  selectMutation.mutate({ conceptId: selectedConceptId, fb: feedback || undefined });
                }}
                disabled={selectMutation.isPending}
                className="bg-violet-600 hover:bg-violet-500 text-white"
              >
                {selectMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Confirming…</>
                  : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirm Selection</>}
              </Button>
              <Button
                variant="ghost"
                className="text-white/40 hover:text-white"
                onClick={() => { setSelectedConceptId(null); setShowFeedback(false); setFeedback(""); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Generate final action */}
        {isConceptSelected && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-emerald-400 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-300">Concept confirmed!</p>
                <p className="text-sm text-white/50 mt-0.5">
                  Ready to generate your final high-resolution images. This uses the {TIER_LABELS[packageTier]} model for best quality.
                </p>
              </div>
            </div>
            <Button
              onClick={() => finalMutation.mutate()}
              disabled={finalMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {finalMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Starting…</>
                : <><Zap className="h-4 w-4 mr-2" />Generate Final Images</>}
            </Button>
          </div>
        )}

        {/* Final assets */}
        {finalAssets.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              Final Images
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {finalAssets.map((asset) => (
                <div key={asset.id} className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                  <div className="aspect-square bg-white/5 relative">
                    {asset.status === "generating" ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                      </div>
                    ) : asset.imageUrl ? (
                      <img src={asset.imageUrl} alt="Final render" className="w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-white/20" />
                      </div>
                    )}
                    {asset.qcScore != null && (
                      <div className="absolute bottom-2 right-2 bg-black/70 rounded-lg px-2 py-0.5 text-xs text-white">
                        QC {asset.qcScore}/100
                      </div>
                    )}
                  </div>
                  {asset.qcNotes && (
                    <div className="p-3">
                      <p className="text-xs text-white/50 leading-relaxed">{asset.qcNotes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost summary */}
        {(isCompleted || finalAssets.length > 0) && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-medium text-white/70 mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Cost Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Preview", value: (session as { previewCostUsd?: number }).previewCostUsd },
                { label: "Final Render", value: (session as { finalCostUsd?: number }).finalCostUsd },
                { label: "QC", value: (session as { qcCostUsd?: number }).qcCostUsd },
                { label: "Total", value: (session as { totalCostUsd?: number }).totalCostUsd },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-xs text-white/40">{label}</p>
                  <p className="text-lg font-semibold text-white">${(value ?? 0).toFixed(4)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
