/**
 * design-templates.tsx — Template Library Admin UI
 * Routes: /design-templates (list), /design-templates/:id (detail)
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Plus, Search, Archive, Copy, CheckCircle, Clock,
  Layers, MoreVertical, ImageOff, FileStack, ChevronLeft,
  AlertTriangle, Sparkles, PenLine, Loader2, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── API helper ─────────────────────────────────────────────────────────────────
// Use empty string so fetch("/api/...") goes through the Vite /api proxy.
// Do NOT use import.meta.env.BASE_URL — it prepends "/admin" and breaks the proxy.
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
    try {
      const b = await res.json();
      if (b?.error) msg = b.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DesignTemplate {
  id: number;
  name: string;
  description?: string | null;
  category?: string | null;
  style?: string | null;
  status: string;
  thumbnailUrl?: string | null;
  activeVersionId?: number | null;
  versionCount?: number;
  createdAt: string;
  updatedAt: string;
  tenantId?: number;
}

export interface TemplateVersion {
  id: number;
  templateId: number;
  versionNumber: number;
  status: string;
  changelog?: string | null;
  createdBy?: string | null;
  createdAt: string;
  publishedAt?: string | null;
}

interface TemplateListResponse {
  items: DesignTemplate[];
  total: number;
  page: number;
  pageSize: number;
}

interface VersionListResponse {
  versions: TemplateVersion[];
}

// ── Status badge styles ────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft:     "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  active:    "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  published: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  archived:  "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

// ── Thumbnail ──────────────────────────────────────────────────────────────────

function TemplateThumbnail({ url, name }: { url?: string | null; name: string }) {
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return (
      <img
        src={url}
        alt={name}
        className="w-full h-full object-cover"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1">
      <ImageOff className="w-6 h-6 text-zinc-600" />
      <span className="text-[10px] text-zinc-600">No preview</span>
    </div>
  );
}

// ── Version Preview Image ──────────────────────────────────────────────────────
// Renders backend-served preview for a specific template/version.
// Only rendered on the detail page, not on list cards.

function VersionPreview({ templateId, versionId }: { templateId: number; versionId: number }) {
  const [errored, setErrored] = useState(false);
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  // We use a POST endpoint, but for simple <img> display we use GET preview data endpoint
  // to avoid triggering expensive renders on every card.
  // The detail page shows a placeholder; on demand the user can view via thumbnail.
  const previewUrl = `${API_BASE}/api/ai/design-templates/${templateId}/versions/${versionId}/preview`;

  if (errored) {
    return (
      <div className="w-full h-28 flex items-center justify-center bg-zinc-800 rounded">
        <ImageOff className="w-5 h-5 text-zinc-600" />
      </div>
    );
  }

  return (
    <img
      src={previewUrl}
      alt={`Version ${versionId} preview`}
      className="w-full h-28 object-cover rounded bg-zinc-800"
      onError={() => setErrored(true)}
      {...(key ? { headers: undefined } : {})}
    />
  );
}

// ── Confirmation Dialog ────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel,
  confirmVariant = "default", loading, onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="confirm-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={loading}
            data-testid="confirm-button"
          >
            {loading ? "Processing…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Template Dialog ─────────────────────────────────────────────────────

interface CreateTemplateDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (t: DesignTemplate) => void;
}

const CATEGORIES = [
  "Social Media", "Presentation", "Flyer", "Banner",
  "Brochure", "Email", "Print", "Other",
];
const STYLES = ["Modern", "Minimal", "Bold", "Elegant", "Playful", "Corporate"];

function CreateTemplateDialog({ open, onOpenChange, onCreated }: CreateTemplateDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [style, setStyle] = useState("");

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<DesignTemplate>("/api/ai/design-templates", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template created", description: `"${t.name}" created — sekarang buat version pertamanya.` });
      onCreated(t);
      setName(""); setDescription(""); setCategory(CATEGORIES[0]!); setStyle("");
    },
    onError: (e: Error) => toast({ title: "Failed to create template", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!name.trim()) return;
    createMut.mutate({ name: name.trim(), description: description || undefined, category, style: style || undefined });
  }

  function handleAiGenerate() {
    onOpenChange(false);
    navigate("/design-templates/ai-create");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="create-template-dialog">
        <DialogHeader>
          <DialogTitle>New Design Template</DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            Buat template baru secara manual, atau biarkan AI yang mendesain dari prompt.
          </DialogDescription>
        </DialogHeader>

        {/* AI path — prominent option */}
        <button
          type="button"
          onClick={handleAiGenerate}
          className="w-full flex items-start gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 hover:bg-indigo-500/10 transition-colors p-3 text-left"
        >
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Generate with AI ✨</p>
            <p className="text-xs text-zinc-400 mt-0.5">Deskripsikan template yang kamu inginkan — AI akan membuat desain lengkap dengan elemen dan variabel.</p>
          </div>
        </button>

        <div className="flex items-center gap-2 my-1">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider">atau manual</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-zinc-400">Template Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Instagram Post — Summer 2025"
              className="mt-1"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
              data-testid="input-template-name"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-400">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
              rows={2}
              className="mt-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-zinc-400">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="mt-1 h-9" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-zinc-400">Style</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="mt-1 h-9">
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">— None —</SelectItem>
                  {STYLES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createMut.isPending} data-testid="button-create-template">
            {createMut.isPending ? "Creating…" : "Create Shell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE LIBRARY PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const PAGE_SIZE = 20;

export default function DesignTemplatesPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  // Build query params
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (categoryFilter !== "all") params.set("category", categoryFilter);
  if (search.trim()) params.set("search", search.trim());

  const { data, isLoading, isError, error } = useQuery<TemplateListResponse>({
    queryKey: ["design-templates", statusFilter, categoryFilter, search, page],
    queryFn: () => apiFetch(`/api/ai/design-templates?${params}`),
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // Reset page on filter change
  function applyStatusFilter(v: string) { setStatusFilter(v); setPage(1); }
  function applyCategoryFilter(v: string) { setCategoryFilter(v); setPage(1); }
  function applySearch(v: string) { setSearch(v); setPage(1); }

  function handleCreated(t: DesignTemplate) {
    setCreateOpen(false);
    navigate(`/design-templates/${t.id}`);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <FileStack className="w-6 h-6 text-indigo-400" />
            Template Library
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Manage design templates, versions, and publishing status
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2" data-testid="button-new-template">
          <Plus className="w-4 h-4" />
          New Template
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5" data-testid="filter-bar">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => applySearch(e.target.value)}
            placeholder="Search templates…"
            className="pl-9 h-9"
            data-testid="input-search"
          />
        </div>

        <Select value={statusFilter} onValueChange={applyStatusFilter}>
          <SelectTrigger className="h-9 w-36" data-testid="filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={applyCategoryFilter}>
          <SelectTrigger className="h-9 w-40" data-testid="filter-category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {data && (
          <span className="text-xs text-zinc-500 ml-auto">
            {data.total} template{data.total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── States ── */}
      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="loading-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-zinc-800 animate-pulse rounded-xl h-48" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div
          className="flex flex-col items-center justify-center py-20 text-center"
          data-testid="error-state"
        >
          <AlertTriangle className="w-12 h-12 text-red-400 mb-3" />
          <p className="text-sm text-red-400 font-medium">Failed to load templates</p>
          <p className="text-xs text-zinc-500 mt-1">{(error as Error)?.message}</p>
        </div>
      )}

      {!isLoading && !isError && data?.items.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-20 text-center"
          data-testid="empty-state"
        >
          <FileStack className="w-12 h-12 text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400 font-medium">No templates found</p>
          <p className="text-xs text-zinc-600 mt-1">
            {search || statusFilter !== "all" || categoryFilter !== "all"
              ? "Try adjusting your filters"
              : "Create your first design template to get started"}
          </p>
          {!search && statusFilter === "all" && categoryFilter === "all" && (
            <Button onClick={() => setCreateOpen(true)} className="mt-4 gap-2" size="sm">
              <Plus className="w-3.5 h-3.5" />
              New Template
            </Button>
          )}
        </div>
      )}

      {/* ── Template Grid ── */}
      {!isLoading && !isError && (data?.items.length ?? 0) > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4" data-testid="template-grid">
          {data!.items.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              template={tpl}
              onClick={() => navigate(`/design-templates/${tpl.id}`)}
            />
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8" data-testid="pagination">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-zinc-400">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}

      {/* ── Dialogs ── */}
      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

// ── Template Card ──────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: DesignTemplate;
  onClick: () => void;
}

function TemplateCard({ template, onClick }: TemplateCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [, navigate] = useLocation();

  const archiveMut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ai/design-templates/${template.id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      setArchiveOpen(false);
      toast({ title: "Template archived", description: `"${template.name}" has been archived.` });
    },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const duplicateMut = useMutation({
    mutationFn: () =>
      apiFetch<DesignTemplate>(`/api/ai/design-templates/${template.id}/duplicate`, { method: "POST" }),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template duplicated", description: `Copy created: "${copy.name}"` });
      navigate(`/design-templates/${copy.id}`);
    },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <Card
        className="group bg-zinc-900 border-zinc-800 hover:border-indigo-500/40 hover:shadow-md transition-all cursor-pointer overflow-hidden"
        onClick={onClick}
        data-testid={`template-card-${template.id}`}
      >
        {/* Thumbnail */}
        <div className="aspect-video bg-zinc-800 flex items-center justify-center overflow-hidden">
          <TemplateThumbnail url={template.thumbnailUrl} name={template.name} />
        </div>

        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-1">
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-white truncate" data-testid="template-name">
                {template.name}
              </h3>
              {template.category && (
                <p className="text-[10px] text-zinc-500 truncate mt-0.5">{template.category}</p>
              )}
            </div>
            {/* Actions menu — stop propagation to avoid navigating */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button className="p-1 rounded hover:bg-zinc-700 shrink-0" data-testid="template-actions-menu">
                  <MoreVertical className="w-3.5 h-3.5 text-zinc-500" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={() => duplicateMut.mutate()}
                  disabled={duplicateMut.isPending}
                  data-testid="action-duplicate"
                >
                  <Copy className="w-3.5 h-3.5 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-orange-400 focus:text-orange-400"
                  onClick={() => setArchiveOpen(true)}
                  data-testid="action-archive"
                >
                  <Archive className="w-3.5 h-3.5 mr-2" />
                  Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <Badge
              className={`text-[10px] px-1.5 py-0 border ${STATUS_STYLES[template.status] ?? ""}`}
              variant="outline"
              data-testid="template-status-badge"
            >
              {template.status}
            </Badge>
            {(template.versionCount ?? 0) > 0 && (
              <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                <Layers className="w-2.5 h-2.5" />
                {template.versionCount}v
              </span>
            )}
            <span className="text-[10px] text-zinc-600 ml-auto flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {new Date(template.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive Template"
        description={`Archive "${template.name}"? It will no longer appear by default but can be restored.`}
        confirmLabel="Archive"
        loading={archiveMut.isPending}
        onConfirm={() => archiveMut.mutate()}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE DETAIL PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export function DesignTemplateDetailPage({ id }: { id: number }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [publishTarget, setPublishTarget] = useState<TemplateVersion | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const templateQ = useQuery<DesignTemplate>({
    queryKey: ["design-template", id],
    queryFn: () => apiFetch(`/api/ai/design-templates/${id}`),
  });

  const versionsQ = useQuery<VersionListResponse>({
    queryKey: ["design-template-versions", id],
    queryFn: () => apiFetch(`/api/ai/design-templates/${id}/versions`),
    enabled: !!templateQ.data,
  });

  const publishMut = useMutation({
    mutationFn: (versionId: number) =>
      apiFetch(`/api/ai/design-templates/${id}/versions/${versionId}/publish`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template", id] });
      qc.invalidateQueries({ queryKey: ["design-template-versions", id] });
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      setPublishTarget(null);
      toast({ title: "Version published", description: "The version is now live." });
    },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const addBlankMut = useMutation({
    mutationFn: (tpl: DesignTemplate) => {
      const now = new Date().toISOString();
      const templateJson = {
        schemaVersion: "1.0",
        id:            String(id),
        tenantId:      "default",
        name:          tpl.name,
        description:   tpl.description ?? "",
        category:      tpl.category ?? "Other",
        canvas:        { width: 1080, height: 1080, backgroundColor: "#ffffff", unit: "px" },
        elements:      [],
        variables:     [],
        metadata: { createdBy: "admin", createdAt: now, updatedAt: now, version: 1 },
      };
      return apiFetch(`/api/ai/design-templates/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ templateJson, changelog: "Blank canvas — start designing in the editor" }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template-versions", id] });
      toast({ title: "Blank version created", description: "Open it in the editor to start designing." });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const duplicateMut = useMutation({
    mutationFn: () =>
      apiFetch<DesignTemplate>(`/api/ai/design-templates/${id}/duplicate`, { method: "POST" }),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Duplicated", description: `New copy: "${copy.name}"` });
      navigate(`/design-templates/${copy.id}`);
    },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const archiveMut = useMutation({
    mutationFn: () =>
      apiFetch(`/api/ai/design-templates/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template", id] });
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      setArchiveOpen(false);
      toast({ title: "Template archived" });
    },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const template = templateQ.data;
  const versions = versionsQ.data?.versions ?? [];

  // ── Loading state
  if (templateQ.isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="detail-loading">
        <div className="h-8 w-48 bg-zinc-800 animate-pulse rounded mb-4" />
        <div className="h-40 bg-zinc-800 animate-pulse rounded" />
      </div>
    );
  }

  // ── Error state
  if (templateQ.isError) {
    return (
      <div className="p-6 max-w-5xl mx-auto" data-testid="detail-error">
        <div className="flex flex-col items-center py-20 text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mb-3" />
          <p className="text-sm text-red-400">Failed to load template</p>
          <p className="text-xs text-zinc-500 mt-1">{(templateQ.error as Error)?.message}</p>
          <Button variant="outline" onClick={() => navigate("/design-templates")} className="mt-4 gap-2">
            <ChevronLeft className="w-3.5 h-3.5" />
            Back to Library
          </Button>
        </div>
      </div>
    );
  }

  if (!template) return null;

  const isArchived = template.status === "archived";

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="template-detail">
      {/* ── Back + Header ── */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/design-templates")}
            className="mt-0.5 px-2"
            data-testid="button-back"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              {template.name}
              <Badge
                className={`text-xs border ${STATUS_STYLES[template.status] ?? ""}`}
                variant="outline"
              >
                {template.status}
              </Badge>
            </h1>
            {template.description && (
              <p className="text-sm text-zinc-400 mt-1">{template.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-zinc-500">
              {template.category && <span>Category: {template.category}</span>}
              {template.style && <span>Style: {template.style}</span>}
              <span>Created: {new Date(template.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Header actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => duplicateMut.mutate()}
            disabled={duplicateMut.isPending}
            className="gap-1.5"
            data-testid="button-duplicate"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </Button>
          {!isArchived && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setArchiveOpen(true)}
              className="gap-1.5 text-orange-400 border-orange-400/30 hover:bg-orange-400/10"
              data-testid="button-archive"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* ── Version History ── */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          Version History
          <span className="text-zinc-600 font-normal">({versions.length})</span>
        </h2>

        {versionsQ.isLoading && (
          <div className="space-y-2" data-testid="versions-loading">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 bg-zinc-800 animate-pulse rounded" />
            ))}
          </div>
        )}

        {!versionsQ.isLoading && versions.length === 0 && (
          <div
            className="flex flex-col items-center py-10 text-center border border-zinc-800 rounded-lg bg-zinc-900/40"
            data-testid="no-versions"
          >
            <Layers className="w-10 h-10 text-zinc-700 mb-3" />
            <p className="text-sm font-medium text-zinc-400">Belum ada versi</p>
            <p className="text-xs text-zinc-600 mt-1 mb-5">
              Template ini belum punya konten. Pilih cara membuat versi pertamanya:
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                size="sm"
                className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => navigate("/design-templates/ai-create")}
                data-testid="button-generate-ai"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate with AI
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                disabled={addBlankMut.isPending || !template}
                onClick={() => template && addBlankMut.mutate(template)}
                data-testid="button-blank-version"
              >
                {addBlankMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <PenLine className="w-3.5 h-3.5" />}
                Start with Blank Canvas
              </Button>
            </div>
          </div>
        )}

        {!versionsQ.isLoading && versions.length > 0 && (
          <div className="space-y-3" data-testid="version-list">
            {versions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                templateId={id}
                isActive={version.id === template.activeVersionId}
                onPublish={() => setPublishTarget(version)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Confirm Publish ── */}
      <ConfirmDialog
        open={!!publishTarget}
        onOpenChange={(v) => { if (!v) setPublishTarget(null); }}
        title="Publish Version"
        description={`Publish v${publishTarget?.versionNumber}? This will make it the active version and is irreversible.`}
        confirmLabel="Publish"
        loading={publishMut.isPending}
        onConfirm={() => publishTarget && publishMut.mutate(publishTarget.id)}
      />

      {/* ── Confirm Archive ── */}
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive Template"
        description={`Archive "${template.name}"? It will not appear in the default list but can be filtered back.`}
        confirmLabel="Archive"
        loading={archiveMut.isPending}
        onConfirm={() => archiveMut.mutate()}
      />
    </div>
  );
}

// ── Version Row ────────────────────────────────────────────────────────────────

interface VersionRowProps {
  version: TemplateVersion;
  templateId: number;
  isActive: boolean;
  onPublish: () => void;
}

function VersionRow({ version, templateId, isActive, onPublish }: VersionRowProps) {
  const [, navigate] = useLocation();
  const isPublished = version.status === "published";
  const editorPath = `/design-templates/${templateId}/versions/${version.id}/edit`;

  return (
    <div
      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
        isActive
          ? "border-indigo-500/40 bg-indigo-500/5"
          : "border-zinc-800 bg-zinc-900"
      }`}
      data-testid={`version-row-${version.id}`}
    >
      {/* Preview thumbnail */}
      <div className="w-28 shrink-0 hidden sm:block">
        <VersionPreview templateId={templateId} versionId={version.id} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">
            v{version.versionNumber}
          </span>
          <Badge
            className={`text-[10px] border ${STATUS_STYLES[version.status] ?? ""}`}
            variant="outline"
            data-testid={`version-status-${version.id}`}
          >
            {version.status}
          </Badge>
          {isActive && (
            <span className="text-[10px] text-indigo-400 flex items-center gap-0.5">
              <CheckCircle className="w-3 h-3" />
              Active
            </span>
          )}
        </div>

        {version.changelog && (
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{version.changelog}</p>
        )}

        <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-600">
          <span className="flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            Created: {new Date(version.createdAt).toLocaleString()}
          </span>
          {version.publishedAt && (
            <span>Published: {new Date(version.publishedAt).toLocaleString()}</span>
          )}
          {version.createdBy && (
            <span>By: {version.createdBy}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex flex-col gap-2 items-end">
        {/* Open in Editor — always visible; read-only banner shown inside editor for published */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(editorPath)}
          className="h-7 text-xs gap-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          data-testid={`button-open-editor-${version.id}`}
        >
          <ExternalLink className="w-3 h-3" />
          {isPublished ? "View" : "Edit"}
        </Button>

        {isPublished ? (
          <Badge
            className="text-[10px] border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            variant="outline"
            data-testid={`version-immutable-${version.id}`}
          >
            <CheckCircle className="w-2.5 h-2.5 mr-1" />
            Published
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onPublish}
            className="h-7 text-xs gap-1 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
            data-testid={`button-publish-version-${version.id}`}
          >
            <CheckCircle className="w-3 h-3" />
            Publish
          </Button>
        )}
      </div>
    </div>
  );
}
