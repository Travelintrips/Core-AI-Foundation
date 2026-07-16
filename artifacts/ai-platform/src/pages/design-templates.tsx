/**
 * Design Templates — Listing page for the Design Template Engine (Phase 1/2+).
 *
 * Shows all templates with status, version, and a link to the visual editor.
 * Route: /design-templates
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus, Pencil, Eye, Copy, Trash2, Loader2, Search,
  LayoutTemplate, CheckCircle2, Archive, FileText,
 * Design Template Library — /design-templates
 *
 * Lists all tenant-scoped design templates with search, status/category
 * filters, pagination, create-draft modal, duplicate, archive/restore,
 * and a quick-preview launcher.
 */

import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, LayoutTemplate, MoreVertical, Eye, Copy,
  Archive, RotateCcw, ChevronLeft, ChevronRight, Loader2,
  AlertCircle, FileImage,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const API_BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    credentials: "include",
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface Template {
  id: number;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  status: string;
  activeVersionId?: number;
  thumbnailUrl?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "border-[#7C6EFA] text-[#9D91FB]",
  published: "border-green-600 text-green-400",
  archived: "border-gray-600 text-gray-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", STATUS_COLORS[status] ?? "")}>
      {status}
    </Badge>
  );
}

interface CreateTemplateForm {
  name: string;
  slug: string;
  description: string;
  category: string;
  canvasWidth: string;
  canvasHeight: string;
}

const CANVAS_PRESETS = [
  { label: "Square 1:1 (1080×1080)", w: 1080, h: 1080 },
  { label: "Portrait 4:5 (1080×1350)", w: 1080, h: 1350 },
  { label: "Story 9:16 (1080×1920)", w: 1080, h: 1920 },
  { label: "Landscape 16:9 (1920×1080)", w: 1920, h: 1080 },
  { label: "Banner (1200×628)", w: 1200, h: 628 },
  { label: "Custom", w: 0, h: 0 },
] as const;

export default function DesignTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateTemplateForm>({
    name: "", slug: "", description: "", category: "",
    canvasWidth: "1080", canvasHeight: "1080",
  });

  const { data, isLoading } = useQuery<{ items: Template[]; total: number }>({
    queryKey: ["design-templates"],
    queryFn: () => apiFetch("/api/ai/design-templates"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Template>("/api/ai/design-templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      setShowCreate(false);
      setForm({ name: "", slug: "", description: "", category: "", canvasWidth: "1080", canvasHeight: "1080" });
      toast({ title: "Template created" });
    },
    onError: (e: Error) => {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/design-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const templates = (data?.items ?? []).filter(
    (t) => !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
            (t.category ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const handleCreate = () => {
    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const slug = form.slug.trim() || autoSlug(form.name);
    createMutation.mutate({
      name: form.name.trim(),
      slug,
      description: form.description || undefined,
      category: form.category || undefined,
      canvasWidth: parseInt(form.canvasWidth) || 1080,
      canvasHeight: parseInt(form.canvasHeight) || 1080,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: "#060B18" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #1E3057" }}
      >
        <div className="flex items-center gap-3">
          <LayoutTemplate className="size-5 text-[#7C6EFA]" />
          <div>
            <h1 className="text-base font-semibold text-[#F0F4FF]">Design Templates</h1>
            <p className="text-xs text-[#4F6494]">Create and manage reusable design templates</p>
          </div>
        </div>
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          style={{ background: "#7C6EFA" }}
          onClick={() => setShowCreate(true)}
        >
          <Plus className="size-3.5" />
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  listTemplates, createTemplate, duplicateTemplate, updateTemplate,
} from "@/services/design-template-api";
import type { DesignTemplate, TemplateStatus } from "@/types/design-template-ui";
import PreviewModal from "./design-template-preview-modal";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700 border-yellow-200",
  published: "bg-green-100 text-green-700 border-green-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
};

const CATEGORIES = [
  "Social Media", "Presentation", "Print", "Marketing", "Brand Identity",
  "Web Banner", "Email", "Video Thumbnail", "Certificate", "Other",
];

// ── Template Card ─────────────────────────────────────────────────────────────

function TemplatePlaceholder({ name, category }: { name: string; category: string | null }) {
  const initials = name.slice(0, 2).toUpperCase();
  const hue = (name.charCodeAt(0) * 37 + (name.charCodeAt(1) ?? 0) * 13) % 360;
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1"
      style={{ background: `hsl(${hue},55%,92%)` }}
    >
      <span className="text-2xl font-bold" style={{ color: `hsl(${hue},45%,40%)` }}>
        {initials}
      </span>
      {category && (
        <span className="text-[10px]" style={{ color: `hsl(${hue},35%,50%)` }}>
          {category}
        </span>
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: DesignTemplate;
  onPreview: (t: DesignTemplate) => void;
  onDuplicate: (t: DesignTemplate) => void;
  onArchive: (t: DesignTemplate) => void;
  onRestore: (t: DesignTemplate) => void;
}

function TemplateCard({ template, onPreview, onDuplicate, onArchive, onRestore }: TemplateCardProps) {
  const isArchived = template.status === "archived";

  return (
    <div className={`group bg-white rounded-xl border overflow-hidden transition-all hover:shadow-md ${isArchived ? "opacity-60 border-gray-200" : "border-gray-200 hover:border-indigo-200"}`}>
      {/* Thumbnail */}
      <Link href={`/design-templates/${template.id}`}>
        <div className="aspect-video bg-gray-50 relative cursor-pointer overflow-hidden">
          <TemplatePlaceholder name={template.name} category={template.category} />
          <div className="absolute inset-0 bg-indigo-600/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-sm font-medium">View Details</span>
          </div>
        </div>
      </Link>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <Link href={`/design-templates/${template.id}`}>
              <h3 className="text-sm font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors cursor-pointer">
                {template.name}
              </h3>
            </Link>
            {template.description && (
              <p className="text-xs text-gray-400 truncate mt-0.5">{template.description}</p>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 rounded hover:bg-gray-100 ml-1 shrink-0"
                aria-label={`Actions for ${template.name}`}
              >
                <MoreVertical className="h-3.5 w-3.5 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/design-templates/${template.id}`}>
                  <LayoutTemplate className="h-3.5 w-3.5 mr-2" /> View Details
                </Link>
              </DropdownMenuItem>
              {template.activeVersionId && (
                <DropdownMenuItem onClick={() => onPreview(template)}>
                  <Eye className="h-3.5 w-3.5 mr-2" /> Quick Preview
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onDuplicate(template)}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isArchived ? (
                <DropdownMenuItem onClick={() => onRestore(template)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-2" /> Restore to Draft
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-orange-600 focus:text-orange-700"
                  onClick={() => onArchive(template)}
                >
                  <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[template.status] ?? ""}`}>
            {template.status}
          </Badge>
          {template.category && (
            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 truncate max-w-[80px]">
              {template.category}
            </span>
          )}
          {template.activeVersionId && (
            <span className="text-[10px] text-gray-400 ml-auto">
              v{template.activeVersionId && "—"}
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          Updated {new Date(template.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      </div>
    </div>
  );
}

// ── Create Template Modal ─────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (t: DesignTemplate) => void;
}

function CreateModal({ open, onOpenChange, onCreated }: CreateModalProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");

  const mutation = useMutation({
    mutationFn: () => createTemplate({ name: name.trim(), description: description.trim() || undefined, category: category.trim() || undefined }),
    onSuccess: (t) => {
      toast({ title: "Template draft created" });
      onCreated(t);
      setName(""); setDescription(""); setCategory("");
    },
    onError: (e: Error) => toast({ title: "Failed to create template", description: e.message, variant: "destructive" }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Template Draft</DialogTitle>
          <DialogDescription>
            Start with basic metadata. Add canvas layers later in the editor.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label htmlFor="tpl-name">Name <span aria-hidden>*</span></Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Instagram Post — Product Launch"
              className="mt-1"
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="tpl-category">Category</Label>
            <Input
              id="tpl-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="tpl-category-list"
              placeholder="Social Media, Print, etc."
              className="mt-1"
            />
            <datalist id="tpl-category-list">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <Label htmlFor="tpl-desc">Description</Label>
            <Textarea
              id="tpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Briefly describe what this template is for (optional)"
              className="mt-1 resize-none"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Archive / Restore Confirmation ────────────────────────────────────────────

interface ArchiveDialogProps {
  template: DesignTemplate | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  mode: "archive" | "restore";
}

function ArchiveDialog({ template, onClose, onConfirm, isPending, mode }: ArchiveDialogProps) {
  return (
    <AlertDialog open={template != null} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "archive" ? "Archive template?" : "Restore template?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {mode === "archive"
              ? `"${template?.name}" will be archived and hidden from active use. You can restore it later from the Archived filter.`
              : `"${template?.name}" will be restored to Draft status and become active again.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className={mode === "archive" ? "bg-orange-600 hover:bg-orange-700" : ""}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "archive" ? "Archive" : "Restore"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DesignTemplatesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Filters & pagination
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Modal state
  const [showCreate, setShowCreate] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<DesignTemplate | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DesignTemplate | null>(null);
  const [previewTarget, setPreviewTarget] = useState<DesignTemplate | null>(null);

  // Data fetch
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["design-templates", statusFilter, categoryFilter, page],
    queryFn: () => listTemplates({ status: statusFilter, category: categoryFilter || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const templates = data?.templates ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Client-side name search on current page
  const filtered = search.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : templates;

  // Mutations
  const archiveMutation = useMutation({
    mutationFn: (t: DesignTemplate) => updateTemplate(t.id, { status: "archived" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template archived" });
      setArchiveTarget(null);
    },
    onError: (e: Error) => toast({ title: "Failed to archive", description: e.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (t: DesignTemplate) => updateTemplate(t.id, { status: "draft" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template restored to draft" });
      setRestoreTarget(null);
    },
    onError: (e: Error) => toast({ title: "Failed to restore", description: e.message, variant: "destructive" }),
  });

  const duplicateMutation = useMutation({
    mutationFn: (t: DesignTemplate) => duplicateTemplate(t.id),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template duplicated", description: `"${copy.name}" created as a new draft.` });
      navigate(`/design-templates/${copy.id}`);
    },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const handleCreated = useCallback((t: DesignTemplate) => {
    qc.invalidateQueries({ queryKey: ["design-templates"] });
    setShowCreate(false);
    navigate(`/design-templates/${t.id}`);
  }, [qc, navigate]);

  const handleStatusFilter = (s: string) => {
    setStatusFilter(s);
    setPage(1);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <LayoutTemplate className="h-6 w-6 text-indigo-600" />
            Design Template Library
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage reusable design templates for batch rendering.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      {/* Search + stats */}
      <div className="flex items-center gap-3 px-6 py-3 flex-shrink-0" style={{ borderBottom: "1px solid #1E3057" }}>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[#4F6494]" />
          <Input
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs bg-[#0A1020] border-[#1E3057] text-[#F0F4FF]"
          />
        </div>
        <span className="text-xs text-[#4F6494]">
          {templates.length} template{templates.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Template grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-20 text-[#4F6494]">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-[#4F6494]">
            <LayoutTemplate className="size-12 opacity-30" />
            <p className="text-sm">
              {search ? "No templates match your search" : "No templates yet. Create your first one!"}
            </p>
            {!search && (
              <Button
                size="sm" style={{ background: "#7C6EFA" }}
                onClick={() => setShowCreate(true)}
              >
                <Plus className="size-3.5 mr-1" /> Create Template
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {templates.map((t) => (
              <Card
                key={t.id}
                className="group border-[#1E3057] hover:border-[#7C6EFA] transition-colors"
                style={{ background: "#0A1020" }}
              >
                {/* Thumbnail */}
                <div
                  className="h-32 rounded-t-lg flex items-center justify-center text-[#4F6494]"
                  style={{ background: "#060B18", borderBottom: "1px solid #1E3057" }}
                >
                  {t.thumbnailUrl ? (
                    <img src={t.thumbnailUrl} alt={t.name} className="w-full h-full object-cover rounded-t-lg" />
                  ) : (
                    <LayoutTemplate className="size-10 opacity-30" />
                  )}
                </div>

                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[#F0F4FF] truncate flex-1">{t.name}</p>
                    <StatusBadge status={t.status} />
                  </div>

                  {t.category && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-[#1E3057] text-[#4F6494]">
                      {t.category}
                    </Badge>
                  )}

                  {t.description && (
                    <p className="text-[11px] text-[#4F6494] line-clamp-2">{t.description}</p>
                  )}

                  <p className="text-[10px] text-[#4F6494]">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-1.5 pt-1">
                    <Link href={`/design-templates/${t.id}/editor`} className="flex-1">
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs gap-1"
                        style={{ background: "#7C6EFA" }}
                      >
                        <Pencil className="size-3" />
                        Edit
                      </Button>
                    </Link>
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      onClick={() => {
                        if (confirm(`Delete "${t.name}"?`)) deleteMutation.mutate(t.id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Template Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-[#0A1020] border-[#1E3057] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#F0F4FF]">New Design Template</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-[#8899BB]">Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value, slug: autoSlug(e.target.value) });
                }}
                placeholder="e.g. Product Catalog Card"
                className="h-8 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#8899BB]">Slug (auto-generated)</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="product-catalog-card"
                className="h-8 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#8899BB]">Category</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Social Media, Print, Digital"
                className="h-8 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#8899BB]">Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF] resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-[#8899BB]">Canvas Size</Label>
              <Select
                onValueChange={(v) => {
                  const preset = CANVAS_PRESETS.find((p) => p.label === v);
                  if (preset && preset.w > 0) {
                    setForm({ ...form, canvasWidth: String(preset.w), canvasHeight: String(preset.h) });
                  }
                }}
              >
                <SelectTrigger className="h-8 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]">
                  <SelectValue placeholder="Select preset…" />
                </SelectTrigger>
                <SelectContent>
                  {CANVAS_PRESETS.filter((p) => p.w > 0).map((p) => (
                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 mt-1">
                <Input
                  type="number" value={form.canvasWidth}
                  onChange={(e) => setForm({ ...form, canvasWidth: e.target.value })}
                  placeholder="Width" min={1} max={8000}
                  className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
                />
                <span className="text-[#4F6494] self-center text-xs">×</span>
                <Input
                  type="number" value={form.canvasHeight}
                  onChange={(e) => setForm({ ...form, canvasHeight: e.target.value })}
                  placeholder="Height" min={1} max={8000}
                  className="h-7 text-xs bg-[#060B18] border-[#1E3057] text-[#F0F4FF]"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost" size="sm"
              className="text-xs border-[#1E3057]"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs gap-1"
              style={{ background: "#7C6EFA" }}
              onClick={handleCreate}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="size-3 animate-spin" />}
              Create & Open Editor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="pl-9 h-9"
            aria-label="Search templates by name"
          />
        </div>

        {/* Category */}
        <div className="relative w-48">
          <Input
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            list="filter-category-list"
            placeholder="Category…"
            className="h-9"
            aria-label="Filter by category"
          />
          <datalist id="filter-category-list">
            {CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 ml-auto">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleStatusFilter(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter === key
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
              aria-pressed={statusFilter === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Result summary ── */}
      {data && !isLoading && (
        <p className="text-sm text-gray-400 mb-4">
          {total} template{total !== 1 ? "s" : ""}
          {search && filtered.length !== templates.length ? ` · ${filtered.length} matching "${search}"` : ""}
        </p>
      )}

      {/* ── Error ── */}
      {isError && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-6 text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{(error as Error)?.message ?? "Failed to load templates"}</span>
        </div>
      )}

      {/* ── Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-100 animate-pulse rounded-xl overflow-hidden">
              <div className="aspect-video" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-3/4" />
                <div className="h-2 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 text-gray-400">
          <FileImage className="h-12 w-12 mx-auto mb-3 opacity-30" aria-hidden />
          <p className="text-sm font-medium">No templates found</p>
          <p className="text-xs mt-1">
            {search ? `No results for "${search}" — try a different search.` : "Create your first template to get started."}
          </p>
          {!search && (
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> New Template
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onPreview={setPreviewTarget}
              onDuplicate={(t) => duplicateMutation.mutate(t)}
              onArchive={setArchiveTarget}
              onRestore={setRestoreTarget}
            />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── Modals ── */}
      <CreateModal open={showCreate} onOpenChange={setShowCreate} onCreated={handleCreated} />

      <ArchiveDialog
        template={archiveTarget}
        mode="archive"
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget)}
        isPending={archiveMutation.isPending}
      />
      <ArchiveDialog
        template={restoreTarget}
        mode="restore"
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget)}
        isPending={restoreMutation.isPending}
      />

      {previewTarget && (
        <PreviewModal
          templateId={previewTarget.id}
          templateName={previewTarget.name}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}
