import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus, Edit3, Archive, MoreVertical, Layout,
  Clock, Layers, FileJson, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface DesignProject {
  id: number;
  name: string;
  description?: string | null;
  canvasWidth: number;
  canvasHeight: number;
  status: string;
  tags: string[];
  thumbnailUrl?: string | null;
  elementCount: number;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectList { items: DesignProject[]; total: number; page: number; pageSize: number }

const PRESETS = [
  { label: "Presentation (1920×1080)", w: 1920, h: 1080 },
  { label: "Instagram Post (1080×1080)", w: 1080, h: 1080 },
  { label: "Instagram Story (1080×1920)", w: 1080, h: 1920 },
  { label: "LinkedIn Banner (1584×396)", w: 1584, h: 396 },
  { label: "A4 Print (2480×3508)", w: 2480, h: 3508 },
  { label: "Web Banner (1200×630)", w: 1200, h: 630 },
  { label: "Custom", w: 0, h: 0 },
];

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  active: "bg-green-100 text-green-700",
  archived: "bg-orange-100 text-orange-700",
};

export default function DesignStudioPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [preset, setPreset] = useState(0);
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);

  const { data, isLoading } = useQuery<ProjectList>({
    queryKey: ["design-projects", statusFilter],
    queryFn: () =>
      apiFetch(`/api/ai/design/projects?${statusFilter !== "all" ? `status=${statusFilter}&` : ""}pageSize=50`),
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string; canvasWidth: number; canvasHeight: number }) =>
      apiFetch<DesignProject>("/api/ai/design/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-projects"] });
      setCreating(false);
      setNewName("");
      setNewDesc("");
      toast({ title: "Project created!" });
    },
    onError: (e: Error) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/design/projects/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-projects"] });
      toast({ title: "Project archived" });
    },
  });

  function handleCreate() {
    if (!newName.trim()) return;
    const p = PRESETS[preset];
    const w = preset === PRESETS.length - 1 ? customW : (p?.w ?? 1920);
    const h = preset === PRESETS.length - 1 ? customH : (p?.h ?? 1080);
    createMutation.mutate({ name: newName.trim(), description: newDesc || undefined, canvasWidth: w, canvasHeight: h });
  }

  const filtered = (data?.items ?? []).filter((p) => {
    if (!search.trim()) return true;
    return p.name.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Layout className="h-6 w-6 text-indigo-600" />
            AI Design Studio
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Canva-like visual editor with AI generation, layers, and version history
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1">
          {["all", "draft", "active", "archived"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter === s
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      {data && (
        <div className="flex gap-4 mb-5 text-sm text-gray-500">
          <span>{data.total} total</span>
          <span>{data.items.filter((p) => p.status === "active").length} active</span>
          <span>{data.items.filter((p) => p.status === "draft").length} drafts</span>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-gray-100 animate-pulse rounded-xl aspect-video" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Layout className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No design projects yet.</p>
          <p className="text-xs mt-1">Create one to get started with the visual editor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((project) => (
            <div
              key={project.id}
              className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-indigo-200 transition-all"
            >
              {/* Thumbnail */}
              <Link href={`/design-studio/${project.id}`}>
                <div
                  className="aspect-video bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center cursor-pointer relative"
                  style={{
                    backgroundImage: project.thumbnailUrl
                      ? `url(${project.thumbnailUrl})`
                      : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                >
                  {!project.thumbnailUrl && (
                    <div className="text-center">
                      <Edit3 className="h-8 w-8 text-indigo-300 mx-auto mb-1" />
                      <p className="text-xs text-indigo-400">{project.canvasWidth}×{project.canvasHeight}</p>
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-indigo-600/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <span className="text-white text-sm font-medium">Open Editor</span>
                  </div>
                </div>
              </Link>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-gray-900 truncate">{project.name}</h3>
                    {project.description && (
                      <p className="text-xs text-gray-400 truncate mt-0.5">{project.description}</p>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded hover:bg-gray-100 ml-1 shrink-0">
                        <MoreVertical className="h-3.5 w-3.5 text-gray-400" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/design-studio/${project.id}`}>
                          <Edit3 className="h-3.5 w-3.5 mr-2" /> Open Editor
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-orange-600"
                        onClick={() => archiveMutation.mutate(project.id)}
                      >
                        <Archive className="h-3.5 w-3.5 mr-2" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE[project.status] ?? ""}`}>
                    {project.status}
                  </Badge>
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                    <Layers className="h-2.5 w-2.5" /> {project.elementCount}
                  </span>
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                    <FileJson className="h-2.5 w-2.5" /> v{project.versionCount}
                  </span>
                  <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Design Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Project Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Brand Campaign 2025"
                className="mt-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional description"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Canvas Size</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPreset(i)}
                    className={`text-xs px-3 py-2 rounded-lg border text-left transition-colors ${
                      preset === i
                        ? "border-indigo-400 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 hover:border-gray-300 text-gray-600"
                    }`}
                  >
                    {p.label}
                    {p.w > 0 && <span className="block text-[10px] text-gray-400">{p.w}×{p.h}px</span>}
                  </button>
                ))}
              </div>
              {preset === PRESETS.length - 1 && (
                <div className="flex gap-2 mt-2">
                  <div className="flex-1">
                    <Label className="text-xs">Width (px)</Label>
                    <Input type="number" value={customW} onChange={(e) => setCustomW(+e.target.value)} className="mt-1" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Height (px)</Label>
                    <Input type="number" value={customH} onChange={(e) => setCustomH(+e.target.value)} className="mt-1" />
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
