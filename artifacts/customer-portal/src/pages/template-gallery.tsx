import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  LayoutTemplate, Search, Star, Sparkles, Eye, Heart,
  Globe, ChevronRight, Zap, Check, MonitorPlay, Wand2,
} from "lucide-react";
import { SEOMeta } from "@/components/SEOMeta";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ColorTheme { primary: string; secondary: string; accent: string; background: string; text: string }

interface CanvasElement {
  id: string;
  type: "text" | "rect" | "circle" | "line" | "frame" | "image";
  x: number; y: number; width: number; height: number;
  rotation: number; opacity: number; zIndex: number;
  locked: boolean; visible: boolean;
  fill?: string; stroke?: string; strokeWidth?: number; borderRadius?: number;
  text?: string; fontSize?: number; fontFamily?: string; fontWeight?: string;
  textAlign?: string; color?: string;
}

interface CanvasState {
  width: number; height: number; background: string;
  elements: CanvasElement[];
}

interface TemplateItem {
  id: number;
  templateCode: string;
  name: string;
  description: string | null;
  category: string;
  style: string;
  industry: string | null;
  colorTheme: ColorTheme | null;
  previewImages: { thumbnail: string; hero: string; gallery: string[] } | null;
  editable: boolean;
  isPremium: boolean;
  version: string;
  status: string;
  featured: boolean;
  views: number;
  selections: number;
  previewsGenerated: number;
  conversions: number;
  supportedPackages: string[] | null;
  // Builtin-only extras
  isBuiltin?: boolean;
  canvasState?: CanvasState;
  canvasWidth?: number;
  canvasHeight?: number;
  tags?: string[];
}

interface TemplateList { items: TemplateItem[]; total: number }

interface LivePreviewResult {
  templateId: number;
  templateName: string;
  companyName: string;
  brandColor: string;
  logoUrl: string | null;
  isBuiltin?: boolean;
  personalizedCanvasState?: CanvasState;
  canvasWidth?: number;
  canvasHeight?: number;
  previewConcept: {
    headerBg: string;
    headerText: string;
    accentColor: string;
    fontPairing: string;
    layoutType: string;
    mockSections: Array<{ type: string; content: string; color: string }>;
  };
  generatedAt: string;
}

// ── Canvas SVG Preview ─────────────────────────────────────────────────────────

/** Lightweight SVG renderer for builtin canvas states — no Konva needed. */
function CanvasSvgPreview({
  canvasState,
  canvasWidth,
  canvasHeight,
  viewWidth,
  viewHeight,
  className,
}: {
  canvasState: CanvasState;
  canvasWidth: number;
  canvasHeight: number;
  viewWidth: number;
  viewHeight: number;
  className?: string;
}) {
  const scaleX = viewWidth / canvasWidth;
  const scaleY = viewHeight / canvasHeight;
  const scale = Math.min(scaleX, scaleY);
  const scaledW = canvasWidth * scale;
  const scaledH = canvasHeight * scale;
  const offsetX = (viewWidth - scaledW) / 2;
  const offsetY = (viewHeight - scaledH) / 2;

  const sorted = [...canvasState.elements]
    .filter((e) => e.visible)
    .sort((a, b) => a.zIndex - b.zIndex);

  return (
    <svg
      width={viewWidth}
      height={viewHeight}
      className={className}
      style={{ display: "block" }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Canvas background */}
      <rect x={offsetX} y={offsetY} width={scaledW} height={scaledH} fill={canvasState.background} />

      <g transform={`translate(${offsetX},${offsetY}) scale(${scale})`}>
        {sorted.map((el) => {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          const transform = el.rotation
            ? `rotate(${el.rotation} ${cx} ${cy})`
            : undefined;

          if (el.type === "line") {
            return (
              <line
                key={el.id}
                x1={el.x} y1={el.y}
                x2={el.x + el.width} y2={el.y + el.height}
                stroke={el.stroke ?? el.fill ?? "#000"}
                strokeWidth={el.strokeWidth ?? 1}
                opacity={el.opacity}
              />
            );
          }

          if (el.type === "text" && el.text) {
            // Only render short single-line text (skip very long / multiline for perf)
            const firstLine = el.text.split("\n")[0] ?? "";
            const anchor =
              el.textAlign === "right" ? "end"
              : el.textAlign === "left" ? "start"
              : "middle";
            const anchorX =
              el.textAlign === "right" ? el.x + el.width
              : el.textAlign === "left" ? el.x
              : el.x + el.width / 2;
            return (
              <text
                key={el.id}
                x={anchorX}
                y={el.y + (el.fontSize ?? 16) * 0.85}
                fill={el.color ?? "#000"}
                opacity={el.opacity}
                fontSize={el.fontSize ?? 16}
                fontFamily={el.fontFamily ?? "Inter, sans-serif"}
                fontWeight={el.fontWeight ?? "400"}
                textAnchor={anchor}
                transform={transform}
                style={{ userSelect: "none" }}
              >
                {firstLine.length > 30 ? firstLine.slice(0, 28) + "…" : firstLine}
              </text>
            );
          }

          // rect / circle / frame / image placeholder
          return (
            <rect
              key={el.id}
              x={el.x} y={el.y}
              width={el.width} height={el.height}
              fill={el.fill ?? "transparent"}
              stroke={el.stroke}
              strokeWidth={el.strokeWidth}
              opacity={el.opacity}
              rx={el.borderRadius ?? 0}
              transform={transform}
            />
          );
        })}
      </g>
    </svg>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "All",
  "Instagram Post", "Instagram Story", "LinkedIn Post", "Banner",
  "Company Profile", "Pitch Deck", "Proposal", "Product Catalog",
  "Corporate Profile", "Brochure", "Flyer", "Presentation",
  "Logo", "Business Card", "Letterhead", "Email Signature",
  "Website Hero", "Landing Page", "Packaging", "Infographic",
  "Whitepaper", "Case Study", "Annual Report",
];

const CATEGORY_ICONS: Record<string, string> = {
  "Instagram Post": "📸",
  "Instagram Story": "📱",
  "LinkedIn Post": "💼",
  "Banner": "🖼️",
  "Logo": "✨",
  "Company Profile": "🏢",
  "Pitch Deck": "📊",
};

const INDUSTRIES = [
  "All", "Trading", "Healthcare", "Manufacturing", "Export", "Construction",
  "Technology", "Logistics", "F&B", "Education", "Property", "Legal", "Finance", "Retail",
];

const SORT_OPTIONS = [
  { value: "popular", label: "Most Popular" },
  { value: "newest", label: "Newest" },
  { value: "conversions", label: "Top Conversions" },
  { value: "selections", label: "Most Selected" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function LivePreviewPane({
  template,
  onClose,
}: {
  template: TemplateItem;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [companyName, setCompanyName] = useState("");
  const [brandColor, setBrandColor] = useState(template.colorTheme?.primary ?? "#6366F1");
  const [logoUrl, setLogoUrl] = useState("");
  const [preview, setPreview] = useState<LivePreviewResult | null>(null);

  // For builtin templates, show the original canvas before personalization
  const defaultCanvas = template.canvasState;
  const displayCanvas = preview?.personalizedCanvasState ?? defaultCanvas;
  const displayCanvasW = preview?.canvasWidth ?? template.canvasWidth ?? 1080;
  const displayCanvasH = preview?.canvasHeight ?? template.canvasHeight ?? 1080;

  const useTemplate = () => {
    fetch(`/api/public/templates/${template.id}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "selected" }),
    }).catch(() => {});

    sessionStorage.setItem(
      "template-selection-seed",
      JSON.stringify({
        templateId: template.id,
        templateName: template.name,
        category: template.category,
        style: template.style,
        isBuiltin: template.isBuiltin ?? false,
      }),
    );

    setLocation(`/services?templateId=${template.id}&templateCategory=${encodeURIComponent(template.category)}`);
  };

  const previewMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/public/templates/${template.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, brandColor, logoUrl: logoUrl || undefined }),
      }).then((r) => r.json()) as Promise<LivePreviewResult>,
    onSuccess: (data) => setPreview(data),
    onError: () => toast({ title: "Preview failed", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)" }}>
      <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-2xl border"
        style={{ background: "#0A0F1E", borderColor: "rgba(255,255,255,0.1)" }}>

        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-3">
            {template.isBuiltin && (
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-violet-600/20 text-violet-300 border border-violet-500/30">
                Built-in
              </span>
            )}
            <div>
              <h2 className="font-bold text-white text-lg">{template.name}</h2>
              <p className="text-xs text-slate-400">{template.category} · {template.style} · {displayCanvasW}×{displayCanvasH}px</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-all text-xl leading-none">×</button>
        </div>

        <div className="flex flex-col lg:flex-row gap-0">
          {/* Left: Canvas Preview */}
          <div className="flex-1 p-5 flex flex-col items-center justify-center"
            style={{ background: "rgba(0,0,0,0.2)", minHeight: 320 }}>
            {displayCanvas ? (
              <div className="rounded-xl overflow-hidden shadow-2xl border border-white/10"
                style={{ width: "100%", maxWidth: 380 }}>
                <CanvasSvgPreview
                  canvasState={displayCanvas}
                  canvasWidth={displayCanvasW}
                  canvasHeight={displayCanvasH}
                  viewWidth={380}
                  viewHeight={Math.round(380 * displayCanvasH / displayCanvasW)}
                />
              </div>
            ) : (
              <div className="rounded-xl flex items-center justify-center"
                style={{ width: 380, height: 280, background: template.colorTheme?.primary ?? "#6366F1" }}>
                <LayoutTemplate className="w-16 h-16 text-white/30" />
              </div>
            )}
            {preview?.personalizedCanvasState && (
              <div className="mt-3 flex items-center gap-2 text-xs text-violet-300">
                <Wand2 className="w-3.5 h-3.5" />
                <span>Dipersonalisasi dengan brand Anda</span>
              </div>
            )}
            {!preview && defaultCanvas && (
              <p className="mt-3 text-xs text-slate-500">Preview template asli — isi form untuk melihat dengan brand Anda</p>
            )}
          </div>

          {/* Right: Customization panel */}
          <div className="w-full lg:w-80 p-5 space-y-4 border-t lg:border-t-0 lg:border-l"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}>

            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                <Wand2 className="w-4 h-4 text-violet-400" />AI Personalisasi
              </h3>
              <p className="text-xs text-slate-500 mb-4">
                Masukkan nama brand dan warna Anda — AI akan menerapkannya langsung ke template.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block font-medium">Nama Brand / Perusahaan</label>
                <input
                  type="text"
                  placeholder="PT Maju Bersama"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 border focus:outline-none focus:border-violet-500"
                  style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }}
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block font-medium">Warna Brand</label>
                <div className="flex gap-2">
                  <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
                    className="w-11 h-10 rounded-lg border-0 p-0.5 cursor-pointer flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.05)" }} />
                  <input type="text" value={brandColor} onChange={(e) => setBrandColor(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg text-sm text-white font-mono border focus:outline-none focus:border-violet-500"
                    style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }} />
                </div>
                {/* Quick color presets */}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {["#7C3AED", "#2563EB", "#DC2626", "#059669", "#D97706", "#EC4899", "#0F172A"].map((c) => (
                    <button key={c} onClick={() => setBrandColor(c)}
                      className="w-6 h-6 rounded-full border-2 transition-all"
                      style={{ background: c, borderColor: brandColor === c ? "#fff" : "transparent" }} />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block font-medium">Logo URL <span className="opacity-50">(opsional)</span></label>
                <input
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-500 border focus:outline-none focus:border-violet-500"
                  style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.12)" }}
                />
              </div>
            </div>

            <button
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || !companyName.trim()}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg,#7C6EFA 0%,#5F52D0 100%)", color: "#fff" }}
            >
              {previewMutation.isPending
                ? <><span className="animate-spin text-lg">⟳</span> Memproses…</>
                : <><Wand2 className="w-4 h-4" /> Terapkan ke Template</>}
            </button>

            {/* Spec chips */}
            <div className="rounded-xl p-3 space-y-1.5"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Spesifikasi</p>
              {[
                { label: "Kategori", value: template.category },
                { label: "Style", value: template.style },
                { label: "Ukuran", value: `${displayCanvasW} × ${displayCanvasH}px` },
                { label: "Format", value: template.isBuiltin ? "Builtin — siap pakai" : "Custom DB" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className="text-xs text-slate-300 font-medium">{value}</span>
                </div>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="space-y-2 pt-1">
              <button
                onClick={useTemplate}
                className="w-full py-3 rounded-xl text-center font-bold text-sm text-white transition-colors"
                style={{ background: "linear-gradient(135deg,#10B981,#059669)" }}
              >
                ✓ Gunakan Template Ini
              </button>
              <button onClick={onClose}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-white transition-colors border border-white/10">
                Batal
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onPreview,
  favorited,
  onFavorite,
}: {
  template: TemplateItem;
  onPreview: () => void;
  favorited: boolean;
  onFavorite: () => void;
}) {
  // Aspect ratio for thumbnail display
  const canvasW = template.canvasWidth ?? 1080;
  const canvasH = template.canvasHeight ?? 1080;
  // Clamp thumbnail height: portrait (story) capped at 220px, square/landscape at 176px
  const isPortrait = canvasH > canvasW;
  const thumbH = isPortrait ? 220 : 176;

  return (
    <div className="group rounded-2xl border overflow-hidden transition-all hover:shadow-xl hover:-translate-y-0.5 cursor-pointer"
      style={{ background: "rgba(12,16,36,0.95)", borderColor: "rgba(255,255,255,0.08)" }}
      onClick={onPreview}>

      {/* Thumbnail */}
      <div className="relative overflow-hidden" style={{ height: thumbH, background: template.colorTheme?.primary ?? "#1E1B4B" }}>

        {/* Canvas SVG preview (builtin) or image (DB) or placeholder */}
        {template.canvasState ? (
          <div className="w-full h-full group-hover:scale-105 transition-transform duration-500">
            <CanvasSvgPreview
              canvasState={template.canvasState}
              canvasWidth={canvasW}
              canvasHeight={canvasH}
              viewWidth={280}
              viewHeight={thumbH}
            />
          </div>
        ) : template.previewImages?.thumbnail ? (
          <img src={template.previewImages.thumbnail} alt={template.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-85" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <LayoutTemplate className="w-10 h-10 text-white/20" />
            <p className="text-white/40 text-xs mt-2">{template.category}</p>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-white shadow-lg"
            style={{ background: "rgba(124,110,250,0.95)" }}>
            <Wand2 className="w-4 h-4" />Personalisasi
          </div>
        </div>

        {/* Top badges */}
        <div className="absolute top-2.5 left-2.5 flex gap-1.5">
          {template.isBuiltin && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold text-violet-200 border"
              style={{ background: "rgba(124,58,237,0.8)", borderColor: "rgba(139,92,246,0.5)" }}>
              Built-in
            </span>
          )}
          {template.featured && !template.isBuiltin && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold text-amber-800 bg-amber-400">
              <Star className="w-3 h-3 inline mr-0.5" />Featured
            </span>
          )}
          {template.isPremium && (
            <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold text-white bg-violet-600">Premium</span>
          )}
        </div>

        {/* Canvas size badge bottom-left */}
        <div className="absolute bottom-2 left-2.5">
          <span className="text-xs px-1.5 py-0.5 rounded font-mono text-white/60"
            style={{ background: "rgba(0,0,0,0.5)" }}>
            {canvasW}×{canvasH}
          </span>
        </div>

        {/* Favorite button */}
        <button
          onClick={(e) => { e.stopPropagation(); onFavorite(); }}
          className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full flex items-center justify-center transition-all"
          style={{ background: favorited ? "#EF4444" : "rgba(0,0,0,0.45)" }}>
          <Heart className={`w-3.5 h-3.5 ${favorited ? "text-white fill-white" : "text-white"}`} />
        </button>
      </div>

      {/* Info */}
      <div className="p-3.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-white leading-tight truncate">{template.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-slate-500">{CATEGORY_ICONS[template.category] ?? "🎨"}</span>
              <p className="text-xs text-slate-500 truncate">{template.category}</p>
              <span className="text-slate-700">·</span>
              <p className="text-xs text-slate-600 truncate">{template.style}</p>
            </div>
          </div>
          {/* Color swatches */}
          {template.colorTheme && (
            <div className="flex gap-0.5 flex-shrink-0 mt-0.5">
              {[template.colorTheme.primary, template.colorTheme.secondary]
                .filter(Boolean).map((c, i) => (
                  <span key={i} className="w-3.5 h-3.5 rounded-full border border-white/10" style={{ background: c }} />
                ))}
            </div>
          )}
        </div>

        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{template.description}</p>

        <button
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
          className="w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
          style={{ borderColor: "rgba(124,110,250,0.35)", color: "#A89CFF", background: "rgba(124,110,250,0.1)", border: "1px solid rgba(124,110,250,0.35)" }}>
          <Wand2 className="w-3 h-3" />Lihat & Personalisasi
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TemplateGalleryPage() {
  const [category, setCategory] = useState("All");
  const [industry, setIndustry] = useState("All");
  const [sortBy, setSortBy] = useState("popular");
  const [search, setSearch] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<TemplateItem | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());

  const params = new URLSearchParams({
    ...(category !== "All" ? { category } : {}),
    ...(industry !== "All" ? { industry } : {}),
    sortBy,
    ...(search ? { search } : {}),
    limit: "24",
  });

  const { data, isLoading } = useQuery<TemplateList>({
    queryKey: ["public-templates", category, industry, sortBy, search],
    queryFn: () => fetch(`/api/public/templates?${params.toString()}`).then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: recommendedData } = useQuery<{ items: TemplateItem[] }>({
    queryKey: ["public-templates-recommended"],
    queryFn: () => fetch("/api/public/templates/recommended?limit=4").then((r) => r.json()),
    staleTime: 120_000,
  });

  const templates = data?.items ?? [];
  const recommended = recommendedData?.items ?? [];

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      fetch(`/api/public/templates/${id}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType: "favorited" }),
      }).catch(() => {});
      return next;
    });
  }

  return (
    <div className="min-h-screen" style={{ background: "#080C1A" }}>
      <SEOMeta
        title="Template Desain Visual"
        description="Jelajahi ratusan template desain visual profesional siap pakai — presentasi, branding, social media, packaging, dan lebih banyak lagi."
        canonical="/template-gallery"
      />
      {/* Live Preview Overlay */}
      {previewTemplate && (
        <LivePreviewPane
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
        />
      )}

      {/* Hero */}
      <div className="relative py-16 text-center overflow-hidden px-4"
        style={{ background: "linear-gradient(180deg, rgba(124,110,250,0.15) 0%, transparent 100%)" }}>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 border"
          style={{ background: "rgba(124,110,250,0.15)", borderColor: "rgba(124,110,250,0.3)", color: "#A89CFF" }}>
          <Sparkles className="w-3.5 h-3.5" />60+ Professional Templates
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-3" style={{ fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
          Template Gallery
        </h1>
        <p className="text-lg text-slate-400 max-w-lg mx-auto mb-8">
          Browse professional templates. Customize instantly with your brand colors and logo.
        </p>
        {/* Search */}
        <div className="max-w-md mx-auto relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-2xl text-sm text-white placeholder-slate-500 border focus:outline-none"
            style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)" }}
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-16 space-y-8">
        {/* AI Recommended section */}
        {recommended.length > 0 && (
          <div>
            <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-amber-400" />AI Recommended
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {recommended.map((t) => (
                <div key={t.id} className="rounded-xl border cursor-pointer overflow-hidden hover:shadow-md transition-shadow"
                  style={{ background: t.colorTheme?.primary ?? "#6366F1", borderColor: "rgba(255,255,255,0.08)" }}
                  onClick={() => setPreviewTemplate(t)}>
                  <div className="p-4">
                    <p className="text-xs text-white/70">{t.category}</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{t.name}</p>
                    <p className="text-xs text-white/60 mt-1">{t.style}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="space-y-4">
          {/* Category pills */}
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                  category === cat
                    ? "text-white border-violet-500"
                    : "text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-300"
                }`}
                style={category === cat ? { background: "linear-gradient(135deg,#7C6EFA,#5F52D0)" } : {}}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Industry + Sort row */}
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-slate-500" />
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-sm border focus:outline-none"
                style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)", color: "#CBD5E1" }}
              >
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-sm border focus:outline-none"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.1)", color: "#CBD5E1" }}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-slate-500 ml-auto">{data?.total ?? 0} templates</p>
          </div>
        </div>

        {/* Grid */}
        {isLoading && (
          <div className="text-center py-16 text-slate-500">
            <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30 animate-pulse" />
            <p className="text-sm">Loading templates…</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onPreview={() => setPreviewTemplate(t)}
              favorited={favorites.has(t.id)}
              onFavorite={() => toggleFavorite(t.id)}
            />
          ))}
        </div>

        {templates.length === 0 && !isLoading && (
          <div className="text-center py-16 text-slate-500">
            <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No templates match your filters.</p>
          </div>
        )}

        {/* CTA banner */}
        <div className="rounded-2xl p-8 text-center"
          style={{ background: "linear-gradient(135deg, rgba(124,110,250,0.2) 0%, rgba(95,82,208,0.2) 100%)", border: "1px solid rgba(124,110,250,0.3)" }}>
          <Sparkles className="w-8 h-8 text-violet-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">Ready to use a template?</h2>
          <p className="text-slate-400 text-sm mb-5">
            Choose a template, we apply your Brand DNA, generate your full professional deliverable.
          </p>
          <Link href="/services"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm text-white"
            style={{ background: "linear-gradient(135deg,#7C6EFA 0%,#5F52D0 100%)" }}>
            Start Your Project <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
