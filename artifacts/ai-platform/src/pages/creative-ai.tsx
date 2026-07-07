import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCreativeBrief,
  useListCreativeProjects,
  useGetCreativeProject,
  getListCreativeProjectsQueryKey,
  getGetCreativeProjectQueryKey,
  type CreativeProject,
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
  ChevronRight,
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
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { slug: "brand-strategist",  label: "Brand Strategy",      icon: Zap },
  { slug: "creative-director", label: "Creative Direction",   icon: Palette },
  { slug: "copywriter",        label: "Copy Production",      icon: FileText },
  { slug: "quality-control",   label: "Quality Control",      icon: ShieldCheck },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "completed": return "bg-green-500/15 text-green-400 border-green-500/30";
    case "running":   return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "failed":    return "bg-red-500/15 text-red-400 border-red-500/30";
    default:          return "bg-muted text-muted-foreground border-border";
  }
}

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = cn("size-4 shrink-0", className);
  switch (status) {
    case "completed": return <CheckCircle2 className={cn(cls, "text-green-400")} />;
    case "running":   return <Loader2 className={cn(cls, "text-blue-400 animate-spin")} />;
    case "failed":    return <XCircle className={cn(cls, "text-red-400")} />;
    default:          return <CircleDot className={cn(cls, "text-muted-foreground")} />;
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

function renderOutput(output: Record<string, unknown> | null | undefined) {
  if (!output || Object.keys(output).length === 0) return null;

  // If it's a raw string response (non-JSON agent output)
  if ("raw" in output && typeof output.raw === "string") {
    return (
      <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap leading-relaxed">
        {output.raw}
      </pre>
    );
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
              <pre className="text-xs font-mono text-foreground/80 whitespace-pre-wrap bg-muted/30 rounded p-2">
                {JSON.stringify(value, null, 2)}
              </pre>
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
  brandName: "",
  businessType: "",
  targetMarket: "",
  productOrService: "",
  stylePreference: "",
  goal: "",
  notes: "",
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(form);
    setForm(EMPTY_FORM);
  };

  const required = form.brandName && form.businessType && form.targetMarket && form.productOrService && form.goal;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="brandName" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Brand Name <span className="text-red-400">*</span>
          </Label>
          <Input id="brandName" placeholder="e.g. Lumina Coffee" className="h-8 text-sm font-mono" {...field("brandName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="businessType" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Business Type <span className="text-red-400">*</span>
          </Label>
          <Input id="businessType" placeholder="e.g. Specialty Coffee Roaster" className="h-8 text-sm font-mono" {...field("businessType")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="targetMarket" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Target Market <span className="text-red-400">*</span>
          </Label>
          <Input id="targetMarket" placeholder="e.g. Urban millennials 25-35" className="h-8 text-sm font-mono" {...field("targetMarket")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="productOrService" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Product / Service <span className="text-red-400">*</span>
          </Label>
          <Input id="productOrService" placeholder="e.g. Single-origin espresso beans" className="h-8 text-sm font-mono" {...field("productOrService")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="goal" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Campaign Goal <span className="text-red-400">*</span>
          </Label>
          <Input id="goal" placeholder="e.g. Launch brand awareness campaign" className="h-8 text-sm font-mono" {...field("goal")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stylePreference" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Style Preference
          </Label>
          <Input id="stylePreference" placeholder="e.g. Minimalist, earthy, premium" className="h-8 text-sm font-mono" {...field("stylePreference")} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
          Additional Notes
        </Label>
        <Textarea
          id="notes"
          rows={2}
          placeholder="Any extra context, constraints, or inspiration..."
          className="text-sm font-mono resize-none"
          {...field("notes")}
        />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="submit"
          disabled={!required || isLoading}
          className="gap-2 font-mono"
        >
          {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {isLoading ? "Generating…" : "Generate Creative Brief"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="font-mono" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// ── Step Card ──────────────────────────────────────────────────────────────────

interface StepCardProps {
  stepDef: typeof PIPELINE_STEPS[0];
  step?: {
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
}

function StepCard({ stepDef, step, projectStatus, index }: StepCardProps) {
  const Icon = stepDef.icon;

  // Determine effective step status when project hasn't started this step yet
  const effectiveStatus = step?.status ?? (projectStatus === "pending" ? "pending" : "pending");
  const isActive = projectStatus === "running" && !step;
  const outputStr = step?.output ? JSON.stringify(step.output, null, 2) : "";

  return (
    <div className={cn(
      "border rounded-lg transition-colors",
      effectiveStatus === "completed" ? "border-green-500/20 bg-green-500/5" :
      effectiveStatus === "running" ? "border-blue-500/20 bg-blue-500/5" :
      effectiveStatus === "failed" ? "border-red-500/20 bg-red-500/5" :
      "border-border/50 bg-muted/10",
    )}>
      {/* Step header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "size-7 rounded border flex items-center justify-center shrink-0",
            effectiveStatus === "completed" ? "border-green-500/30 bg-green-500/10" :
            effectiveStatus === "running"   ? "border-blue-500/30 bg-blue-500/10" :
            effectiveStatus === "failed"    ? "border-red-500/30 bg-red-500/10" :
            "border-border bg-muted/30",
          )}>
            {isActive || effectiveStatus === "running"
              ? <Loader2 className="size-3.5 text-blue-400 animate-spin" />
              : <Icon className={cn(
                  "size-3.5",
                  effectiveStatus === "completed" ? "text-green-400" :
                  effectiveStatus === "failed"    ? "text-red-400" :
                  "text-muted-foreground",
                )} />
            }
          </div>
          <div>
            <p className="text-sm font-medium font-mono">{stepDef.label}</p>
            <p className="text-[10px] text-muted-foreground font-mono">Step {index + 1} of {PIPELINE_STEPS.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Metadata badges */}
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
          <StatusIcon status={effectiveStatus} />
        </div>
      </div>

      {/* Output */}
      {step?.output && Object.keys(step.output).length > 0 && (
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

      {/* Error */}
      {step?.errorMessage && (
        <>
          <Separator className="opacity-30" />
          <div className="px-4 py-3 flex items-start gap-2">
            <AlertCircle className="size-3.5 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs font-mono text-red-400">{step.errorMessage}</p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Project Detail ─────────────────────────────────────────────────────────────

function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: project, isLoading } = useGetCreativeProject(projectId, {
    query: {
      queryKey: getGetCreativeProjectQueryKey(projectId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "running" ? 2000 : false;
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm font-mono">
        Project not found
      </div>
    );
  }

  const stepsByName = Object.fromEntries(
    (project.steps ?? []).map((s) => [s.stepName, s])
  );

  // Map pipeline steps → step names used in DB
  const stepNameMap: Record<string, string> = {
    "brand-strategist":  "Brand Strategy",
    "creative-director": "Creative Direction",
    "copywriter":        "Copy Production",
    "quality-control":   "Quality Control",
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Project header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-bold text-lg font-mono">{project.brandName}</h2>
            <Badge className={cn("text-[10px] border font-mono px-1.5", statusColor(project.status))}>
              {project.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {project.businessType} · {project.productOrService}
          </p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {project.targetMarket} · Goal: {project.goal}
          </p>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono shrink-0">
          <Clock className="size-3" />
          {format(new Date(project.createdAt), "MMM d, HH:mm")}
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

          {PIPELINE_STEPS.map((def, i) => {
            const dbName = stepNameMap[def.slug];
            const step = stepsByName[dbName];
            return (
              <StepCard
                key={def.slug}
                stepDef={def}
                step={step}
                projectStatus={project.status}
                index={i}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Project List Item ──────────────────────────────────────────────────────────

function ProjectListItem({
  project,
  isActive,
  onClick,
}: {
  project: CreativeProject;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-md transition-colors group",
        isActive
          ? "bg-primary/10 border border-primary/20"
          : "hover:bg-sidebar-accent border border-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-mono text-xs font-semibold truncate text-foreground">{project.brandName}</span>
        <div className={cn("size-1.5 rounded-full shrink-0",
          project.status === "completed" ? "bg-green-500" :
          project.status === "running"   ? "bg-blue-500 animate-pulse" :
          project.status === "failed"    ? "bg-red-500" :
          "bg-muted-foreground",
        )} />
      </div>
      <p className="font-mono text-[10px] text-muted-foreground truncate">{project.businessType}</p>
      <p className="font-mono text-[10px] text-muted-foreground/60 mt-0.5">
        {format(new Date(project.createdAt), "MMM d, HH:mm")}
      </p>
    </button>
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
      onError: () => {
        toast({ title: "Failed to submit brief", variant: "destructive" });
      },
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
        {/* Panel header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="font-mono text-sm font-semibold">Creative AI</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => { setShowForm(true); setActiveProjectId(null); }}
            title="New Brief"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        {/* Project list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {projectsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-4 text-muted-foreground animate-spin" />
              </div>
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
          /* Brief form */
          <div className="flex-1 flex flex-col min-h-0">
            <div className="h-14 flex items-center gap-3 px-6 border-b border-border shrink-0">
              <Sparkles className="size-4 text-primary" />
              <span className="font-mono text-sm font-semibold text-foreground">New Creative Brief</span>
            </div>
            <ScrollArea className="flex-1">
              <BriefForm
                onSubmit={handleNewBrief}
                isLoading={createBrief.isPending}
                onCancel={projects.length > 0 ? () => setShowForm(false) : undefined}
              />
            </ScrollArea>
          </div>
        ) : activeProjectId ? (
          /* Project detail */
          <ProjectDetail
            key={activeProjectId}
            projectId={activeProjectId}
          />
        ) : (
          /* Empty state — projects exist but none selected */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="size-12 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-center">
              <Sparkles className="size-6 text-primary" />
            </div>
            <div>
              <p className="font-mono font-semibold text-foreground mb-1">Creative AI MVP</p>
              <p className="text-sm text-muted-foreground font-mono max-w-xs">
                Select a project from the list or create a new brief to run the 4-agent creative pipeline.
              </p>
            </div>
            <Button
              className="gap-2 font-mono"
              onClick={() => setShowForm(true)}
            >
              <Plus className="size-4" />
              New Brief
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
