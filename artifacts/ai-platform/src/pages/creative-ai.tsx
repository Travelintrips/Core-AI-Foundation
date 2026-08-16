import { useState, useCallback, useEffect } from "react";
import { InteriorDesignEditor } from "@/components/interior-design/InteriorDesignEditor";
import { InteriorConceptOutput } from "@/components/interior-design/InteriorConceptOutput";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCreativeBrief,
  useListCreativeProjects,
  useGetCreativeProject,
  useListProjectFeedback,
  useSubmitProjectFeedback,
  useGenerateImageConcepts,
  useListProjectAssets,
  useUpdateAssetStatus,
  useSubmitAssetFeedback,
  useGetCreativeImageAnalytics,
  getListCreativeProjectsQueryKey,
  getGetCreativeProjectQueryKey,
  getListProjectFeedbackQueryKey,
  getListProjectAssetsQueryKey,
  useCreateClientReviewLink,
  useListClientReviews,
  useRevokeClientReview,
  useListReviewComments,
  getListClientReviewsQueryKey,
  getListReviewCommentsQueryKey,
  useGetProjectQuotation,
  useSaveProjectQuotation,
  useSendProjectQuotation,
  getProjectQuotationQueryKey,
  type CreativeProject,
  type CreativeProjectDetail,
  type FeedbackEntry,
  type CreativeAiAsset,
  type ClientReview,
  type ClientComment,
  type QuotationLineItemInput,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sparkles,
  Plus,
  Clock,
  Cpu,
  Copy,
  Check,
  Download,
  Loader2,
  Zap,
  FileText,
  Palette,
  ShieldCheck,
  AlertCircle,
  CircleDot,
  CheckCircle2,
  XCircle,
  Hash,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Star,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  BanIcon,
  ImageIcon,
  ImageOff,
  Wand2,
  ExternalLink,
  Link2,
  UserCheck,
  ShieldOff,
  CalendarClock,
  Send,
  Eye,
  Trash2,
  Receipt,
  Home,
  Sofa,
  Layers,
  Lightbulb,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { slug: "brand-strategist",  label: "Brand Strategy",    icon: Zap },
  { slug: "creative-director", label: "Creative Direction", icon: Palette },
  { slug: "copywriter",        label: "Copy Production",    icon: FileText },
  { slug: "quality-control",   label: "Quality Control",    icon: ShieldCheck },
];

const STEP_NAME_MAP: Record<string, string> = {
  "brand-strategist":           "Brand Strategy",
  "creative-director":          "Creative Direction",
  "copywriter":                 "Copy Production",
  "quality-control":            "Quality Control",
  "fashion-design-specialist":  "Fashion Specialist",
  "interior-design-specialist": "Interior Specialist",
};

/** Specialist agents — displayed separately from the main pipeline */
const SPECIALIST_AGENTS = [
  {
    slug:  "fashion-design-specialist",
    label: "Fashion Design Specialist",
    model: "Claude Opus 4.8",
    provider: "Anthropic",
    color: "from-rose-500/10 to-pink-500/10 border-rose-500/20",
    iconColor: "text-rose-400",
    description: "Koleksi fashion, brand storytelling, editorial copywriting, dan fashion brand strategy.",
    capabilities: ["Collection Brief", "Fashion Copywriting", "Brand Strategy", "Trend Research"],
  },
  {
    slug:  "interior-design-specialist",
    label: "Interior Design Specialist",
    model: "Gemini 2.5 Pro",
    provider: "Google",
    color: "from-teal-500/10 to-emerald-500/10 border-teal-500/20",
    iconColor: "text-teal-400",
    description: "Konsep spasial, spesifikasi material, proposal klien, dan interior brand identity.",
    capabilities: ["Spatial Concept", "Material Spec", "Client Proposal", "Style Direction"],
  },
];

// ── Interior step detection ────────────────────────────────────────────────────

/** Step names exclusively used by the Interior Design workflow */
const INTERIOR_STEP_NAMES = new Set([
  "Design Concept",
  "Space Planning",
  "Material Specification",
  "Design Copy",
  "Interior Quality Control",
]);

/** Derive the best-fit Lucide icon from a step name */
function getStepIcon(stepName: string): typeof Zap {
  const lower = stepName.toLowerCase();
  if (lower.includes("concept") || lower.includes("architect")) return Layers;
  if (lower.includes("space") || lower.includes("plan")) return Home;
  if (lower.includes("material") || lower.includes("specification")) return Palette;
  if (lower.includes("light")) return Lightbulb;
  if (lower.includes("furniture") || lower.includes("placement") || lower.includes("sofa")) return Sofa;
  if (lower.includes("quality") || lower.includes("control") || lower.includes("qc")) return ShieldCheck;
  if (lower.includes("copy") || lower.includes("writing") || lower.includes("brief")) return FileText;
  if (lower.includes("strategy") || lower.includes("brand")) return Zap;
  if (lower.includes("direction") || lower.includes("creative") || lower.includes("color")) return Palette;
  if (lower.includes("trend") || lower.includes("fashion") || lower.includes("collection")) return Sparkles;
  return FileText;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "completed":        return "bg-green-500/15 text-green-400 border-green-500/30";
    case "running":          return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "generating_document": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "generating_presentation": return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "failed":           return "bg-red-500/15 text-red-400 border-red-500/30";
    case "blocked_by_budget": return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    default:                 return "bg-muted text-muted-foreground border-border";
  }
}

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = cn("size-4 shrink-0", className);
  switch (status) {
    case "completed":        return <CheckCircle2 className={cn(cls, "text-green-400")} />;
    case "running":          return <Loader2 className={cn(cls, "text-blue-400 animate-spin")} />;
    case "generating_document": return <Loader2 className={cn(cls, "text-blue-400 animate-spin")} />;
    case "generating_presentation": return <Loader2 className={cn(cls, "text-blue-400 animate-spin")} />;
    case "failed":           return <XCircle className={cn(cls, "text-red-400")} />;
    case "blocked_by_budget": return <BanIcon className={cn(cls, "text-orange-400")} />;
    default:                 return <CircleDot className={cn(cls, "text-muted-foreground")} />;
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <Button variant="ghost" size="icon" className="size-7" onClick={handleCopy} title="Copy">
      {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(null)}
          className="p-0.5 transition-transform hover:scale-110"
        >
          <Star
            className={cn(
              "size-3.5 transition-colors",
              (hovered ?? value ?? 0) >= n ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function renderOutput(output: Record<string, unknown> | null | undefined) {
  if (!output || Object.keys(output).length === 0) return null;
  if ("raw" in output && typeof output.raw === "string") {
    return <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">{output.raw}</pre>;
  }
  return (
    <div className="space-y-3">
      {Object.entries(output).map(([key, value]) => {
        if (value === null || value === undefined) return null;
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (Array.isArray(value)) {
          return (
            <div key={key}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</p>
              <ul className="space-y-1">
                {value.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                    <span className="text-primary mt-0.5">•</span>
                    <span>{typeof item === "string" ? item : JSON.stringify(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (typeof value === "object") {
          return (
            <div key={key}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</p>
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap bg-muted/30 rounded p-2">{JSON.stringify(value, null, 2)}</pre>
            </div>
          );
        }
        return (
          <div key={key}>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{String(value)}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Brief Form ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  brandName: "", businessType: "", targetMarket: "",
  productOrService: "", stylePreference: "", goal: "", notes: "",
  language: "id",
};

interface BriefFormProps {
  onSubmit: (data: typeof EMPTY_FORM) => Promise<void>;
  isLoading: boolean;
  onCancel?: () => void;
}

function BriefForm({ onSubmit, isLoading, onCancel }: BriefFormProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const field = (k: keyof typeof EMPTY_FORM) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [k]: e.target.value })),
  });
  const handleSubmit = async (e: React.FormEvent) => { e.preventDefault(); await onSubmit(form); setForm(EMPTY_FORM); };
  const required = form.brandName && form.businessType && form.targetMarket && form.productOrService && form.goal;
  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="brandName" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Brand Name <span className="text-red-400">*</span></Label>
          <Input id="brandName" placeholder="e.g. Lumina Coffee" className="h-8 text-sm font-mono" {...field("brandName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessType" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Business Type <span className="text-red-400">*</span></Label>
          <Input id="businessType" placeholder="e.g. Specialty Coffee Roaster" className="h-8 text-sm font-mono" {...field("businessType")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="targetMarket" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Target Market <span className="text-red-400">*</span></Label>
          <Input id="targetMarket" placeholder="e.g. Urban millennials 25-35" className="h-8 text-sm font-mono" {...field("targetMarket")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="productOrService" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Product / Service <span className="text-red-400">*</span></Label>
          <Input id="productOrService" placeholder="e.g. Single-origin espresso beans" className="h-8 text-sm font-mono" {...field("productOrService")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="goal" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Campaign Goal <span className="text-red-400">*</span></Label>
          <Input id="goal" placeholder="e.g. Launch brand awareness campaign" className="h-8 text-sm font-mono" {...field("goal")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stylePreference" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Style Preference</Label>
          <Input id="stylePreference" placeholder="e.g. Minimalist, earthy, premium" className="h-8 text-sm font-mono" {...field("stylePreference")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Bahasa Output <span className="text-red-400">*</span></Label>
          <Select value={form.language} onValueChange={(v) => setForm((prev) => ({ ...prev, language: v }))}>
            <SelectTrigger className="h-8 text-sm font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="id" className="font-mono text-sm">🇮🇩 Bahasa Indonesia</SelectItem>
              <SelectItem value="en" className="font-mono text-sm">🇬🇧 English</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Additional Notes</Label>
          <Textarea id="notes" rows={1} placeholder="Context tambahan, constraint, inspirasi..." className="text-sm font-mono resize-none" {...field("notes")} />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={!required || isLoading} className="gap-2 font-mono">
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {isLoading ? "Generating…" : "Generate Creative Brief"}
        </Button>
        {onCancel && <Button type="button" variant="ghost" className="font-mono" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

// ── Feedback Bar ───────────────────────────────────────────────────────────────

interface FeedbackBarProps {
  projectId: string;
  stepId?: number;
  stepName: string;
  stepOutput: Record<string, unknown> | null | undefined;
  existingFeedback: FeedbackEntry[];
  onSubmit: (data: {
    stepId?: number;
    stepName: string;
    action: "approve" | "reject" | "needs_revision" | "human_edit";
    rating?: number | null;
    feedbackText?: string | null;
    originalOutput?: Record<string, unknown> | null;
  }) => Promise<void>;
}

function FeedbackBar({ projectId: _projectId, stepId, stepName, stepOutput, existingFeedback, onSubmit }: FeedbackBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const lastFeedback = existingFeedback.at(0);
  const actionColor: Record<string, string> = {
    approve: "text-green-400",
    reject: "text-red-400",
    needs_revision: "text-yellow-400",
    human_edit: "text-blue-400",
  };

  const handleAction = async (action: "approve" | "reject" | "needs_revision" | "human_edit") => {
    setSubmitting(true);
    try {
      await onSubmit({
        stepId,
        stepName,
        action,
        rating: rating ?? null,
        feedbackText: comment.trim() || null,
        originalOutput: (stepOutput as Record<string, unknown>) ?? null,
      });
      setExpanded(false);
      setRating(null);
      setComment("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-t border-border/30 bg-background/30">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          {lastFeedback ? (
            <div className="flex items-center gap-1.5">
              <span className={cn("text-[10px] font-mono font-semibold uppercase", actionColor[lastFeedback.action] ?? "text-muted-foreground")}>
                {lastFeedback.action.replace(/_/g, " ")}
              </span>
              {lastFeedback.rating != null && (
                <div className="flex gap-0.5">
                  {[1,2,3,4,5].map(n => (
                    <Star key={n} className={cn("size-2.5", n <= lastFeedback.rating! ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/30")} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[10px] font-mono text-muted-foreground/50">No feedback yet</span>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="size-3" />
          {lastFeedback ? "Update" : "Review"}
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-border/20">
          <div className="flex items-center gap-2 pt-2">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Rating</span>
            <StarRating value={rating} onChange={setRating} />
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional feedback comment…"
            rows={2}
            className="text-xs font-mono resize-none bg-muted/30"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs font-mono border-green-500/30 text-green-400 hover:bg-green-500/10"
              onClick={() => handleAction("approve")}
              disabled={submitting}
            >
              <ThumbsUp className="size-3" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs font-mono border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
              onClick={() => handleAction("needs_revision")}
              disabled={submitting}
            >
              <RotateCcw className="size-3" /> Needs Revision
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs font-mono border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => handleAction("reject")}
              disabled={submitting}
            >
              <ThumbsDown className="size-3" /> Reject
            </Button>
            {submitting && <Loader2 className="size-3.5 text-muted-foreground animate-spin ml-1" />}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step Card ──────────────────────────────────────────────────────────────────

interface StepCardProps {
  stepDef: { label: string; icon: typeof Zap };
  step?: {
    id?: number;
    status: string;
    output?: Record<string, unknown> | null;
    model?: string | null;
    provider?: string | null;
    tokenUsage?: number;
    latencyMs?: number | null;
    errorMessage?: string | null;
  };
  projectStatus: string;
  index: number;
  totalSteps: number;
  projectId: string;
  stepFeedback: FeedbackEntry[];
  onFeedback: (data: Parameters<FeedbackBarProps["onSubmit"]>[0]) => Promise<void>;
}

function StepCard({ stepDef, step, projectStatus, index, totalSteps, projectId: _projectId, stepFeedback, onFeedback }: StepCardProps) {
  const Icon = stepDef.icon;
  const effectiveStatus = step?.status ?? "pending";
  const isRunning = effectiveStatus === "running" || (projectStatus === "running" && !step);
  const isBudgetBlocked = effectiveStatus === "blocked_by_budget";
  const outputStr = step?.output ? JSON.stringify(step.output, null, 2) : "";
  const showFeedback = effectiveStatus === "completed";

  const borderClass =
    effectiveStatus === "completed"      ? "border-green-500/20 bg-green-500/5" :
    isRunning                            ? "border-blue-500/20 bg-blue-500/5" :
    effectiveStatus === "failed"         ? "border-red-500/20 bg-red-500/5" :
    isBudgetBlocked                      ? "border-orange-500/20 bg-orange-500/5" :
    "border-border/50 bg-muted/10";

  const iconBorderClass =
    effectiveStatus === "completed"      ? "border-green-500/30 bg-green-500/10" :
    isRunning                            ? "border-blue-500/30 bg-blue-500/10" :
    effectiveStatus === "failed"         ? "border-red-500/30 bg-red-500/10" :
    isBudgetBlocked                      ? "border-orange-500/30 bg-orange-500/10" :
    "border-border bg-muted/30";

  const iconClass =
    effectiveStatus === "completed"  ? "text-green-400" :
    effectiveStatus === "failed"     ? "text-red-400" :
    isBudgetBlocked                  ? "text-orange-400" :
    "text-muted-foreground";

  return (
    <div className={cn("border rounded-lg transition-colors overflow-hidden", borderClass)}>
      {/* Step header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn("size-7 rounded border flex items-center justify-center shrink-0", iconBorderClass)}>
            {isRunning
              ? <Loader2 className="size-3.5 text-blue-400 animate-spin" />
              : <Icon className={cn("size-3.5", iconClass)} />
            }
          </div>
          <div>
            <p className="text-sm font-medium font-mono">{stepDef.label}</p>
            <p className="text-[10px] text-muted-foreground font-mono">Step {index + 1} of {totalSteps}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {step?.model && (
            <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground gap-1 px-1.5 h-5">
              <Cpu className="size-2.5" />{step.model}
            </Badge>
          )}
          {step?.latencyMs != null && (
            <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground gap-1 px-1.5 h-5">
              <Clock className="size-2.5" />{(step.latencyMs / 1000).toFixed(1)}s
            </Badge>
          )}
          {step?.tokenUsage != null && step.tokenUsage > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground gap-1 px-1.5 h-5">
              <Hash className="size-2.5" />{step.tokenUsage}
            </Badge>
          )}
          {stepFeedback.length > 0 && (
            <div className={cn("size-1.5 rounded-full",
              stepFeedback[0].action === "approve" ? "bg-green-500" :
              stepFeedback[0].action === "reject"  ? "bg-red-500" :
              "bg-yellow-500"
            )} title={`Reviewed: ${stepFeedback[0].action}`} />
          )}
          <StatusIcon status={isRunning ? "running" : effectiveStatus} />
        </div>
      </div>

      {/* Budget blocked banner */}
      {isBudgetBlocked && (
        <>
          <Separator className="opacity-30" />
          <div className="px-4 py-3 flex items-start gap-2 bg-orange-500/5">
            <BanIcon className="size-3.5 text-orange-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-mono text-orange-400 font-semibold">Budget Limit Reached</p>
              {step?.errorMessage && (
                <p className="text-[11px] font-mono text-orange-300/80 mt-0.5">{step.errorMessage}</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Output */}
      {step?.output && Object.keys(step.output).length > 0 && !("_blocked" in (step.output ?? {})) && (
        <>
          <Separator className="opacity-30" />
          <div className="px-4 py-3 relative">
            <div className="absolute top-2 right-3">
              <CopyButton text={outputStr} />
            </div>
            {renderOutput(step.output as Record<string, unknown>)}
          </div>
        </>
      )}

      {/* Error (non-budget) */}
      {step?.errorMessage && !isBudgetBlocked && (
        <>
          <Separator className="opacity-30" />
          <div className="px-4 py-3 flex items-start gap-2">
            <AlertCircle className="size-3.5 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs font-mono text-red-400">{step.errorMessage}</p>
          </div>
        </>
      )}

      {/* Human Feedback Bar */}
      {showFeedback && (
        <FeedbackBar
          projectId={_projectId}
          stepId={step?.id}
          stepName={stepDef.label}
          stepOutput={step?.output}
          existingFeedback={stepFeedback}
          onSubmit={onFeedback}
        />
      )}
    </div>
  );
}

// ── Project List Item ──────────────────────────────────────────────────────────

function ProjectListItem({ project, isActive, onClick }: { project: CreativeProject; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-md transition-colors group",
        isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-sidebar-accent border border-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs font-semibold truncate text-foreground">{project.brandName}</span>
        <div className={cn("size-1.5 rounded-full shrink-0",
          project.status === "completed" ? "bg-green-500" :
          project.status === "running"   ? "bg-blue-500 animate-pulse" :
          project.status === "generating_document" ? "bg-blue-500 animate-pulse" :
          project.status === "generating_presentation" ? "bg-blue-500 animate-pulse" :
          project.status === "failed"    ? "bg-red-500" : "bg-muted-foreground",
        )} />
      </div>
      <p className="font-mono text-[10px] text-muted-foreground truncate">{project.businessType}</p>
      <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">{format(new Date(project.createdAt), "MMM d, HH:mm")}</p>
    </button>
  );
}

// ── Image Concepts Section ─────────────────────────────────────────────────────

function assetStatusColor(status: string) {
  switch (status) {
    case "approved":       return "bg-green-500/15 text-green-400 border-green-500/30";
    case "completed":      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "generating":     return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "failed":         return "bg-red-500/15 text-red-400 border-red-500/30";
    case "needs_revision": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "rejected":       return "bg-red-500/15 text-red-500 border-red-500/30";
    default:               return "bg-muted text-muted-foreground border-border";
  }
}

type InteriorVisualRole =
  | "hero_concept"
  | "moodboard"
  | "material_reference"
  | "furniture_reference"
  | "lighting_reference";

const INTERIOR_ROLE_LABELS: Record<InteriorVisualRole, string> = {
  hero_concept: "Hero concept render",
  moodboard: "Moodboard collage",
  material_reference: "Material references",
  furniture_reference: "Furniture references",
  lighting_reference: "Lighting references",
};

function interiorAssetRole(asset: CreativeAiAsset): InteriorVisualRole | null {
  const metadata = asset.metadata as Record<string, unknown> | null | undefined;
  const role = metadata?.conceptRole;
  return typeof role === "string" && role in INTERIOR_ROLE_LABELS
    ? role as InteriorVisualRole
    : null;
}

function interiorAssetGenerationStatus(asset: CreativeAiAsset): string {
  const metadata = asset.metadata as Record<string, unknown> | null | undefined;
  return typeof metadata?.generationStatus === "string"
    ? metadata.generationStatus
    : asset.status;
}

function InteriorVisualGallery({
  assets,
  onRetry,
  retrying,
}: {
  assets: CreativeAiAsset[];
  onRetry: (assetId: number) => Promise<void>;
  retrying: number | null;
}) {
  const [lightbox, setLightbox] = useState<CreativeAiAsset | null>(null);
  const visualAssets = assets.filter((asset) => interiorAssetRole(asset));
  const hero = visualAssets.find((asset) => interiorAssetRole(asset) === "hero_concept");
  const moodboard = visualAssets.find((asset) => interiorAssetRole(asset) === "moodboard");
  const references = visualAssets.filter((asset) =>
    ["material_reference", "furniture_reference", "lighting_reference"].includes(interiorAssetRole(asset) ?? ""),
  );
  const isGenerating = visualAssets.some((asset) =>
    ["generating", "pending"].includes(asset.status) || interiorAssetGenerationStatus(asset) === "generating_visual",
  );
  const hasFailed = visualAssets.length > 0 && visualAssets.every((asset) =>
    ["failed", "visual_failed"].includes(interiorAssetGenerationStatus(asset)),
  );
  const imageErrorFallback = (asset: CreativeAiAsset) => (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 bg-muted/20 p-5 text-center">
      <ImageOff className="size-7 text-muted-foreground/70" />
      <p className="text-xs font-medium text-foreground/80">Visual tidak dapat dimuat</p>
      <p className="text-[10px] text-muted-foreground">Coba generate ulang asset ini.</p>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-[10px]"
        onClick={() => void onRetry(asset.id)}
        disabled={retrying === asset.id}
      >
        {retrying === asset.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
        Retry
      </Button>
    </div>
  );
  const renderImage = (asset: CreativeAiAsset, className: string) => (
    <img
      src={asset.imageUrl ?? undefined}
      alt={`${INTERIOR_ROLE_LABELS[interiorAssetRole(asset)!]} for the approved interior design concept`}
      className={className}
      onError={(event) => {
        event.currentTarget.style.display = "none";
        event.currentTarget.parentElement?.querySelector("[data-image-fallback]")?.removeAttribute("hidden");
      }}
      loading="lazy"
    />
  );
  const renderAsset = (asset: CreativeAiAsset, className: string) => {
    const role = interiorAssetRole(asset)!;
    const status = interiorAssetGenerationStatus(asset);
    const ready = Boolean(asset.imageUrl) && !["generating", "pending", "failed", "visual_failed"].includes(status);
    return (
      <div className="relative h-full min-h-[180px] overflow-hidden bg-muted/20">
        {ready ? renderImage(asset, className) : null}
        <div data-image-fallback hidden={ready ? undefined : false} className="h-full">
          {ready ? null : status === "generating_visual" || status === "generating" || status === "pending" ? (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 p-5 text-center">
              <div className="size-9 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
              <p className="text-xs font-medium">Sedang membuat visual konsep…</p>
              <p className="text-[10px] text-muted-foreground">Setiap visual akan tersimpan permanen setelah selesai.</p>
            </div>
          ) : imageErrorFallback(asset)}
        </div>
        {ready && (
          <button
            type="button"
            className="absolute inset-0 cursor-zoom-in bg-black/0 transition-colors hover:bg-black/15"
            aria-label={`Open ${INTERIOR_ROLE_LABELS[role]} fullscreen`}
            onClick={() => setLightbox(asset)}
          />
        )}
      </div>
    );
  };

  if (visualAssets.length === 0) return null;

  return (
    <div className="mt-4 space-y-4" data-testid="interior-visual-gallery">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-mono font-semibold text-teal-300">Visual Concept Presentation</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Approved concept visuals, organized by design role.</p>
        </div>
        <Badge variant="outline" className={cn("text-[10px] font-mono", hasFailed ? "border-red-500/30 text-red-300" : isGenerating ? "border-blue-500/30 text-blue-300" : "border-teal-500/30 text-teal-300")}>
          {hasFailed ? "Visual failed" : isGenerating ? "Generating visual" : "Visual ready"}
        </Badge>
      </div>

      {hero && (
        <div className="overflow-hidden rounded-xl border border-teal-500/25 bg-card/50">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-teal-300">{INTERIOR_ROLE_LABELS.hero_concept}</span>
            <span className="text-[10px] text-muted-foreground">Click image to enlarge</span>
          </div>
          <div className="aspect-[16/8] min-h-[220px]">{renderAsset(hero, "h-full w-full object-cover")}</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        {moodboard && (
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/40">
            <div className="border-b border-border/40 px-3 py-2 text-[10px] font-mono font-semibold uppercase tracking-wider text-foreground/80">{INTERIOR_ROLE_LABELS.moodboard}</div>
            <div className="aspect-[4/3]">{renderAsset(moodboard, "h-full w-full object-cover")}</div>
          </div>
        )}
        {references.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-card/40 p-3">
            <p className="mb-3 text-[10px] font-mono font-semibold uppercase tracking-wider text-foreground/80">Material, furniture &amp; lighting</p>
            <div className="grid grid-cols-2 gap-2">
              {references.map((asset) => (
                <div key={asset.id} className="overflow-hidden rounded-lg border border-border/40 bg-muted/10">
                  <div className="aspect-square">{renderAsset(asset, "h-full w-full object-cover")}</div>
                  <div className="px-2 py-1.5 text-[9px] leading-tight text-muted-foreground">{INTERIOR_ROLE_LABELS[interiorAssetRole(asset)!]}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => { if (!open) setLightbox(null); }}>
        <DialogContent className="max-w-5xl border-border/60 bg-background/95 p-2 sm:p-3">
          <DialogHeader className="px-2 pt-1">
            <DialogTitle className="text-xs font-mono">{lightbox ? INTERIOR_ROLE_LABELS[interiorAssetRole(lightbox)!] : "Interior visual"}</DialogTitle>
          </DialogHeader>
          {lightbox?.imageUrl && (
            <img
              src={lightbox.imageUrl}
              alt={`${INTERIOR_ROLE_LABELS[interiorAssetRole(lightbox)!]} fullscreen preview`}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          )}
          {lightbox?.imageUrl && (
            <div className="flex justify-end px-2 pb-1">
              <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-[10px]">
                <a href={lightbox.imageUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3" /> Open permanent image
                </a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface AssetCardProps {
  asset: CreativeAiAsset;
  onApprove: (id: number) => void;
  onRevision: (id: number, note: string) => Promise<void>;
  onReject: (id: number) => void;
  isUpdating: boolean;
}

function AssetCard({ asset, onApprove, onRevision, onReject, isUpdating }: AssetCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showReviseDialog, setShowReviseDialog] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
  const [revising, setRevising] = useState(false);

  const handleReviseSubmit = async () => {
    if (!reviseNote.trim()) return;
    setRevising(true);
    try {
      await onRevision(asset.id, reviseNote.trim());
      setShowReviseDialog(false);
      setReviseNote("");
    } finally {
      setRevising(false);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(asset.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const qcColor = asset.qcScore == null ? "text-muted-foreground"
    : asset.qcScore >= 80 ? "text-green-400"
    : asset.qcScore >= 60 ? "text-yellow-400"
    : "text-red-400";
  const assetMetadata = asset.metadata as Record<string, unknown> | null | undefined;
  const pipelineStage = assetMetadata?.pipelineStage;
  const isPromptGenerating = pipelineStage === "prompt_generation";
  const generationError = typeof assetMetadata?.generationError === "string"
    ? assetMetadata.generationError.replace(/^Error:\s*/i, "")
    : null;

  return (
    <div className="border border-border/50 rounded-lg bg-card/40 overflow-hidden">
      {/* Image area */}
      <div className="relative aspect-square bg-muted/20 flex items-center justify-center min-h-[160px]">
        {asset.imageUrl ? (
          <img
            src={asset.imageUrl}
            alt={`Generated visual — ${asset.prompt.slice(0, 60)}…`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : asset.status === "generating" ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="size-8 animate-spin text-primary" />
            <span className="text-[10px] font-mono">
              {isPromptGenerating ? "Preparing prompt…" : "Generating…"}
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageOff className="size-8 opacity-40" />
            <span className="text-[10px] font-mono text-center px-3 leading-relaxed">
              {generationError
                ? `Generation failed: ${generationError}`
                : asset.qcNotes?.includes("REPLICATE_API_TOKEN")
                ? "Set REPLICATE_API_TOKEN to generate images"
                : "Generation failed"}
            </span>
          </div>
        )}
        {/* Status overlay badge */}
        <div className="absolute top-2 right-2">
          <Badge className={cn("text-[9px] border font-mono px-1.5 py-0", assetStatusColor(asset.status))}>
            {asset.status.replace(/_/g, " ")}
          </Badge>
        </div>
        {/* Open full size */}
        {asset.imageUrl && (
          <a
            href={asset.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-2 left-2 size-6 flex items-center justify-center rounded bg-black/50 hover:bg-black/70 transition-colors"
          >
            <ExternalLink className="size-3 text-white" />
          </a>
        )}
      </div>

      {/* Meta */}
      <div className="p-3 space-y-2">
        {/* Provider / model / cost / latency */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1">
            <Cpu className="size-2.5" />{asset.provider}/{asset.model.split("/").pop()}
          </span>
          {asset.cost != null && (
            <span>${Number(asset.cost).toFixed(4)}</span>
          )}
          {asset.latencyMs != null && asset.latencyMs > 0 && (
            <span><Clock className="size-2.5 inline" /> {(asset.latencyMs / 1000).toFixed(1)}s</span>
          )}
          {asset.aspectRatio && (
            <span>{asset.aspectRatio}</span>
          )}
        </div>

        {/* QC score */}
        {asset.qcScore != null && (
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-muted-foreground">QC Score</span>
            <span className={cn("font-semibold", qcColor)}>{asset.qcScore}/100</span>
          </div>
        )}

        {/* QC notes (collapsible) */}
        <button
          onClick={() => setShowPrompt((v) => !v)}
          className="w-full flex items-center justify-between text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>{asset.qcNotes ? "Notes / Prompt" : "View Prompt"}</span>
          {showPrompt ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </button>
        {showPrompt && (
          <div className="space-y-1.5">
            {asset.qcNotes && (
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed bg-muted/30 rounded p-2">
                {asset.qcNotes}
              </p>
            )}
            <div className="relative">
              <p className="text-[10px] font-mono text-foreground/70 leading-relaxed bg-muted/20 rounded p-2 pr-7 line-clamp-3">
                {asset.prompt}
              </p>
              <button
                onClick={handleCopyPrompt}
                className="absolute top-1.5 right-1.5 size-5 flex items-center justify-center rounded hover:bg-muted/50"
                title="Copy prompt"
              >
                {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3 text-muted-foreground" />}
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-1 pt-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={isUpdating || asset.status === "approved"}
            onClick={() => onApprove(asset.id)}
            className="flex-1 h-7 gap-1 text-[10px] font-mono text-green-400 hover:text-green-300 hover:bg-green-500/10"
          >
            <ThumbsUp className="size-3" />Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isUpdating || asset.status === "generating"}
            onClick={() => setShowReviseDialog(true)}
            className="flex-1 h-7 gap-1 text-[10px] font-mono text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
          >
            <RotateCcw className="size-3" />Revise
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isUpdating || asset.status === "rejected"}
            onClick={() => onReject(asset.id)}
            className="flex-1 h-7 gap-1 text-[10px] font-mono text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <ThumbsDown className="size-3" />Reject
          </Button>
        </div>
      </div>
      {/* Revision dialog */}
      <Dialog open={showReviseDialog} onOpenChange={(open) => { if (!revising) { setShowReviseDialog(open); if (!open) setReviseNote(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-mono">Instruksi Revisi</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            Deskripsikan perubahan yang diinginkan. AI akan menyesuaikan prompt lalu generate ulang — misalnya: <span className="text-foreground/60">"pindahkan logo ke tengah", "warna lebih gelap", "teks judul lebih besar"</span>.
          </p>
          <Textarea
            value={reviseNote}
            onChange={(e) => setReviseNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { void handleReviseSubmit(); } }}
            placeholder="contoh: logo di pojok kiri atas, latar belakang lebih terang, komposisi portrait..."
            className="text-xs font-mono resize-none min-h-[80px]"
            autoFocus
            disabled={revising}
          />
          <DialogFooter className="gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setShowReviseDialog(false); setReviseNote(""); }}
              disabled={revising}
            >
              Batal
            </Button>
            <Button
              size="sm"
              onClick={handleReviseSubmit}
              disabled={revising || !reviseNote.trim()}
              className="gap-1.5"
            >
              {revising ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
              {revising ? "Generating…" : "Generate Ulang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Client Review Section ──────────────────────────────────────────────────────

function ClientReviewSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [freshToken, setFreshToken] = useState<{ token: string; id: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ clientName: "", clientEmail: "", clientPhone: "", expiresInDays: 7 });
  const [resendingId, setResendingId] = useState<number | null>(null);

  const { data: reviews = [] } = useListClientReviews(projectId, {
    query: { queryKey: getListClientReviewsQueryKey(projectId) },
  });
  const { data: comments = [] } = useListReviewComments(projectId, {
    query: { queryKey: getListReviewCommentsQueryKey(projectId) },
  });

  const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
  const adminHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
  };
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

  // Auto-fill form with customer data from service request when form opens
  const handleOpenCreate = async () => {
    setShowCreate(true);
    try {
      const res = await fetch(`/api/creative-ai/projects/${projectId}/customer-info`, {
        headers: adminHeaders,
      });
      if (res.ok) {
        const data = (await res.json()) as { name: string; email: string; phone: string };
        setForm((f) => ({
          ...f,
          clientName: data.name || f.clientName,
          clientEmail: data.email || f.clientEmail,
          clientPhone: data.phone || f.clientPhone,
        }));
      }
    } catch {
      // silent — form stays empty, admin can fill manually
    }
  };

  const createLink = useCreateClientReviewLink({
    mutation: {
      onSuccess: (data) => {
        setFreshToken({ token: data.token!, id: data.id });
        setShowCreate(false);
        setForm({ clientName: "", clientEmail: "", clientPhone: "", expiresInDays: 7 });
        queryClient.invalidateQueries({ queryKey: getListClientReviewsQueryKey(projectId) });
        toast({ title: "Review link created — copy it now!" });
      },
      onError: () => toast({ title: "Failed to create review link", variant: "destructive" }),
    },
  });

  const revokeLink = useRevokeClientReview({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientReviewsQueryKey(projectId) });
        toast({ title: "Review link revoked" });
      },
      onError: () => toast({ title: "Failed to revoke", variant: "destructive" }),
    },
  });

  const handleResend = async (reviewId: number, clientEmail?: string | null) => {
    setResendingId(reviewId);
    try {
      const res = await fetch(`/api/creative-ai/client-reviews/${reviewId}/resend`, {
        method: "PATCH",
        headers: adminHeaders,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to resend");
      }
      const data = (await res.json()) as { token?: string };
      queryClient.invalidateQueries({ queryKey: getListClientReviewsQueryKey(projectId) });
      if (data.token) setFreshToken({ token: data.token, id: reviewId });
      toast({
        title: "Revision selesai — link baru sudah aktif",
        description: clientEmail
          ? `Email notifikasi dikirim ke ${clientEmail}`
          : "Salin link baru dan bagikan ke klien.",
      });
    } catch (err: unknown) {
      toast({
        title: "Gagal mengirim notifikasi",
        description: err instanceof Error ? err.message : "Coba lagi",
        variant: "destructive",
      });
    } finally {
      setResendingId(null);
    }
  };

  const publicBase =
    `${window.location.origin}${import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""}/review/creative/`;

  const handleCopyLink = (token: string) => {
    navigator.clipboard.writeText(publicBase + token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reviewStatusColor = (s: string) => {
    switch (s) {
      case "approved":           return "bg-green-500/15 text-green-400 border-green-500/30";
      case "rejected":           return "bg-red-500/15 text-red-400 border-red-500/30";
      case "revision_requested": return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
      case "viewed":             return "bg-blue-500/15 text-blue-400 border-blue-500/30";
      case "shared":             return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
      default:                   return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCheck className="size-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Client Review</span>
          {reviews.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-border/50 text-muted-foreground">
              {reviews.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => showCreate ? setShowCreate(false) : handleOpenCreate()}
          className="h-6 gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-primary"
        >
          <Link2 className="size-3" />
          Create Link
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-muted/10">
          <p className="text-[11px] font-mono text-muted-foreground">Generate a secure one-time link for your client.</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Client Name *</Label>
              <Input
                value={form.clientName}
                onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                placeholder="e.g. Jane Smith"
                className="h-7 text-xs font-mono mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Expires in (days)</Label>
              <Input
                type="number"
                value={form.expiresInDays}
                onChange={(e) => setForm((f) => ({ ...f, expiresInDays: parseInt(e.target.value) || 7 }))}
                min={1}
                max={90}
                className="h-7 text-xs font-mono mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Client Email</Label>
              <Input
                value={form.clientEmail}
                onChange={(e) => setForm((f) => ({ ...f, clientEmail: e.target.value }))}
                placeholder="client@example.com"
                className="h-7 text-xs font-mono mt-1"
              />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Phone</Label>
              <Input
                value={form.clientPhone}
                onChange={(e) => setForm((f) => ({ ...f, clientPhone: e.target.value }))}
                placeholder="+62..."
                className="h-7 text-xs font-mono mt-1"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!form.clientName || createLink.isPending}
              onClick={() =>
                createLink.mutate({
                  id: projectId,
                  data: {
                    clientName: form.clientName,
                    clientEmail: form.clientEmail || null,
                    clientPhone: form.clientPhone || null,
                    expiresInDays: form.expiresInDays,
                  },
                })
              }
              className="h-7 text-[10px] font-mono gap-1.5"
            >
              {createLink.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              Generate Link
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCreate(false)}
              className="h-7 text-[10px] font-mono"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Fresh token — shown once */}
      {freshToken && (
        <div className="border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-primary font-mono font-semibold">
            <AlertCircle className="size-3.5 shrink-0" />
            Copy this link now — it won't be shown again!
          </div>
          <div className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1.5">
            <span className="flex-1 font-mono text-[10px] text-foreground/80 truncate min-w-0">
              {publicBase}{freshToken.token}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              onClick={() => handleCopyLink(freshToken.token)}
            >
              {copied ? <Check className="size-3 text-green-400" /> : <Copy className="size-3" />}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFreshToken(null)}
            className="h-5 text-[10px] font-mono text-muted-foreground p-0"
          >
            I've saved the link — dismiss
          </Button>
        </div>
      )}

      {/* Existing reviews list */}
      {reviews.length > 0 && (
        <div className="space-y-2">
          {reviews.map((review) => (
            <div key={review.id} className="border border-border/40 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <UserCheck className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono font-medium truncate">{review.clientName}</span>
                  {review.clientEmail && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate hidden sm:block">
                      {review.clientEmail}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge
                    className={cn("text-[10px] border font-mono px-1.5 h-5", reviewStatusColor(review.status))}
                  >
                    {review.status.replace(/_/g, " ")}
                  </Badge>
                  {/* Revision Done button — only on revision_requested reviews */}
                  {review.status === "revision_requested" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 text-[10px] font-mono text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 px-2"
                      title={review.clientEmail ? `Kirim email notifikasi ke ${review.clientEmail}` : "Aktifkan link baru untuk klien"}
                      onClick={() => handleResend(review.id, review.clientEmail)}
                      disabled={resendingId === review.id}
                    >
                      {resendingId === review.id
                        ? <Loader2 className="size-3 animate-spin" />
                        : <Send className="size-3" />}
                      Revision Done
                    </Button>
                  )}
                  {!["revoked", "approved", "rejected", "expired"].includes(review.status) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-red-400"
                      title="Revoke link"
                      onClick={() => revokeLink.mutate({ reviewId: review.id })}
                      disabled={revokeLink.isPending}
                    >
                      <ShieldOff className="size-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarClock className="size-3" />
                  Expires {format(new Date(review.tokenExpiresAt), "MMM d, yyyy")}
                </span>
                {review.viewedAt && (
                  <span className="flex items-center gap-1 text-blue-400">
                    <Eye className="size-3" />
                    Viewed {format(new Date(review.viewedAt), "MMM d, HH:mm")}
                  </span>
                )}
                {(review.commentCount ?? 0) > 0 && (
                  <span className="flex items-center gap-1">
                    <MessageSquare className="size-3" />
                    {review.commentCount} comment{review.commentCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Client comments */}
      {comments.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] font-mono font-medium text-muted-foreground">
              Client Comments ({comments.length})
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {comments.map((c) => (
              <div key={c.id} className="border border-border/40 rounded px-3 py-2 text-xs font-mono">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium text-foreground/90">{c.authorName}</span>
                  {c.assetId != null && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 h-4 border-border/50 font-mono text-muted-foreground"
                    >
                      image #{c.assetId}
                    </Badge>
                  )}
                  <span className="text-muted-foreground ml-auto">
                    {format(new Date(c.createdAt), "MMM d, HH:mm")}
                  </span>
                </div>
                <p className="text-foreground/80 leading-relaxed whitespace-pre-wrap">{c.comment}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {reviews.length === 0 && !showCreate && (
        <div className="border border-dashed border-border/40 rounded-lg p-5 flex flex-col items-center gap-2 text-center">
          <UserCheck className="size-6 text-muted-foreground/40" />
          <p className="text-xs font-mono text-muted-foreground">No client review links yet.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(true)}
            className="h-7 gap-1.5 font-mono text-[10px] border-border/50"
          >
            <Link2 className="size-3" />
            Create Review Link
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Project Detail ─────────────────────────────────────────────────────────────

function QuotationSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: quotation } = useGetProjectQuotation(projectId, {
    query: { queryKey: getProjectQuotationQueryKey(projectId) },
  });

  const [editing, setEditing] = useState(false);
  const [currency, setCurrency] = useState("IDR");
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(11);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<QuotationLineItemInput[]>([{ description: "", quantity: 1, unitPrice: 0 }]);

  const startEditing = () => {
    if (quotation) {
      setCurrency(quotation.currency);
      setDiscount(quotation.discount);
      setTaxPercent(quotation.taxPercent);
      setNotes(quotation.notes ?? "");
      setItems(quotation.lineItems.length ? quotation.lineItems : [{ description: "", quantity: 1, unitPrice: 0 }]);
    }
    setEditing(true);
  };

  const saveQuotation = useSaveProjectQuotation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getProjectQuotationQueryKey(projectId) });
        setEditing(false);
        toast({ title: "Quotation saved as draft" });
      },
      onError: (err: unknown) => toast({ title: "Failed to save", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    },
  });

  const sendQuotation = useSendProjectQuotation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getProjectQuotationQueryKey(projectId) });
        toast({ title: "Quotation sent to client" });
      },
      onError: (err: unknown) => toast({ title: "Failed to send", description: String((err as Error)?.message ?? err), variant: "destructive" }),
    },
  });

  const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const discounted = Math.max(0, subtotal - discount);
  const taxAmount = Math.round((discounted * taxPercent) / 100);
  const total = discounted + taxAmount;

  const statusColor = (s: string) => {
    switch (s) {
      case "sent":     return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
      case "approved": return "bg-green-500/15 text-green-400 border-green-500/30";
      case "rejected": return "bg-red-500/15 text-red-400 border-red-500/30";
      case "expired":  return "bg-orange-500/15 text-orange-400 border-orange-500/30";
      default:         return "bg-muted text-muted-foreground border-border";
    }
  };

  const canEdit = !quotation || quotation.status === "draft";

  return (
    <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-primary" />
          <span className="font-mono text-sm font-semibold">Quotation</span>
          {quotation && (
            <Badge className={cn("text-[10px] border font-mono px-1.5 h-5", statusColor(quotation.status))}>
              {quotation.status}
            </Badge>
          )}
        </div>
        {canEdit && !editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={startEditing}
            className="h-6 gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-primary"
          >
            <Plus className="size-3" />
            {quotation ? "Edit Draft" : "Create Offer"}
          </Button>
        )}
      </div>

      {!editing && quotation && (
        <div className="border border-border/40 rounded-lg p-3 space-y-2">
          {quotation.lineItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-foreground/80">{item.description} × {item.quantity}</span>
              <span className="text-muted-foreground">{quotation.currency} {(item.quantity * item.unitPrice).toLocaleString()}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs font-mono font-semibold pt-2 border-t border-border/40">
            <span>Total</span>
            <span>{quotation.currency} {quotation.total.toLocaleString()}</span>
          </div>
          {quotation.status === "draft" && (
            <Button
              size="sm"
              onClick={() => sendQuotation.mutate(projectId)}
              disabled={sendQuotation.isPending}
              className="h-7 w-full text-[10px] font-mono gap-1.5 mt-2"
            >
              {sendQuotation.isPending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
              Send to Client
            </Button>
          )}
          {quotation.status === "rejected" && quotation.responseNotes && (
            <p className="text-[10px] font-mono text-red-400 pt-1">Client note: {quotation.responseNotes}</p>
          )}
        </div>
      )}

      {editing && (
        <div className="border border-border/50 rounded-lg p-4 space-y-3 bg-muted/10">
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_60px_100px_28px] gap-2 items-end">
                <div>
                  {i === 0 && <Label className="text-[10px] font-mono text-muted-foreground">Description</Label>}
                  <Input
                    value={item.description}
                    onChange={(e) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, description: e.target.value } : it))}
                    placeholder="e.g. Brand Strategy Package"
                    className="h-7 text-xs font-mono mt-1"
                  />
                </div>
                <div>
                  {i === 0 && <Label className="text-[10px] font-mono text-muted-foreground">Qty</Label>}
                  <Input
                    type="number"
                    value={item.quantity}
                    onChange={(e) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, quantity: Number(e.target.value) || 0 } : it))}
                    min={1}
                    className="h-7 text-xs font-mono mt-1"
                  />
                </div>
                <div>
                  {i === 0 && <Label className="text-[10px] font-mono text-muted-foreground">Unit Price</Label>}
                  <Input
                    type="number"
                    value={item.unitPrice}
                    onChange={(e) => setItems((arr) => arr.map((it, idx) => idx === i ? { ...it, unitPrice: Number(e.target.value) || 0 } : it))}
                    min={0}
                    className="h-7 text-xs font-mono mt-1"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-red-400"
                  onClick={() => setItems((arr) => arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setItems((arr) => [...arr, { description: "", quantity: 1, unitPrice: 0 }])}
              className="h-6 gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-primary"
            >
              <Plus className="size-3" />
              Add Item
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className="h-7 text-xs font-mono mt-1" />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Discount</Label>
              <Input type="number" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} min={0} className="h-7 text-xs font-mono mt-1" />
            </div>
            <div>
              <Label className="text-[10px] font-mono text-muted-foreground">Tax %</Label>
              <Input type="number" value={taxPercent} onChange={(e) => setTaxPercent(Number(e.target.value) || 0)} min={0} className="h-7 text-xs font-mono mt-1" />
            </div>
          </div>

          <div>
            <Label className="text-[10px] font-mono text-muted-foreground">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="text-xs font-mono mt-1 min-h-[60px]" placeholder="Payment terms, scope details..." />
          </div>

          <div className="flex items-center justify-between text-xs font-mono font-semibold pt-2 border-t border-border/40">
            <span>Total</span>
            <span>{currency} {total.toLocaleString()}</span>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={items.every((it) => !it.description.trim()) || saveQuotation.isPending}
              onClick={() =>
                saveQuotation.mutate({
                  projectId,
                  data: {
                    lineItems: items.filter((it) => it.description.trim()),
                    discount,
                    taxPercent,
                    currency,
                    notes: notes || undefined,
                  },
                })
              }
              className="h-7 text-[10px] font-mono gap-1.5"
            >
              {saveQuotation.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
              Save Draft
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} className="h-7 text-[10px] font-mono">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Interior Design Output ─────────────────────────────────────────────────────

type CreativeStep = NonNullable<CreativeProjectDetail["steps"]>[number];

/** Renders interior-specific output sections from creative_project_steps outputs.
 *  Shows Moodboard, Space Plan, Materials, Design Copy, and QC sections when
 *  the project ran the Interior Design workflow. */
function InteriorDesignOutput({
  steps,
  conceptImageUrl,
  isGeneratingConceptImage,
  conceptImageFailed,
}: {
  steps: CreativeStep[];
  conceptImageUrl?: string | null;
  isGeneratingConceptImage?: boolean;
  conceptImageFailed?: boolean;
}) {
  const byName: Record<string, CreativeStep> = Object.fromEntries(steps.map((s) => [s.stepName, s]));

  const conceptOut   = byName["Design Concept"]?.output ?? null;
  const spacePlanOut = byName["Space Planning"]?.output ?? null;
  const materialOut  = byName["Material Specification"]?.output ?? null;
  const copyOut      = byName["Design Copy"]?.output ?? null;
  const qcOut        = byName["Interior Quality Control"]?.output ?? null;

  const hasAny = [conceptOut, spacePlanOut, materialOut, copyOut, qcOut].some(Boolean);
  if (!hasAny) return null;

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Home className="size-4 text-teal-400" />
        <span className="font-mono text-sm font-semibold">Interior Design Output</span>
      </div>

      {/* Moodboard & Visual Concept — rich renderer, no raw JSON */}
      {conceptOut && (
        <div className="border rounded-lg p-4 border-teal-500/20 bg-teal-500/5">
          <h4 className="text-xs font-mono font-semibold text-teal-400 mb-3 flex items-center gap-1.5">
            <Layers className="size-3.5" /> Moodboard &amp; Visual Concept
          </h4>
          <InteriorConceptOutput
            output={conceptOut}
            conceptImageUrl={conceptImageUrl}
            isGeneratingImage={isGeneratingConceptImage}
            imageGenerationFailed={conceptImageFailed}
          />
        </div>
      )}

      {/* Space Plan */}
      {spacePlanOut && (
        <div className="border rounded-lg p-4 border-border/50 bg-muted/10">
          <h4 className="text-xs font-mono font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Home className="size-3.5" /> Space Plan
          </h4>
          {renderOutput(spacePlanOut as Record<string, unknown>)}
        </div>
      )}

      {/* Material Recommendations */}
      {materialOut && (
        <div className="border rounded-lg p-4 border-border/50 bg-muted/10">
          <h4 className="text-xs font-mono font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Palette className="size-3.5" /> Material Recommendations
          </h4>
          {renderOutput(materialOut as Record<string, unknown>)}
        </div>
      )}

      {/* Furniture Placement / Lighting from copy step */}
      {copyOut && (
        <div className="border rounded-lg p-4 border-border/50 bg-muted/10">
          <h4 className="text-xs font-mono font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Sofa className="size-3.5" /> Design Copy &amp; Lighting Recommendations
          </h4>
          {renderOutput(copyOut as Record<string, unknown>)}
        </div>
      )}

      {/* QC */}
      {qcOut && (
        <div className="border rounded-lg p-4 border-green-500/15 bg-green-500/5">
          <h4 className="text-xs font-mono font-semibold text-green-400 mb-3 flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Interior Quality Control
          </h4>
          {renderOutput(qcOut as Record<string, unknown>)}
        </div>
      )}
    </div>
  );
}

// ── Project Detail ─────────────────────────────────────────────────────────────

function ProjectDetail({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [retryingWorkflow, setRetryingWorkflow] = useState(false);
  // Tracks whether the user just triggered image generation so we keep
  // polling even while the asset list is still empty.
  const [generationTriggered, setGenerationTriggered] = useState(false);

  const { data: project, isLoading } = useGetCreativeProject(projectId, {
    query: {
      queryKey: getGetCreativeProjectQueryKey(projectId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "running" ? 2000 : false;
      },
    },
  });

  const { data: allFeedback = [] } = useListProjectFeedback(projectId, {
    query: { queryKey: getListProjectFeedbackQueryKey(projectId) },
  });

  // Phase 5: Image assets
  const { data: assets = [], refetch: refetchAssets } = useListProjectAssets(projectId, {
    query: {
      queryKey: getListProjectAssetsQueryKey(projectId),
      refetchInterval: (query) => {
        const list = query.state.data ?? [];
        const hasGenerating = list.some((a) => a.status === "generating" || a.status === "pending");
        // Keep polling if assets are actively generating OR if we just
        // triggered generation and the list hasn't populated yet.
        return hasGenerating || generationTriggered ? 3000 : false;
      },
    },
  });

  // Image generation runs in the API as a background job. There is a short
  // window where the prompt generator is still running and no asset rows have
  // been inserted yet, so the asset list alone cannot describe the state.
  const imageGenerationActive =
    generationTriggered ||
    assets.some((a) => a.status === "generating" || a.status === "pending");
  const promptGenerationActive = assets.some((asset) =>
    (asset.status === "generating" || asset.status === "pending") &&
    (asset.metadata as Record<string, unknown> | null | undefined)?.pipelineStage === "prompt_generation",
  );

  const { data: imageAnalytics } = useGetCreativeImageAnalytics();

  const generateImages = useGenerateImageConcepts({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `Image generation started — ${data.variations} variation${data.variations > 1 ? "s" : ""} in progress` });
        // Mark triggered so refetchInterval keeps polling even while the
        // list is still empty (images may not exist in DB yet at t=0).
        setGenerationTriggered(true);
        setTimeout(() => refetchAssets(), 1500);
      },
      onError: (err: unknown) => {
        const apiError = err as {
          message?: string;
          status?: number;
          data?: { error?: string };
        };
        const msg = apiError.message ?? "Image generation failed";
        const serverMessage = apiError.data?.error ?? "";
        const isGenerationInProgress =
          /already in progress/i.test(serverMessage) ||
          /already in progress/i.test(msg);

        if (apiError.status === 409 && isGenerationInProgress) {
          // A refresh or a second click can hit the server while the
          // fire-and-forget pipeline is still running. Keep the UI in its
          // generating state and let the asset query continue polling.
          setGenerationTriggered(true);
          void refetchAssets();
          toast({ title: "Konsep gambar masih sedang dibuat", description: "Tunggu sampai proses selesai sebelum membuat ulang." });
          return;
        }

        // A 409 can also be a workflow guard (for example, an Interior Design
        // concept that has not been approved). That is not an active
        // generation, so never turn on the polling flag for this response.
        if (
          apiError.status === 409 &&
          /approved for rendering/i.test(serverMessage || msg)
        ) {
          setGenerationTriggered(false);
          toast({
            title: "Konsep Interior Design belum disetujui",
            description: "Approve the concept for rendering before generating images.",
            variant: "destructive",
          });
          return;
        }

        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  // Once assets appear (generation populated the DB), stop the forced-poll flag.
  // Keep it true while any asset is still generating/pending.
  useEffect(() => {
    if (
      generationTriggered &&
      assets.length > 0 &&
      !assets.some((a) => a.status === "generating" || a.status === "pending")
    ) {
      setGenerationTriggered(false);
    }
  }, [generationTriggered, assets]);

  const updateAssetStatus = useUpdateAssetStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectAssetsQueryKey(projectId) });
      },
      onError: () => toast({ title: "Failed to update asset", variant: "destructive" }),
    },
  });

  const submitFeedback = useSubmitProjectFeedback({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectFeedbackQueryKey(projectId) });
        toast({ title: "Feedback recorded" });
      },
      onError: () => toast({ title: "Failed to record feedback", variant: "destructive" }),
    },
  });

  const handleGenerateImages = () => {
    generateImages.mutate({ id: projectId, data: { variations: 2 } });
  };

  const handleAssetApprove = (assetId: number) => {
    updateAssetStatus.mutate({ assetId, data: { status: "approved" } });
  };
  const handleAssetRevision = async (assetId: number, revisionNote: string) => {
    const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
    };
    try {
      const res = await fetch(`/api/creative-ai/assets/${assetId}/regenerate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ revisionNote }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to start revision");
      }
      // Refetch immediately so the new "generating" row is visible,
      // then the refetchInterval (3 s) takes over until generation completes.
      await refetchAssets();
      toast({ title: "Revisi dimulai — gambar baru sedang di-generate" });
    } catch (err: unknown) {
      toast({
        title: "Gagal memulai revisi",
        description: err instanceof Error ? err.message : "Coba lagi",
        variant: "destructive",
      });
    }
  };
  const handleAssetReject = (assetId: number) => {
    updateAssetStatus.mutate({ assetId, data: { status: "rejected" } });
  };

  const handleFeedback = async (data: Parameters<FeedbackBarProps["onSubmit"]>[0]) => {
    await submitFeedback.mutateAsync({
      id: projectId,
      data: {
        stepId: data.stepId ?? null,
        stepName: data.stepName ?? null,
        action: data.action,
        rating: data.rating ?? null,
        feedbackText: data.feedbackText ?? null,
        originalOutput: (data.originalOutput as Record<string, unknown>) ?? null,
        editedOutput: null,
        diff: null,
      },
    });
  };

  // Interior Design approval state — must be declared before early returns (Rules of Hooks)
  const [conceptApproved, setConceptApproved] = useState(false);
  const handleConceptReadyStateChange = useCallback((approved: boolean) => {
    setConceptApproved(approved);
  }, []);

  const handleRetryWorkflow = async () => {
    if (!project || retryingWorkflow) return;
    setRetryingWorkflow(true);
    const adminKey = import.meta.env.VITE_ADMIN_API_KEY as string | undefined;
    try {
      const res = await fetch(`/api/creative-ai/projects/${projectId}/retry`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminKey ? { "x-admin-api-key": adminKey } : {}),
        },
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Retry failed");
      }
      toast({ title: "Workflow dimulai ulang — agen AI sedang bekerja kembali" });
      queryClient.invalidateQueries({ queryKey: getGetCreativeProjectQueryKey(projectId) });
    } catch (err: unknown) {
      toast({
        title: "Gagal memulai ulang workflow",
        description: err instanceof Error ? err.message : "Coba lagi",
        variant: "destructive",
      });
      setRetryingWorkflow(false);
    }
  };

  const handleExportMarkdown = async () => {
    if (!project) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/creative-ai/projects/${projectId}/export/markdown`);
      if (!res.ok) throw new Error("Export failed");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-creative-brief.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Markdown exported" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="size-6 text-primary animate-spin" /></div>;
  }
  if (!project) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono">Project not found</div>;
  }

  const dbSteps = project.steps ?? [];
  const stepsByName = Object.fromEntries(dbSteps.map((s) => [s.stepName, s]));

  const feedbackByStep: Record<string, FeedbackEntry[]> = {};
  for (const fb of allFeedback) {
    if (!fb.stepName) continue;
    feedbackByStep[fb.stepName] = feedbackByStep[fb.stepName] ?? [];
    feedbackByStep[fb.stepName].push(fb);
  }

  const isCompleted = project.status === "completed";
  const hasBudgetBlocked = dbSteps.some((s) => (s.status as string) === "blocked_by_budget");

  // Detect workflow type from stored step names — no backend schema change needed
  const isInteriorDesign = dbSteps.some((s) => INTERIOR_STEP_NAMES.has(s.stepName));

  // All concept steps completed → concept phase done; safe to generate images
  const conceptWorkflowComplete = dbSteps.length > 0 && dbSteps.every((s) => s.status === "completed");

  // "Generate Images" gate: concept done (or completed) AND, for interior design,
  // concept draft must be approved for rendering before images can run.
  const canGenerateImages =
    (isCompleted || conceptWorkflowComplete) &&
    (!isInteriorDesign || isCompleted || conceptApproved) &&
    !generateImages.isPending &&
    !imageGenerationActive;

  // Step count for the "Step X of Y" counter in StepCard
  const totalSteps = dbSteps.length > 0 ? dbSteps.length : PIPELINE_STEPS.length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Project header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-bold text-lg font-mono">{project.brandName}</h2>
            <Badge className={cn("text-[10px] border font-mono px-1.5", statusColor(project.status))}>
              {project.status.replace(/_/g, " ")}
            </Badge>
            {hasBudgetBlocked && (
              <Badge className="text-[10px] border font-mono px-1.5 bg-orange-500/10 text-orange-400 border-orange-500/30">
                budget capped
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono">{project.businessType} · {project.productOrService}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{project.targetMarket} · Goal: {project.goal}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2">
            {project.status === "failed" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRetryWorkflow()}
                disabled={retryingWorkflow}
                className="h-7 gap-1.5 text-[10px] font-mono border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                {retryingWorkflow
                  ? <Loader2 className="size-3 animate-spin" />
                  : <RotateCcw className="size-3" />}
                Retry Workflow
              </Button>
            )}
            {canGenerateImages && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateImages}
                disabled={generateImages.isPending}
                className="h-7 gap-1.5 text-[10px] font-mono border-primary/30 text-primary hover:bg-primary/10"
                title="Run Image Prompt Generator → FLUX.1 → Image QC in background"
              >
                {generateImages.isPending
                  ? <Loader2 className="size-3 animate-spin" />
                  : <Wand2 className="size-3" />}
                Generate Images
              </Button>
            )}
            {isCompleted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportMarkdown}
                disabled={exporting}
                className="h-7 gap-1.5 text-[10px] font-mono border-border/50"
              >
                {exporting
                  ? <Loader2 className="size-3 animate-spin" />
                  : <Download className="size-3" />}
                Export MD
              </Button>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
            <Clock className="size-3" />
            {format(new Date(project.createdAt), "MMM d, HH:mm")}
          </div>
          {allFeedback.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground gap-1 px-1.5 h-5">
              <MessageSquare className="size-2.5" />{allFeedback.length} feedback
            </Badge>
          )}
        </div>
      </div>

      {/* Pipeline steps */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-3">
          {(project.status === "pending" || project.status === "running") && (
            <div className="flex items-center gap-2 mb-4 text-xs text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 rounded px-3 py-2">
              <Loader2 className="size-3.5 animate-spin" />
              {project.status === "pending" ? "Workflow queued — agents will start shortly…" : "Agents are generating your creative assets…"}
            </div>
          )}
          {project.status === "failed" && (
            <div className="flex items-center justify-between gap-2 mb-4 text-xs text-red-400 font-mono bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              <div className="flex items-center gap-2">
                <XCircle className="size-3.5 shrink-0" />
                Workflow gagal — kemungkinan karena API key tidak valid saat proses berlangsung. Klik Retry untuk menjalankan ulang.
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRetryWorkflow()}
                disabled={retryingWorkflow}
                className="h-6 gap-1 text-[10px] font-mono text-red-400 hover:bg-red-500/15 shrink-0"
              >
                {retryingWorkflow ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                Retry
              </Button>
            </div>
          )}
          {hasBudgetBlocked && (
            <div className="flex items-center gap-2 mb-2 text-xs text-orange-400 font-mono bg-orange-500/10 border border-orange-500/20 rounded px-3 py-2">
              <BanIcon className="size-3.5" />
              Workflow paused — per-workflow budget limit reached. Adjust guardrail settings to increase the limit.
            </div>
          )}
          {/* ── Dynamic workflow steps from DB ───────────────────────── */}
          {dbSteps.length > 0 ? (
            // PHASE 1-2: Render real steps stored in creative_project_steps
            dbSteps.map((s, i) => {
              const stepDef = { label: s.stepName, icon: getStepIcon(s.stepName) };
              return (
                <StepCard
                  key={s.id}
                  stepDef={stepDef}
                  step={s}
                  projectStatus={project.status}
                  index={i}
                  totalSteps={totalSteps}
                  projectId={projectId}
                  stepFeedback={feedbackByStep[s.stepName] ?? []}
                  onFeedback={handleFeedback}
                />
              );
            })
          ) : (
            // Fallback: show PIPELINE_STEPS as pending placeholders for new projects
            PIPELINE_STEPS.map((def, i) => {
              const dbName = STEP_NAME_MAP[def.slug];
              const step = stepsByName[dbName];
              return (
                <StepCard
                  key={def.slug}
                  stepDef={def}
                  step={step}
                  projectStatus={project.status}
                  index={i}
                  totalSteps={totalSteps}
                  projectId={projectId}
                  stepFeedback={feedbackByStep[dbName] ?? []}
                  onFeedback={handleFeedback}
                />
              );
            })
          )}

          {/* ── PHASE 3: Interior Design Output sections ─────────────── */}
          {isInteriorDesign && (() => {
            const firstCompletedAsset = assets.find(
              (a) => (a.status === "completed" || a.status === "approved") && a.imageUrl,
            );
            const isGeneratingConceptImage = assets.some(
              (a) => a.status === "generating" || a.status === "pending",
            );
            const conceptImageFailed =
              assets.length > 0 && assets.every((a) => a.status === "failed");
            return (
              <InteriorDesignOutput
                steps={dbSteps}
                conceptImageUrl={firstCompletedAsset?.imageUrl ?? null}
                isGeneratingConceptImage={isGeneratingConceptImage}
                conceptImageFailed={conceptImageFailed}
              />
            );
          })()}

          {/* ── Interior Design Concept Approval ─────────────────────── */}
          {/* Must be approved before "Generate Images" unlocks */}
          {isInteriorDesign && conceptWorkflowComplete && (
            <div className="mt-2">
              <InteriorDesignEditor
                projectUuid={projectId}
                onReadyStateChange={handleConceptReadyStateChange}
              />
            </div>
          )}

          {/* ── Image Concepts Section ────────────────────────────────── */}
          {/* Phase 5: show when concept workflow is done or assets already exist */}
          {(isCompleted || conceptWorkflowComplete || assets.length > 0) && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="size-4 text-primary" />
                  <span className="font-mono text-sm font-semibold">Image Concepts</span>
                  {assets.length > 0 && (
                    <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5 border-border/50 text-muted-foreground">
                      {assets.length}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {imageAnalytics && imageAnalytics.totalImages > 0 && (
                    <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                      <span title="Total images generated across all projects">
                        {imageAnalytics.totalImages} total
                      </span>
                      {imageAnalytics.approvedRate != null && (
                        <span className="text-green-400" title="Approved rate across all projects">
                          {Math.round(imageAnalytics.approvedRate * 100)}% approved
                        </span>
                      )}
                      {imageAnalytics.avgQcScore != null && (
                        <span title="Average QC score across all projects">
                          QC {Math.round(imageAnalytics.avgQcScore)}
                        </span>
                      )}
                    </div>
                  )}
                  {canGenerateImages && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleGenerateImages}
                      disabled={generateImages.isPending}
                      className="h-6 gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-primary"
                    >
                      {generateImages.isPending
                        ? <Loader2 className="size-3 animate-spin" />
                        : <Wand2 className="size-3" />}
                      {assets.length > 0 ? "Regenerate" : "Generate Image Concepts"}
                    </Button>
                  )}
                </div>
              </div>

              {assets.length === 0 && (isCompleted || conceptWorkflowComplete) && !generateImages.isPending && !imageGenerationActive && (
                <div className="border border-dashed border-border/40 rounded-lg p-8 flex flex-col items-center gap-3 text-center">
                  <div className="size-10 rounded-lg border border-border/40 bg-muted/20 flex items-center justify-center">
                    <Wand2 className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-mono font-medium">No image concepts yet</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {canGenerateImages
                        ? 'Click "Generate Images" to run the Image Prompt Generator → FLUX.1 → QC pipeline.'
                        : "Approve the Interior Design concept before generating images."}
                    </p>
                  </div>
                  {canGenerateImages && (
                    <Button
                      size="sm"
                      onClick={handleGenerateImages}
                      disabled={generateImages.isPending}
                      className="gap-1.5 font-mono text-xs"
                    >
                      <Wand2 className="size-3.5" />
                      Generate Image Concepts
                    </Button>
                  )}
                </div>
              )}

              {imageGenerationActive && assets.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 rounded px-3 py-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  {promptGenerationActive
                    ? "Image Prompt Generator running…"
                    : "FLUX.1 sedang membuat konsep gambar…"}
                </div>
              )}

              {assets.length > 0 && (
                <>
                  {/* Stats row */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Generated", value: assets.filter(a => a.status === "completed" || a.imageUrl).length },
                      { label: "Approved", value: assets.filter(a => a.status === "approved").length },
                      { label: "Avg QC", value: (() => { const s = assets.filter(a => a.qcScore != null); return s.length ? Math.round(s.reduce((acc, a) => acc + (a.qcScore ?? 0), 0) / s.length) : "—"; })() },
                      { label: "Total Cost", value: `${assets.reduce((acc, a) => acc + Number(a.cost ?? 0), 0).toFixed(4)}` },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-muted/20 border border-border/30 rounded p-2 text-center">
                        <p className="text-sm font-bold font-mono">{value}</p>
                        <p className="text-[9px] font-mono text-muted-foreground mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Asset grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {assets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        onApprove={handleAssetApprove}
                        onRevision={handleAssetRevision}
                        onReject={handleAssetReject}
                        isUpdating={updateAssetStatus.isPending}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Quotation Section ───────────────────────────────────────── */}
          <QuotationSection projectId={projectId} />

          {/* ── Client Review Section ─────────────────────────────────── */}
          <ClientReviewSection projectId={projectId} />
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function CreativeAI() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: projects = [], isLoading: projectsLoading } = useListCreativeProjects({
    query: {
      queryKey: getListCreativeProjectsQueryKey(),
      refetchInterval: (query) => {
        const list = query.state.data ?? [];
        const hasActive = list.some((p) => p.status === "pending" || p.status === "running");
        return hasActive ? 3000 : false;
      },
    },
  });

  const createBrief = useCreateCreativeBrief({
    mutation: {
      onSuccess: (project) => {
        queryClient.invalidateQueries({ queryKey: getListCreativeProjectsQueryKey() });
        setActiveProjectId(project.projectId);
        setShowForm(false);
        toast({ title: "Brief submitted", description: "4-agent workflow has started." });
      },
      onError: () => toast({ title: "Failed to submit brief", variant: "destructive" }),
    },
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const handleNewBrief = async (form: typeof EMPTY_FORM) => {
    // Embed language preference in notes so the API (which has no language field)
    // can pass it through to the prompt builders without a schema change.
    const langTag = `[OUTPUT_LANGUAGE:${form.language}]`;
    const notesWithLang = [form.notes.trim(), langTag].filter(Boolean).join("\n");
    await createBrief.mutateAsync({
      data: {
        brandName: form.brandName,
        businessType: form.businessType,
        targetMarket: form.targetMarket,
        productOrService: form.productOrService,
        stylePreference: form.stylePreference || null,
        goal: form.goal,
        notes: notesWithLang,
      },
    });
  };

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: getGetCreativeProjectQueryKey(id) });
  };

  return (
    <div className="flex h-full">
      {/* ── Left panel: history ─────────────────────────────────────── */}
      <aside className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="font-mono text-sm font-semibold">Creative AI</span>
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => { setShowForm(true); setActiveProjectId(null); }} title="New Brief">
            <Plus className="size-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {projectsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="size-4 text-muted-foreground animate-spin" /></div>
            ) : projects.length === 0 ? (
              <div className="text-center py-8 px-3">
                <Sparkles className="size-6 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground font-mono">No projects yet.</p>
                <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">Submit a brief to get started.</p>
              </div>
            ) : (
              projects.map((p) => (
                <ProjectListItem
                  key={p.projectId}
                  project={p}
                  isActive={activeProjectId === p.projectId}
                  onClick={() => handleSelectProject(p.projectId)}
                />
              ))
            )}
          </div>
        </ScrollArea>

        {/* ── Specialist Agents Info ───────────────────────────────── */}
        <div className="border-t border-border/40 p-3 space-y-2">
          <p className="text-[10px] font-mono font-semibold text-muted-foreground uppercase tracking-wider px-1">Specialist Agents</p>
          {SPECIALIST_AGENTS.map((agent) => (
            <div
              key={agent.slug}
              className={cn("rounded-md border bg-gradient-to-br p-2.5 space-y-1.5", agent.color)}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={cn("text-[11px] font-mono font-semibold truncate", agent.iconColor)}>{agent.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{agent.description}</p>
              <div className="flex flex-wrap gap-1">
                {agent.capabilities.slice(0, 2).map((cap) => (
                  <span key={cap} className="text-[9px] font-mono bg-background/40 border border-border/40 rounded px-1 py-0.5 text-muted-foreground">{cap}</span>
                ))}
                <span className="text-[9px] font-mono text-muted-foreground/60">via {agent.model}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Right panel: form or detail ──────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {showForm || (!activeProjectId && projects.length === 0) ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-14 flex items-center gap-3 px-6 border-b border-border shrink-0">
              <Sparkles className="size-4 text-primary" />
              <span className="font-mono text-sm font-semibold text-foreground">New Creative Brief</span>
            </div>
            <ScrollArea className="flex-1">
              <BriefForm onSubmit={handleNewBrief} isLoading={createBrief.isPending} onCancel={projects.length > 0 ? () => setShowForm(false) : undefined} />
            </ScrollArea>
          </div>
        ) : activeProjectId ? (
          <ProjectDetail key={activeProjectId} projectId={activeProjectId} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="size-12 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center">
              <Sparkles className="size-6 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-mono text-sm font-semibold">Select a project</p>
              <p className="text-xs text-muted-foreground font-mono">Choose a project from the left panel or create a new brief.</p>
            </div>
            <Button variant="outline" size="sm" className="gap-2 font-mono" onClick={() => setShowForm(true)}>
              <Plus className="size-4" />
              New Brief
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
