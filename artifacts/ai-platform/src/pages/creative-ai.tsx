import { useState } from "react";
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
  type CreativeProject,
  type FeedbackEntry,
  type CreativeAiAsset,
  type ClientReview,
  type ClientComment,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  "brand-strategist":  "Brand Strategy",
  "creative-director": "Creative Direction",
  "copywriter":        "Copy Production",
  "quality-control":   "Quality Control",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "completed":        return "bg-green-500/15 text-green-400 border-green-500/30";
    case "running":          return "bg-blue-500/15 text-blue-400 border-blue-500/30";
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
      <div className="space-y-1.5">
        <Label htmlFor="notes" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Additional Notes</Label>
        <Textarea id="notes" rows={2} placeholder="Any extra context, constraints, or inspiration..." className="text-sm font-mono resize-none" {...field("notes")} />
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
  stepDef: typeof PIPELINE_STEPS[0];
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
  projectId: string;
  stepFeedback: FeedbackEntry[];
  onFeedback: (data: Parameters<FeedbackBarProps["onSubmit"]>[0]) => Promise<void>;
}

function StepCard({ stepDef, step, projectStatus, index, projectId: _projectId, stepFeedback, onFeedback }: StepCardProps) {
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
            <p className="text-[10px] text-muted-foreground font-mono">Step {index + 1} of {PIPELINE_STEPS.length}</p>
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

interface AssetCardProps {
  asset: CreativeAiAsset;
  onApprove: (id: number) => void;
  onRevision: (id: number) => void;
  onReject: (id: number) => void;
  isUpdating: boolean;
}

function AssetCard({ asset, onApprove, onRevision, onReject, isUpdating }: AssetCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(asset.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const qcColor = asset.qcScore == null ? "text-muted-foreground"
    : asset.qcScore >= 80 ? "text-green-400"
    : asset.qcScore >= 60 ? "text-yellow-400"
    : "text-red-400";

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
            <span className="text-[10px] font-mono">Generating…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImageOff className="size-8 opacity-40" />
            <span className="text-[10px] font-mono text-center px-3 leading-relaxed">
              {asset.qcNotes?.includes("REPLICATE_API_TOKEN")
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
        {asset.qcNotes && (
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="w-full flex items-center justify-between text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Notes / Prompt</span>
            {showPrompt ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
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
            disabled={isUpdating || asset.status === "needs_revision"}
            onClick={() => onRevision(asset.id)}
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

  const { data: reviews = [] } = useListClientReviews(projectId, {
    query: { queryKey: getListClientReviewsQueryKey(projectId) },
  });
  const { data: comments = [] } = useListReviewComments(projectId, {
    query: { queryKey: getListReviewCommentsQueryKey(projectId) },
  });

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
          onClick={() => setShowCreate((v) => !v)}
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

function ProjectDetail({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

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
        return hasGenerating ? 3000 : false;
      },
    },
  });

  const generateImages = useGenerateImageConcepts({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `Image generation started — ${data.variations} variation${data.variations > 1 ? "s" : ""} in progress` });
        setTimeout(() => refetchAssets(), 1500);
      },
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message ?? "Image generation failed";
        toast({ title: msg.includes("409") ? "Generation already in progress" : msg, variant: "destructive" });
      },
    },
  });

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
  const handleAssetRevision = (assetId: number) => {
    updateAssetStatus.mutate({ assetId, data: { status: "needs_revision" } });
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

  const stepsByName = Object.fromEntries((project.steps ?? []).map((s) => [s.stepName, s]));

  const feedbackByStep: Record<string, FeedbackEntry[]> = {};
  for (const fb of allFeedback) {
    if (!fb.stepName) continue;
    feedbackByStep[fb.stepName] = feedbackByStep[fb.stepName] ?? [];
    feedbackByStep[fb.stepName].push(fb);
  }

  const isCompleted = project.status === "completed";
  const hasBudgetBlocked = (project.steps ?? []).some((s) => (s.status as string) === "blocked_by_budget");

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
            {isCompleted && (
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
          {hasBudgetBlocked && (
            <div className="flex items-center gap-2 mb-2 text-xs text-orange-400 font-mono bg-orange-500/10 border border-orange-500/20 rounded px-3 py-2">
              <BanIcon className="size-3.5" />
              Workflow paused — per-workflow budget limit reached. Adjust guardrail settings to increase the limit.
            </div>
          )}
          {PIPELINE_STEPS.map((def, i) => {
            const dbName = STEP_NAME_MAP[def.slug];
            const step = stepsByName[dbName];
            return (
              <StepCard
                key={def.slug}
                stepDef={def}
                step={step}
                projectStatus={project.status}
                index={i}
                projectId={projectId}
                stepFeedback={feedbackByStep[dbName] ?? []}
                onFeedback={handleFeedback}
              />
            );
          })}

          {/* ── Image Concepts Section ────────────────────────────────── */}
          {(isCompleted || assets.length > 0) && (
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
                {isCompleted && (
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

              {assets.length === 0 && isCompleted && !generateImages.isPending && (
                <div className="border border-dashed border-border/40 rounded-lg p-8 flex flex-col items-center gap-3 text-center">
                  <div className="size-10 rounded-lg border border-border/40 bg-muted/20 flex items-center justify-center">
                    <Wand2 className="size-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-mono font-medium">No image concepts yet</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      Click "Generate Images" to run the Image Prompt Generator → FLUX.1 → QC pipeline.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleGenerateImages}
                    disabled={generateImages.isPending}
                    className="gap-1.5 font-mono text-xs"
                  >
                    <Wand2 className="size-3.5" />
                    Generate Image Concepts
                  </Button>
                </div>
              )}

              {generateImages.isPending && assets.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-blue-400 font-mono bg-blue-500/10 border border-blue-500/20 rounded px-3 py-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  Image Prompt Generator running… FLUX.1 image generation will start shortly.
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
    await createBrief.mutateAsync({
      data: {
        brandName: form.brandName,
        businessType: form.businessType,
        targetMarket: form.targetMarket,
        productOrService: form.productOrService,
        stylePreference: form.stylePreference || null,
        goal: form.goal,
        notes: form.notes || null,
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
