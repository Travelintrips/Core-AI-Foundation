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
    </div>
  );
}
