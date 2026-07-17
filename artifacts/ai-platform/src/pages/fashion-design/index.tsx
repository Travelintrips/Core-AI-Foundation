/**
 * Fashion & Apparel Design — Admin Panel (Team 18)
 *
 * Admin interface for managing fashion design orders:
 * - View & filter orders by status/service type
 * - Review blueprint specifications
 * - Run trademark safety checks
 * - Trigger generation & update order status
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shirt, Search, Filter, RefreshCw, Loader2,
  AlertTriangle, CheckCircle2, ChevronRight,
  Palette, Layout, FileJson, Sparkles, Shield,
  Clock, Package, Eye, Trash2, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ── API helper ────────────────────────────────────────────────────────────────

const API_BASE = "";
const API_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(API_KEY ? { "x-admin-api-key": API_KEY } : {}),
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
  draft:             { label: "Draft",            color: "bg-gray-500/20 text-gray-300 border-gray-500/30" },
  blueprint_ready:   { label: "Blueprint Siap",   color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  generating:        { label: "Generating",       color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  review:            { label: "Review",           color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  approved:          { label: "Approved",         color: "bg-green-500/20 text-green-400 border-green-500/30" },
  delivered:         { label: "Delivered",        color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  trademark_flagged: { label: "TM Flagged",       color: "bg-red-500/20 text-red-400 border-red-500/30" },
  cancelled:         { label: "Cancelled",        color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
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

  // ── Render ────────────────────────────────────────────────────────────────

  const order = detailData ?? selectedOrder;

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
          { label: "Perlu Review", value: data?.items.filter(o => o.status === "review").length ?? 0, icon: Eye, color: "text-yellow-400" },
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
          <SelectTrigger className="w-40 text-sm">
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
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-3">
                        <span>#{o.id}</span>
                        <span>{o.customerName}</span>
                        <span>{svc?.label ?? o.serviceType}</span>
                        <span>Qty: {o.quantity}</span>
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
            <div className="space-y-4">
              {/* Status & safety */}
              <div className="flex items-center gap-3 flex-wrap">
                <Badge className={`border ${(STATUS_BADGE[order.status] ?? STATUS_BADGE["draft"]).color}`}>
                  {(STATUS_BADGE[order.status] ?? { label: order.status }).label}
                </Badge>
                <Badge className={order.trademarkSafe ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                  {order.trademarkSafe ? <><CheckCircle2 className="w-3 h-3 mr-1" />TM Safe</> : <><AlertTriangle className="w-3 h-3 mr-1" />TM Flagged</>}
                </Badge>
              </div>

              {order.trademarkNotes && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                  <p className="font-semibold mb-1">Trademark Issues:</p>
                  <p>{order.trademarkNotes}</p>
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
                  <Layout className="w-3.5 h-3.5" /> Belum ada blueprint. Blueprint diisi melalui admin panel setelah order dikonfirmasi.
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
                  size="sm"
                  variant="outline"
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
                {["draft", "review", "blueprint_ready"].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: order.id, status: "cancelled" })}
                    disabled={statusMutation.isPending}
                    className="gap-1.5 text-xs text-muted-foreground"
                  >
                    <Clock className="w-3.5 h-3.5" /> Cancel
                  </Button>
                )}
                {["draft", "cancelled"].includes(order.status) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (confirm("Hapus order ini?")) deleteMutation.mutate(order.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="gap-1.5 text-xs ml-auto"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Hapus
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
