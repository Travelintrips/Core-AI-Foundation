/**
 * Fashion & Apparel Design — Customer Portal (Team 18)
 *
 * Public-facing page for browsing available apparel services and submitting
 * design orders. Connects to the /api/ai/fashion-design/* endpoints.
 *
 * Revision flow:
 *   After submitting, customers can track order status and request human-touch
 *   revisions when the AI output is in "review" status.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shirt, ChevronRight, Palette, Layout, FileJson,
  CheckCircle2, AlertTriangle, Loader2, ArrowLeft,
  Package, Sparkles, Info, MessageSquare, Search,
  History, ExternalLink, RefreshCw, PenTool,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { SEOMeta } from "@/components/SEOMeta";

// ── API helpers ───────────────────────────────────────────────────────────────

const API = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
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

interface ServiceMeta {
  type: string;
  blueprintPanels: string[];
  outputTypes: string[];
  panelConstraints: Record<string, { minW: number; maxW: number; minH: number; maxH: number }>;
  notes?: string;
}

interface OrderResult {
  id: number;
  orderName: string;
  serviceType: string;
  status: string;
  trademarkSafe: boolean;
  trademarkNotes?: string;
  designerName?: string | null;
  designerEmail?: string | null;
  createdAt: string;
}

interface FashionRevision {
  id: number;
  type: string;
  feedback?: string | null;
  referenceUrls: string[];
  designerName?: string | null;
  revisedFileUrls: string[];
  notes?: string | null;
  createdAt: string;
}

// ── Display config ────────────────────────────────────────────────────────────

const SERVICE_CONFIG: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  "t-shirt":         { label: "T-Shirt",              emoji: "👕", color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/30" },
  "jersey":          { label: "Jersey",               emoji: "⚽", color: "text-green-400",  bg: "bg-green-500/10 border-green-500/30" },
  "hoodie":          { label: "Hoodie",               emoji: "🧥", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/30" },
  "uniform":         { label: "Seragam",              emoji: "👔", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  "jacket":          { label: "Jacket",               emoji: "🧣", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
  "dress":           { label: "Dress",                emoji: "👗", color: "text-pink-400",   bg: "bg-pink-500/10 border-pink-500/30" },
  "batik-inspired":  { label: "Batik Inspired",       emoji: "🎨", color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30" },
  "merchandise":     { label: "Merchandise",          emoji: "🛍️", color: "text-cyan-400",   bg: "bg-cyan-500/10 border-cyan-500/30" },
};

const STATUS_INFO: Record<string, { label: string; color: string; desc: string }> = {
  draft:                { label: "Draft",              color: "bg-gray-500/20 text-gray-300 border-gray-500/30",    desc: "Order diterima, menunggu konfirmasi." },
  blueprint_ready:      { label: "Blueprint Siap",     color: "bg-blue-500/20 text-blue-400 border-blue-500/30",    desc: "Tim kami sedang menyiapkan desain." },
  generating:           { label: "AI Generating",      color: "bg-purple-500/20 text-purple-400 border-purple-500/30", desc: "AI sedang membuat desain Anda." },
  review:               { label: "Siap Direview",      color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", desc: "Desain selesai, Anda dapat meminta revisi jika perlu." },
  revision_requested:   { label: "Revisi Diminta",     color: "bg-orange-500/20 text-orange-400 border-orange-500/30", desc: "Permintaan revisi Anda diterima, menunggu assignment designer." },
  revision_in_progress: { label: "Designer Bekerja",   color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",    desc: "Designer sedang mengerjakan revisi Anda." },
  approved:             { label: "Disetujui",          color: "bg-green-500/20 text-green-400 border-green-500/30",  desc: "Desain telah disetujui." },
  delivered:            { label: "Terkirim",           color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", desc: "Desain telah dikirimkan ke Anda." },
  trademark_flagged:    { label: "Perlu Review TM",    color: "bg-red-500/20 text-red-400 border-red-500/30",        desc: "Order perlu review trademark. Tim kami akan menghubungi Anda." },
  cancelled:            { label: "Dibatalkan",         color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",     desc: "Order telah dibatalkan." },
};

const REVISION_TYPE_LABEL: Record<string, { label: string; icon: string }> = {
  customer_request:    { label: "Permintaan Revisi Anda", icon: "💬" },
  designer_assignment: { label: "Designer Ditugaskan",    icon: "👤" },
  designer_upload:     { label: "File Revisi Tersedia",   icon: "✅" },
};

const OUTPUT_LABELS: Record<string, string> = {
  "flat-design":        "Flat Design",
  "front-back-preview": "Preview Depan/Belakang",
  "colorways":          "Variasi Warna",
  "motif-variants":     "Variasi Motif",
  "placement-spec":     "Spesifikasi Penempatan",
  "composition-json":   "Komposisi JSON",
};

// ── Steps ─────────────────────────────────────────────────────────────────────

type Step = "select-service" | "fill-form" | "submitted" | "track-order" | "request-revision";

const DEFAULT_COLORS = ["#1A237E", "#FFFFFF", "#F44336"];

// ── Main component ────────────────────────────────────────────────────────────

export default function FashionDesignPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("select-service");
  const [selectedService, setSelectedService] = useState<ServiceMeta | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<OrderResult | null>(null);
  const [colorways, setColorways] = useState<string[]>(DEFAULT_COLORS);
  const [newColor, setNewColor] = useState("#000000");

  // Track order state
  const [trackOrderId, setTrackOrderId] = useState("");
  const [trackEmail, setTrackEmail] = useState("");
  const [trackedOrder, setTrackedOrder] = useState<OrderResult | null>(null);
  const [trackedRevisions, setTrackedRevisions] = useState<FashionRevision[]>([]);
  const [trackLoading, setTrackLoading] = useState(false);

  // Revision request form
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [revisionRefUrls, setRevisionRefUrls] = useState("");

  // Form state
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    orderName: "",
    description: "",
    quantity: "1",
  });

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ["fashion-services"],
    queryFn: () => apiFetch<{ services: ServiceMeta[] }>("/api/ai/fashion-design/services"),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<OrderResult>("/api/ai/fashion-design/orders", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (order) => {
      setSubmittedOrder(order);
      setStep("submitted");
      toast({ title: "Order berhasil dibuat!", description: `Order #${order.id} — ${order.orderName}` });
    },
    onError: (err: Error) => {
      toast({ title: "Gagal membuat order", description: err.message, variant: "destructive" });
    },
  });

  const revisionMutation = useMutation({
    mutationFn: ({ orderId, customerEmail, feedback, referenceUrls }: {
      orderId: number; customerEmail: string; feedback: string; referenceUrls: string[];
    }) =>
      apiFetch<{ revision: FashionRevision }>(`/api/ai/fashion-design/orders/${orderId}/revision-request`, {
        method: "POST",
        body: JSON.stringify({ customerEmail, feedback, referenceUrls }),
      }),
    onSuccess: () => {
      toast({ title: "Permintaan revisi terkirim!", description: "Tim kami akan menghubungi designer untuk mengerjakan revisi Anda." });
      setRevisionFeedback("");
      setRevisionRefUrls("");
      // Re-fetch order & revisions
      if (trackedOrder) {
        handleTrackOrder(String(trackedOrder.id), form.customerEmail || trackEmail);
      }
      setStep("track-order");
    },
    onError: (err: Error) => toast({ title: "Gagal mengirim revisi", description: err.message, variant: "destructive" }),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSelectService(svc: ServiceMeta) {
    setSelectedService(svc);
    setStep("fill-form");
  }

  function handleBack() {
    setStep("select-service");
    setSelectedService(null);
  }

  function handleAddColor() {
    if (colorways.length >= 10) return;
    if (!colorways.includes(newColor)) setColorways([...colorways, newColor]);
  }

  function handleRemoveColor(c: string) {
    setColorways(colorways.filter(x => x !== c));
  }

  function handleSubmit() {
    if (!selectedService) return;
    const { customerName, customerEmail, orderName, description, quantity } = form;
    if (!customerName.trim() || !customerEmail.trim() || !orderName.trim()) {
      toast({ title: "Lengkapi form", description: "Nama, email, dan nama order wajib diisi.", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      orderName: orderName.trim(),
      description: description.trim() || undefined,
      serviceType: selectedService.type,
      quantity: parseInt(quantity, 10) || 1,
      colorways,
    });
  }

  async function handleTrackOrder(orderId: string, email: string) {
    if (!orderId || !email) return;
    setTrackLoading(true);
    try {
      const [orderRes, revisionsRes] = await Promise.all([
        apiFetch<OrderResult & { outputs?: Record<string, unknown> }>(`/api/ai/fashion-design/orders/${orderId}`).catch(() => null),
        apiFetch<{ revisions: FashionRevision[] }>(`/api/ai/fashion-design/orders/${orderId}/revisions?customerEmail=${encodeURIComponent(email)}`).catch(() => ({ revisions: [] })),
      ]);
      if (!orderRes) {
        toast({ title: "Order tidak ditemukan", description: "Periksa kembali nomor order dan email.", variant: "destructive" });
        return;
      }
      setTrackedOrder(orderRes);
      setTrackedRevisions(revisionsRes.revisions);
      setStep("track-order");
    } catch {
      toast({ title: "Gagal memuat order", variant: "destructive" });
    } finally {
      setTrackLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeOrder = trackedOrder ?? submittedOrder;
  const activeEmail = form.customerEmail || trackEmail;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEOMeta
        title="Fashion & Apparel Design AI"
        description="Rancang koleksi fashion dan pakaian dengan bantuan AI — desain teknis, moodboard, pola, dan presentasi brand fashion profesional."
        canonical="/fashion-design"
      />
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
            <Shirt className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Fashion & Apparel Design</h1>
            <p className="text-sm text-muted-foreground">Desain pakaian custom berbasis AI + sentuhan designer manusia</p>
          </div>
        </div>

        <AnimatePresence mode="wait">

          {/* ── STEP: Select service ── */}
          {step === "select-service" && (
            <motion.div key="select" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">

              {/* Track existing order */}
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground" /> Lacak Order Existing
                  </CardTitle>
                  <CardDescription>Sudah punya order? Cek status atau minta revisi di sini.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={trackOrderId}
                      onChange={(e) => setTrackOrderId(e.target.value)}
                      placeholder="Nomor Order (contoh: 42)"
                      className="text-sm"
                    />
                    <Input
                      type="email"
                      value={trackEmail}
                      onChange={(e) => setTrackEmail(e.target.value)}
                      placeholder="Email Anda"
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleTrackOrder(trackOrderId, trackEmail)}
                      disabled={trackLoading || !trackOrderId || !trackEmail}
                      className="gap-1.5 shrink-0"
                    >
                      {trackLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                      Cek
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Services grid */}
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Pilih Jenis Pakaian</h2>
                {servicesLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(servicesData?.services ?? []).map((svc) => {
                      const cfg = SERVICE_CONFIG[svc.type];
                      return (
                        <Card
                          key={svc.type}
                          className={`cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md border ${cfg?.bg ?? "border-border"}`}
                          onClick={() => handleSelectService(svc)}
                        >
                          <CardContent className="p-4 text-center space-y-2">
                            <div className="text-3xl">{cfg?.emoji ?? "👕"}</div>
                            <p className={`font-semibold text-sm ${cfg?.color ?? ""}`}>{cfg?.label ?? svc.type}</p>
                            {svc.notes && <p className="text-[10px] text-muted-foreground line-clamp-2">{svc.notes}</p>}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Info card */}
              <Card className="bg-purple-500/5 border-purple-500/20">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <Sparkles className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                    <div className="space-y-1 text-sm">
                      <p className="font-medium text-purple-300">AI + Human Designer</p>
                      <p className="text-muted-foreground text-xs">
                        AI kami akan membuat komposisi desain awal. Jika hasilnya kurang pas, Anda bisa minta revisi —
                        designer manusia kami yang akan menyempurnakannya sesuai keinginan Anda.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── STEP: Fill form ── */}
          {step === "fill-form" && selectedService && (
            <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1.5 mb-4 -ml-2">
                <ArrowLeft className="w-4 h-4" /> Kembali
              </Button>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <span className="text-2xl">{SERVICE_CONFIG[selectedService.type]?.emoji}</span>
                    Order {SERVICE_CONFIG[selectedService.type]?.label ?? selectedService.type}
                  </CardTitle>
                  <CardDescription>Isi detail order Anda. AI akan membuat komposisi desain berdasarkan informasi ini.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>Nama Anda *</Label>
                      <Input value={form.customerName} onChange={(e) => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Budi Santoso" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email *</Label>
                      <Input type="email" value={form.customerEmail} onChange={(e) => setForm(f => ({ ...f, customerEmail: e.target.value }))} placeholder="budi@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Nama Order *</Label>
                      <Input value={form.orderName} onChange={(e) => setForm(f => ({ ...f, orderName: e.target.value }))} placeholder="Jersey Tim Garuda 2025" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Jumlah (pcs)</Label>
                      <Input type="number" min="1" max="10000" value={form.quantity} onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Deskripsi Desain</Label>
                    <Textarea
                      value={form.description}
                      onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Jelaskan konsep desain: tema, motif, inspirasi, atau detail khusus yang Anda inginkan..."
                      rows={3}
                    />
                  </div>

                  {/* Colorways */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Pilihan Warna</Label>
                    <div className="flex flex-wrap gap-2">
                      {colorways.map((c) => (
                        <button
                          key={c}
                          onClick={() => handleRemoveColor(c)}
                          title="Klik untuk hapus"
                          className="flex items-center gap-1.5 bg-muted/40 hover:bg-red-500/20 rounded px-2 py-1 text-xs transition-colors"
                        >
                          <div className="w-4 h-4 rounded border border-white/20" style={{ backgroundColor: c }} />
                          <span className="font-mono">{c}</span>
                          <span className="text-muted-foreground">×</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-9 h-9 rounded cursor-pointer border-0" />
                      <Input value={newColor} onChange={(e) => setNewColor(e.target.value)} className="w-32 font-mono text-sm" />
                      <Button size="sm" variant="outline" onClick={handleAddColor} disabled={colorways.length >= 10}>+ Tambah</Button>
                    </div>
                  </div>

                  {selectedService.notes && (
                    <div className="flex gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
                      <Info className="w-4 h-4 shrink-0" /> {selectedService.notes}
                    </div>
                  )}

                  <Button
                    className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    onClick={handleSubmit}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Buat Order
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ── STEP: Submitted ── */}
          {step === "submitted" && submittedOrder && (
            <motion.div key="submitted" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
              <Card className="border-green-500/30 bg-green-500/5">
                <CardContent className="p-6 text-center space-y-3">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
                  <h2 className="text-lg font-bold">Order Berhasil Dibuat!</h2>
                  <p className="text-muted-foreground text-sm">
                    Order #{submittedOrder.id} — <strong>{submittedOrder.orderName}</strong> sedang diproses.
                  </p>
                  {!submittedOrder.trademarkSafe && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 text-left">
                      <p className="font-semibold">⚠️ Perlu review trademark</p>
                      <p>{submittedOrder.trademarkNotes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-medium mb-3">Simpan info ini untuk lacak order Anda:</p>
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-sm font-mono">
                    <div className="flex justify-between"><span className="text-muted-foreground">Order ID:</span><strong>#{submittedOrder.id}</strong></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Email:</span><span>{form.customerEmail}</span></div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button
                  className="flex-1 gap-2"
                  onClick={() => {
                    setTrackedOrder(submittedOrder);
                    setTrackedRevisions([]);
                    setStep("track-order");
                  }}
                >
                  <Search className="w-4 h-4" /> Lacak Order
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => { setStep("select-service"); setSubmittedOrder(null); }}>
                  Buat Order Baru
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── STEP: Track Order ── */}
          {step === "track-order" && activeOrder && (
            <motion.div key="track" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("select-service")} className="gap-1.5 -ml-2">
                  <ArrowLeft className="w-4 h-4" /> Kembali
                </Button>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => handleTrackOrder(String(activeOrder.id), activeEmail)}
                  className="gap-1.5 ml-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
              </div>

              {/* Order status card */}
              <Card>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{SERVICE_CONFIG[activeOrder.serviceType]?.emoji ?? "👕"}</span>
                        <h2 className="font-bold">{activeOrder.orderName}</h2>
                      </div>
                      <p className="text-xs text-muted-foreground">Order #{activeOrder.id} · {new Date(activeOrder.createdAt).toLocaleDateString("id-ID")}</p>
                    </div>
                    <Badge className={`border shrink-0 ${(STATUS_INFO[activeOrder.status] ?? STATUS_INFO["draft"]).color}`}>
                      {(STATUS_INFO[activeOrder.status] ?? { label: activeOrder.status }).label}
                    </Badge>
                  </div>

                  {/* Status description */}
                  <div className="bg-muted/30 rounded-lg p-3 text-sm text-muted-foreground">
                    {(STATUS_INFO[activeOrder.status] ?? { desc: "Status tidak diketahui." }).desc}
                  </div>

                  {/* Designer info */}
                  {activeOrder.designerName && (
                    <div className="flex items-center gap-2 text-sm bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3">
                      <PenTool className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <span className="text-cyan-400 font-medium">Designer: {activeOrder.designerName}</span>
                        <p className="text-xs text-muted-foreground">Sedang mengerjakan revisi desain Anda</p>
                      </div>
                    </div>
                  )}

                  {/* Trademark warning */}
                  {!activeOrder.trademarkSafe && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400">
                      <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Perlu review trademark</p>
                      <p>{activeOrder.trademarkNotes}</p>
                    </div>
                  )}

                  {/* CTA: Request Revision */}
                  {["review", "revision_in_progress"].includes(activeOrder.status) && (
                    <div className="border border-dashed border-purple-500/30 rounded-lg p-4 space-y-2">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4 text-purple-400" />
                        {activeOrder.status === "review" ? "Hasil desain AI siap — butuh sentuhan designer manusia?" : "Revisi sedang dikerjakan — ada tambahan feedback?"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Jika desain AI kurang sesuai keinginan Anda, klik tombol di bawah untuk minta penyempurnaan dari designer manusia kami.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => setStep("request-revision")}
                        className="gap-1.5 bg-purple-600 hover:bg-purple-700"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Minta Revisi Designer
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Revision history */}
              {trackedRevisions.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <History className="w-4 h-4 text-muted-foreground" /> Riwayat Revisi
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {trackedRevisions.map((rev) => {
                      const typeInfo = REVISION_TYPE_LABEL[rev.type] ?? { label: rev.type, icon: "📝" };
                      return (
                        <div key={rev.id} className="bg-muted/30 rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{typeInfo.icon} {typeInfo.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(rev.createdAt).toLocaleString("id-ID")}
                            </span>
                          </div>

                          {rev.feedback && (
                            <div className="bg-background/50 rounded p-2 text-xs">
                              <p className="text-muted-foreground mb-1">Feedback Anda:</p>
                              <p>{rev.feedback}</p>
                            </div>
                          )}

                          {rev.designerName && (
                            <p className="text-xs text-cyan-400 flex items-center gap-1">
                              <PenTool className="w-3 h-3" /> Designer: {rev.designerName}
                            </p>
                          )}

                          {(rev.revisedFileUrls as string[])?.length > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1.5">File Revisi Tersedia:</p>
                              <div className="flex flex-wrap gap-2">
                                {(rev.revisedFileUrls as string[]).map((url, i) => (
                                  <a
                                    key={i} href={url} target="_blank" rel="noopener noreferrer"
                                    className="text-xs text-green-400 hover:underline flex items-center gap-1 bg-green-500/10 px-2 py-1 rounded"
                                  >
                                    <ExternalLink className="w-3 h-3" /> Lihat File {i + 1}
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}

                          {rev.notes && <p className="text-xs text-muted-foreground italic">Catatan: {rev.notes}</p>}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}

          {/* ── STEP: Request Revision ── */}
          {step === "request-revision" && activeOrder && (
            <motion.div key="revision" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <Button variant="ghost" size="sm" onClick={() => setStep("track-order")} className="gap-1.5 -ml-2">
                <ArrowLeft className="w-4 h-4" /> Kembali ke Status Order
              </Button>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-purple-400" /> Minta Revisi Designer
                  </CardTitle>
                  <CardDescription>
                    Order #{activeOrder.id} — {activeOrder.orderName}.
                    Jelaskan secara detail perubahan yang Anda inginkan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Feedback Revisi * <span className="text-xs text-muted-foreground">(min. 10 karakter)</span></Label>
                    <Textarea
                      value={revisionFeedback}
                      onChange={(e) => setRevisionFeedback(e.target.value)}
                      placeholder="Contoh: Logo terlalu besar di bagian depan, tolong perkecil 30%. Warna merah kurang cerah, gunakan #FF1744. Nomor punggung perlu font yang lebih tebal..."
                      rows={5}
                    />
                    <p className="text-xs text-muted-foreground">{revisionFeedback.length} karakter</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>URL Referensi (opsional) <span className="text-xs text-muted-foreground">— satu URL per baris, maks. 5</span></Label>
                    <Textarea
                      value={revisionRefUrls}
                      onChange={(e) => setRevisionRefUrls(e.target.value)}
                      placeholder={"https://example.com/referensi-jersey.jpg\nhttps://example.com/inspirasi-warna.png"}
                      rows={3}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-400 space-y-1">
                    <p className="font-semibold flex items-center gap-1"><Info className="w-3.5 h-3.5" /> Yang akan terjadi selanjutnya:</p>
                    <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                      <li>Tim kami menerima permintaan revisi Anda</li>
                      <li>Admin akan menugaskan designer manusia</li>
                      <li>Designer mengerjakan revisi sesuai feedback Anda</li>
                      <li>File hasil revisi akan tersedia di halaman ini</li>
                    </ol>
                  </div>

                  <Button
                    className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    onClick={() => {
                      const refUrls = revisionRefUrls
                        .split("\n")
                        .map(u => u.trim())
                        .filter(u => u.startsWith("http"));
                      revisionMutation.mutate({
                        orderId: activeOrder.id,
                        customerEmail: activeEmail,
                        feedback: revisionFeedback,
                        referenceUrls: refUrls,
                      });
                    }}
                    disabled={revisionMutation.isPending || revisionFeedback.trim().length < 10}
                  >
                    {revisionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                    Kirim Permintaan Revisi
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
