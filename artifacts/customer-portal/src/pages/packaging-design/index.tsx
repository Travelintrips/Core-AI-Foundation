/**
 * Packaging Design — Customer Portal
 * Team 19 | /packaging-design
 *
 * A multi-step order form covering all 8 packaging service types.
 * Includes service selection, product details, panel / technical spec,
 * design brief, and order confirmation.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package, Box, Droplets, Tag, Coffee, Layers, Wheat, Sparkles,
  ChevronRight, ChevronLeft, CheckCircle2, AlertTriangle, Loader2,
  ArrowRight, Shield, Palette, Ruler, Barcode, FileText, Info,
} from "lucide-react";
import { Layout } from "@/components/layout";

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceType =
  | "box" | "pouch" | "bottle_label" | "jar_label"
  | "cup" | "sleeve" | "food_packaging" | "cosmetic_packaging";

interface ServiceOption {
  id: ServiceType;
  name: string;
  nameId: string;
  description: string;
  icon: React.ElementType;
  color: string;
  regulated: boolean;
  panels: string[];
}

interface OrderForm {
  serviceType: ServiceType | null;
  // Product
  brandName: string;
  productName: string;
  companyName: string;
  productCategory: string;
  marketTarget: string;
  quantity: number;
  // Panels & tech
  panelsRequired: string[];
  widthMm: string;
  heightMm: string;
  depthMm: string;
  bleedMm: string;
  safeAreaMm: string;
  colorMode: string;
  finishType: string;
  materialType: string;
  printSides: number;
  // Zones
  hasBarcodeZone: boolean;
  barcodeType: string;
  hasIngredientsBlock: boolean;
  hasLegalBlock: boolean;
  hasLogoZone: boolean;
  hasProductImageZone: boolean;
  hasNutritionFacts: boolean;
  hasHalalCertification: boolean;
  hasSniBadge: boolean;
  hasBpomNumber: boolean;
  // Variants
  variantCount: number;
  variantNames: string[];
  // Design brief
  stylePreference: string;
  colorPrimary: string;
  colorSecondary: string;
  referenceLinks: string;
  additionalNotes: string;
  // Contact
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICES: ServiceOption[] = [
  { id: "box",               name: "Box",              nameId: "Kemasan Box",         description: "Kotak kemasan kaku atau lipat — gift box, shipper box, rigid box",           icon: Box,      color: "#7C6EFA", regulated: false, panels: ["front","back","side","top","bottom"] },
  { id: "pouch",             name: "Pouch",            nameId: "Kemasan Pouch",        description: "Kemasan fleksibel standing pouch, flat pouch, spouted pouch",                icon: Package,  color: "#22D3EE", regulated: false, panels: ["front","back"] },
  { id: "bottle_label",     name: "Bottle Label",     nameId: "Label Botol",          description: "Label adhesif atau shrink untuk botol plastik / kaca",                       icon: Droplets, color: "#10B981", regulated: true,  panels: ["front","back","side"] },
  { id: "jar_label",        name: "Jar Label",        nameId: "Label Jar",            description: "Label untuk jar kosmetik, selai, produk supplement",                        icon: Tag,      color: "#F59E0B", regulated: true,  panels: ["front","back"] },
  { id: "cup",              name: "Cup",              nameId: "Kemasan Cup",          description: "Cup minuman, cup makanan — paper cup, plastic cup",                          icon: Coffee,   color: "#F97316", regulated: false, panels: ["side","bottom"] },
  { id: "sleeve",           name: "Sleeve",           nameId: "Sleeve",               description: "Shrink sleeve atau stretch sleeve untuk botol / kaleng",                     icon: Layers,   color: "#8B5CF6", regulated: false, panels: ["front","back","side"] },
  { id: "food_packaging",   name: "Food Packaging",   nameId: "Kemasan Makanan",      description: "Kemasan khusus produk pangan — snack, frozen food, bumbu, dll.",            icon: Wheat,    color: "#EF4444", regulated: true,  panels: ["front","back","side","top","bottom"] },
  { id: "cosmetic_packaging", name: "Cosmetic Packaging", nameId: "Kemasan Kosmetik", description: "Kemasan kosmetik & skincare — tube, jar, bottle, sachet, compact",         icon: Sparkles, color: "#EC4899", regulated: true,  panels: ["front","back","side","top","bottom"] },
];

const PANELS_ALL = ["front","back","side","top","bottom"];
const COLOR_MODES = [{ v:"cmyk", l:"CMYK (Print)" }, { v:"pantone", l:"Pantone (Spot)" }, { v:"rgb", l:"RGB (Digital only)" }];
const FINISH_TYPES = ["matte","gloss","soft_touch","uv_spot","foil","none"];
const MATERIAL_TYPES = ["kraft","cardboard","plastic","glass","aluminium","other"];
const BARCODE_TYPES = ["ean13","upc","qr","code128","datamatrix"];

const EMPTY_FORM: OrderForm = {
  serviceType: null,
  brandName: "", productName: "", companyName: "",
  productCategory: "", marketTarget: "", quantity: 500,
  panelsRequired: [], widthMm: "", heightMm: "", depthMm: "",
  bleedMm: "3", safeAreaMm: "5", colorMode: "cmyk",
  finishType: "matte", materialType: "cardboard", printSides: 1,
  hasBarcodeZone: false, barcodeType: "ean13",
  hasIngredientsBlock: false, hasLegalBlock: false, hasLogoZone: true,
  hasProductImageZone: false, hasNutritionFacts: false,
  hasHalalCertification: false, hasSniBadge: false, hasBpomNumber: false,
  variantCount: 1, variantNames: [""],
  stylePreference: "", colorPrimary: "#1A1A2E", colorSecondary: "#FFFFFF",
  referenceLinks: "", additionalNotes: "",
  customerName: "", customerEmail: "", customerPhone: "",
};

// ── Animation variants ─────────────────────────────────────────────────────────
const fadeSlide = {
  hidden: { opacity: 0, x: 24 },
  show:   { opacity: 1, x: 0,  transition: { duration: 0.3, ease: "easeOut" as const } },
  exit:   { opacity: 0, x: -16, transition: { duration: 0.2 } },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const steps = ["Layanan", "Produk", "Teknis", "Brief", "Kontak", "Konfirmasi"];
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.slice(0, total).map((label, i) => (
        <div key={i} className="flex items-center gap-1 flex-1">
          <div className="flex flex-col items-center">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                i < current
                  ? "bg-[#7C6EFA] text-white"
                  : i === current
                  ? "bg-[#7C6EFA]/20 border-2 border-[#7C6EFA] text-[#7C6EFA]"
                  : "bg-[#131E35] border border-[#2E4270] text-[#8B9BC4]"
              }`}
            >
              {i < current ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
            </div>
            <span className="text-[9px] text-[#8B9BC4] mt-1 whitespace-nowrap hidden sm:block">{label}</span>
          </div>
          {i < total - 1 && (
            <div className={`h-px flex-1 transition-all duration-300 ${i < current ? "bg-[#7C6EFA]" : "bg-[#2E4270]"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function Input({ value, onChange, placeholder, type = "text" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-[#2E4270] bg-[#0A1225] px-4 py-2.5 text-sm text-[#F0F4FF] placeholder-[#4A5A80] focus:outline-none focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA]/30 transition-colors"
    />
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`w-10 h-5.5 rounded-full transition-colors duration-200 flex items-center px-0.5 ${checked ? "bg-[#7C6EFA]" : "bg-[#2E4270]"}`}
        style={{ height: 22 }}
      >
        <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </div>
      <span className="text-sm text-[#C8D5F0] group-hover:text-[#F0F4FF] transition-colors">{label}</span>
    </label>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border border-[#2E4270] bg-[#0A1225] px-4 py-2.5 text-sm text-[#F0F4FF] focus:outline-none focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA]/30 transition-colors"
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PackagingDesignPage() {
  const [step, setStep]     = useState(0);
  const [form, setForm]     = useState<OrderForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; orderId?: string; message?: string; error?: string } | null>(null);

  const set = <K extends keyof OrderForm>(k: K, v: OrderForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const service = SERVICES.find((s) => s.id === form.serviceType);
  const isRegulated = service?.regulated ?? false;
  const TOTAL_STEPS = 6;

  // ── Submission ──────────────────────────────────────────────────────────────

  async function submit() {
    setSubmitting(true);
    try {
      const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${apiBase}/api/public/packaging-design/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType:           form.serviceType,
          customerName:          form.customerName,
          customerEmail:         form.customerEmail,
          customerPhone:         form.customerPhone || undefined,
          companyName:           form.companyName || undefined,
          brandName:             form.brandName,
          productName:           form.productName,
          productCategory:       form.productCategory || undefined,
          marketTarget:          form.marketTarget || undefined,
          quantity:              form.quantity,
          panelsRequired:        form.panelsRequired,
          widthMm:               form.widthMm || undefined,
          heightMm:              form.heightMm || undefined,
          depthMm:               form.depthMm || undefined,
          bleedMm:               form.bleedMm,
          safeAreaMm:            form.safeAreaMm,
          colorMode:             form.colorMode,
          finishType:            form.finishType || undefined,
          materialType:          form.materialType || undefined,
          printSides:            form.printSides,
          hasBarcodeZone:        form.hasBarcodeZone,
          barcodeType:           form.hasBarcodeZone ? form.barcodeType : undefined,
          hasIngredientsBlock:   form.hasIngredientsBlock,
          hasLegalBlock:         form.hasLegalBlock,
          hasLogoZone:           form.hasLogoZone,
          hasProductImageZone:   form.hasProductImageZone,
          hasNutritionFacts:     form.hasNutritionFacts,
          hasHalalCertification: form.hasHalalCertification,
          hasSniBadge:           form.hasSniBadge,
          hasBpomNumber:         form.hasBpomNumber,
          variantCount:          form.variantCount,
          stylePreference:       form.stylePreference || undefined,
          colorPrimary:          form.colorPrimary || undefined,
          colorSecondary:        form.colorSecondary || undefined,
          referenceLinks:        form.referenceLinks || undefined,
          additionalNotes:       form.additionalNotes || undefined,
        }),
      });
      const data = await res.json() as { ok?: boolean; orderId?: string; message?: string; error?: string };
      if (!res.ok) {
        setResult({ ok: false, error: data.error ?? "Gagal mengirim pesanan." });
      } else {
        setResult({ ok: true, orderId: data.orderId, message: data.message });
      }
    } catch {
      setResult({ ok: false, error: "Koneksi gagal. Periksa internet Anda dan coba lagi." });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step renderers ──────────────────────────────────────────────────────────

  function renderStep0() {
    return (
      <div>
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Pilih Jenis Kemasan</h2>
        <p className="text-sm text-[#8B9BC4] mb-6">Pilih jenis layanan desain kemasan yang Anda butuhkan.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SERVICES.map((s) => {
            const Icon = s.icon;
            const selected = form.serviceType === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  set("serviceType", s.id);
                  set("panelsRequired", s.panels);
                  if (s.regulated) {
                    set("hasIngredientsBlock", true);
                    set("hasLegalBlock", true);
                  }
                }}
                className={`text-left p-4 rounded-2xl border transition-all duration-200 ${
                  selected
                    ? "border-[#7C6EFA] bg-[#7C6EFA]/10 shadow-lg shadow-[#7C6EFA]/10"
                    : "border-[#2E4270] bg-[#0D1526] hover:border-[#7C6EFA]/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${s.color}20`, border: `1px solid ${s.color}40` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: s.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-sm text-[#F0F4FF]">{s.nameId}</p>
                      {s.regulated && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          REGULASI
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#8B9BC4] leading-snug">{s.description}</p>
                  </div>
                  {selected && <CheckCircle2 className="w-5 h-5 text-[#7C6EFA] shrink-0 mt-0.5" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderStep1() {
    return (
      <div className="space-y-4">
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Detail Produk</h2>
        <p className="text-sm text-[#8B9BC4] mb-6">Informasi brand dan produk yang akan didesain.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel required>Nama Brand</FieldLabel>
            <Input value={form.brandName} onChange={(v) => set("brandName", v)} placeholder="misal: JayaPack" />
          </div>
          <div>
            <FieldLabel required>Nama Produk</FieldLabel>
            <Input value={form.productName} onChange={(v) => set("productName", v)} placeholder="misal: Gift Box Premium" />
          </div>
          <div>
            <FieldLabel>Nama Perusahaan</FieldLabel>
            <Input value={form.companyName} onChange={(v) => set("companyName", v)} placeholder="PT / CV / Nama Toko" />
          </div>
          <div>
            <FieldLabel>Kategori Produk</FieldLabel>
            <Select
              value={form.productCategory}
              onChange={(v) => set("productCategory", v)}
              options={[
                { v: "", l: "Pilih kategori..." },
                { v: "food", l: "Makanan & Minuman" },
                { v: "beverage", l: "Minuman" },
                { v: "cosmetic", l: "Kosmetik & Skincare" },
                { v: "pharma", l: "Farmasi & Suplemen" },
                { v: "retail", l: "Retail / Consumer" },
                { v: "industrial", l: "Industri" },
                { v: "other", l: "Lainnya" },
              ]}
            />
          </div>
          <div>
            <FieldLabel>Target Pasar</FieldLabel>
            <Input value={form.marketTarget} onChange={(v) => set("marketTarget", v)} placeholder="misal: Indonesia, Asia Tenggara" />
          </div>
          <div>
            <FieldLabel>Estimasi Kuantitas</FieldLabel>
            <input
              type="number"
              value={form.quantity}
              onChange={(e) => set("quantity", parseInt(e.target.value) || 1)}
              min={1}
              className="w-full rounded-xl border border-[#2E4270] bg-[#0A1225] px-4 py-2.5 text-sm text-[#F0F4FF] focus:outline-none focus:border-[#7C6EFA]"
            />
          </div>
        </div>

        {/* Variant count */}
        <div>
          <FieldLabel>Jumlah Varian</FieldLabel>
          <p className="text-xs text-[#8B9BC4] mb-2">Berapa varian rasa / ukuran / aroma yang perlu didesain?</p>
          <input
            type="number"
            value={form.variantCount}
            onChange={(e) => {
              const n = Math.max(1, parseInt(e.target.value) || 1);
              set("variantCount", n);
              const names = Array.from({ length: n }, (_, i) => form.variantNames[i] ?? "");
              set("variantNames", names);
            }}
            min={1}
            max={50}
            className="w-32 rounded-xl border border-[#2E4270] bg-[#0A1225] px-4 py-2.5 text-sm text-[#F0F4FF] focus:outline-none focus:border-[#7C6EFA]"
          />
        </div>
        {form.variantCount > 1 && (
          <div className="space-y-2">
            <FieldLabel>Nama Varian</FieldLabel>
            {form.variantNames.map((name, i) => (
              <Input
                key={i}
                value={name}
                onChange={(v) => {
                  const names = [...form.variantNames];
                  names[i] = v;
                  set("variantNames", names);
                }}
                placeholder={`Varian ${i + 1} — misal: Strawberry 250ml`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderStep2() {
    return (
      <div className="space-y-5">
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Spesifikasi Teknis</h2>
        <p className="text-sm text-[#8B9BC4] mb-6">Dimensi, panel, bleed, safe area, dan zona wajib.</p>

        {/* Panels */}
        <div>
          <FieldLabel>Panel Dibutuhkan</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {PANELS_ALL.map((p) => {
              const checked = form.panelsRequired.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => {
                    const panels = checked
                      ? form.panelsRequired.filter((x) => x !== p)
                      : [...form.panelsRequired, p];
                    set("panelsRequired", panels);
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-150 capitalize ${
                    checked
                      ? "border-[#7C6EFA] bg-[#7C6EFA]/15 text-[#7C6EFA]"
                      : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dimensions */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel>Lebar (mm)</FieldLabel>
            <Input value={form.widthMm} onChange={(v) => set("widthMm", v)} placeholder="200" type="number" />
          </div>
          <div>
            <FieldLabel>Tinggi (mm)</FieldLabel>
            <Input value={form.heightMm} onChange={(v) => set("heightMm", v)} placeholder="150" type="number" />
          </div>
          <div>
            <FieldLabel>Kedalaman (mm)</FieldLabel>
            <Input value={form.depthMm} onChange={(v) => set("depthMm", v)} placeholder="80" type="number" />
          </div>
        </div>

        {/* Bleed + Safe Area */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel required>Bleed (mm)</FieldLabel>
            <Input value={form.bleedMm} onChange={(v) => set("bleedMm", v)} placeholder="3" type="number" />
            <p className="text-[11px] text-[#8B9BC4] mt-1">Min. 3 mm, rekomendasi 5 mm</p>
          </div>
          <div>
            <FieldLabel required>Safe Area (mm)</FieldLabel>
            <Input value={form.safeAreaMm} onChange={(v) => set("safeAreaMm", v)} placeholder="5" type="number" />
            <p className="text-[11px] text-[#8B9BC4] mt-1">Min. 3 mm dari garis potong</p>
          </div>
        </div>

        {/* Color mode + sides */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel required>Mode Warna</FieldLabel>
            <Select value={form.colorMode} onChange={(v) => set("colorMode", v)} options={COLOR_MODES} />
            {form.colorMode === "rgb" && (
              <p className="flex items-center gap-1 text-[11px] text-amber-400 mt-1"><AlertTriangle className="w-3 h-3" /> RGB tidak disarankan untuk cetak</p>
            )}
          </div>
          <div>
            <FieldLabel>Sisi Cetak</FieldLabel>
            <Select
              value={String(form.printSides)}
              onChange={(v) => set("printSides", parseInt(v))}
              options={[{ v:"1", l:"1 sisi" }, { v:"2", l:"2 sisi" }, { v:"4", l:"Semua sisi" }]}
            />
          </div>
        </div>

        {/* Finish + material */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Jenis Finishing</FieldLabel>
            <Select value={form.finishType} onChange={(v) => set("finishType", v)} options={FINISH_TYPES.map((t) => ({ v: t, l: t.replace(/_/g," ").replace(/\b\w/g,(c)=>c.toUpperCase()) }))} />
          </div>
          <div>
            <FieldLabel>Material</FieldLabel>
            <Select value={form.materialType} onChange={(v) => set("materialType", v)} options={MATERIAL_TYPES.map((t) => ({ v: t, l: t.charAt(0).toUpperCase()+t.slice(1) }))} />
          </div>
        </div>

        {/* Zones */}
        <div className="space-y-3 pt-2">
          <p className="text-xs font-semibold text-[#8B9BC4] uppercase tracking-wider flex items-center gap-2"><Layers className="w-3.5 h-3.5" /> Zona Desain</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Toggle checked={form.hasLogoZone}         onChange={(v) => set("hasLogoZone", v)}         label="Zona Logo" />
            <Toggle checked={form.hasProductImageZone} onChange={(v) => set("hasProductImageZone", v)} label="Zona Gambar Produk" />
            <Toggle checked={form.hasBarcodeZone}      onChange={(v) => set("hasBarcodeZone", v)}      label="Zona Barcode" />
            <Toggle checked={form.hasNutritionFacts}   onChange={(v) => set("hasNutritionFacts", v)}   label="Nutrition Facts" />
            <Toggle checked={form.hasHalalCertification} onChange={(v) => set("hasHalalCertification", v)} label="Sertifikasi Halal" />
            <Toggle checked={form.hasSniBadge}         onChange={(v) => set("hasSniBadge", v)}         label="Badge SNI" />
            <Toggle checked={form.hasBpomNumber}       onChange={(v) => set("hasBpomNumber", v)}       label="Nomor BPOM" />
          </div>
        </div>

        {/* Regulated fields */}
        {isRegulated && (
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-400">
              <Shield className="w-4 h-4" /> Informasi Wajib (Produk Regulasi)
            </p>
            <p className="text-xs text-amber-300/80">Tipe kemasan <strong>{service?.nameId}</strong> diwajibkan mencantumkan informasi komposisi dan legalitas.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Toggle checked={form.hasIngredientsBlock} onChange={(v) => set("hasIngredientsBlock", v)} label="Blok Komposisi / Bahan" />
              <Toggle checked={form.hasLegalBlock}       onChange={(v) => set("hasLegalBlock", v)}       label="Blok Legal (nama, alamat, ijin)" />
            </div>
            {(!form.hasIngredientsBlock || !form.hasLegalBlock) && (
              <p className="text-[11px] text-red-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Kedua blok wajib diaktifkan untuk produk regulasi.
              </p>
            )}
          </div>
        )}

        {/* Barcode type when barcode zone enabled */}
        {form.hasBarcodeZone && (
          <div>
            <FieldLabel>Tipe Barcode</FieldLabel>
            <Select
              value={form.barcodeType}
              onChange={(v) => set("barcodeType", v)}
              options={BARCODE_TYPES.map((t) => ({ v: t, l: t.toUpperCase() }))}
            />
          </div>
        )}
      </div>
    );
  }

  function renderStep3() {
    return (
      <div className="space-y-5">
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Brief Desain</h2>
        <p className="text-sm text-[#8B9BC4] mb-6">Preferensi visual dan referensi untuk tim desainer kami.</p>

        <div>
          <FieldLabel>Gaya Desain</FieldLabel>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {["minimalis","bold & vibrant","elegant & luxury","retro / vintage","natural & organic","modern & techy","playful & fun","industrial"].map((s) => (
              <button
                key={s}
                onClick={() => set("stylePreference", s)}
                className={`px-3 py-2 rounded-xl border text-xs font-medium transition-all capitalize text-left ${
                  form.stylePreference === s
                    ? "border-[#7C6EFA] bg-[#7C6EFA]/15 text-[#7C6EFA]"
                    : "border-[#2E4270] text-[#8B9BC4] hover:border-[#7C6EFA]/40"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Warna Utama</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.colorPrimary}
                onChange={(e) => set("colorPrimary", e.target.value)}
                className="w-10 h-10 rounded-lg border border-[#2E4270] bg-transparent cursor-pointer"
              />
              <Input value={form.colorPrimary} onChange={(v) => set("colorPrimary", v)} placeholder="#1A1A2E" />
            </div>
          </div>
          <div>
            <FieldLabel>Warna Sekunder</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.colorSecondary}
                onChange={(e) => set("colorSecondary", e.target.value)}
                className="w-10 h-10 rounded-lg border border-[#2E4270] bg-transparent cursor-pointer"
              />
              <Input value={form.colorSecondary} onChange={(v) => set("colorSecondary", v)} placeholder="#FFFFFF" />
            </div>
          </div>
        </div>

        <div>
          <FieldLabel>Link Referensi</FieldLabel>
          <Input value={form.referenceLinks} onChange={(v) => set("referenceLinks", v)} placeholder="https://pinterest.com/... atau Behance, Google Drive, dll." />
        </div>

        <div>
          <FieldLabel>Catatan Tambahan</FieldLabel>
          <textarea
            value={form.additionalNotes}
            onChange={(e) => set("additionalNotes", e.target.value)}
            rows={4}
            placeholder="Tuliskan keinginan, pantangan, atau detail penting lainnya untuk tim desainer..."
            className="w-full rounded-xl border border-[#2E4270] bg-[#0A1225] px-4 py-3 text-sm text-[#F0F4FF] placeholder-[#4A5A80] focus:outline-none focus:border-[#7C6EFA] focus:ring-1 focus:ring-[#7C6EFA]/30 resize-none"
          />
        </div>
      </div>
    );
  }

  function renderStep4() {
    return (
      <div className="space-y-4">
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Informasi Kontak</h2>
        <p className="text-sm text-[#8B9BC4] mb-6">Kami akan menghubungi Anda melalui email atau WhatsApp.</p>
        <div>
          <FieldLabel required>Nama Lengkap</FieldLabel>
          <Input value={form.customerName} onChange={(v) => set("customerName", v)} placeholder="Nama PIC / pemilik brand" />
        </div>
        <div>
          <FieldLabel required>Email</FieldLabel>
          <Input value={form.customerEmail} onChange={(v) => set("customerEmail", v)} placeholder="email@perusahaan.com" type="email" />
        </div>
        <div>
          <FieldLabel>WhatsApp / Telepon</FieldLabel>
          <Input value={form.customerPhone} onChange={(v) => set("customerPhone", v)} placeholder="+62 812 xxxx xxxx" type="tel" />
        </div>
      </div>
    );
  }

  function renderStep5() {
    const rows: [string, string][] = [
      ["Layanan",   service?.nameId ?? "-"],
      ["Brand",     form.brandName],
      ["Produk",    form.productName],
      ["Varian",    `${form.variantCount} varian`],
      ["Kuantitas", `${form.quantity.toLocaleString("id-ID")} pcs`],
      ["Dimensi",   [form.widthMm, form.heightMm, form.depthMm].filter(Boolean).join(" × ") + " mm" || "-"],
      ["Bleed",     `${form.bleedMm} mm`],
      ["Safe Area", `${form.safeAreaMm} mm`],
      ["Mode Warna",form.colorMode.toUpperCase()],
      ["Panel",     form.panelsRequired.join(", ") || "-"],
      ["Kontak",    `${form.customerName} · ${form.customerEmail}`],
    ];
    return (
      <div className="space-y-5">
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-xl font-bold text-[#F0F4FF] mb-1">Konfirmasi Pesanan</h2>
        <p className="text-sm text-[#8B9BC4] mb-4">Periksa kembali detail pesanan Anda sebelum mengirim.</p>

        <div className="rounded-2xl border border-[#2E4270] overflow-hidden">
          {rows.map(([label, value], i) => (
            <div key={i} className={`flex justify-between px-4 py-2.5 text-sm ${i % 2 === 0 ? "bg-[#0A1225]" : "bg-[#0D1526]"}`}>
              <span className="text-[#8B9BC4]">{label}</span>
              <span className="text-[#F0F4FF] font-medium text-right max-w-[55%] truncate">{value}</span>
            </div>
          ))}
        </div>

        {form.colorMode === "rgb" && (
          <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300">Mode warna RGB dipilih. Tim kami akan mengkonversi ke CMYK — warna akhir dapat sedikit berbeda.</p>
          </div>
        )}

        {isRegulated && (!form.hasIngredientsBlock || !form.hasLegalBlock) && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">Blok informasi wajib (komposisi + legal) belum diaktifkan. Pesanan tidak dapat dicetak tanpa informasi tersebut.</p>
          </div>
        )}

        <div className="p-3 rounded-xl border border-[#7C6EFA]/30 bg-[#7C6EFA]/10 flex items-start gap-2">
          <Info className="w-4 h-4 text-[#7C6EFA] mt-0.5 shrink-0" />
          <p className="text-xs text-[#C8D5F0]">Setelah pesanan dikirim, tim kami akan menghubungi Anda dalam 1×24 jam untuk konfirmasi scope dan jadwal produksi.</p>
        </div>
      </div>
    );
  }

  // ── Navigation guards ──────────────────────────────────────────────────────

  function canProceed(): boolean {
    switch (step) {
      case 0: return !!form.serviceType;
      case 1: return !!form.brandName && !!form.productName;
      case 2: return parseFloat(form.bleedMm) >= 3 && parseFloat(form.safeAreaMm) >= 3 && (!isRegulated || (form.hasIngredientsBlock && form.hasLegalBlock));
      case 3: return true;
      case 4: return !!form.customerName && !!form.customerEmail;
      case 5: return true;
      default: return false;
    }
  }

  // ── Success screen ──────────────────────────────────────────────────────────

  if (result?.ok) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-md w-full text-center"
          >
            <div className="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center"
                 style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", boxShadow: "0 8px 32px rgba(16,185,129,0.4)" }}>
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-2xl font-bold text-[#F0F4FF] mb-3">
              Pesanan Terkirim!
            </h1>
            <p className="text-[#8B9BC4] mb-4">{result.message}</p>
            {result.orderId && (
              <div className="p-3 rounded-xl border border-[#2E4270] bg-[#0D1526] mb-6">
                <p className="text-xs text-[#8B9BC4] mb-1">Nomor Pesanan</p>
                <p className="font-mono text-sm text-[#7C6EFA] break-all">{result.orderId}</p>
              </div>
            )}
            <button
              onClick={() => { setResult(null); setForm(EMPTY_FORM); setStep(0); }}
              className="btn-primary"
            >
              Buat Pesanan Baru
            </button>
          </motion.div>
        </div>
      </Layout>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", boxShadow: "0 4px 16px rgba(124,110,250,0.35)" }}>
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="text-2xl font-bold text-[#F0F4FF]">
                Desain Kemasan
              </h1>
              <p className="text-sm text-[#8B9BC4]">Packaging Design • Creative AI Studio</p>
            </div>
          </div>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} total={TOTAL_STEPS} />

        {/* Step content */}
        <div className="bg-[#0D1526] rounded-2xl border border-[#2E4270] p-6 mb-6 min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              variants={fadeSlide}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              {step === 0 && renderStep0()}
              {step === 1 && renderStep1()}
              {step === 2 && renderStep2()}
              {step === 3 && renderStep3()}
              {step === 4 && renderStep4()}
              {step === 5 && renderStep5()}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Error */}
        {result?.error && (
          <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{result.error}</p>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setStep(Math.max(0, step - 1)); setResult(null); }}
            disabled={step === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2E4270] text-sm text-[#8B9BC4] hover:text-[#F0F4FF] hover:border-[#7C6EFA] disabled:opacity-30 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Kembali
          </button>

          {step < TOTAL_STEPS - 1 ? (
            <button
              onClick={() => canProceed() && setStep(step + 1)}
              disabled={!canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)", color: "#fff", boxShadow: canProceed() ? "0 4px 16px rgba(124,110,250,0.35)" : "none" }}
            >
              Lanjut <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={submitting || !canProceed()}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)", color: "#fff", boxShadow: "0 4px 16px rgba(16,185,129,0.35)" }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {submitting ? "Mengirim..." : "Kirim Pesanan"}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
