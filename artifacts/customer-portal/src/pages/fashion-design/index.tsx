/**
 * Fashion & Apparel Design — Customer Portal (Team 18)
 *
 * Public-facing page for browsing available apparel services and submitting
 * design orders. Connects to the /api/ai/fashion-design/* endpoints.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shirt, ChevronRight, Palette, Layout, FileJson,
  CheckCircle2, AlertTriangle, Loader2, ArrowLeft,
  Package, Sparkles, Info,
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
  createdAt: string;
}

// ── Service type display config ───────────────────────────────────────────────

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

const OUTPUT_LABELS: Record<string, string> = {
  "flat-design":      "Flat Design",
  "front-back-preview": "Preview Depan/Belakang",
  "colorways":        "Variasi Warna",
  "motif-variants":   "Variasi Motif",
  "placement-spec":   "Spesifikasi Penempatan",
  "composition-json": "Komposisi JSON (Editable)",
};

const PANEL_LABELS: Record<string, string> = {
  "front":          "Depan",
  "back":           "Belakang",
  "sleeves":        "Lengan",
  "collar":         "Kerah",
  "pocket":         "Saku",
  "logo-area":      "Area Logo",
  "sponsor":        "Sponsor",
  "name":           "Nama",
  "number":         "Nomor",
  "garment-panels": "Panel Pakaian",
};

// ── Steps ─────────────────────────────────────────────────────────────────────

type Step = "select-service" | "fill-form" | "submitted";

const DEFAULT_COLORS = ["#1A237E", "#FFFFFF", "#F44336"];

// ── Main component ────────────────────────────────────────────────────────────

export default function FashionDesignPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("select-service");
  const [selectedService, setSelectedService] = useState<ServiceMeta | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<OrderResult | null>(null);
  const [colorways, setColorways] = useState<string[]>(DEFAULT_COLORS);
  const [newColor, setNewColor] = useState("#000000");

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
    setColorways(colorways.filter((x) => x !== c));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedService) return;
    createMutation.mutate({
      customerName: form.customerName,
      customerEmail: form.customerEmail,
      orderName: form.orderName,
      description: form.description || undefined,
      serviceType: selectedService.type,
      quantity: parseInt(form.quantity, 10) || 1,
      colorways,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0A0A14] text-white">
      {/* Header */}
      <div className="border-b border-white/10 bg-[#0D0D1A]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Shirt className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">Fashion & Apparel Design</h1>
            <p className="text-xs text-white/50">AI-assisted garment design studio</p>
          </div>
          {step !== "select-service" && (
            <div className="ml-auto">
              <Button variant="ghost" size="sm" onClick={handleBack} className="text-white/60 hover:text-white">
                <ArrowLeft className="w-4 h-4 mr-1" /> Kembali
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">

          {/* ── Step 1: Service selection ─────────────────────────────────── */}
          {step === "select-service" && (
            <motion.div
              key="select"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <div className="mb-8">
                <h2 className="text-2xl font-bold mb-2">Pilih Jenis Pakaian</h2>
                <p className="text-white/50 text-sm">
                  Tersedia 8 kategori pakaian dengan blueprint panel lengkap dan validasi otomatis.
                </p>
              </div>

              {servicesLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {(servicesData?.services ?? []).map((svc) => {
                    const cfg = SERVICE_CONFIG[svc.type] ?? { label: svc.type, emoji: "👕", color: "text-white", bg: "bg-white/5 border-white/20" };
                    return (
                      <motion.button
                        key={svc.type}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handleSelectService(svc)}
                        className={`border rounded-xl p-5 text-left transition-all hover:shadow-lg ${cfg.bg}`}
                      >
                        <div className="text-3xl mb-3">{cfg.emoji}</div>
                        <div className={`font-semibold mb-1 ${cfg.color}`}>{cfg.label}</div>
                        <div className="text-xs text-white/40 mb-3">{svc.blueprintPanels.length} panel blueprint</div>
                        <div className="flex flex-wrap gap-1">
                          {svc.outputTypes.slice(0, 3).map((o) => (
                            <span key={o} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/50">
                              {OUTPUT_LABELS[o] ?? o}
                            </span>
                          ))}
                        </div>
                        {svc.notes && (
                          <div className="mt-3 text-[10px] text-amber-400/70 flex gap-1">
                            <Info className="w-3 h-3 shrink-0 mt-0.5" />{svc.notes}
                          </div>
                        )}
                        <ChevronRight className="w-4 h-4 text-white/20 mt-3 ml-auto" />
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* Info banner */}
              <div className="mt-8 border border-blue-500/20 bg-blue-500/5 rounded-xl p-4 flex gap-3">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/50">
                  Output desain fashion ini bukan pola produksi final. Pola produksi memerlukan spesifikasi ukuran dan technical review sebelum manufaktur.
                  Desain yang meniru merek terkenal (Nike, Adidas, dll.) akan otomatis diblokir.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Order form ────────────────────────────────────────── */}
          {step === "fill-form" && selectedService && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <div className="mb-6 flex items-center gap-3">
                <div className="text-3xl">{SERVICE_CONFIG[selectedService.type]?.emoji ?? "👕"}</div>
                <div>
                  <h2 className="text-xl font-bold">
                    {SERVICE_CONFIG[selectedService.type]?.label ?? selectedService.type}
                  </h2>
                  <p className="text-white/40 text-sm">Isi detail order desain Anda</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Form column */}
                <form onSubmit={handleSubmit} className="lg:col-span-2 space-y-5">
                  <Card className="bg-white/5 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white">Informasi Order</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label className="text-xs text-white/60 mb-1.5 block">Nama Pelanggan *</Label>
                          <Input
                            required
                            value={form.customerName}
                            onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                            placeholder="Budi Santoso"
                            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-white/60 mb-1.5 block">Email *</Label>
                          <Input
                            required
                            type="email"
                            value={form.customerEmail}
                            onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                            placeholder="budi@contoh.com"
                            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs text-white/60 mb-1.5 block">Nama Order *</Label>
                        <Input
                          required
                          value={form.orderName}
                          onChange={(e) => setForm({ ...form, orderName: e.target.value })}
                          placeholder="Jersey Tim Futsal Garuda 2026"
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-white/60 mb-1.5 block">Deskripsi</Label>
                        <Textarea
                          rows={3}
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                          placeholder="Deskripsikan kebutuhan desain Anda..."
                          className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-white/60 mb-1.5 block">Jumlah (pcs)</Label>
                        <Input
                          type="number"
                          min="1"
                          max="10000"
                          value={form.quantity}
                          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                          className="bg-white/5 border-white/10 text-white text-sm w-32"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Colorways */}
                  <Card className="bg-white/5 border-white/10">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm text-white flex items-center gap-2">
                        <Palette className="w-4 h-4 text-purple-400" /> Colorways
                      </CardTitle>
                      <CardDescription className="text-xs text-white/40">
                        Pilih hingga 10 warna untuk desain (format hex)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {colorways.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => handleRemoveColor(c)}
                            title={`Hapus ${c}`}
                            className="group relative w-8 h-8 rounded-lg border-2 border-white/20 hover:border-red-400 transition-colors"
                            style={{ backgroundColor: c }}
                          >
                            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 text-white text-xs font-bold">✕</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          className="w-9 h-9 rounded-lg border border-white/20 bg-transparent cursor-pointer"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddColor}
                          disabled={colorways.length >= 10}
                          className="border-white/20 text-white/70 hover:text-white text-xs"
                        >
                          Tambah Warna
                        </Button>
                        <span className="text-xs text-white/30 self-center">{colorways.length}/10</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {createMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Membuat Order...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 mr-2" /> Buat Order Desain</>
                    )}
                  </Button>
                </form>

                {/* Sidebar: blueprint panels & outputs */}
                <div className="space-y-4">
                  <Card className="bg-white/5 border-white/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                        <Layout className="w-3 h-3" /> Blueprint Panels
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1.5">
                        {selectedService.blueprintPanels.map((p) => (
                          <div key={p} className="flex items-center gap-2 text-xs text-white/50">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
                            {PANEL_LABELS[p] ?? p}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-white/5 border-white/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                        <FileJson className="w-3 h-3" /> Output
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1.5">
                        {selectedService.outputTypes.map((o) => (
                          <div key={o} className="flex items-center gap-2 text-xs text-white/50">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-400/60" />
                            {OUTPUT_LABELS[o] ?? o}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {selectedService.notes && (
                    <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-3 flex gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-400/80">{selectedService.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Step 3: Success ───────────────────────────────────────────── */}
          {step === "submitted" && submittedOrder && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-lg mx-auto text-center py-16"
            >
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/30">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Order Berhasil Dibuat!</h2>
              <p className="text-white/50 mb-6 text-sm">
                Order desain Anda telah diterima. Tim kami akan memproses blueprint dan menghubungi Anda via email.
              </p>

              <div className="border border-white/10 bg-white/5 rounded-xl p-5 text-left mb-6 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Order ID</span>
                  <span className="font-mono font-semibold">#{submittedOrder.id}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Nama Order</span>
                  <span className="font-medium">{submittedOrder.orderName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Jenis Pakaian</span>
                  <span>{SERVICE_CONFIG[submittedOrder.serviceType]?.label ?? submittedOrder.serviceType}</span>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-white/50">Status</span>
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Draft</Badge>
                </div>
                <div className="flex justify-between text-sm items-center">
                  <span className="text-white/50">Trademark Safety</span>
                  {submittedOrder.trademarkSafe ? (
                    <span className="flex items-center gap-1 text-green-400 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Aman
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-400 text-xs">
                      <AlertTriangle className="w-3.5 h-3.5" /> Perlu review
                    </span>
                  )}
                </div>
              </div>

              {!submittedOrder.trademarkSafe && (
                <div className="border border-amber-500/20 bg-amber-500/5 rounded-xl p-4 mb-6 text-left">
                  <div className="flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-400 mb-1">Trademark Review Required</p>
                      <p className="text-xs text-white/50">{submittedOrder.trademarkNotes}</p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                onClick={() => { setStep("select-service"); setSubmittedOrder(null); setForm({ customerName: "", customerEmail: "", orderName: "", description: "", quantity: "1" }); setColorways(DEFAULT_COLORS); }}
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white"
              >
                <Package className="w-4 h-4 mr-2" /> Buat Order Baru
              </Button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
