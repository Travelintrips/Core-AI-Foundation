/**
 * Project Wizard — /start
 *
 * AI-guided creative project intake. Replaces the old service-marketplace
 * browse flow. Collects project context in 5 steps, shows an AI workflow
 * plan, lets the customer pick a package, then creates a service request
 * using the existing catalog API.
 */

import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, ArrowLeft, Sparkles, CheckCircle2, Upload,
  X, Loader2, ChevronRight, Diamond, Play, Zap, Clock, Star,
  Users, Package, Building2, FileText, Image, Megaphone, Globe,
  Cpu, LayoutGrid, Palette, Camera, Presentation,
} from "lucide-react";
import { usePublicCatalog, type CatalogService } from "@/hooks/use-catalog";

/* ─────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────── */

export const PROJECT_CATEGORIES = [
  { id: "branding",          emoji: "🎨", label: "Branding & Logo",       icon: Palette,       color: "#7C6EFA", keywords: ["brand", "logo", "identity"] },
  { id: "packaging",         emoji: "📦", label: "Packaging Produk",      icon: Package,       color: "#F97316", keywords: ["packaging", "kemasan"] },
  { id: "fashion",           emoji: "👗", label: "Fashion Design",         icon: Sparkles,      color: "#EC4899", keywords: ["fashion", "koleksi", "collection"] },
  { id: "interior",          emoji: "🏠", label: "Interior Design",        icon: LayoutGrid,    color: "#22D3EE", keywords: ["interior", "ruang", "space"] },
  { id: "company_profile",   emoji: "🏢", label: "Company Profile",        icon: Building2,     color: "#10B981", keywords: ["company", "profile", "profil"] },
  { id: "pitch_deck",        emoji: "📊", label: "Pitch Deck",             icon: Presentation,  color: "#F59E0B", keywords: ["pitch", "deck", "presentation", "investor"] },
  { id: "social_media",      emoji: "📱", label: "Social Media Content",   icon: Camera,        color: "#8B5CF6", keywords: ["social", "media", "content", "konten"] },
  { id: "website",           emoji: "🌐", label: "Website",                icon: Globe,         color: "#06B6D4", keywords: ["web", "website", "landing"] },
  { id: "ai_image",          emoji: "📸", label: "AI Image Campaign",      icon: Image,         color: "#F43F5E", keywords: ["image", "visual", "campaign", "foto"] },
  { id: "creative_marketing",emoji: "🎬", label: "Creative Marketing",     icon: Megaphone,     color: "#EAB308", keywords: ["marketing", "campaign", "iklan"] },
];

/* Workflow steps shown per category */
const CATEGORY_WORKFLOWS: Record<string, string[]> = {
  branding:          ["Brand Research", "Logo Design", "Identity System", "Brand Guidelines", "Asset Kit"],
  packaging:         ["Market Research", "Concept Design", "Packaging Mockup", "Print-Ready Files", "Brand Integration"],
  fashion:           ["Brand Strategy", "Collection Brief", "Visual Campaign", "Campaign Copy", "Lookbook"],
  interior:          ["Client Brief", "Concept & Mood Board", "3D Visualization", "Material Spec", "Presentation"],
  company_profile:   ["Business Analysis", "Content Strategy", "Design & Layout", "Photography Direction", "PDF & Print"],
  pitch_deck:        ["Story Framework", "Slide Design", "Data Visualization", "Executive Summary", "Investor Pack"],
  social_media:      ["Content Strategy", "Visual Templates", "Caption Copy", "Posting Calendar", "Analytics Report"],
  website:           ["UX Strategy", "Wireframes", "Visual Design", "Copy & SEO", "Design Handoff"],
  ai_image:          ["Creative Briefing", "AI Generation", "Quality Review", "Text Overlay", "Final Delivery"],
  creative_marketing:["Campaign Strategy", "Creative Concept", "Visual Production", "Copywriting", "Campaign Report"],
};

const PACKAGE_TIERS = [
  {
    id: "starter",
    name: "Starter",
    price: "Hubungi kami",
    badge: null,
    color: "#22D3EE",
    features: [
      "3–5 deliverable",
      "2× revisi",
      "AI model standar",
      "5 hari kerja",
      "PDF final",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    price: "Hubungi kami",
    badge: "Paling Populer",
    color: "#7C6EFA",
    features: [
      "8–12 deliverable",
      "5× revisi",
      "AI model premium",
      "3 hari kerja",
      "Human review",
      "Editable source file",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Hubungi kami",
    badge: null,
    color: "#F59E0B",
    features: [
      "Tidak terbatas",
      "Revisi unlimited",
      "Multi-AI workflow",
      "Priority queue",
      "Dedicated manager",
      "Extended usage rights",
    ],
  },
];

const WIZARD_STEPS = [
  { id: 1, label: "Apa yang dibuat" },
  { id: 2, label: "Bisnis Anda" },
  { id: 3, label: "Target Market" },
  { id: 4, label: "Tujuan Project" },
  { id: 5, label: "Referensi" },
];

/* ─────────────────────────────────────────────────────────
   ANIMATION VARIANTS
───────────────────────────────────────────────────────── */

const slideIn = {
  hidden: { opacity: 0, x: 32 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] } },
  exit:   { opacity: 0, x: -32, transition: { duration: 0.25 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

/* ─────────────────────────────────────────────────────────
   HELPER — detect best category from a free-text query
───────────────────────────────────────────────────────── */

function findCategoryFromQuery(query: string): string {
  if (!query.trim()) return "branding";
  const q = query.toLowerCase();
  // Extended keyword map (covers common Indonesian + English terms)
  const extended: Record<string, string[]> = {
    interior:          ["ruang", "interior", "rumah", "kamar", "dapur", "kantor", "makan", "tidur", "apartemen", "villa", "cafe", "restoran", "lobby", "bedroom", "kitchen", "living", "dining"],
    branding:          ["brand", "logo", "identitas", "identity", "merek", "mark", "branding"],
    packaging:         ["packaging", "kemasan", "botol", "box", "wadah", "produk", "label"],
    fashion:           ["fashion", "baju", "pakaian", "koleksi", "clothing", "outfit", "busana"],
    company_profile:   ["company", "profil perusahaan", "company profile", "profil bisnis"],
    pitch_deck:        ["pitch", "deck", "investor", "presentation", "presentasi", "slide"],
    social_media:      ["social media", "instagram", "tiktok", "konten", "content", "feed", "story"],
    website:           ["website", "web", "landing page", "toko online", "e-commerce", "ecommerce"],
    ai_image:          ["foto", "gambar", "visual", "image", "campaign", "editorial", "photo"],
    creative_marketing:["marketing", "iklan", "ads", "promosi", "campaign", "digital marketing"],
  };

  let best = { id: "branding", score: 0 };
  for (const cat of PROJECT_CATEGORIES) {
    const allKw = [...(cat.keywords ?? []), ...(extended[cat.id] ?? [])];
    const score = allKw.reduce((n, kw) => n + (q.includes(kw) ? 2 : 0), 0);
    if (score > best.score) best = { id: cat.id, score };
  }
  return best.id;
}

/* ─────────────────────────────────────────────────────────
   HELPER — find the best-matching service from catalog
───────────────────────────────────────────────────────── */

function findService(
  services: CatalogService[],
  categoryId: string,
  query: string,
): CatalogService | null {
  if (!services.length) return null;
  const cat = PROJECT_CATEGORIES.find((c) => c.id === categoryId);
  const keywords = cat?.keywords ?? [];
  const searchTerms = [...keywords, ...query.toLowerCase().split(" ")].filter(Boolean);

  // Score each service
  const scored = services.map((s) => {
    const hay = `${s.serviceCode} ${s.serviceName} ${s.shortDescription}`.toLowerCase();
    const score = searchTerms.reduce((n, kw) => n + (hay.includes(kw) ? 1 : 0), 0);
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.s ?? null;
}

/* ─────────────────────────────────────────────────────────
   WIZARD STATE
───────────────────────────────────────────────────────── */

type Phase =
  | "wizard"   // steps 1-5
  | "analysis" // AI thinking animation
  | "workflow" // show workflow + package pick
  | "contact"  // name/email/submit
  | "done";    // redirecting

interface WizardData {
  categoryId:   string;
  query:        string;   // free-text from landing
  // Step 1
  projectDesc:  string;
  // Step 2
  businessName: string;
  industry:     string;
  stage:        string;
  // Step 3
  targetMarket: string;
  geography:    string;
  // Step 4
  goals:        string;
  timeline:     string;
  // Step 5
  references:   string;
  styleNotes:   string;
  // Package
  package:      string;
  // Contact
  name:         string;
  email:        string;
  phone:        string;
}

/* ─────────────────────────────────────────────────────────
   SUB-COMPONENTS
───────────────────────────────────────────────────────── */

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1 rounded-full transition-all duration-500"
          style={{
            width: i + 1 === step ? 32 : 16,
            background: i + 1 <= step ? "#7C6EFA" : "rgba(124,110,250,0.20)",
          }}
        />
      ))}
      <span className="text-xs ml-1" style={{ color: "#4F6494" }}>
        {step} / {total}
      </span>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-sm font-semibold mb-2" style={{ color: "#C8D0E8" }}>
      {children}
    </label>
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all"
      style={{
        background: "rgba(13,21,38,0.80)",
        border: "1.5px solid #243352",
        color: "#F0F4FF",
        fontFamily: "inherit",
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "#7C6EFA"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "#243352"; }}
    />
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all"
      style={{
        background: "rgba(13,21,38,0.80)",
        border: "1.5px solid #243352",
        color: "#F0F4FF",
        fontFamily: "inherit",
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = "#7C6EFA"; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = "#243352"; }}
    />
  );
}

function SelectChip({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
          style={
            value === opt
              ? { background: "rgba(124,110,250,0.22)", color: "#9D91FB", border: "1.5px solid rgba(124,110,250,0.50)" }
              : { background: "rgba(13,21,38,0.80)", color: "#8B9BC4", border: "1.5px solid #243352" }
          }
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   WIZARD STEPS
───────────────────────────────────────────────────────── */

function Step1({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  const cat = PROJECT_CATEGORIES.find((c) => c.id === data.categoryId);
  // Start collapsed (compact badge) when a category is already set; open grid when user wants to change
  const [showGrid, setShowGrid] = useState(false);

  return (
    <motion.div key="step1" variants={slideIn} initial="hidden" animate="show" exit="exit" className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#4F6494" }}>
          Apa yang dibuat
        </p>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Apa yang ingin Anda buat?
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          Jelaskan kebutuhan Anda. Semakin detail, semakin tepat workflow AI yang kami siapkan.
        </p>
      </div>

      {/* Category — compact badge (collapsed) or full grid */}
      <div>
        <FieldLabel>Kategori project</FieldLabel>
        {!showGrid ? (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: `${cat?.color ?? "#7C6EFA"}12`, border: `1.5px solid ${cat?.color ?? "#7C6EFA"}40` }}>
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{cat?.emoji}</span>
              <span className="font-semibold text-sm" style={{ color: cat?.color ?? "#7C6EFA" }}>{cat?.label ?? "Project Kreatif"}</span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${cat?.color ?? "#7C6EFA"}22`, color: cat?.color ?? "#7C6EFA" }}>
                ✓ Terdeteksi
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowGrid(true)}
              className="text-xs font-medium transition-colors"
              style={{ color: "#6B7FA8" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#F0F4FF"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#6B7FA8"; }}
            >
              Ganti kategori ↓
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
              {PROJECT_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onChange("categoryId", c.id); setShowGrid(false); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
                  style={
                    data.categoryId === c.id
                      ? { background: `${c.color}18`, border: `1.5px solid ${c.color}44`, color: c.color }
                      : { background: "rgba(13,21,38,0.60)", border: "1.5px solid #243352", color: "#8B9BC4" }
                  }
                >
                  <span className="text-base">{c.emoji}</span>
                  <span className="truncate">{c.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowGrid(false)}
              className="text-xs font-medium"
              style={{ color: "#4F6494" }}
            >
              ↑ Tutup
            </button>
          </div>
        )}
      </div>

      <div>
        <FieldLabel>Deskripsi project Anda *</FieldLabel>
        <Textarea
          value={data.projectDesc || data.query}
          onChange={(v) => onChange("projectDesc", v)}
          placeholder={`Contoh: "Saya ingin membuat brand fashion wanita premium untuk target usia 25-35 tahun, dengan nuansa minimalis dan elegan."`}
          rows={4}
        />
      </div>
    </motion.div>
  );
}

function Step2({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <motion.div key="step2" variants={slideIn} initial="hidden" animate="show" exit="exit" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Ceritakan bisnis Anda
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          AI kami menyesuaikan workflow berdasarkan profil bisnis Anda.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>Nama bisnis / brand *</FieldLabel>
          <Input value={data.businessName} onChange={(v) => onChange("businessName", v)} placeholder="Contoh: Aurora Fashion Studio" />
        </div>
        <div>
          <FieldLabel>Industri</FieldLabel>
          <SelectChip
            value={data.industry}
            onChange={(v) => onChange("industry", v)}
            options={["Fashion", "Retail", "F&B", "Teknologi", "Healthcare", "Property", "Pendidikan", "Jasa", "Lainnya"]}
          />
        </div>
        <div>
          <FieldLabel>Tahap bisnis</FieldLabel>
          <SelectChip
            value={data.stage}
            onChange={(v) => onChange("stage", v)}
            options={["Baru mulai (0–1 tahun)", "Berkembang (1–3 tahun)", "Mapan (3+ tahun)", "Enterprise"]}
          />
        </div>
      </div>
    </motion.div>
  );
}

function Step3({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <motion.div key="step3" variants={slideIn} initial="hidden" animate="show" exit="exit" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Siapa target market Anda?
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          Memahami audiens Anda membantu AI membuat konten yang beresonansi.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>Deskripsi target audiens *</FieldLabel>
          <Textarea
            value={data.targetMarket}
            onChange={(v) => onChange("targetMarket", v)}
            placeholder="Contoh: Wanita urban usia 25-35 tahun, berpenghasilan menengah-atas, peduli gaya hidup dan fashion premium."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel>Jangkauan geografis</FieldLabel>
          <SelectChip
            value={data.geography}
            onChange={(v) => onChange("geography", v)}
            options={["Lokal (Kota)", "Nasional", "Regional (ASEAN)", "Global"]}
          />
        </div>
      </div>
    </motion.div>
  );
}

function Step4({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <motion.div key="step4" variants={slideIn} initial="hidden" animate="show" exit="exit" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Apa tujuan project ini?
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          Tujuan yang jelas menghasilkan deliverable yang lebih tepat sasaran.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>Tujuan utama *</FieldLabel>
          <SelectChip
            value={data.goals}
            onChange={(v) => onChange("goals", v)}
            options={[
              "Membangun brand baru",
              "Rebranding",
              "Meningkatkan penjualan",
              "Ekspansi pasar",
              "Peluncuran produk",
              "Fundraising / investor",
              "Meningkatkan awareness",
              "Lainnya",
            ]}
          />
        </div>
        <div>
          <FieldLabel>Target waktu selesai</FieldLabel>
          <SelectChip
            value={data.timeline}
            onChange={(v) => onChange("timeline", v)}
            options={["ASAP (< 3 hari)", "1 minggu", "2 minggu", "1 bulan", "Fleksibel"]}
          />
        </div>
      </div>
    </motion.div>
  );
}

function Step5({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <motion.div key="step5" variants={slideIn} initial="hidden" animate="show" exit="exit" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Referensi & preferensi gaya
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          Opsional — bagikan referensi visual atau brand yang Anda sukai.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <FieldLabel>Link referensi (website, Instagram, Behance, dll.)</FieldLabel>
          <Textarea
            value={data.references}
            onChange={(v) => onChange("references", v)}
            placeholder="Paste link referensi, satu per baris. Contoh:&#10;https://www.behance.net/...&#10;https://www.instagram.com/..."
            rows={3}
          />
        </div>
        <div>
          <FieldLabel>Catatan gaya & preferensi</FieldLabel>
          <Textarea
            value={data.styleNotes}
            onChange={(v) => onChange("styleNotes", v)}
            placeholder="Contoh: Warna dominan hitam dan emas, nuansa premium dan minimalis, menghindari warna cerah."
            rows={3}
          />
        </div>

        {/* Upload hint */}
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: "rgba(124,110,250,0.06)", border: "1px dashed rgba(124,110,250,0.25)" }}>
          <Upload className="w-4 h-4 shrink-0" style={{ color: "#7C6EFA" }} />
          <p className="text-xs" style={{ color: "#8B9BC4" }}>
            Upload logo dan aset brand bisa dilakukan setelah project dibuat, di halaman brief Anda.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   AI ANALYSIS SCREEN
───────────────────────────────────────────────────────── */

function AnalysisScreen({ categoryId }: { categoryId: string }) {
  const cat = PROJECT_CATEGORIES.find((c) => c.id === categoryId);
  const steps = [
    "Memahami kebutuhan project Anda…",
    "Menganalisis target market…",
    "Merancang workflow AI yang optimal…",
    "Memilih deliverable terbaik…",
    "Menyiapkan rencana project…",
  ];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= steps.length - 1) return;
    const t = setTimeout(() => setIdx((i) => i + 1), 500);
    return () => clearTimeout(t);
  }, [idx]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 space-y-8"
    >
      {/* Animated orb */}
      <div className="relative w-24 h-24">
        <div className="absolute inset-0 rounded-full animate-ping"
          style={{ background: `${cat?.color ?? "#7C6EFA"}22`, animationDuration: "1.4s" }} />
        <div className="relative w-24 h-24 rounded-full flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${cat?.color ?? "#7C6EFA"} 0%, #5F52D0 100%)`, boxShadow: `0 0 40px ${cat?.color ?? "#7C6EFA"}44` }}>
          <Sparkles className="w-10 h-10 text-white" />
        </div>
      </div>

      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          AI sedang menganalisis project Anda
        </h2>
        <AnimatePresence mode="wait">
          <motion.p
            key={idx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="text-sm"
            style={{ color: "#8B9BC4" }}
          >
            {steps[idx]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Progress */}
      <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(124,110,250,0.15)" }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: cat?.color ?? "#7C6EFA" }}
          initial={{ width: "0%" }}
          animate={{ width: `${((idx + 1) / steps.length) * 100}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   WORKFLOW + PACKAGE SCREEN
───────────────────────────────────────────────────────── */

function WorkflowPackageScreen({
  data,
  onChange,
  onNext,
}: {
  data: WizardData;
  onChange: (k: keyof WizardData, v: string) => void;
  onNext: () => void;
}) {
  const cat = PROJECT_CATEGORIES.find((c) => c.id === data.categoryId);
  const workflow = CATEGORY_WORKFLOWS[data.categoryId] ?? CATEGORY_WORKFLOWS.branding;

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4"
          style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.30)", color: "#10B981" }}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Analisis selesai
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Kami memahami kebutuhan Anda
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          AI kami akan menjalankan workflow berikut untuk project {cat?.label ?? ""} Anda.
        </p>
      </div>

      {/* Workflow timeline */}
      <div className="rounded-2xl p-5 space-y-3"
        style={{ background: "rgba(13,21,38,0.80)", border: "1px solid #243352" }}>
        <div className="flex items-center gap-2 mb-4">
          <Cpu className="w-4 h-4" style={{ color: "#7C6EFA" }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#4F6494" }}>
            AI Workflow Plan
          </span>
        </div>
        {workflow.map((step, i) => (
          <div key={step} className="flex items-center gap-3">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: `${cat?.color ?? "#7C6EFA"}22`, color: cat?.color ?? "#7C6EFA", border: `1px solid ${cat?.color ?? "#7C6EFA"}44` }}>
                {i + 1}
              </div>
              {i < workflow.length - 1 && (
                <div className="w-px h-5 mt-1" style={{ background: `${cat?.color ?? "#7C6EFA"}22` }} />
              )}
            </div>
            <div className="flex-1 flex items-center justify-between py-0.5">
              <span className="text-sm font-medium" style={{ color: "#C8D0E8" }}>{step}</span>
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(16,185,129,0.10)", color: "#10B981", border: "1px solid rgba(16,185,129,0.20)" }}>
                ✓ AI
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Package selection */}
      <div>
        <h3 className="text-base font-semibold mb-4" style={{ color: "#F0F4FF" }}>Pilih paket yang sesuai</h3>
        <div className="grid gap-3">
          {PACKAGE_TIERS.map((pkg) => (
            <button
              key={pkg.id}
              type="button"
              onClick={() => onChange("package", pkg.id)}
              className="w-full text-left rounded-2xl p-4 transition-all"
              style={
                data.package === pkg.id
                  ? { background: `${pkg.color}10`, border: `2px solid ${pkg.color}55`, boxShadow: `0 0 20px ${pkg.color}15` }
                  : { background: "rgba(13,21,38,0.60)", border: "2px solid #243352" }
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm" style={{ color: pkg.color }}>{pkg.name}</span>
                    {pkg.badge && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `${pkg.color}18`, color: pkg.color, border: `1px solid ${pkg.color}33` }}>
                        {pkg.badge}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {pkg.features.map((f) => (
                      <li key={f} className="flex items-center gap-1.5 text-xs" style={{ color: "#8B9BC4" }}>
                        <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: pkg.color }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1"
                  style={{ borderColor: data.package === pkg.id ? pkg.color : "#243352" }}>
                  {data.package === pkg.id && (
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: pkg.color }} />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!data.package}
        className="w-full py-3.5 rounded-xl font-semibold text-sm text-white flex items-center justify-center gap-2 transition-all"
        style={{
          background: data.package ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" : "#243352",
          color: data.package ? "white" : "#4F6494",
          boxShadow: data.package ? "0 4px 20px rgba(124,110,250,0.35)" : "none",
        }}
      >
        Lanjut ke Konfirmasi <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   CONTACT + SUBMIT SCREEN
───────────────────────────────────────────────────────── */

function ContactScreen({
  data,
  onChange,
  onSubmit,
  loading,
  error,
}: {
  data: WizardData;
  onChange: (k: keyof WizardData, v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}) {
  const cat = PROJECT_CATEGORIES.find((c) => c.id === data.categoryId);
  const pkg = PACKAGE_TIERS.find((p) => p.id === data.package);
  const workflow = CATEGORY_WORKFLOWS[data.categoryId] ?? [];

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Konfirmasi & mulai project
        </h2>
        <p className="text-sm" style={{ color: "#6B7FA8" }}>
          Tim kami akan meninjau kebutuhan Anda dan mengirimkan penawaran dalam 1×24 jam.
        </p>
      </div>

      {/* Summary card */}
      <div className="rounded-2xl p-4 space-y-3"
        style={{ background: "rgba(124,110,250,0.06)", border: "1px solid rgba(124,110,250,0.20)" }}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#7C6EFA" }}>
          <Sparkles className="w-3.5 h-3.5" /> Ringkasan Project
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span style={{ color: "#4F6494" }}>Kategori</span>
            <p className="font-medium mt-0.5" style={{ color: "#C8D0E8" }}>{cat?.emoji} {cat?.label}</p>
          </div>
          <div>
            <span style={{ color: "#4F6494" }}>Paket</span>
            <p className="font-medium mt-0.5" style={{ color: pkg?.color ?? "#7C6EFA" }}>{pkg?.name}</p>
          </div>
          <div>
            <span style={{ color: "#4F6494" }}>Deliverable utama</span>
            <p className="font-medium mt-0.5" style={{ color: "#C8D0E8" }}>{workflow.slice(0, 3).join(", ")}</p>
          </div>
          <div>
            <span style={{ color: "#4F6494" }}>Timeline</span>
            <p className="font-medium mt-0.5" style={{ color: "#C8D0E8" }}>{data.timeline || "Fleksibel"}</p>
          </div>
        </div>
      </div>

      {/* Contact fields */}
      <div className="space-y-4">
        <div>
          <FieldLabel>Nama lengkap *</FieldLabel>
          <Input value={data.name} onChange={(v) => onChange("name", v)} placeholder="Nama Anda" />
        </div>
        <div>
          <FieldLabel>Email *</FieldLabel>
          <Input value={data.email} onChange={(v) => onChange("email", v)} placeholder="email@bisnis.com" type="email" />
        </div>
        <div>
          <FieldLabel>WhatsApp (opsional)</FieldLabel>
          <Input value={data.phone} onChange={(v) => onChange("phone", v)} placeholder="+62 812 xxxx xxxx" type="tel" />
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
          style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", color: "#F87171" }}>
          <X className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <button
        onClick={onSubmit}
        disabled={loading || !data.name || !data.email}
        className="w-full py-4 rounded-xl font-bold text-base text-white flex items-center justify-center gap-2 transition-all"
        style={{
          background: (!data.name || !data.email) ? "#243352" : "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)",
          color: (!data.name || !data.email) ? "#4F6494" : "white",
          boxShadow: (!data.name || !data.email) ? "none" : "0 4px 24px rgba(124,110,250,0.40)",
        }}
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Membuat project…</>
        ) : (
          <><Sparkles className="w-4 h-4" /> Mulai Project Saya <ArrowRight className="w-4 h-4" /></>
        )}
      </button>

      <p className="text-xs text-center" style={{ color: "#4F6494" }}>
        Dengan melanjutkan, Anda menyetujui bahwa tim kami akan menghubungi Anda untuk diskusi lebih lanjut.
      </p>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────── */

export default function StartPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [, navigate] = useLocation();

  const { data: catalogData } = usePublicCatalog();

  const [phase, setPhase] = useState<Phase>("wizard");
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const queryParam    = decodeURIComponent(params.get("query") ?? "");
  const categoryParam = params.get("category");
  // Auto-detect category from free-text when none is specified in URL
  const initCategory  = categoryParam ?? (queryParam ? findCategoryFromQuery(queryParam) : "branding");

  const [data, setData] = useState<WizardData>({
    categoryId:   initCategory,
    query:        queryParam,
    projectDesc:  queryParam,
    businessName: "",
    industry:     "",
    stage:        "",
    targetMarket: "",
    geography:    "",
    goals:        "",
    timeline:     "",
    references:   "",
    styleNotes:   "",
    package:      "",
    name:         "",
    email:        "",
    phone:        "",
  });

  function handleChange(key: keyof WizardData, value: string) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function canProceedStep() {
    if (step === 1) return (data.projectDesc || data.query).trim().length > 5;
    if (step === 2) return data.businessName.trim().length > 0;
    if (step === 3) return data.targetMarket.trim().length > 5;
    if (step === 4) return data.goals.length > 0;
    return true; // step 5 is optional
  }

  function nextStep() {
    if (step < 5) {
      setStep((s) => s + 1);
    } else {
      // Transition to analysis
      setPhase("analysis");
      setTimeout(() => setPhase("workflow"), 3000);
    }
  }

  function prevStep() {
    if (step > 1) setStep((s) => s - 1);
    else navigate("/");
  }

  async function handleSubmit() {
    if (!data.name.trim() || !data.email.trim()) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Find best-matching service from catalog
      const services = catalogData?.services ?? [];
      const service = findService(services, data.categoryId, data.projectDesc || data.query);

      if (!service) {
        throw new Error("Tidak ada layanan tersedia saat ini. Silakan coba lagi.");
      }

      const notes = [
        `Kategori: ${PROJECT_CATEGORIES.find((c) => c.id === data.categoryId)?.label ?? data.categoryId}`,
        `Paket: ${PACKAGE_TIERS.find((p) => p.id === data.package)?.name ?? data.package}`,
        `Deskripsi: ${data.projectDesc || data.query}`,
        `Bisnis: ${data.businessName}${data.industry ? ` (${data.industry})` : ""}${data.stage ? ` — ${data.stage}` : ""}`,
        `Target: ${data.targetMarket}${data.geography ? ` [${data.geography}]` : ""}`,
        `Tujuan: ${data.goals}${data.timeline ? ` — ${data.timeline}` : ""}`,
        data.references ? `Referensi: ${data.references}` : "",
        data.styleNotes ? `Gaya: ${data.styleNotes}` : "",
      ].filter(Boolean).join("\n");

      const res = await fetch(`/api/ai/catalog/services/${service.id}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName:  data.name,
          customerEmail: data.email,
          customerPhone: data.phone || undefined,
          companyName:   data.businessName || undefined,
          notes,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`);
      }

      const result = await res.json() as { requestId: string };
      setPhase("done");
      // Redirect to brief page after brief moment
      setTimeout(() => navigate(`/request-service/${result.requestId}/brief`), 800);

    } catch (err) {
      setSubmitError((err as Error).message ?? "Terjadi kesalahan. Silakan coba lagi.");
      setSubmitting(false);
    }
  }

  // Determine back/nav behavior
  const isWizard = phase === "wizard";

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#060B18" }}>
      {/* Minimal header */}
      <header className="sticky top-0 z-50 px-4 md:px-8 h-14 flex items-center justify-between"
        style={{ background: "rgba(6,11,24,0.90)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(30,48,87,0.60)" }}>
        <a href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" }}>
            <Diamond className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-semibold text-sm" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Creative Studio
          </span>
        </a>

        {isWizard && (
          <div className="hidden sm:block">
            <StepIndicator step={step} total={5} />
          </div>
        )}

        <a href="/" className="text-xs flex items-center gap-1 transition-opacity hover:opacity-70" style={{ color: "#4F6494" }}>
          <X className="w-3.5 h-3.5" /> Batal
        </a>
      </header>

      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div style={{ position: "absolute", top: "-10%", right: "-5%", width: "50%", height: "60%", background: "radial-gradient(ellipse, rgba(124,110,250,0.10) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "0%", left: "-5%", width: "40%", height: "50%", background: "radial-gradient(ellipse, rgba(34,211,238,0.05) 0%, transparent 65%)" }} />
      </div>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-xl">

          {/* ── Wizard steps ── */}
          {phase === "wizard" && (
            <div className="space-y-6">
              {/* Step indicator (mobile) */}
              <div className="sm:hidden flex justify-center">
                <StepIndicator step={step} total={5} />
              </div>

              {/* Step label */}
              <div className="flex items-center gap-2 text-xs" style={{ color: "#4F6494" }}>
                <Zap className="w-3.5 h-3.5" style={{ color: "#7C6EFA" }} />
                {WIZARD_STEPS[step - 1].label}
              </div>

              {/* Active step */}
              <AnimatePresence mode="wait">
                {step === 1 && <Step1 key="s1" data={data} onChange={handleChange} />}
                {step === 2 && <Step2 key="s2" data={data} onChange={handleChange} />}
                {step === 3 && <Step3 key="s3" data={data} onChange={handleChange} />}
                {step === 4 && <Step4 key="s4" data={data} onChange={handleChange} />}
                {step === 5 && <Step5 key="s5" data={data} onChange={handleChange} />}
              </AnimatePresence>

              {/* Navigation */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={prevStep}
                  className="flex items-center gap-1.5 px-4 py-3 rounded-xl text-sm font-medium transition-all"
                  style={{ background: "rgba(13,21,38,0.80)", border: "1.5px solid #243352", color: "#8B9BC4" }}
                >
                  <ArrowLeft className="w-4 h-4" />
                  {step === 1 ? "Beranda" : "Kembali"}
                </button>
                <button
                  onClick={nextStep}
                  disabled={!canProceedStep()}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{
                    background: canProceedStep() ? "linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)" : "#243352",
                    color: canProceedStep() ? "white" : "#4F6494",
                    boxShadow: canProceedStep() ? "0 4px 20px rgba(124,110,250,0.30)" : "none",
                  }}
                >
                  {step === 5 ? (
                    <><Sparkles className="w-4 h-4" /> Analisis AI</>
                  ) : (
                    <>Lanjut <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>

              {/* Skip hint for optional steps */}
              {step === 5 && (
                <button onClick={nextStep} className="w-full text-xs text-center transition-opacity hover:opacity-70" style={{ color: "#4F6494" }}>
                  Lewati — isi referensi nanti
                </button>
              )}
            </div>
          )}

          {/* ── AI analysis ── */}
          {phase === "analysis" && (
            <AnalysisScreen categoryId={data.categoryId} />
          )}

          {/* ── Workflow + package ── */}
          {phase === "workflow" && (
            <WorkflowPackageScreen
              data={data}
              onChange={handleChange}
              onNext={() => setPhase("contact")}
            />
          )}

          {/* ── Contact + submit ── */}
          {phase === "contact" && (
            <div className="space-y-4">
              <button
                onClick={() => setPhase("workflow")}
                className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: "#4F6494" }}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Ganti paket
              </button>
              <ContactScreen
                data={data}
                onChange={handleChange}
                onSubmit={handleSubmit}
                loading={submitting}
                error={submitError}
              />
            </div>
          )}

          {/* ── Done ── */}
          {phase === "done" && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center py-16 space-y-6 text-center"
            >
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.40)" }}>
                <CheckCircle2 className="w-10 h-10" style={{ color: "#10B981" }} />
              </div>
              <div>
                <h2 className="text-xl font-bold mb-2" style={{ color: "#F0F4FF", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Project Anda dibuat!
                </h2>
                <p className="text-sm" style={{ color: "#8B9BC4" }}>
                  Mengalihkan ke halaman brief…
                </p>
              </div>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#7C6EFA" }} />
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
