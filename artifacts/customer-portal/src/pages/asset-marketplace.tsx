/**
 * Asset Marketplace — V4.7 Creative Marketplace (Customer Portal)
 * Browse, search, filter, favorite, rate, and download creative assets.
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Download,
  Star,
  Heart,
  Eye,
  Filter,
  X,
  Zap,
  Image,
  Palette,
  Layout,
  Camera,
  Layers,
  Globe,
  Package,
  CheckCircle,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SEOMeta } from "@/components/SEOMeta";

// ── API ────────────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Asset {
  id: number;
  assetCode: string;
  assetType: string;
  title: string;
  description?: string | null;
  category: string;
  tags: string[];
  priceType: string;
  priceAmount: string;
  currency: string;
  thumbnailUrl?: string | null;
  fileUrl?: string | null;
  isFeatured: boolean;
  downloadsCount: number;
  viewsCount: number;
  favoritesCount: number;
  avgRating: string;
  ratingsCount: number;
  creator?: { name: string; code: string; verified: boolean } | null;
}

interface CategoriesResult {
  assetTypes: string[];
  categories: string[];
}

interface SearchResult {
  assets: Asset[];
  templates: Record<string, unknown>[];
  total: number;
}

// ── Type icon map ─────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  illustration: <Palette className="w-4 h-4" />,
  icon: <Zap className="w-4 h-4" />,
  cover: <Image className="w-4 h-4" />,
  layout: <Layout className="w-4 h-4" />,
  background: <Layers className="w-4 h-4" />,
  photo: <Camera className="w-4 h-4" />,
  brand_pack: <Globe className="w-4 h-4" />,
};

const TYPE_LABELS: Record<string, string> = {
  illustration: "Ilustrasi",
  icon: "Ikon",
  cover: "Cover",
  layout: "Layout",
  background: "Background",
  photo: "Foto",
  brand_pack: "Brand Pack",
};

// ── Asset Card ────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  isFavorited,
  onFavorite,
  onDownload,
  onRate,
}: {
  asset: Asset;
  isFavorited: boolean;
  onFavorite: (id: number) => void;
  onDownload: (asset: Asset) => void;
  onRate: (asset: Asset) => void;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col group cursor-pointer"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Thumbnail */}
      <div
        className="relative overflow-hidden"
        style={{ paddingBottom: "62.5%", background: "rgba(255,255,255,0.05)" }}
      >
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(124,110,250,0.2)", color: "#7C6EFA" }}
            >
              {TYPE_ICONS[asset.assetType] ?? <Package className="w-6 h-6" />}
            </div>
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-1">
          {asset.isFeatured && (
            <Badge style={{ background: "rgba(251,191,36,0.9)", color: "#000", fontSize: "10px" }}>
              ★ Featured
            </Badge>
          )}
          <Badge
            style={
              asset.priceType === "free"
                ? { background: "rgba(52,211,153,0.9)", color: "#000", fontSize: "10px" }
                : { background: "rgba(124,110,250,0.9)", color: "#fff", fontSize: "10px" }
            }
          >
            {asset.priceType === "free" ? "Gratis" : `IDR ${Number(asset.priceAmount).toLocaleString("id")}`}
          </Badge>
        </div>
        {/* Favorite */}
        <button
          onClick={(e) => { e.stopPropagation(); onFavorite(asset.id); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center transition-all"
          style={{
            background: isFavorited ? "rgba(248,113,113,0.9)" : "rgba(0,0,0,0.5)",
            color: isFavorited ? "#fff" : "#fff",
          }}
        >
          <Heart className="w-4 h-4" fill={isFavorited ? "currentColor" : "none"} />
        </button>
      </div>

      {/* Info */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight" style={{ color: "#F0F4FF" }}>
            {asset.title}
          </h3>
          <Badge
            className="flex-shrink-0 text-xs capitalize flex items-center gap-1"
            style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA", border: "none" }}
          >
            {TYPE_ICONS[asset.assetType]}
            {TYPE_LABELS[asset.assetType] ?? asset.assetType}
          </Badge>
        </div>

        {asset.creator && (
          <p className="text-xs" style={{ color: "#8B9BC4" }}>
            oleh {asset.creator.name}
            {asset.creator.verified && (
              <CheckCircle className="inline w-3 h-3 ml-1" style={{ color: "#34D399" }} />
            )}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs" style={{ color: "#8B9BC4" }}>
          <span className="flex items-center gap-1">
            <Download className="w-3 h-3" /> {asset.downloadsCount.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="w-3 h-3" /> {asset.viewsCount.toLocaleString()}
          </span>
          {parseFloat(asset.avgRating) > 0 && (
            <span className="flex items-center gap-1" style={{ color: "#FBB924" }}>
              <Star className="w-3 h-3" fill="currentColor" />
              {parseFloat(asset.avgRating).toFixed(1)}
            </span>
          )}
        </div>

        {/* Tags */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "#8B9BC4" }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-2">
          <Button
            size="sm"
            className="flex-1 text-xs"
            style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", color: "#fff" }}
            onClick={() => onDownload(asset)}
          >
            <Download className="w-3 h-3 mr-1" />
            {asset.priceType === "free" ? "Unduh Gratis" : "Beli"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#8B9BC4" }}
            onClick={() => onRate(asset)}
          >
            <Star className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Rating Dialog ─────────────────────────────────────────────────────────────

function RatingDialog({
  asset,
  email,
  onClose,
}: {
  asset: Asset;
  email: string;
  onClose: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState("");
  const { toast } = useToast();

  const mut = useMutation({
    mutationFn: () =>
      apiFetch(`/public/creative-marketplace/assets/${asset.id}/rate`, {
        method: "POST",
        body: JSON.stringify({ customerEmail: email, rating, review: review || undefined }),
      }),
    onSuccess: () => { toast({ title: "Terima kasih atas ulasan Anda!" }); onClose(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 w-full max-w-sm space-y-4"
        style={{ background: "#0E1829", border: "1px solid rgba(255,255,255,0.1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: "#F0F4FF" }}>Beri Rating</h3>
          <button onClick={onClose}><X className="w-4 h-4" style={{ color: "#8B9BC4" }} /></button>
        </div>
        <p className="text-sm" style={{ color: "#8B9BC4" }}>{asset.title}</p>

        <div className="flex gap-2 justify-center">
          {[1, 2, 3, 4, 5].map((s) => (
            <button
              key={s}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
              onClick={() => setRating(s)}
            >
              <Star
                className="w-8 h-8 transition-colors"
                style={{ color: s <= (hovered || rating) ? "#FBB924" : "#3A4A6B" }}
                fill={s <= (hovered || rating) ? "#FBB924" : "none"}
              />
            </button>
          ))}
        </div>

        <textarea
          value={review}
          onChange={(e) => setReview(e.target.value)}
          placeholder="Ulasan (opsional)…"
          rows={3}
          className="w-full rounded-lg p-3 text-sm resize-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
        />

        <Button
          className="w-full"
          disabled={rating === 0 || mut.isPending || !email}
          onClick={() => mut.mutate()}
          style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", color: "#fff" }}
        >
          {mut.isPending ? "Menyimpan…" : "Kirim Rating"}
        </Button>
        {!email && (
          <p className="text-xs text-center" style={{ color: "#F87171" }}>
            Login diperlukan untuk memberi rating
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AssetMarketplacePage() {
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [category, setCategory] = useState("all");
  const [priceType, setPriceType] = useState("all");
  const [sortBy, setSortBy] = useState("popular");
  const [ratingTarget, setRatingTarget] = useState<Asset | null>(null);
  const [customerEmail] = useState(""); // In real app, comes from workspace session
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: categories } = useQuery({
    queryKey: ["mp-categories"],
    queryFn: () => apiFetch<CategoriesResult>("/public/creative-marketplace/assets/categories"),
  });

  const { data: featuredData } = useQuery({
    queryKey: ["mp-featured"],
    queryFn: () => apiFetch<{ items: Asset[] }>("/public/creative-marketplace/assets/featured?limit=6"),
  });

  const { data: searchResult, isLoading: searchLoading } = useQuery({
    queryKey: ["mp-search", activeSearch, assetType !== "all" ? assetType : undefined],
    queryFn: () =>
      apiFetch<SearchResult>(
        `/public/creative-marketplace/assets/search?q=${encodeURIComponent(activeSearch)}${assetType !== "all" ? `&assetType=${assetType}` : ""}&limit=24`
      ),
    enabled: activeSearch.length > 1,
  });

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ["mp-assets", assetType, category, priceType, sortBy],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "48", sortBy });
      if (assetType !== "all") params.set("assetType", assetType);
      if (category !== "all") params.set("category", category);
      if (priceType !== "all") params.set("priceType", priceType);
      return apiFetch<{ items: Asset[]; total: number }>(
        `/public/creative-marketplace/assets?${params}`
      );
    },
    enabled: !activeSearch,
  });

  const downloadMut = useMutation({
    mutationFn: (asset: Asset) =>
      apiFetch<{ downloadUrl?: string | null; asset: Asset }>(
        `/public/creative-marketplace/assets/${asset.id}/download`,
        { method: "POST", body: JSON.stringify({ customerEmail: customerEmail || undefined }) }
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["mp-assets"] });
      if (data.downloadUrl) {
        window.open(data.downloadUrl, "_blank");
        toast({ title: "Unduhan dimulai" });
      } else {
        toast({ title: "Unduhan dicatat", description: "File akan segera tersedia" });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleFavorite = useCallback(
    (id: number) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
          toast({ title: "Dihapus dari favorit" });
        } else {
          next.add(id);
          toast({ title: "Ditambahkan ke favorit" });
        }
        return next;
      });
    },
    [toast]
  );

  const displayItems: Asset[] = activeSearch
    ? (searchResult?.assets ?? [])
    : (assetsData?.items ?? []);

  const isLoading = activeSearch ? searchLoading : assetsLoading;

  return (
    <div className="min-h-screen" style={{ background: "#060B18", color: "#F0F4FF" }}>
      <SEOMeta
        title="Marketplace Aset Kreatif"
        description="Temukan dan unduh aset kreatif premium — ikon, template, ilustrasi, foto, dan elemen desain profesional untuk proyek Anda."
        canonical="/marketplace"
      />
      {/* Hero */}
      <div
        className="relative overflow-hidden py-16 px-6"
        style={{ background: "linear-gradient(180deg, rgba(124,110,250,0.12) 0%, transparent 100%)" }}
      >
        <div className="max-w-4xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm" style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA" }}>
            <Zap className="w-4 h-4" />
            Asset Marketplace — V4.7
          </div>
          <h1 className="text-4xl md:text-5xl font-bold" style={{ color: "#F0F4FF" }}>
            Temukan Aset Kreatif<br />
            <span style={{ color: "#7C6EFA" }}>Enterprise</span> Terbaik
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: "#8B9BC4" }}>
            Ilustrasi, ikon, cover, layout, background, foto, dan brand pack premium untuk proyek Anda.
          </p>

          {/* Search */}
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: "#5A6785" }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setActiveSearch(search);
                if (e.key === "Escape") { setSearch(""); setActiveSearch(""); }
              }}
              placeholder="Cari ilustrasi, ikon, brand pack…"
              className="pl-12 pr-4 h-14 text-base rounded-2xl"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#F0F4FF" }}
            />
            {activeSearch && (
              <button
                onClick={() => { setSearch(""); setActiveSearch(""); }}
                className="absolute right-4 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4" style={{ color: "#8B9BC4" }} />
              </button>
            )}
          </div>

          {/* Type Pills */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => setAssetType("all")}
              className="px-4 py-2 rounded-full text-sm transition-all"
              style={{
                background: assetType === "all" ? "rgba(124,110,250,0.25)" : "rgba(255,255,255,0.05)",
                color: assetType === "all" ? "#7C6EFA" : "#8B9BC4",
                border: `1px solid ${assetType === "all" ? "rgba(124,110,250,0.4)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              Semua
            </button>
            {(categories?.assetTypes ?? []).map((t) => (
              <button
                key={t}
                onClick={() => setAssetType(t)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-all"
                style={{
                  background: assetType === t ? "rgba(124,110,250,0.25)" : "rgba(255,255,255,0.05)",
                  color: assetType === t ? "#7C6EFA" : "#8B9BC4",
                  border: `1px solid ${assetType === t ? "rgba(124,110,250,0.4)" : "rgba(255,255,255,0.08)"}`,
                }}
              >
                {TYPE_ICONS[t]} {TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 pb-16 space-y-10">

        {/* Featured */}
        {!activeSearch && featuredData && featuredData.items.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">✨ Featured</h2>
              <button
                className="flex items-center gap-1 text-sm"
                style={{ color: "#7C6EFA" }}
                onClick={() => setSortBy("downloads")}
              >
                Lihat semua <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {featuredData.items.map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-xl overflow-hidden cursor-pointer group"
                  style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div
                    className="relative"
                    style={{ paddingBottom: "100%", background: "rgba(255,255,255,0.05)" }}
                  >
                    {asset.thumbnailUrl ? (
                      <img
                        src={asset.thumbnailUrl}
                        alt={asset.title}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ color: "#7C6EFA" }}>
                        {TYPE_ICONS[asset.assetType] ?? <Package className="w-8 h-8" />}
                      </div>
                    )}
                    <Badge
                      className="absolute top-2 left-2 text-xs"
                      style={
                        asset.priceType === "free"
                          ? { background: "rgba(52,211,153,0.9)", color: "#000" }
                          : { background: "rgba(124,110,250,0.9)", color: "#fff" }
                      }
                    >
                      {asset.priceType === "free" ? "Gratis" : "Premium"}
                    </Badge>
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-medium truncate" style={{ color: "#F0F4FF" }}>{asset.title}</p>
                    <p className="text-xs truncate" style={{ color: "#5A6785" }}>{asset.downloadsCount} unduhan</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Filters + Grid */}
        <section>
          {/* Filter bar */}
          {!activeSearch && (
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <div className="flex items-center gap-2 text-sm" style={{ color: "#8B9BC4" }}>
                <Filter className="w-4 h-4" />
                Filter:
              </div>

              {/* Category */}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              >
                <option value="all">Semua Kategori</option>
                {(categories?.categories ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              {/* Price */}
              <select
                value={priceType}
                onChange={(e) => setPriceType(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              >
                <option value="all">Semua Harga</option>
                <option value="free">Gratis</option>
                <option value="premium">Premium</option>
              </select>

              {/* Sort */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-lg px-3 py-1.5 text-sm"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              >
                <option value="popular">Terpopuler</option>
                <option value="newest">Terbaru</option>
                <option value="downloads">Terbanyak Diunduh</option>
                <option value="rating">Rating Tertinggi</option>
              </select>

              {assetsData && (
                <span className="text-xs ml-auto" style={{ color: "#5A6785" }}>
                  {assetsData.total} aset
                </span>
              )}
            </div>
          )}

          {/* Search result banner */}
          {activeSearch && (
            <div className="flex items-center justify-between mb-4 p-4 rounded-xl" style={{ background: "rgba(124,110,250,0.08)", border: "1px solid rgba(124,110,250,0.2)" }}>
              <p className="text-sm" style={{ color: "#8B9BC4" }}>
                Hasil pencarian untuk <span className="font-semibold" style={{ color: "#7C6EFA" }}>"{activeSearch}"</span>
                {" "}&mdash; {displayItems.length} aset ditemukan
              </p>
              <button
                onClick={() => { setSearch(""); setActiveSearch(""); }}
                className="text-xs flex items-center gap-1"
                style={{ color: "#F87171" }}
              >
                <X className="w-3 h-3" /> Hapus pencarian
              </button>
            </div>
          )}

          {/* Grid */}
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl animate-pulse"
                  style={{ height: "300px", background: "rgba(255,255,255,0.04)" }}
                />
              ))}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="text-center py-20">
              <Package className="w-16 h-16 mx-auto mb-4" style={{ color: "#3A4A6B" }} />
              <h3 className="text-xl font-semibold mb-2" style={{ color: "#F0F4FF" }}>
                {activeSearch ? "Tidak ada aset ditemukan" : "Belum ada aset"}
              </h3>
              <p style={{ color: "#8B9BC4" }}>
                {activeSearch ? "Coba kata kunci lain" : "Aset akan muncul di sini setelah ditambahkan"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {displayItems.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isFavorited={favorites.has(asset.id)}
                  onFavorite={toggleFavorite}
                  onDownload={(a) => downloadMut.mutate(a)}
                  onRate={(a) => setRatingTarget(a)}
                />
              ))}
            </div>
          )}

          {/* Search templates section */}
          {activeSearch && (searchResult?.templates ?? []).length > 0 && (
            <section className="mt-10">
              <h3 className="text-lg font-bold mb-4">Template Terkait</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(searchResult?.templates ?? []).slice(0, 6).map((t) => {
                  const template = t as Record<string, unknown>;
                  return (
                    <div
                      key={String(template.id ?? Math.random())}
                      className="rounded-xl p-4 flex items-center gap-3"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <Layout className="w-8 h-8 flex-shrink-0" style={{ color: "#7C6EFA" }} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "#F0F4FF" }}>{String(template.name ?? "")}</p>
                        <p className="text-xs truncate" style={{ color: "#8B9BC4" }}>{String(template.category ?? "")}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </section>
      </div>

      {/* Rating Dialog */}
      {ratingTarget && (
        <RatingDialog
          asset={ratingTarget}
          email={customerEmail}
          onClose={() => setRatingTarget(null)}
        />
      )}
    </div>
  );
}
