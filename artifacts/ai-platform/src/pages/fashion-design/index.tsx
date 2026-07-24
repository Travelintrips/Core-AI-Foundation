/**
 * Fashion & Apparel Design — Admin Panel (Team 18)
 *
 * Admin interface for managing fashion design orders:
 * - View & filter orders by status/service type
 * - Review blueprint specifications
 * - Run trademark safety checks
 * - Trigger generation & update order status
 * - Assign human designer for revision (revision flow)
 * - Upload revised design files
 * - View full revision history
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shirt, Search, Filter, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, ChevronRight,
  Palette, Layout, FileJson, Sparkles, Shield,
  Clock, Package, Eye, Trash2, Play,
  UserCheck, Upload, MessageSquare, History,
  ExternalLink, PenTool,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

// ── API helper ────────────────────────────────────────────────────────────────

const API_BASE = "";


async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface FashionOrder {
  id: number;
  customerName: string;
  customerEmail: string;
  orderName: string;
  description?: string | null;
  serviceType: string;
  quantity: number;
  status: string;
  trademarkSafe: boolean;
  trademarkNotes?: string | null;
  colorways: string[];
  motifConfig?: Record<string, unknown> | null;
  compositionJson?: Record<string, unknown> | null;
  outputs: Record<string, unknown>;
  adminNotes?: string | null;
  designerName?: string | null;
  designerEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  blueprint?: FashionBlueprint | null;
}

interface FashionBlueprint {
  id: number;
  orderId: number;
  panels: Record<string, unknown>;
  placementSpec?: Record<string, unknown> | null;
  numberValue?: string | null;
  nameValue?: string | null;
  sponsors?: unknown[];
}

interface FashionRevision {
  id: number;
  orderId: number;
  type: string;
  status: string;
  feedback?: string | null;
  referenceUrls: string[];
  designerName?: string | null;
  designerEmail?: string | null;
  revisedFileUrls: string[];
  notes?: string | null;
  createdAt: string;
}

interface OrderList {
  items: FashionOrder[];
  total: number;
  page: number;
  pageSize: number;
}

interface TrademarkResult {
  safe: boolean;
  flags: string[];
  checkedFields: string[];
}

// ── Display config ────────────────────────────────────────────────────────────

const SERVICE_CONFIG: Record<string, { label: string; emoji: string }> = {
  "t-shirt":        { label: "T-Shirt",         emoji: "👕" },
  "jersey":         { label: "Jersey",           emoji: "⚽" },
  "hoodie":         { label: "Hoodie",           emoji: "🧥" },
  "uniform":        { label: "Seragam",          emoji: "👔" },
  "jacket":         { label: "Jacket",           emoji: "🧣" },
  "dress":          { label: "Dress",            emoji: "👗" },
  "batik-inspired": { label: "Batik Inspired",   emoji: "🎨" },
  "merchandise":    { label: "Merchandise",      emoji: "🛍️" },
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  draft:                { label: "Draft",              color: "bg-gray-500/20 text-gray-300 border-gray-500/30" },
  blueprint_ready:      { label: "Blueprint Siap",     color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  generating:           { label: "Generating",         color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  review:               { label: "Review",             color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  revision_requested:   { label: "Revisi Diminta",     color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  revision_in_progress: { label: "Revisi Berjalan",    color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  approved:             { label: "Approved",           color: "bg-green-500/20 text-green-400 border-green-500/30" },
  delivered:            { label: "Delivered",          color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  trademark_flagged:    { label: "TM Flagged",         color: "bg-red-500/20 text-red-400 border-red-500/30" },
  cancelled:            { label: "Cancelled",          color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

const REVISION_TYPE_LABEL: Record<string, { label: string; icon: string }> = {
  customer_request:    { label: "Permintaan Pelanggan", icon: "💬" },
  designer_assignment: { label: "Designer Ditugaskan",  icon: "👤" },
  designer_upload:     { label: "File Revisi Diupload", icon: "📁" },
};

const PANEL_LABELS: Record<string, string> = {
  "front": "Depan", "back": "Belakang", "sleeves": "Lengan", "collar": "Kerah",
  "pocket": "Saku", "logo-area": "Area Logo", "sponsor": "Sponsor",
  "name": "Nama", "number": "Nomor", "garment-panels": "Panel Pakaian",
};

// ── Main component ────────────────────────────────────────────────────────────

export default function FashionDesignAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<FashionOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Designer assignment form state
  const [assignForm, setAssignForm] = useState({ designerName: "", designerEmail: "", notes: "" });
  const [assignOpen, setAssignOpen] = useState(false);

  // Revision upload form state
  const [uploadForm, setUploadForm] = useState({ fileUrlsText: "", notes: "" });
  const [uploadOpen, setUploadOpen] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data, isLoading, refetch } = useQuery<OrderList>({
    queryKey: ["fashion-orders", page, statusFilter, serviceFilter, search],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (serviceFilter !== "all") params.set("serviceType", serviceFilter);
      if (search) params.set("search", search);
      return apiFetch(`/api/ai/fashion-design/orders?${params}`);
    },
  });

  const { data: detailData, isLoading: detailLoading } = useQuery<FashionOrder>({
    queryKey: ["fashion-order-detail", selectedOrder?.id],
    queryFn: () => apiFetch(`/api/ai/fashion-design/orders/${selectedOrder!.id}`),
    enabled: !!selectedOrder && detailOpen,
  });

  const { data: revisionsData } = useQuery<{ revisions: FashionRevision[] }>({
    queryKey: ["fashion-revisions", selectedOrder?.id],
    queryFn: () => apiFetch(`/api/ai/fashion-design/orders/${selectedOrder!.id}/revisions`),
    enabled: !!selectedOrder && detailOpen,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const trademarkMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ order: FashionOrder; result: TrademarkResult }>(`/api/ai/fashion-design/orders/${id}/trademark-check`, { method: "POST" }),
    onSuccess: ({ result }) => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-order-detail"] });
      toast({
        title: result.safe ? "Trademark: Aman" : "Trademark: Terdeteksi masalah",
        description: result.safe ? "Tidak ada pelanggaran trademark." : result.flags.join("; "),
        variant: result.safe ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ outputs: Record<string, unknown>; warnings: string[] }>(`/api/ai/fashion-design/orders/${id}/generate`, { method: "POST" }),
    onSuccess: ({ warnings }) => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-order-detail"] });
      toast({
        title: "Output dihasilkan",
        description: warnings.length > 0 ? warnings[0] : "Composition JSON dan placement spec berhasil dibuat.",
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch<FashionOrder>(`/api/ai/fashion-design/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-order-detail"] });
      toast({ title: "Status diperbarui" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/ai/fashion-design/orders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      setDetailOpen(false);
      toast({ title: "Order dihapus" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignDesignerMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: number; designerName: string; designerEmail: string; notes?: string }) =>
      apiFetch<{ revision: FashionRevision; emailSent: boolean }>(`/api/ai/fashion-design/orders/${id}/assign-designer`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: ({ emailSent }) => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-order-detail"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-revisions"] });
      setAssignOpen(false);
      setAssignForm({ designerName: "", designerEmail: "", notes: "" });
      toast({
        title: "Designer berhasil ditugaskan",
        description: emailSent ? "Email notifikasi telah dikirim ke designer." : "Designer ditugaskan (email gagal terkirim).",
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const uploadRevisionMutation = useMutation({
    mutationFn: ({ id, revisedFileUrls, notes }: { id: number; revisedFileUrls: string[]; notes?: string }) =>
      apiFetch<{ revision: FashionRevision; emailSent: boolean }>(`/api/ai/fashion-design/orders/${id}/revision-upload`, {
        method: "POST",
        body: JSON.stringify({ revisedFileUrls, notes }),
      }),
    onSuccess: ({ emailSent }) => {
      queryClient.invalidateQueries({ queryKey: ["fashion-orders"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-order-detail"] });
      queryClient.invalidateQueries({ queryKey: ["fashion-revisions"] });
      setUploadOpen(false);
      setUploadForm({ fileUrlsText: "", notes: "" });
      toast({
        title: "File revisi berhasil diupload",
        description: emailSent ? "Pelanggan telah dinotifikasi via email." : "File diupload (email ke pelanggan gagal terkirim).",
      });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const order = detailData ?? selectedOrder;
  const revisions = revisionsData?.revisions ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <Shirt className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Fashion & Apparel Design</h1>
            <p className="text-sm text-muted-foreground">Manajemen order desain pakaian (Team 18)</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Orders", value: data?.total ?? 0, icon: Package, color: "text-blue-400" },
          { label: "Blueprint Siap", value: data?.items.filter(o => o.status === "blueprint_ready").length ?? 0, icon: Layout, color: "text-green-400" },
          { label: "Perlu Review", value: data?.items.filter(o => ["review", "revision_requested"].includes(o.status)).length ?? 0, icon: Eye, color: "text-yellow-400" },
          { label: "TM Flagged", value: data?.items.filter(o => o.status === "trademark_flagged").length ?? 0, icon: AlertTriangle, color: "text-red-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-card/50">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-5 h-5 ${color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-bold">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Cari order..."
            className="pl-9 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            {Object.entries(STATUS_BADGE).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={serviceFilter} onValueChange={(v) => { setServiceFilter(v); setPage(1); }}>
          <SelectTrigger className="w-44 text-sm">
            <SelectValue placeholder="Jenis Pakaian" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis</SelectItem>
            {Object.entries(SERVICE_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.emoji} {v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Orders table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="w-4 h-4" /> Orders
            {data && <span className="text-muted-foreground font-normal">({data.total})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !data?.items.length ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Belum ada order. Order akan muncul setelah pelanggan mengisi form di portal.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.items.map((o) => {
                const svc = SERVICE_CONFIG[o.serviceType];
                const st = STATUS_BADGE[o.status] ?? { label: o.status, color: "bg-gray-500/20 text-gray-400 border-gray-500/30" };
                return (
                  <div
                    key={o.id}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => { setSelectedOrder(o); setDetailOpen(true); }}
                  >
                    <span className="text-xl w-7">{svc?.emoji ?? "👕"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-sm truncate">{o.orderName}</span>
                        <Badge className={`text-[10px] border ${st.color}`}>{st.label}</Badge>
                        {!o.trademarkSafe && <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                        {o.status === "revision_requested" && <MessageSquare className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>#{o.id}</span>
                        <span>{o.customerName}</span>
                        <span>{svc?.label ?? o.serviceType}</span>
                        <span>Qty: {o.quantity}</span>
                        {o.designerName && <span className="text-cyan-400">👤 {o.designerName}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {o.colorways?.length > 0 && (
                        <div className="flex gap-0.5">
                          {(o.colorways as string[]).slice(0, 4).map((c, i) => (
                            <div key={i} className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-xs text-muted-foreground">Hal {page} / {Math.ceil(data.total / data.pageSize)}</span>
          <Button variant="outline" size="sm" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {order && SERVICE_CONFIG[order.serviceType]?.emoji} Order #{order?.id} — {order?.orderName}
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : order ? (
            <Tabs defaultValue="info">
              <TabsList className="w-full mb-4">
                <TabsTrigger value="info" className="flex-1">Info</TabsTrigger>
                <TabsTrigger value="revisions" className="flex-1 gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  Riwayat Revisi
                  {revisions.length > 0 && (
                    <span className="ml-1 bg-orange-500/20 text-orange-400 text-[10px] px-1.5 py-0.5 rounded-full">
                      {revisions.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── INFO TAB ── */}
              <TabsContent value="info" className="space-y-4 mt-0">
                {/* Status & safety */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className={`border ${(STATUS_BADGE[order.status] ?? STATUS_BADGE["draft"]).color}`}>
                    {(STATUS_BADGE[order.status] ?? { label: order.status }).label}
                  </Badge>
                  <Badge className={order.trademarkSafe ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                    {order.trademarkSafe ? <><CheckCircle2 className="w-3 h-3 mr-1" />TM Safe</> : <><AlertTriangle className="w-3 h-3 mr-1" />TM Flagged</>}
                  </Badge>
                  {order.designerName && (
                    <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
                      <PenTool className="w-3 h-3 mr-1" />{order.designerName}
                    </Badge>
                  )}
                </div>

                {order.trademarkNotes && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                    <p className="font-semibold mb-1">Trademark Issues:</p>
                    <p>{order.trademarkNotes}</p>
                  </div>
                )}

                {/* Revision request banner */}
                {order.status === "revision_requested" && (
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                    <p className="text-xs font-semibold text-orange-400 flex items-center gap-1.5 mb-1">
                      <MessageSquare className="w-3.5 h-3.5" /> Pelanggan meminta revisi
                    </p>
                    {revisions.find(r => r.type === "customer_request") && (
                      <p className="text-xs text-muted-foreground">
                        {revisions.find(r => r.type === "customer_request")?.feedback}
                      </p>
                    )}
                  </div>
                )}

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Pelanggan", order.customerName],
                    ["Email", order.customerEmail],
                    ["Jenis", `${SERVICE_CONFIG[order.serviceType]?.emoji} ${SERVICE_CONFIG[order.serviceType]?.label ?? order.serviceType}`],
                    ["Jumlah", String(order.quantity)],
                    ["Dibuat", new Date(order.createdAt).toLocaleDateString("id-ID")],
                    ["Updated", new Date(order.updatedAt).toLocaleDateString("id-ID")],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-muted-foreground">{k}</p>
                      <p className="font-medium">{v}</p>
                    </div>
                  ))}
                </div>

                {order.description && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Deskripsi</p>
                    <p className="text-sm bg-muted/30 rounded-lg p-3">{order.description}</p>
                  </div>
                )}

                {/* Colorways */}
                {order.colorways?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><Palette className="w-3 h-3" /> Colorways</p>
                    <div className="flex gap-2 flex-wrap">
                      {(order.colorways as string[]).map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded border border-white/20" style={{ backgroundColor: c }} />
                          <span className="text-xs font-mono text-muted-foreground">{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Blueprint summary */}
                {order.blueprint ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><Layout className="w-3 h-3" /> Blueprint</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                      {order.blueprint.nameValue && (
                        <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-20">Nama:</span><span className="font-medium">{order.blueprint.nameValue}</span></div>
                      )}
                      {order.blueprint.numberValue && (
                        <div className="flex gap-2 text-xs"><span className="text-muted-foreground w-20">Nomor:</span><span className="font-mono font-bold">{order.blueprint.numberValue}</span></div>
                      )}
                      <div className="flex gap-2 text-xs">
                        <span className="text-muted-foreground w-20">Panels:</span>
                        <span>{Object.keys(order.blueprint.panels ?? {}).map(p => PANEL_LABELS[p] ?? p).join(", ") || "—"}</span>
                      </div>
                      {(order.blueprint.sponsors as unknown[])?.length > 0 && (
                        <div className="flex gap-2 text-xs">
                          <span className="text-muted-foreground w-20">Sponsor:</span>
                          <span>{(order.blueprint.sponsors as Array<{ name?: string }>).map(s => s.name ?? "—").join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-muted/20 rounded-lg p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Layout className="w-3.5 h-3.5" /> Belum ada blueprint.
                  </div>
                )}

                {/* Output summary */}
                {Object.keys(order.outputs ?? {}).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><FileJson className="w-3 h-3" /> Outputs</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                      {Object.entries(order.outputs as Record<string, unknown>).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-xs">
                          <span className="text-muted-foreground w-36">{k}:</span>
                          <span className="text-green-400">{v ? "✓ Tersedia" : "— Pending"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => trademarkMutation.mutate(order.id)}
                    disabled={trademarkMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    {trademarkMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                    Cek Trademark
                  </Button>

                  {order.status === "blueprint_ready" && order.trademarkSafe && (
                    <Button
                      size="sm"
                      onClick={() => generateMutation.mutate(order.id)}
                      disabled={generateMutation.isPending}
                      className="gap-1.5 text-xs bg-purple-600 hover:bg-purple-700"
                    >
                      {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Generate Output
                    </Button>
                  )}

                  {/* Assign Designer — available when revision requested or in review */}
                  {["revision_requested", "review"].includes(order.status) && (
                    <Button
                      size="sm"
                      onClick={() => setAssignOpen(true)}
                      className="gap-1.5 text-xs bg-cyan-600 hover:bg-cyan-700"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Assign Designer
                    </Button>
                  )}

                  {/* Upload Revision — available when in progress */}
                  {["revision_in_progress", "revision_requested"].includes(order.status) && (
                    <Button
                      size="sm"
                      onClick={() => setUploadOpen(true)}
                      className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700"
                    >
                      <Upload className="w-3.5 h-3.5" /> Upload Revisi
                    </Button>
                  )}

                  {order.status === "review" && (
                    <Button
                      size="sm"
                      onClick={() => statusMutation.mutate({ id: order.id, status: "approved" })}
                      disabled={statusMutation.isPending}
                      className="gap-1.5 text-xs bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                    </Button>
                  )}

                  {order.status === "approved" && (
                    <Button
                      size="sm"
                      onClick={() => statusMutation.mutate({ id: order.id, status: "delivered" })}
                      disabled={statusMutation.isPending}
                      className="gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Play className="w-3.5 h-3.5" /> Tandai Terkirim
                    </Button>
                  )}

                  {["draft", "review", "blueprint_ready", "revision_requested"].includes(order.status) && (
                    <Button
                      size="sm" variant="outline"
                      onClick={() => statusMutation.mutate({ id: order.id, status: "cancelled" })}
                      disabled={statusMutation.isPending}
                      className="gap-1.5 text-xs text-muted-foreground"
                    >
                      <Clock className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  )}

                  {["draft", "cancelled"].includes(order.status) && (
                    <Button
                      size="sm" variant="destructive"
                      onClick={() => { if (confirm("Hapus order ini?")) deleteMutation.mutate(order.id); }}
                      disabled={deleteMutation.isPending}
                      className="gap-1.5 text-xs ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Hapus
                    </Button>
                  )}
                </div>
              </TabsContent>

              {/* ── REVISION HISTORY TAB ── */}
              <TabsContent value="revisions" className="mt-0">
                {revisions.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    Belum ada riwayat revisi untuk order ini.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {revisions.map((rev) => {
                      const typeInfo = REVISION_TYPE_LABEL[rev.type] ?? { label: rev.type, icon: "📝" };
                      return (
                        <div key={rev.id} className="bg-muted/30 rounded-lg p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-base">{typeInfo.icon}</span>
                              <span className="text-sm font-medium">{typeInfo.label}</span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(rev.createdAt).toLocaleString("id-ID")}
                            </span>
                          </div>

                          {rev.feedback && (
                            <div className="bg-background/50 rounded p-2.5">
                              <p className="text-xs text-muted-foreground mb-1">Feedback:</p>
                              <p className="text-sm">{rev.feedback}</p>
                            </div>
                          )}

                          {(rev.referenceUrls as string[])?.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">Referensi:</p>
                              <div className="flex flex-wrap gap-2">
                                {(rev.referenceUrls as string[]).map((url, i) => (
                                  <a
                                    key={i}
                                    href={url} target="_blank" rel="noopener noreferrer"
                                    className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Referensi {i + 1}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {rev.designerName && (
                            <div className="flex items-center gap-2 text-xs">
                              <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
                              <span className="text-muted-foreground">Designer:</span>
                              <span className="font-medium">{rev.designerName}</span>
                              {rev.designerEmail && <span className="text-muted-foreground">({rev.designerEmail})</span>}
                            </div>
                          )}

                          {(rev.revisedFileUrls as string[])?.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">File Revisi:</p>
                              <div className="flex flex-wrap gap-2">
                                {(rev.revisedFileUrls as string[]).map((url, i) => (
                                  <a
                                    key={i}
                                    href={url} target="_blank" rel="noopener noreferrer"
                                    className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                                  >
                                    <Upload className="w-3 h-3" /> File {i + 1}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {rev.notes && (
                            <p className="text-xs text-muted-foreground italic">{rev.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick action from revision tab */}
                {order && ["revision_requested", "review"].includes(order.status) && (
                  <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                    <Button size="sm" onClick={() => setAssignOpen(true)} className="gap-1.5 text-xs bg-cyan-600 hover:bg-cyan-700">
                      <UserCheck className="w-3.5 h-3.5" /> Assign Designer
                    </Button>
                    {["revision_in_progress", "revision_requested"].includes(order.status) && (
                      <Button size="sm" onClick={() => setUploadOpen(true)} className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700">
                        <Upload className="w-3.5 h-3.5" /> Upload Revisi
                      </Button>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Assign Designer Dialog ── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-cyan-400" /> Assign Designer
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tugaskan human designer untuk mengerjakan revisi order #{order?.id}.
              Email notifikasi akan dikirim ke designer.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Designer *</Label>
              <Input
                value={assignForm.designerName}
                onChange={(e) => setAssignForm(f => ({ ...f, designerName: e.target.value }))}
                placeholder="Budi Santoso"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email Designer *</Label>
              <Input
                type="email"
                value={assignForm.designerEmail}
                onChange={(e) => setAssignForm(f => ({ ...f, designerEmail: e.target.value }))}
                placeholder="designer@studio.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan untuk Designer (opsional)</Label>
              <Textarea
                value={assignForm.notes}
                onChange={(e) => setAssignForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Perhatikan warna utama #1A237E dan posisi logo di bagian depan..."
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAssignOpen(false)}>Batal</Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!order) return;
                  assignDesignerMutation.mutate({
                    id: order.id,
                    designerName: assignForm.designerName,
                    designerEmail: assignForm.designerEmail,
                    notes: assignForm.notes || undefined,
                  });
                }}
                disabled={assignDesignerMutation.isPending || !assignForm.designerName || !assignForm.designerEmail}
                className="gap-1.5 bg-cyan-600 hover:bg-cyan-700"
              >
                {assignDesignerMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                Assign Designer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Upload Revision Dialog ── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-400" /> Upload File Revisi
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload file hasil revisi desain (URL storage). Order akan kembali ke status "Review" setelah upload.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">URL File Revisi * (satu per baris)</Label>
              <Textarea
                value={uploadForm.fileUrlsText}
                onChange={(e) => setUploadForm(f => ({ ...f, fileUrlsText: e.target.value }))}
                placeholder={"https://storage.supabase.co/object/public/ai-assets/revisi-jersey-v2.png\nhttps://storage.supabase.co/object/public/ai-assets/revisi-jersey-v2-back.png"}
                rows={4}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">Gunakan URL dari Supabase Storage atau public file hosting.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Catatan Revisi (opsional)</Label>
              <Textarea
                value={uploadForm.notes}
                onChange={(e) => setUploadForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Sudah diperbaiki warna dan posisi logo sesuai request pelanggan..."
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setUploadOpen(false)}>Batal</Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!order) return;
                  const urls = uploadForm.fileUrlsText
                    .split("\n")
                    .map(u => u.trim())
                    .filter(u => u.length > 0);
                  uploadRevisionMutation.mutate({
                    id: order.id,
                    revisedFileUrls: urls,
                    notes: uploadForm.notes || undefined,
                  });
                }}
                disabled={uploadRevisionMutation.isPending || !uploadForm.fileUrlsText.trim()}
                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
              >
                {uploadRevisionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Upload Revisi
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
