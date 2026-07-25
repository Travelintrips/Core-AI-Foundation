import { useState } from "react";
import {
  useListPrompts,
  useCreatePrompt,
  useUpdatePrompt,
  useDeletePrompt,
  getListPromptsQueryKey,
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
  FileText,
  Plus,
  Search,
  Copy,
  Check,
  Pencil,
  Trash2,
  MoreHorizontal,
  BookOpen,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/lib/i18n";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PromptFormData {
  name: string;
  category: string;
  customCategory: string;
  description: string;
  content: string;
  variables: string;
  tags: string;
  isActive: boolean;
}

const DEFAULT_FORM: PromptFormData = {
  name: "",
  category: "general",
  customCategory: "",
  description: "",
  content: "",
  variables: "",
  tags: "",
  isActive: true,
};

const PRESET_CATEGORIES = [
  "brand", "copy", "logo", "packaging", "social-media",
  "design", "naming", "brief", "review", "general",
];

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
      {copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

// ── Prompt form dialog ────────────────────────────────────────────────────────

function PromptDialog({
  open,
  initial,
  onClose,
  onSave,
  isPending,
}: {
  open: boolean;
  initial?: PromptFormData;
  onClose: () => void;
  onSave: (data: PromptFormData) => void;
  isPending: boolean;
}) {
  const { t } = useLang();
  const [form, setForm] = useState<PromptFormData>(initial ?? DEFAULT_FORM);
  const set = (k: keyof PromptFormData) => (v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Reset when dialog opens
  const handleOpen = (isOpen: boolean) => {
    if (isOpen && initial) setForm(initial);
    if (!isOpen) onClose();
  };

  const isEditing = !!initial?.name;
  const effectiveCategory = form.category === "__custom__" ? form.customCategory : form.category;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">
            {isEditing ? "Edit Prompt" : t("pages.prompts.dialog.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.prompts.dialog.name")} *</Label>
              <Input placeholder={t("pages.prompts.dialog.namePh")} value={form.name} onChange={(e) => set("name")(e.target.value)} className="bg-background/50" />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.prompts.dialog.category")} *</Label>
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                  <SelectItem value="__custom__">+ Custom category</SelectItem>
                </SelectContent>
              </Select>
              {form.category === "__custom__" && (
                <Input
                  placeholder={t("pages.prompts.dialog.categoryPh")}
                  value={form.customCategory}
                  onChange={(e) => set("customCategory")(e.target.value)}
                  className="bg-background/50 mt-1.5"
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">{t("pages.prompts.dialog.description")}</Label>
            <Input placeholder={t("pages.prompts.dialog.descPh")} value={form.description} onChange={(e) => set("description")(e.target.value)} className="bg-background/50" />
          </div>

          <div className="space-y-1.5">
            <Label className="font-mono text-xs uppercase text-muted-foreground">
              {t("pages.prompts.dialog.template")} *
              <span className="text-muted-foreground/60 ml-2 normal-case">Use &#123;&#123;variable&#125;&#125; for dynamic values</span>
            </Label>
            <Textarea
              placeholder={t("pages.prompts.dialog.templatePh")}
              value={form.content}
              onChange={(e) => set("content")(e.target.value)}
              className="bg-background/50 font-mono text-sm resize-none"
              rows={8}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                {t("pages.prompts.dialog.variables")} <span className="text-muted-foreground/60">({t("pages.workflows.dialog.tagsHint")})</span>
              </Label>
              <Input
                placeholder={t("pages.prompts.dialog.variablesPh")}
                value={form.variables}
                onChange={(e) => set("variables")(e.target.value)}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-mono text-xs uppercase text-muted-foreground">
                {t("pages.prompts.dialog.tags")} <span className="text-muted-foreground/60">({t("pages.workflows.dialog.tagsHint")})</span>
              </Label>
              <Input
                placeholder={t("pages.prompts.dialog.tagsPh")}
                value={form.tags}
                onChange={(e) => set("tags")(e.target.value)}
                className="bg-background/50"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={form.isActive}
              onChange={(e) => set("isActive")(e.target.checked)}
              className="rounded"
            />
            <Label htmlFor="isActive" className="font-mono text-xs text-muted-foreground cursor-pointer">{t("pages.prompts.dialog.isActive")}</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} className="font-mono text-xs uppercase tracking-wider">{t("common.actions.cancel")}</Button>
          <Button
            onClick={() => onSave({ ...form, category: effectiveCategory })}
            disabled={isPending || !form.name.trim() || !form.content.trim()}
            className="font-mono text-xs uppercase tracking-wider"
          >
            {isEditing ? <><Pencil className="size-3 mr-1.5" />{isPending ? t("common.actions.saving") : "Save Changes"}</> : <><Plus className="size-3 mr-1.5" />{isPending ? t("common.actions.creating") : "Create Prompt"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Prompts() {
  const { t } = useLang();
  const { data: prompts, isLoading } = useListPrompts();
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();
  const deletePrompt = useDeletePrompt();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(typeof prompts extends (infer T)[] | undefined ? T : never) | null>(null);

  // Derive categories from data
  const allCategories = Array.from(new Set((prompts ?? []).map((p) => p.category))).sort();

  const filtered = (prompts ?? []).filter((p) => {
    const matchCat = !categoryFilter || p.category === categoryFilter;
    const matchSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.content.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleCreate = async (form: PromptFormData) => {
    try {
      await createPrompt.mutateAsync(
        {
          data: {
            name: form.name,
            category: form.category,
            content: form.content,
            description: form.description || undefined,
            variables: form.variables ? form.variables.split(",").map((v) => v.trim()).filter(Boolean) : [],
            tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
            isActive: form.isActive,
          },
        },
        {
          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey() }); toast({ title: t("pages.prompts.toast.created") }); setCreateOpen(false); },
        },
      );
    } catch {
      toast({ title: t("pages.prompts.toast.createFailed"), variant: "destructive" });
    }
  };

  const handleEdit = async (form: PromptFormData) => {
    if (!editTarget) return;
    try {
      await updatePrompt.mutateAsync(
        {
          id: editTarget.id,
          data: {
            name: form.name,
            category: form.category,
            content: form.content,
            description: form.description || undefined,
            variables: form.variables ? form.variables.split(",").map((v) => v.trim()).filter(Boolean) : [],
            tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
            isActive: form.isActive,
          },
        },
        {
          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey() }); toast({ title: t("pages.prompts.toast.updated") }); setEditTarget(null); },
        },
      );
    } catch {
      toast({ title: t("pages.prompts.toast.updateFailed"), variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deletePrompt.mutateAsync(
        { id },
        {
          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPromptsQueryKey() }); toast({ title: t("pages.prompts.toast.deleted") }); },
        },
      );
    } catch {
      toast({ title: t("pages.prompts.toast.deleteFailed"), variant: "destructive" });
    }
  };

  const toFormData = (p: NonNullable<typeof editTarget>): PromptFormData => ({
    name: p.name,
    category: p.category,
    customCategory: "",
    description: p.description ?? "",
    content: p.content,
    variables: (p.variables ?? []).join(", "),
    tags: (p.tags ?? []).join(", "),
    isActive: p.isActive,
  });

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.prompts.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.prompts.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="font-mono text-xs uppercase tracking-wider">
          <Plus className="size-4 mr-2" /> {t("pages.prompts.dialog.title")}
        </Button>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <div className="space-y-2">
          <Card className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{t("pages.prompts.categories")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <div className="space-y-0.5 px-2">
                <button
                  onClick={() => setCategoryFilter(null)}
                  className={`w-full text-left text-sm font-mono px-3 py-2 rounded transition-colors ${!categoryFilter ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/30"}`}
                >
                  All Prompts
                  <span className="float-right text-xs text-muted-foreground/60">{prompts?.length ?? 0}</span>
                </button>
                {allCategories.map((cat) => {
                  const count = (prompts ?? []).filter((p) => p.category === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat === categoryFilter ? null : cat)}
                      className={`w-full text-left text-sm font-mono px-3 py-2 rounded capitalize transition-colors ${categoryFilter === cat ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/30"}`}
                    >
                      {cat}
                      <span className="float-right text-xs text-muted-foreground/60">{count}</span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main content */}
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("pages.prompts.search")}
              className="pl-10 bg-card/50 border-border/50"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground font-mono text-sm border border-border/50 rounded-lg bg-card/50">{t("pages.prompts.empty.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center space-y-3 border border-border/50 rounded-lg bg-card/50">
              <BookOpen className="size-10 text-muted-foreground/20 mx-auto" />
              <p className="text-muted-foreground font-mono text-sm">{t("pages.prompts.empty.none")}</p>
              <p className="text-muted-foreground/60 text-xs">{t("pages.prompts.empty.hint")}</p>
            </div>
          ) : (
            filtered.map((prompt) => (
              <Card key={prompt.id} className="border-border/50 bg-card/50 backdrop-blur hover:border-primary/20 transition-colors group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="size-8 rounded bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <FileText className="size-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{prompt.name}</h3>
                          <Badge variant="outline" className="font-mono text-[10px] border-primary/20 text-primary bg-primary/5">v{prompt.version}</Badge>
                          {prompt.isActive && (
                            <Badge variant="outline" className="font-mono text-[10px] border-green-500/30 text-green-400 bg-green-500/10">{t("pages.prompts.active")}</Badge>
                          )}
                          <Badge variant="secondary" className="font-mono text-[10px] capitalize bg-secondary/50">{prompt.category}</Badge>
                        </div>
                        {prompt.description && <p className="text-xs text-muted-foreground mt-0.5">{prompt.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <CopyButton text={prompt.content} />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreHorizontal className="size-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          <DropdownMenuItem className="font-mono text-xs cursor-pointer" onClick={() => setEditTarget(prompt)}>
                            <Pencil className="mr-2 h-3 w-3" /> {t("common.actions.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="font-mono text-xs text-destructive focus:text-destructive cursor-pointer" onClick={() => handleDelete(prompt.id)}>
                            <Trash2 className="mr-2 h-3 w-3" /> {t("common.actions.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Content preview */}
                  <div className="bg-background/60 border border-border/40 rounded-md p-3 font-mono text-xs text-foreground/75 line-clamp-3 leading-relaxed whitespace-pre-wrap">
                    {prompt.content}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex flex-wrap gap-1">
                      {(prompt.variables ?? []).map((v) => (
                        <Badge key={v} variant="outline" className="font-mono text-[10px] border-border/50 text-foreground/50">
                          &#123;&#123;{v}&#125;&#125;
                        </Badge>
                      ))}
                      {(prompt.tags ?? []).map((t) => (
                        <Badge key={t} variant="secondary" className="font-mono text-[10px] bg-secondary/50 text-muted-foreground">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground/60 flex-shrink-0">
                      {(prompt.usageCount ?? 0).toLocaleString()} uses · {format(new Date(prompt.updatedAt), "MMM d, yyyy")}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <PromptDialog open={createOpen} onClose={() => setCreateOpen(false)} onSave={handleCreate} isPending={createPrompt.isPending} />
      {editTarget && (
        <PromptDialog
          open={!!editTarget}
          initial={toFormData(editTarget)}
          onClose={() => setEditTarget(null)}
          onSave={handleEdit}
          isPending={updatePrompt.isPending}
        />
      )}
    </div>
  );
}
