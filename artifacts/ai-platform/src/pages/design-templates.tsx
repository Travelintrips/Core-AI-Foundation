/**
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
