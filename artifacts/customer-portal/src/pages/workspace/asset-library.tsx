import { useState } from "react";
import { Link } from "wouter";
import { WorkspaceLayout } from "@/components/workspace-layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fmtDate, fmtFileSize } from "@/lib/workspace-format";
import {
  Loader2, Search, Upload, Download, Archive, Heart, HeartOff,
  Tag, MoreHorizontal, ArrowLeft, FileText, Image, FileImage,
  Layers, BookOpen, Grid3X3, Star, Filter, X, Check,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AssetItem {
  id: number;
  category: string;
  categoryLabel: string;
  title: string;
  fileName: string;
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  version: number;
  active: boolean;
  archived: boolean;
  favorited: boolean;
  uploadedBy: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface AssetList {
  items: AssetItem[];
  total: number;
}

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "logo", label: "Logo" },
  { value: "photo", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "icon", label: "Icon" },
  { value: "document", label: "Document" },
  { value: "brand_guideline", label: "Brand Guideline" },
  { value: "reference", label: "Reference" },
  { value: "generated_image", label: "Generated Image" },
  { value: "uploaded_image", label: "Uploaded Image" },
];

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A–Z" },
  { value: "size", label: "Largest first" },
];

// ── Category icon ─────────────────────────────────────────────────────────────

function CategoryIcon({ category, className = "w-5 h-5" }: { category: string; className?: string }) {
  switch (category) {
    case "logo": return <Star className={className} />;
    case "photo": return <Image className={className} />;
    case "illustration": return <FileImage className={className} />;
    case "icon": return <Grid3X3 className={className} />;
    case "document": return <FileText className={className} />;
    case "brand_guideline": return <BookOpen className={className} />;
    case "generated_image": return <Layers className={className} />;
    default: return <FileText className={className} />;
  }
}

function categoryColor(category: string): string {
  const map: Record<string, string> = {
    logo: "bg-yellow-500/10 text-yellow-600",
    photo: "bg-blue-500/10 text-blue-600",
    illustration: "bg-purple-500/10 text-purple-600",
    icon: "bg-green-500/10 text-green-600",
    document: "bg-primary/10 text-primary",
    brand_guideline: "bg-rose-500/10 text-rose-600",
    generated_image: "bg-teal-500/10 text-teal-600",
    uploaded_image: "bg-orange-500/10 text-orange-600",
  };
  return map[category] ?? "bg-muted text-muted-foreground";
}

// ── Asset card ────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  onFavorite,
  onArchive,
  onDownload,
  loading,
}: {
  asset: AssetItem;
  onFavorite: (id: number) => void;
  onArchive: (id: number) => void;
  onDownload: (id: number) => void;
  loading: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-card border border-card-border rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
      {/* Preview */}
      <div className={`aspect-video flex items-center justify-center ${categoryColor(asset.category)}`}>
        {asset.previewUrl ? (
          <img src={asset.previewUrl} alt={asset.title} className="w-full h-full object-cover" />
        ) : (
          <CategoryIcon category={asset.category} className="w-10 h-10 opacity-60" />
        )}
      </div>

      <div className="p-3 space-y-2">
        {/* Title + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{asset.title}</p>
            <p className="text-xs text-muted-foreground truncate">{asset.fileName}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onFavorite(asset.id)}
              className={`p-1.5 rounded-lg hover:bg-muted transition-colors ${asset.favorited ? "text-rose-500" : "text-muted-foreground"}`}
              title={asset.favorited ? "Remove favorite" : "Add to favorites"}
            >
              {asset.favorited ? <Heart className="w-3.5 h-3.5 fill-current" /> : <HeartOff className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${categoryColor(asset.category)}`}>
            {asset.categoryLabel}
          </span>
          <span className="text-[10px] text-muted-foreground">v{asset.version}</span>
          {asset.fileSizeBytes && (
            <span className="text-[10px] text-muted-foreground">{fmtFileSize(asset.fileSizeBytes)}</span>
          )}
        </div>

        {/* Tags */}
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t}</span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onDownload(asset.id)}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium px-2 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            <Download className="w-3 h-3" /> Download
          </button>
          <button
            onClick={() => onArchive(asset.id)}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
            title="Archive"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AssetLibraryPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("newest");
  const [showFavorites, setShowFavorites] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryKey = ["workspace-asset-library", token, category, search, sort, showFavorites];

  const { data, isLoading } = useQuery<AssetList>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      if (sort) params.set("sort", sort);
      if (showFavorites) params.set("favorited", "true");
      const res = await fetch(`/api/public/customer/workspace/${token}/assets?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load assets");
      return res.json();
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/public/customer/workspace/${token}/assets/${id}/favorite`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to update favorite");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-asset-library"] }),
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/public/customer/workspace/${token}/assets/${id}/archive`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to archive");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-asset-library"] });
      toast({ title: "Asset archived" });
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  async function handleDownload(id: number) {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/public/customer/workspace/${token}/assets/${id}/sign`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to get download link");
      const data = await res.json();
      window.open(data.downloadUrl, "_blank");
    } catch (e) {
      toast({ title: "Download failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <WorkspaceLayout token={token}>
      <Link href={`/workspace/${token}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 group">
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        Kembali ke Dashboard
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif font-medium mb-1">Asset Library</h1>
          <p className="text-muted-foreground">
            {data ? `${data.total} asset${data.total !== 1 ? "s" : ""}` : "All your brand assets, versioned."}
          </p>
        </div>
        <Link href={`/workspace/${token}/brand-kit`} className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
          <Star className="w-4 h-4" /> Brand Kit
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            data-testid="input-asset-search"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category filter */}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="text-sm border border-border rounded-xl px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid="select-category"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="text-sm border border-border rounded-xl px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {/* Favorites toggle */}
        <button
          onClick={() => setShowFavorites(!showFavorites)}
          className={`inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border transition-colors ${
            showFavorites ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-card border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <Heart className={`w-4 h-4 ${showFavorites ? "fill-current" : ""}`} />
          Favorites
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-card-border rounded-2xl p-12 text-center">
          <Layers className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="text-xl font-medium mb-2">
            {showFavorites ? "No favorites yet" : search || category ? "No assets match" : "Asset library is empty"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {showFavorites
              ? "Heart an asset to add it to favorites."
              : search || category
              ? "Try adjusting your search or filter."
              : "Assets generated by your projects will appear here. You can also ask your Creative AI Studio team to upload brand assets."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {items.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onFavorite={(id) => favoriteMutation.mutate(id)}
              onArchive={(id) => archiveMutation.mutate(id)}
              onDownload={handleDownload}
              loading={downloadingId === asset.id}
            />
          ))}
        </div>
      )}
    </WorkspaceLayout>
  );
}
