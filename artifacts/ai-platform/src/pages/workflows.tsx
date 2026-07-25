import { useState } from "react";
import {
  useListWorkflows,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  getListWorkflowsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GitMerge,
  Plus,
  Trash2,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  ArrowDown,
  Inbox,
  FileText,
  Sparkles,
  Palette,
  Eye,
  CheckCircle,
  ShieldCheck,
  Zap,
  X,
  Save,
  PenLine,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";

// ── Step type definitions ─────────────────────────────────────────────────────

const STEP_TYPES = [
  { value: "reception",  icon: Inbox,        color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/30" },
  { value: "brief",      icon: FileText,     color: "text-yellow-400",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30" },
  { value: "brand",      icon: Sparkles,     color: "text-purple-400",  bg: "bg-purple-500/10",  border: "border-purple-500/30" },
  { value: "creative",   icon: Palette,      color: "text-pink-400",    bg: "bg-pink-500/10",    border: "border-pink-500/30" },
  { value: "design",     icon: PenLine,      color: "text-cyan-400",    bg: "bg-cyan-500/10",    border: "border-cyan-500/30" },
  { value: "review",     icon: Eye,          color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30" },
  { value: "qc",         icon: CheckCircle,  color: "text-green-400",   bg: "bg-green-500/10",   border: "border-green-500/30" },
  { value: "approval",   icon: ShieldCheck,  color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  { value: "custom",     icon: Zap,          color: "text-muted-foreground", bg: "bg-muted/30",  border: "border-border/50" },
];

type StepType = { id: string; order: number; name: string; type: string; description: string };

function getStepDef(type: string) {
  return STEP_TYPES.find((t) => t.value === type) ?? STEP_TYPES[STEP_TYPES.length - 1]!;
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

// ── Step pipeline display ─────────────────────────────────────────────────────

function PipelineView({ steps }: { steps: StepType[] }) {
  const { t } = useLang();
  const getStepLabel = (value: string) => t(`pages.workflows.stepTypes.${value}`) || value;

  const sorted = [...steps].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground font-mono text-xs">
        {t("pages.workflows.noSteps")}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-0">
      {sorted.map((step, i) => {
        const def = getStepDef(step.type);
        const Icon = def.icon;
        return (
          <div key={step.id} className="flex flex-col items-center">
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${def.bg} ${def.border} min-w-[220px]`}>
              <div className={`size-7 rounded flex items-center justify-center ${def.bg} border ${def.border} flex-shrink-0`}>
                <Icon className={`size-3.5 ${def.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${def.color}`}>{step.name || getStepLabel(step.type)}</p>
                {step.description && (
                  <p className="text-[10px] text-muted-foreground truncate">{step.description}</p>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/60">{String(i + 1).padStart(2, "0")}</span>
            </div>
            {i < sorted.length - 1 && (
              <div className="flex flex-col items-center py-0.5">
                <div className="w-px h-3 bg-border/50" />
                <ArrowDown className="size-3 text-muted-foreground/40" />
                <div className="w-px h-3 bg-border/50" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step editor ───────────────────────────────────────────────────────────────

function StepEditor({
  steps,
  onChange,
}: {
  steps: StepType[];
  onChange: (steps: StepType[]) => void;
}) {
  const { t } = useLang();
  const getStepLabel = (value: string) => t(`pages.workflows.stepTypes.${value}`) || value;

  const sorted = [...steps].sort((a, b) => a.order - b.order);

  const addStep = () => {
    const next: StepType = {
      id: genId(),
      order: sorted.length,
      name: "",
      type: "custom",
      description: "",
    };
    onChange([...steps, next]);
  };

  const removeStep = (id: string) => {
    const remaining = steps.filter((s) => s.id !== id);
    onChange(remaining.sort((a, b) => a.order - b.order).map((s, i) => ({ ...s, order: i })));
  };

  const updateStep = (id: string, patch: Partial<StepType>) =>
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const move = (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((s) => s.id === id);
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;
    const newSorted = [...sorted];
    [newSorted[idx], newSorted[targetIdx]] = [newSorted[targetIdx]!, newSorted[idx]!];
    onChange(newSorted.map((s, i) => ({ ...s, order: i })));
  };

  return (
    <div className="space-y-2">
      {sorted.map((step, i) => {
        const def = getStepDef(step.type);
        const Icon = def.icon;
        return (
          <div key={step.id} className="flex items-start gap-2 group">
            {/* Order */}
            <div className="flex flex-col gap-0.5 pt-1.5">
              <button
                onClick={() => move(step.id, -1)}
                disabled={i === 0}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
              >
                <ChevronUp className="size-3 text-muted-foreground" />
              </button>
              <span className="font-mono text-[10px] text-muted-foreground/60 text-center w-5">{i + 1}</span>
              <button
                onClick={() => move(step.id, 1)}
                disabled={i === sorted.length - 1}
                className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
              >
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </div>

            {/* Step icon */}
            <div className={`size-8 rounded border flex items-center justify-center flex-shrink-0 mt-1 ${def.bg} ${def.border}`}>
              <Icon className={`size-3.5 ${def.color}`} />
            </div>

            {/* Fields */}
            <div className="flex-1 grid grid-cols-[1fr_160px] gap-2">
              <Input
                placeholder={t("pages.workflows.editor.stepNamePh")}
                value={step.name}
                onChange={(e) => updateStep(step.id, { name: e.target.value })}
                className="bg-background/50 h-8 text-sm"
              />
              <Select
                value={step.type}
                onValueChange={(v) => updateStep(step.id, { type: v })}
              >
                <SelectTrigger className="bg-background/50 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_TYPES.map((st) => (
                    <SelectItem key={st.value} value={st.value} className="text-xs">
                      {getStepLabel(st.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder={t("pages.workflows.editor.descPh")}
                value={step.description}
                onChange={(e) => updateStep(step.id, { description: e.target.value })}
                className="bg-background/50 h-7 text-xs col-span-2 text-muted-foreground"
              />
            </div>

            {/* Delete */}
            <button
              onClick={() => removeStep(step.id)}
              className="mt-1 p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}

      <Button
        variant="ghost"
        size="sm"
        onClick={addStep}
        className="w-full border border-dashed border-border/50 hover:border-primary/30 font-mono text-xs text-muted-foreground hover:text-primary mt-2"
      >
        <Plus className="size-3 mr-1.5" /> {t("pages.workflows.editor.addStep")}
      </Button>
    </div>
  );
}

// ── Create workflow dialog ────────────────────────────────────────────────────

function CreateWorkflowDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useLang();
  const create = useCreateWorkflow();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "active" | "paused">("draft");
  const [tags, setTags] = useState("");
  const [steps, setSteps] = useState<StepType[]>([]);

  const handleSubmit = async () => {
    if (!name.trim()) { toast({ title: t("pages.workflows.toast.nameRequired"), variant: "destructive" }); return; }
    try {
      await create.mutateAsync(
        {
          data: {
            name,
            description: description || undefined,
            status,
            tags: tags ? tags.split(",").map((tg) => tg.trim()).filter(Boolean) : [],
            steps: steps.sort((a, b) => a.order - b.order),
          },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
            toast({ title: t("pages.workflows.toast.created") });
            onClose();
            setName(""); setDescription(""); setStatus("draft"); setTags(""); setSteps([]);
          },
        },
      );
    } catch {
      toast({ title: t("pages.workflows.toast.createFailed"), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">{t("pages.workflows.dialog.title")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.workflows.dialog.name")} *</Label>
            <Input placeholder={t("pages.workflows.dialog.namePh")} value={name} onChange={(e) => setName(e.target.value)} className="bg-background/50" />
          </div>
          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.workflows.dialog.status")}</Label>
            <Select value={status} onValueChange={(v: typeof status) => setStatus(v)}>
              <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("common.status.draft")}</SelectItem>
                <SelectItem value="active">{t("common.status.active")}</SelectItem>
                <SelectItem value="paused">{t("common.status.paused")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.workflows.dialog.description")}</Label>
            <Textarea placeholder={t("pages.workflows.dialog.descPh")} value={description} onChange={(e) => setDescription(e.target.value)} className="bg-background/50 resize-none" rows={2} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.workflows.dialog.tags")} <span className="text-muted-foreground/60">{t("pages.workflows.dialog.tagsHint")}</span></Label>
            <Input placeholder={t("pages.workflows.dialog.tagsPh")} value={tags} onChange={(e) => setTags(e.target.value)} className="bg-background/50" />
          </div>

          {/* Step builder */}
          <div className="col-span-2 space-y-3 border-t border-border/50 pt-4">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.workflows.pipelineSteps")}</Label>
            <StepEditor steps={steps} onChange={setSteps} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="font-mono text-xs uppercase tracking-wider">{t("common.actions.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={create.isPending} className="font-mono text-xs uppercase tracking-wider">
            <Plus className="size-3 mr-1.5" />{create.isPending ? t("common.actions.creating") : t("common.actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Workflow detail panel ────────────────────────────────────────────────────

function WorkflowDetail({
  workflow,
  onClose,
}: {
  workflow: { id: number; name: string; description?: string | null; status: string; steps: unknown; tags: string[]; updatedAt: string };
  onClose: () => void;
}) {
  const { t } = useLang();
  const update = useUpdateWorkflow();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rawSteps = (Array.isArray(workflow.steps) ? workflow.steps : []) as StepType[];
  const [steps, setSteps] = useState<StepType[]>(rawSteps);
  const [dirty, setDirty] = useState(false);

  const handleChange = (s: StepType[]) => { setSteps(s); setDirty(true); };

  const handleSave = async () => {
    try {
      await update.mutateAsync(
        { id: workflow.id, data: { steps: steps.sort((a, b) => a.order - b.order) } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
            toast({ title: t("pages.workflows.toast.saved") });
            setDirty(false);
          },
        },
      );
    } catch {
      toast({ title: t("pages.workflows.toast.saveFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="w-[420px] flex-shrink-0 animate-in slide-in-from-right-4 duration-300">
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader className="pb-3 flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base font-semibold">{workflow.name}</CardTitle>
            {workflow.description && <p className="text-xs text-muted-foreground mt-0.5">{workflow.description}</p>}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Tabs: edit vs preview */}
          <div className="border-t border-border/50 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{t("pages.workflows.pipelineSteps")}</span>
              {dirty && (
                <Button size="sm" onClick={handleSave} disabled={update.isPending} className="h-6 font-mono text-[10px] uppercase tracking-wider px-2">
                  <Save className="size-3 mr-1" /> {update.isPending ? t("common.actions.saving") : t("common.actions.save")}
                </Button>
              )}
            </div>
            <StepEditor steps={steps} onChange={handleChange} />
          </div>

          {/* Preview */}
          {steps.length > 0 && (
            <div className="border-t border-border/50 pt-4 space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{t("pages.workflows.preview")}</span>
              <PipelineView steps={steps} />
            </div>
          )}

          <p className="text-[10px] font-mono text-muted-foreground/50">
            Updated {format(new Date(workflow.updatedAt), "MMM d, yyyy · HH:mm")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active: "border-green-500/30 text-green-400 bg-green-500/10",
  draft: "border-yellow-500/30 text-yellow-400 bg-yellow-500/10",
  paused: "border-muted text-muted-foreground",
  archived: "border-muted text-muted-foreground",
};

export default function Workflows() {
  const { t } = useLang();
  const { data: workflows, isLoading } = useListWorkflows();
  const deleteWorkflow = useDeleteWorkflow();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const getStepLabel = (value: string) => t(`pages.workflows.stepTypes.${value}`) || value;

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const selected = workflows?.find((w) => w.id === selectedId) ?? null;
  const filtered = (workflows ?? []).filter(
    (w) => w.name.toLowerCase().includes(search.toLowerCase()) || (w.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const handleDelete = async (id: number) => {
    try {
      await deleteWorkflow.mutateAsync(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListWorkflowsQueryKey() });
            if (selectedId === id) setSelectedId(null);
            toast({ title: t("pages.workflows.toast.deleted") });
          },
        },
      );
    } catch {
      toast({ title: t("pages.workflows.toast.deleteFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.workflows.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.workflows.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="font-mono text-xs uppercase tracking-wider">
          <Plus className="size-4 mr-2" /> {t("pages.workflows.newBtn")}
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Workflow list */}
        <div className={`flex-1 min-w-0 transition-all ${selected ? "max-w-[calc(100%-444px)]" : ""}`}>
          <Card className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <CardTitle className="text-sm font-medium font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <GitMerge className="size-4" /> {t("pages.workflows.engine")}
              </CardTitle>
              <div className="relative">
                <Input
                  placeholder={t("pages.workflows.search")}
                  className="w-[240px] bg-background/50"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-12 text-center text-muted-foreground font-mono text-sm">{t("pages.workflows.empty.loading")}</div>
              ) : filtered.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <GitMerge className="size-10 text-muted-foreground/20 mx-auto" />
                  <p className="text-muted-foreground font-mono text-sm">{t("pages.workflows.empty.none")}</p>
                  <p className="text-muted-foreground/60 text-xs">{t("pages.workflows.empty.hint")}</p>
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {filtered.map((wf) => {
                    const stepsArr = Array.isArray(wf.steps) ? wf.steps as StepType[] : [];
                    const isSelected = selectedId === wf.id;
                    return (
                      <div
                        key={wf.id}
                        onClick={() => setSelectedId(isSelected ? null : wf.id)}
                        className={`flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors group ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}
                      >
                        {/* Icon */}
                        <div className="size-10 rounded bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <GitMerge className="size-5 text-primary" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{wf.name}</span>
                            <Badge variant="outline" className={`font-mono text-[10px] uppercase px-1.5 h-5 ${STATUS_STYLES[wf.status] ?? STATUS_STYLES.draft}`}>
                              {t(`common.status.${wf.status}`) || wf.status}
                            </Badge>
                            {(wf.tags ?? []).map((tg) => (
                              <Badge key={tg} variant="secondary" className="font-mono text-[10px] bg-secondary/50 h-5">
                                {tg}
                              </Badge>
                            ))}
                          </div>
                          {wf.description && <p className="text-xs text-muted-foreground mb-2 truncate">{wf.description}</p>}

                          {/* Mini pipeline preview */}
                          {stepsArr.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap">
                              {[...stepsArr].sort((a, b) => a.order - b.order).map((step, i) => {
                                const def = getStepDef(step.type);
                                const Icon = def.icon;
                                return (
                                  <div key={step.id} className="flex items-center gap-1">
                                    <div className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border ${def.bg} ${def.border} ${def.color}`}>
                                      <Icon className="size-2.5" />
                                      {step.name || getStepLabel(step.type)}
                                    </div>
                                    {i < stepsArr.length - 1 && <span className="text-muted-foreground/30 text-[10px]">→</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Meta */}
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <p className="font-mono text-xs text-muted-foreground">{stepsArr.length} {t("pages.workflows.steps")}</p>
                            <p className="font-mono text-[10px] text-muted-foreground/60">{format(new Date(wf.updatedAt), "MMM d")}</p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-popover border-border">
                              <DropdownMenuItem
                                className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer"
                                onClick={(e) => { e.stopPropagation(); handleDelete(wf.id); }}
                              >
                                <Trash2 className="mr-2 h-3 w-3" /> {t("common.actions.delete")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail panel */}
        {selected && (
          <WorkflowDetail key={selected.id} workflow={selected as Parameters<typeof WorkflowDetail>[0]["workflow"]} onClose={() => setSelectedId(null)} />
        )}
      </div>

      <CreateWorkflowDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
