/**
 * Team 17 — Interior Design Planning — Admin project list
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Home, Plus, Search, Filter, ChevronRight, Loader2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
    try { const b = await res.json() as { error?: string }; if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

interface Project {
  id: number;
  title: string;
  roomType: string;
  status: string;
  clientName?: string | null;
  clientEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROOM_LABELS: Record<string, string> = {
  living_room: "Ruang Tamu", bedroom: "Kamar Tidur", kitchen: "Dapur",
  office: "Kantor", cafe: "Kafe", restaurant: "Restoran",
  hotel: "Hotel", lobby: "Lobi", booth: "Booth",
};

const ROOM_EMOJIS: Record<string, string> = {
  living_room: "🛋️", bedroom: "🛏️", kitchen: "🍳", office: "💼",
  cafe: "☕", restaurant: "🍽️", hotel: "🏨", lobby: "🏢", booth: "🏪",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "secondary" },
  brief_submitted: { label: "Brief Masuk", variant: "outline" },
  analyzing: { label: "Menganalisis...", variant: "default" },
  outputs_ready: { label: "Konsep Siap", variant: "default" },
  revision_requested: { label: "Revisi", variant: "destructive" },
  completed: { label: "Selesai", variant: "default" },
};

const ROOM_TYPE_OPTIONS = [
  { value: "", label: "Semua Tipe" },
  { value: "living_room", label: "Ruang Tamu" },
  { value: "bedroom", label: "Kamar Tidur" },
  { value: "kitchen", label: "Dapur" },
  { value: "office", label: "Kantor" },
  { value: "cafe", label: "Kafe" },
  { value: "restaurant", label: "Restoran" },
  { value: "hotel", label: "Hotel" },
  { value: "lobby", label: "Lobi" },
  { value: "booth", label: "Booth" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Semua Status" },
  { value: "draft", label: "Draft" },
  { value: "brief_submitted", label: "Brief Masuk" },
  { value: "analyzing", label: "Menganalisis" },
  { value: "outputs_ready", label: "Konsep Siap" },
  { value: "revision_requested", label: "Revisi" },
  { value: "completed", label: "Selesai" },
];

export default function InteriorDesignPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["interior-design-projects", statusFilter, roomFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (statusFilter) params.set("status", statusFilter);
      if (roomFilter) params.set("roomType", roomFilter);
      return apiFetch<{ items: Project[]; total: number; page: number; pageSize: number }>(
        `/api/ai/interior-design/projects?${params}`,
      );
    },
  });

  const filtered = (data?.items ?? []).filter(
    (p) =>
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      (p.clientName ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
            <Home className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Interior Design</h1>
            <p className="text-xs text-muted-foreground">Manajemen proyek desain interior</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Proyek", value: data.total, color: "#7C6EFA" },
            { label: "Brief Masuk", value: data.items.filter((p) => p.status === "brief_submitted").length, color: "#F59E0B" },
            { label: "Konsep Siap", value: data.items.filter((p) => p.status === "outputs_ready").length, color: "#10B981" },
            { label: "Selesai", value: data.items.filter((p) => p.status === "completed").length, color: "#6B7280" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl p-4 border" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-2xl font-bold" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul atau klien..."
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-md border text-sm bg-background"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={roomFilter}
          onChange={(e) => { setRoomFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-md border text-sm bg-background"
        >
          {ROOM_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-destructive text-sm">{(error as Error).message}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Home className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">Belum ada proyek. Brief baru dari portal klien akan muncul di sini.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const statusConf = STATUS_CONFIG[p.status] ?? { label: p.status, variant: "secondary" as const };
            return (
              <Link key={p.id} href={`/interior-design/${p.id}`}>
                <div className="flex items-center justify-between p-4 rounded-xl border hover:border-purple-500/30 transition-colors cursor-pointer" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{ROOM_EMOJIS[p.roomType] ?? "🏠"}</span>
                    <div>
                      <p className="text-sm font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROOM_LABELS[p.roomType] ?? p.roomType}
                        {p.clientName && ` · ${p.clientName}`}
                        {" · #"}{p.id}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusConf.variant}>{statusConf.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Hal {page} / {Math.ceil(data.total / data.pageSize)}</span>
          <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
