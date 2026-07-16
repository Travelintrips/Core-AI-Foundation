import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus, Edit3, Archive, MoreVertical, Layout,
  Clock, Layers, FileJson, Search, Sparkles,
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

// Use empty string so fetch("/api/...") goes directly through the Vite /api proxy.
// Do NOT use import.meta.env.BASE_URL here — that prepends "/admin" which breaks
// the proxy match and causes silent 404s returned as HTML (React Query parse-error).
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

interface BuiltinTemplateMeta {
  templateCode: string;
  name: string;
  description: string;
  category: string;
  style: string;
  industry: string | null;
  tags: string[];
  canvasWidth: number;
  canvasHeight: number;
}

interface BuiltinTemplateList { items: BuiltinTemplateMeta[]; total: number }

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

// ── SVG mini-preview generator ────────────────────────────────────────────────
// Setiap kode template punya preview SVG yang merepresentasikan visual aslinya.
function TemplateSvgPreview({ code, w, h }: { code: string; w: number; h: number }) {
  const vb = `0 0 ${w} ${h}`;
  const cx = w / 2;

  // ── LOGO-TECH-MODERN-001 ────────────────────────────────────────────────────
  if (code === "LOGO-TECH-MODERN-001") {
    const cy = h * 0.44;
    const r1 = Math.min(w, h) * 0.38, r2 = r1 * 0.6, r3 = r2 * 0.55;
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#0F172A" />
        <circle cx={cx} cy={cy} r={r1} fill="#6366F1" fillOpacity="0.15" />
        <circle cx={cx} cy={cy} r={r2} fill="#8B5CF6" fillOpacity="0.28" />
        <circle cx={cx} cy={cy} r={r3} fill="#4F46E5" />
        <rect x={cx - r3*0.55} y={cy - r3*0.55} width={r3*1.1} height={r3*1.1} rx={r3*0.12} fill="white" fillOpacity="0.9" transform={`rotate(45 ${cx} ${cy})`} />
        <line x1={cx - r2*0.45} y1={h*0.73} x2={cx + r2*0.45} y2={h*0.73} stroke="#6366F1" strokeWidth={h*0.003} strokeOpacity="0.5" />
        <text x={cx} y={h*0.81} textAnchor="middle" fill="white" fontSize={h*0.065} fontWeight="800" fontFamily="Inter,sans-serif">NAMA PERUSAHAAN</text>
        <text x={cx} y={h*0.90} textAnchor="middle" fill="#94A3B8" fontSize={h*0.028} fontFamily="Inter,sans-serif">Inovasi · Kualitas · Kepercayaan</text>
      </svg>
    );
  }

  // ── IG-POST-ELEGANT-001 ─────────────────────────────────────────────────────
  if (code === "IG-POST-ELEGANT-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#0A0A0A" />
        <rect x={w*0.06} y={h*0.06} width={w*0.88} height={h*0.002} fill="#C9A84C" />
        <rect x={w*0.06} y={h*0.06} width={w*0.002} height={h*0.88} fill="#C9A84C" />
        <rect x={w*0.938} y={h*0.06} width={w*0.002} height={h*0.88} fill="#C9A84C" />
        <rect x={w*0.06} y={h*0.938} width={w*0.88} height={w*0.002} fill="#C9A84C" />
        <line x1={w*0.31} y1={h*0.32} x2={w*0.69} y2={h*0.32} stroke="#C9A84C" strokeWidth={h*0.002} strokeOpacity="0.6" />
        <text x={cx} y={h*0.46} textAnchor="middle" fill="#C9A84C" fontSize={h*0.08} fontFamily="Georgia,serif">TAGLINE ANDA</text>
        <text x={cx} y={h*0.56} textAnchor="middle" fill="#C9A84C" fontSize={h*0.08} fontFamily="Georgia,serif">DI SINI</text>
        <line x1={w*0.31} y1={h*0.60} x2={w*0.69} y2={h*0.60} stroke="#C9A84C" strokeWidth={h*0.002} strokeOpacity="0.6" />
        <text x={cx} y={h*0.68} textAnchor="middle" fill="white" fontSize={h*0.035} fontFamily="Georgia,serif" fillOpacity="0.8">Kualitas Tanpa Kompromi</text>
        <text x={cx} y={h*0.90} textAnchor="middle" fill="#C9A84C" fontSize={h*0.032} fontFamily="Inter,sans-serif" fontWeight="300">NAMA BRAND</text>
      </svg>
    );
  }

  // ── IG-POST-VIBRANT-001 ─────────────────────────────────────────────────────
  if (code === "IG-POST-VIBRANT-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#FF6B35" />
        <rect x={0} y={0} width={w} height={h*0.5} fill="#FF006E" fillOpacity="0.7" />
        <rect x={0} y={h*0.5} width={w} height={h*0.5} fill="#8338EC" fillOpacity="0.7" />
        <circle cx={0} cy={0} r={w*0.4} fill="white" fillOpacity="0.12" />
        <rect x={w*0.3} y={h*0.13} width={w*0.4} height={h*0.065} rx={h*0.033} fill="white" />
        <text x={cx} y={h*0.175} textAnchor="middle" fill="#FF006E" fontSize={h*0.04} fontWeight="700" fontFamily="Inter,sans-serif">✨ NEW ARRIVAL</text>
        <text x={w*0.06} y={h*0.43} fill="white" fontSize={h*0.13} fontWeight="900" fontFamily="Inter,sans-serif">JUDUL</text>
        <text x={w*0.06} y={h*0.56} fill="white" fontSize={h*0.13} fontWeight="900" fontFamily="Inter,sans-serif">BERANI</text>
        <rect x={w*0.06} y={h*0.79} width={w*0.32} height={h*0.075} rx={h*0.038} fill="white" />
        <text x={w*0.22} y={h*0.839} textAnchor="middle" fill="#FF006E" fontSize={h*0.038} fontWeight="700" fontFamily="Inter,sans-serif">Pelajari</text>
      </svg>
    );
  }

  // ── IG-POST-MINIMAL-001 ─────────────────────────────────────────────────────
  if (code === "IG-POST-MINIMAL-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#FAFAFA" />
        <rect x={w*0.06} y={h*0.06} width={w*0.1} height={h*0.008} rx={h*0.004} fill="#1A1A1A" />
        <rect x={w*0.06} y={h*0.105} width={w*0.88} height={h*0.55} rx={h*0.01} fill="#E8E8E8" />
        <text x={cx} y={h*0.405} textAnchor="middle" fill="#AAAAAA" fontSize={h*0.04} fontFamily="Inter,sans-serif">Gambar Produk</text>
        <rect x={w*0.06} y={h*0.71} width={w*0.88} height={h*0.001} fill="#000000" fillOpacity="0.15" />
        <text x={w*0.06} y={h*0.795} fill="#1A1A1A" fontSize={h*0.06} fontWeight="700" fontFamily="Inter,sans-serif">Nama Produk</text>
        <text x={w*0.06} y={h*0.87} fill="#555555" fontSize={h*0.034} fontFamily="Inter,sans-serif" fillOpacity="0.7">Kategori Produk</text>
        <text x={w*0.94} y={h*0.076} textAnchor="end" fill="#1A1A1A" fontSize={h*0.032} fontWeight="800" fontFamily="Inter,sans-serif">BRAND</text>
      </svg>
    );
  }

  // ── IG-POST-CORPORATE-001 ───────────────────────────────────────────────────
  if (code === "IG-POST-CORPORATE-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#0D1B3E" />
        <rect x={0} y={0} width={w} height={h*0.01} fill="#1E90FF" />
        <rect x={0} y={0} width={w*0.008} height={h} fill="#1E90FF" />
        <rect x={w*0.5} y={-h*0.2} width={w*0.65} height={w*0.65} rx="0" fill="#1E90FF" fillOpacity="0.06" transform={`rotate(30 ${w*0.75} ${h*0.15})`} />
        <rect x={w*0.06} y={h*0.075} width={w*0.18} height={h*0.065} rx={h*0.01} fill="#1E2D5A" />
        <text x={w*0.15} y={h*0.12} textAnchor="middle" fill="#FFFFFF" fontSize={h*0.036} fontWeight="800" fontFamily="Inter,sans-serif">BRAND</text>
        <rect x={w*0.06} y={h*0.27} width={w*0.07} height={h*0.009} rx={h*0.004} fill="#1E90FF" />
        <text x={w*0.06} y={h*0.325} fill="#1E90FF" fontSize={h*0.028} fontWeight="600" fontFamily="Inter,sans-serif">SOLUSI BISNIS</text>
        <text x={w*0.06} y={h*0.42} fill="white" fontSize={h*0.105} fontWeight="800" fontFamily="Inter,sans-serif">Tingkat</text>
        <text x={w*0.06} y={h*0.535} fill="white" fontSize={h*0.105} fontWeight="800" fontFamily="Inter,sans-serif">kan</text>
        <rect x={w*0.06} y={h*0.76} width={w*0.19} height={h*0.13} rx={h*0.015} fill="#1E2D5A" />
        <text x={w*0.155} y={h*0.823} textAnchor="middle" fill="#1E90FF" fontSize={h*0.055} fontWeight="800" fontFamily="Inter,sans-serif">500+</text>
        <text x={w*0.155} y={h*0.87} textAnchor="middle" fill="white" fontSize={h*0.028} fontFamily="Inter,sans-serif" fillOpacity="0.7">Klien</text>
        <rect x={w*0.29} y={h*0.76} width={w*0.19} height={h*0.13} rx={h*0.015} fill="#1E2D5A" />
        <text x={w*0.385} y={h*0.823} textAnchor="middle" fill="#1E90FF" fontSize={h*0.055} fontWeight="800" fontFamily="Inter,sans-serif">10T+</text>
        <text x={w*0.385} y={h*0.87} textAnchor="middle" fill="white" fontSize={h*0.028} fontFamily="Inter,sans-serif" fillOpacity="0.7">Aset</text>
      </svg>
    );
  }

  // ── IG-POST-NATURE-001 ──────────────────────────────────────────────────────
  if (code === "IG-POST-NATURE-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#F5F0E8" />
        <circle cx={0} cy={0} r={w*0.35} fill="#4A7C59" />
        <circle cx={w} cy={h} r={w*0.32} fill="#6B9E78" />
        <rect x={w*0.09} y={h*0.19} width={w*0.82} height={h*0.65} rx={h*0.025} fill="#FDFAF4" fillOpacity="0.96" />
        <rect x={w*0.35} y={h*0.265} width={w*0.3} height={h*0.052} rx={h*0.026} fill="#4A7C59" />
        <text x={cx} y={h*0.302} textAnchor="middle" fill="white" fontSize={h*0.028} fontWeight="700" fontFamily="Inter,sans-serif">100% ORGANIK</text>
        <text x={cx} y={h*0.43} textAnchor="middle" fill="#2D4A35" fontSize={h*0.09} fontFamily="Georgia,serif">Nama</text>
        <text x={cx} y={h*0.53} textAnchor="middle" fill="#2D4A35" fontSize={h*0.09} fontFamily="Georgia,serif">Produk</text>
        <line x1={w*0.35} y1={h*0.565} x2={w*0.65} y2={h*0.565} stroke="#4A7C59" strokeWidth={h*0.001} strokeOpacity="0.5" />
        <text x={cx} y={h*0.64} textAnchor="middle" fill="#5A6E61" fontSize={h*0.03} fontFamily="Georgia,serif" fillOpacity="0.8">Bahan alami pilihan terbaik</text>
        <text x={cx} y={h*0.72} textAnchor="middle" fill="#4A7C59" fontSize={h*0.048} fontWeight="700" fontFamily="Inter,sans-serif">Rp 00.000</text>
        <text x={cx} y={h*0.955} textAnchor="middle" fill="#4A7C59" fontSize={h*0.028} fontFamily="Inter,sans-serif" fillOpacity="0.8">@namabrand  ·  www.brand.com</text>
      </svg>
    );
  }

  // ── IG-POST-PROMO-001 ───────────────────────────────────────────────────────
  if (code === "IG-POST-PROMO-001") {
    return (
      <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <rect width={w} height={h} fill="#1A0A00" />
        <rect x={0} y={0} width={w} height={h} fill="#CC0000" fillOpacity="0.8" />
        <rect x={w*0.175} y={h*0.175} width={w*0.65} height={w*0.65} fill="#FFD700" fillOpacity="0.15" transform={`rotate(22.5 ${cx} ${h*0.5})`} />
        <rect x={w*0.175} y={h*0.175} width={w*0.65} height={w*0.65} fill="#FFD700" fillOpacity="0.1" />
        <rect x={0} y={0} width={w} height={h*0.13} fill="black" fillOpacity="0.85" />
        <text x={cx} y={h*0.086} textAnchor="middle" fill="#FFD700" fontSize={h*0.05} fontWeight="800" fontFamily="Inter,sans-serif">NAMA TOKO</text>
        <text x={cx} y={h*0.24} textAnchor="middle" fill="#FFD700" fontSize={h*0.14} fontWeight="900" fontFamily="Inter,sans-serif" transform={`rotate(-3 ${cx} ${h*0.21})`}>FLASH SALE</text>
        <circle cx={cx} cy={h*0.52} r={w*0.21} fill="#FFD700" />
        <text x={cx} y={h*0.545} textAnchor="middle" fill="#CC0000" fontSize={h*0.19} fontWeight="900" fontFamily="Inter,sans-serif">50%</text>
        <text x={cx} y={h*0.625} textAnchor="middle" fill="#CC0000" fontSize={h*0.065} fontWeight="800" fontFamily="Inter,sans-serif">DISKON</text>
        <rect x={0} y={h*0.8} width={w} height={h*0.2} fill="black" fillOpacity="0.9" />
        <text x={cx} y={h*0.875} textAnchor="middle" fill="white" fontSize={h*0.045} fontWeight="700" fontFamily="Inter,sans-serif">Semua Produk Pilihan</text>
        <text x={cx} y={h*0.94} textAnchor="middle" fill="#FFD700" fontSize={h*0.028} fontFamily="Inter,sans-serif" fillOpacity="0.8">Berlaku 1–7 Agustus 2025</text>
      </svg>
    );
  }

  // Generic fallback for unknown codes
  return (
    <svg viewBox={vb} xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width={w} height={h} fill="#1E293B" />
      <text x={cx} y={h/2} textAnchor="middle" dominantBaseline="middle" fill="#64748B" fontSize={h*0.08} fontFamily="Inter,sans-serif">Preview</text>
    </svg>
  );
}

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
  const [createMode, setCreateMode] = useState<"blank" | "template">("blank");
  const [selectedTemplate, setSelectedTemplate] = useState<BuiltinTemplateMeta | null>(null);

  const { data, isLoading } = useQuery<ProjectList>({
    queryKey: ["design-projects", statusFilter],
    queryFn: () =>
      apiFetch(`/api/ai/design/projects?${statusFilter !== "all" ? `status=${statusFilter}&` : ""}pageSize=50`),
  });

  const { data: templatesData } = useQuery<BuiltinTemplateList>({
    queryKey: ["builtin-templates"],
    queryFn: () => apiFetch("/api/ai/design/templates/builtin"),
    staleTime: Infinity, // template statis, tidak berubah
  });

  const createMutation = useMutation({
    mutationFn: async (payload: {
      name: string;
      description?: string;
      canvasWidth: number;
      canvasHeight: number;
      templateCode?: string;
    }) => {
      // Jika pakai template: ambil canvas state dulu, lalu kirim ke API
      if (payload.templateCode) {
        const tpl = await apiFetch<{ canvasState: unknown; canvasWidth: number; canvasHeight: number }>(
          `/api/ai/design/templates/builtin/${payload.templateCode}`
        );
        return apiFetch<DesignProject>("/api/ai/design/projects", {
          method: "POST",
          body: JSON.stringify({
            name: payload.name,
            description: payload.description,
            canvasWidth: tpl.canvasWidth,
            canvasHeight: tpl.canvasHeight,
            initialState: tpl.canvasState,
          }),
        });
      }
      return apiFetch<DesignProject>("/api/ai/design/projects", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-projects"] });
      setCreating(false);
      setNewName("");
      setNewDesc("");
      setSelectedTemplate(null);
      setCreateMode("blank");
      toast({ title: "Project berhasil dibuat!" });
    },
    onError: (e: Error) => toast({ title: "Gagal membuat project", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/design/projects/${id}/archive`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-projects"] });
      toast({ title: "Project diarsipkan" });
    },
  });

  function handleCreate() {
    if (!newName.trim()) return;
    if (createMode === "template" && selectedTemplate) {
      createMutation.mutate({
        name: newName.trim(),
        description: newDesc || undefined,
        canvasWidth: selectedTemplate.canvasWidth,
        canvasHeight: selectedTemplate.canvasHeight,
        templateCode: selectedTemplate.templateCode,
      });
    } else {
      const p = PRESETS[preset];
      const w = preset === PRESETS.length - 1 ? customW : (p?.w ?? 1920);
      const h = preset === PRESETS.length - 1 ? customH : (p?.h ?? 1080);
      createMutation.mutate({ name: newName.trim(), description: newDesc || undefined, canvasWidth: w, canvasHeight: h });
    }
  }

  function handleOpenCreate() {
    setCreateMode("blank");
    setSelectedTemplate(null);
    setCreating(true);
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
            Canva-like visual editor dengan AI generation, layers, dan version history
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2">
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
            placeholder="Cari project..."
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
          <span>{data.items.filter((p) => p.status === "active").length} aktif</span>
          <span>{data.items.filter((p) => p.status === "draft").length} draft</span>
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
          <p className="text-sm">Belum ada design project.</p>
          <p className="text-xs mt-1">Buat project baru atau mulai dari template.</p>
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
                    <span className="text-white text-sm font-medium">Buka Editor</span>
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
                          <Edit3 className="h-3.5 w-3.5 mr-2" /> Buka Editor
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-orange-600"
                        onClick={() => archiveMutation.mutate(project.id)}
                      >
                        <Archive className="h-3.5 w-3.5 mr-2" /> Arsipkan
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
                    {new Date(project.updatedAt).toLocaleDateString("id-ID")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Design Project</DialogTitle>
          </DialogHeader>

          {/* Mode tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit mb-4">
            <button
              onClick={() => setCreateMode("blank")}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                createMode === "blank"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Mulai Kosong
            </button>
            <button
              onClick={() => setCreateMode("template")}
              className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                createMode === "template"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              Dari Template
            </button>
          </div>

          <div className="space-y-4">
            {/* Project name & desc — selalu tampil */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Nama Project *</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Logo Startup 2025"
                  className="mt-1"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  autoFocus
                />
              </div>
              <div>
                <Label>Deskripsi</Label>
                <Input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Opsional"
                  className="mt-1"
                />
              </div>
            </div>

            {/* BLANK mode: canvas size picker */}
            {createMode === "blank" && (
              <div>
                <Label>Ukuran Canvas</Label>
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
                      <Label className="text-xs">Lebar (px)</Label>
                      <Input type="number" value={customW} onChange={(e) => setCustomW(+e.target.value)} className="mt-1" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Tinggi (px)</Label>
                      <Input type="number" value={customH} onChange={(e) => setCustomH(+e.target.value)} className="mt-1" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TEMPLATE mode: template picker grid */}
            {createMode === "template" && (
              <div>
                <Label className="mb-2 block">Pilih Template</Label>
                {!templatesData || templatesData.items.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center">Memuat template…</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[480px] overflow-y-auto pr-1">
                    {templatesData.items.map((tpl) => {
                      const isSelected = selectedTemplate?.templateCode === tpl.templateCode;
                      const aspectRatio = tpl.canvasWidth / tpl.canvasHeight;
                      return (
                        <button
                          key={tpl.templateCode}
                          onClick={() => setSelectedTemplate(tpl)}
                          className={`rounded-xl border-2 overflow-hidden text-left transition-all focus:outline-none ${
                            isSelected
                              ? "border-indigo-500 ring-2 ring-indigo-200"
                              : "border-gray-200 hover:border-indigo-300"
                          }`}
                        >
                          {/* SVG Preview */}
                          <div
                            className="w-full bg-gray-900"
                            style={{ aspectRatio: String(aspectRatio) }}
                          >
                            <TemplateSvgPreview
                              code={tpl.templateCode}
                              w={tpl.canvasWidth}
                              h={tpl.canvasHeight}
                            />
                          </div>
                          <div className="p-2 bg-white">
                            <p className="text-xs font-semibold text-gray-800 truncate">{tpl.name}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{tpl.category} · {tpl.style}</p>
                            {tpl.industry && (
                              <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 font-medium">
                                {tpl.industry}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedTemplate && (
                  <p className="text-xs text-indigo-600 mt-2 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    Template dipilih: <strong>{selectedTemplate.name}</strong> ({selectedTemplate.canvasWidth}×{selectedTemplate.canvasHeight}px)
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Batal</Button>
            <Button
              onClick={handleCreate}
              disabled={
                !newName.trim() ||
                createMutation.isPending ||
                (createMode === "template" && !selectedTemplate)
              }
            >
              {createMutation.isPending ? "Membuat…" : "Buat Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
