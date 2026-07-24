/**
 * Creative Marketplace Admin — V4.7
 * Asset management, creator profiles, analytics, downloads log.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Users,
  BarChart3,
  Download,
  Plus,
  Star,
  Eye,
  Heart,
  TrendingUp,
  Filter,
  Search,
  CheckCircle,
  XCircle,
  Zap,
  Image,
  Palette,
  Layout,
  Camera,
  Layers,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── API helpers ──────────────────────────────────────────────────────────────

const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? "";
const BASE = "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-admin-api-key": ADMIN_KEY,
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface MarketplaceAsset {
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
  isFeatured: boolean;
  isActive: boolean;
  downloadsCount: number;
  viewsCount: number;
  favoritesCount: number;
  avgRating: string;
  ratingsCount: number;
  createdAt: string;
  creator?: { name: string; code: string; verified: boolean } | null;
}

interface MarketplaceCreator {
  id: number;
  creatorCode: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
  websiteUrl?: string | null;
  isVerified: boolean;
  isActive: boolean;
  totalAssets: number;
  totalDownloads: number;
  avgRating: string;
}

interface MarketplaceAnalytics {
  totalAssets: number;
  freeAssets: number;
  premiumAssets: number;
  totalCreators: number;
  verifiedCreators: number;
  totalDownloads: number;
  totalFavorites: number;
  totalRatings: number;
  avgRating: number;
  byType: Array<{ assetType: string; count: number; downloads: number }>;
}

// ── Icons per asset type ──────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, React.ReactNode> = {
  illustration: <Palette className="w-4 h-4" />,
  icon: <Zap className="w-4 h-4" />,
  cover: <Image className="w-4 h-4" />,
  layout: <Layout className="w-4 h-4" />,
  background: <Layers className="w-4 h-4" />,
  photo: <Camera className="w-4 h-4" />,
  brand_pack: <Globe className="w-4 h-4" />,
};

const ASSET_TYPES = ["illustration", "icon", "cover", "layout", "background", "photo", "brand_pack"];

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  sub,
  color = "#7C6EFA",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-xl p-5 flex items-start gap-4"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}22`, color }}
      >
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold" style={{ color: "#F0F4FF" }}>
          {value}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "#8B9BC4" }}>
          {label}
        </p>
        {sub && (
          <p className="text-xs mt-1" style={{ color: "#5A6785" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Asset Card ───────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  onFeature,
  onActivate,
}: {
  asset: MarketplaceAsset;
  onFeature: (id: number, featured: boolean) => void;
  onActivate: (id: number, active: boolean) => void;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA" }}
          >
            {TYPE_ICONS[asset.assetType] ?? <Package className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "#F0F4FF" }}>
              {asset.title}
            </p>
            <p className="text-xs truncate" style={{ color: "#8B9BC4" }}>
              {asset.assetCode}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {asset.isFeatured && (
            <Badge className="text-xs" style={{ background: "rgba(251,191,36,0.15)", color: "#FBB924", border: "1px solid rgba(251,191,36,0.2)" }}>
              ★ Featured
            </Badge>
          )}
          <Badge
            className="text-xs"
            style={
              asset.priceType === "free"
                ? { background: "rgba(52,211,153,0.15)", color: "#34D399", border: "1px solid rgba(52,211,153,0.2)" }
                : { background: "rgba(251,191,36,0.15)", color: "#FBB924", border: "1px solid rgba(251,191,36,0.2)" }
            }
          >
            {asset.priceType === "free" ? "Free" : `IDR ${Number(asset.priceAmount).toLocaleString("id")}`}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs" style={{ color: "#8B9BC4" }}>
        <span className="flex items-center gap-1">
          <Download className="w-3 h-3" /> {asset.downloadsCount.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="w-3 h-3" /> {asset.viewsCount.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <Heart className="w-3 h-3" /> {asset.favoritesCount}
        </span>
        <span className="flex items-center gap-1">
          <Star className="w-3 h-3" /> {parseFloat(asset.avgRating).toFixed(1)}
          <span style={{ color: "#5A6785" }}>({asset.ratingsCount})</span>
        </span>
      </div>

      {asset.creator && (
        <p className="text-xs" style={{ color: "#5A6785" }}>
          By {asset.creator.name}
          {asset.creator.verified && <span className="ml-1" style={{ color: "#34D399" }}>✓</span>}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          style={{
            background: asset.isFeatured ? "rgba(251,191,36,0.1)" : "transparent",
            borderColor: "rgba(255,255,255,0.1)",
            color: "#8B9BC4",
          }}
          onClick={() => onFeature(asset.id, !asset.isFeatured)}
        >
          {asset.isFeatured ? "Unfeature" : "Feature"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs"
          style={{
            background: asset.isActive ? "transparent" : "rgba(248,113,113,0.1)",
            borderColor: "rgba(255,255,255,0.1)",
            color: asset.isActive ? "#8B9BC4" : "#F87171",
          }}
          onClick={() => onActivate(asset.id, !asset.isActive)}
        >
          {asset.isActive ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}

// ── Create Asset Dialog ───────────────────────────────────────────────────────

function CreateAssetDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    assetCode: "",
    assetType: "illustration",
    title: "",
    category: "",
    description: "",
    priceType: "free",
    priceAmount: "0",
    thumbnailUrl: "",
    fileUrl: "",
    tags: "",
  });
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/ai/creative-marketplace/assets", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
          priceAmount: form.priceAmount || "0",
          thumbnailUrl: form.thumbnailUrl || undefined,
          fileUrl: form.fileUrl || undefined,
          description: form.description || undefined,
        }),
      }),
    onSuccess: () => {
      toast({ title: "Asset created" });
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", color: "#fff" }}
        >
          <Plus className="w-4 h-4 mr-1" /> New Asset
        </Button>
      </DialogTrigger>
      <DialogContent style={{ background: "#0E1829", border: "1px solid rgba(255,255,255,0.1)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "#F0F4FF" }}>Create Marketplace Asset</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Asset Code *</Label>
              <Input
                value={form.assetCode}
                onChange={(e) => setForm((f) => ({ ...f, assetCode: e.target.value }))}
                placeholder="ILLUS-ABSTRACT-001"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Type *</Label>
              <Select value={form.assetType} onValueChange={(v) => setForm((f) => ({ ...f, assetType: v }))}>
                <SelectTrigger style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Abstract Fluid Shapes Collection"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Category *</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Abstract, Business…"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Price Type</Label>
              <Select value={form.priceType} onValueChange={(v) => setForm((f) => ({ ...f, priceType: v }))}>
                <SelectTrigger style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.priceType === "premium" && (
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Price (IDR)</Label>
              <Input
                type="number"
                value={form.priceAmount}
                onChange={(e) => setForm((f) => ({ ...f, priceAmount: e.target.value }))}
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
          )}
          <div>
            <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Thumbnail URL</Label>
              <Input
                value={form.thumbnailUrl}
                onChange={(e) => setForm((f) => ({ ...f, thumbnailUrl: e.target.value }))}
                placeholder="https://…"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>File URL</Label>
              <Input
                value={form.fileUrl}
                onChange={(e) => setForm((f) => ({ ...f, fileUrl: e.target.value }))}
                placeholder="https://…"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Tags (comma-separated)</Label>
            <Input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="abstract, fluid, colorful"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
            />
          </div>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.assetCode || !form.title || !form.category}
            style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", color: "#fff" }}
          >
            {mutation.isPending ? "Creating…" : "Create Asset"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Create Creator Dialog ─────────────────────────────────────────────────────

function CreateCreatorDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ creatorCode: "", displayName: "", bio: "", websiteUrl: "", avatarUrl: "", email: "" });
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/ai/creative-marketplace/creators", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          bio: form.bio || undefined,
          websiteUrl: form.websiteUrl || undefined,
          avatarUrl: form.avatarUrl || undefined,
          email: form.email || undefined,
        }),
      }),
    onSuccess: () => {
      toast({ title: "Creator created" });
      setOpen(false);
      onCreated();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          style={{ borderColor: "rgba(255,255,255,0.1)", color: "#8B9BC4" }}
        >
          <Plus className="w-4 h-4 mr-1" /> New Creator
        </Button>
      </DialogTrigger>
      <DialogContent style={{ background: "#0E1829", border: "1px solid rgba(255,255,255,0.1)" }}>
        <DialogHeader>
          <DialogTitle style={{ color: "#F0F4FF" }}>Create Creator Profile</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Creator Code *</Label>
              <Input value={form.creatorCode} onChange={(e) => setForm((f) => ({ ...f, creatorCode: e.target.value }))} placeholder="CREATOR-001" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }} />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Display Name *</Label>
              <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="Studio Kreatif" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }} />
            </div>
          </div>
          <div>
            <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Bio</Label>
            <Textarea value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} rows={2} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Website URL</Label>
              <Input value={form.websiteUrl} onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))} placeholder="https://…" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }} />
            </div>
            <div>
              <Label className="text-xs mb-1 block" style={{ color: "#8B9BC4" }}>Email</Label>
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} type="email" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }} />
            </div>
          </div>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.creatorCode || !form.displayName}
            style={{ background: "linear-gradient(135deg, #7C6EFA, #5F52D0)", color: "#fff" }}
          >
            {mutation.isPending ? "Creating…" : "Create Creator"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type Tab = "assets" | "creators" | "analytics" | "downloads";

export default function CreativeMarketplacePage() {
  const [tab, setTab] = useState<Tab>("assets");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priceFilter, setPriceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ["cm-assets", search, typeFilter, priceFilter, sortBy],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "48", sortBy });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("assetType", typeFilter);
      if (priceFilter !== "all") params.set("priceType", priceFilter);
      return apiFetch<{ items: MarketplaceAsset[]; total: number }>(
        `/ai/creative-marketplace/assets?${params}`
      );
    },
  });

  const { data: creatorsData, isLoading: creatorsLoading } = useQuery({
    queryKey: ["cm-creators"],
    queryFn: () => apiFetch<{ items: MarketplaceCreator[]; total: number }>("/ai/creative-marketplace/creators?limit=48"),
  });

  const { data: analytics } = useQuery({
    queryKey: ["cm-analytics"],
    queryFn: () => apiFetch<MarketplaceAnalytics>("/ai/creative-marketplace/analytics"),
  });

  const { data: downloadsData } = useQuery({
    queryKey: ["cm-downloads"],
    queryFn: () => apiFetch<{ items: unknown[] }>("/ai/creative-marketplace/downloads?limit=50"),
    enabled: tab === "downloads",
  });

  const featureMut = useMutation({
    mutationFn: ({ id, featured }: { id: number; featured: boolean }) =>
      apiFetch(`/ai/creative-marketplace/assets/${id}/feature`, {
        method: "POST",
        body: JSON.stringify({ featured }),
      }),
    onSuccess: () => { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["cm-assets"] }); },
  });

  const activateMut = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiFetch(`/ai/creative-marketplace/assets/${id}/activate`, {
        method: "POST",
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["cm-assets"] }); },
  });

  const verifyMut = useMutation({
    mutationFn: ({ id, isVerified }: { id: number; isVerified: boolean }) =>
      apiFetch(`/ai/creative-marketplace/creators/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isVerified }),
      }),
    onSuccess: () => { toast({ title: "Updated" }); qc.invalidateQueries({ queryKey: ["cm-creators"] }); },
  });

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "assets", label: "Assets", icon: <Package className="w-4 h-4" /> },
    { key: "creators", label: "Creators", icon: <Users className="w-4 h-4" /> },
    { key: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
    { key: "downloads", label: "Downloads", icon: <Download className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 space-y-6" style={{ color: "#F0F4FF" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Creative Marketplace</h1>
          <p className="text-sm mt-1" style={{ color: "#8B9BC4" }}>
            Manage digital assets, creators, pricing, ratings, and analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CreateCreatorDialog onCreated={() => qc.invalidateQueries({ queryKey: ["cm-creators"] })} />
          <CreateAssetDialog onCreated={() => qc.invalidateQueries({ queryKey: ["cm-assets"] })} />
        </div>
      </div>

      {/* Quick Stats */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Assets" value={analytics.totalAssets} icon={<Package className="w-5 h-5" />} sub={`${analytics.freeAssets} free · ${analytics.premiumAssets} premium`} />
          <StatCard label="Creators" value={analytics.totalCreators} icon={<Users className="w-5 h-5" />} sub={`${analytics.verifiedCreators} verified`} color="#34D399" />
          <StatCard label="Total Downloads" value={analytics.totalDownloads.toLocaleString()} icon={<Download className="w-5 h-5" />} color="#F87171" />
          <StatCard label="Avg Rating" value={analytics.avgRating.toFixed(1)} icon={<Star className="w-5 h-5" />} sub={`${analytics.totalRatings} ratings`} color="#FBB924" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: "rgba(255,255,255,0.04)" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-all"
            style={{
              background: tab === t.key ? "rgba(124,110,250,0.2)" : "transparent",
              color: tab === t.key ? "#7C6EFA" : "#8B9BC4",
              fontWeight: tab === t.key ? 600 : 400,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Assets Tab */}
      {tab === "assets" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#5A6785" }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets…"
                className="pl-9"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-40" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}>
                <Filter className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {ASSET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priceFilter} onValueChange={setPriceFilter}>
              <SelectTrigger className="w-36" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}>
                <SelectValue placeholder="Price" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Prices</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-36" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#F0F4FF" }}>
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="popular">Most Viewed</SelectItem>
                <SelectItem value="downloads">Most Downloaded</SelectItem>
                <SelectItem value="rating">Top Rated</SelectItem>
              </SelectContent>
            </Select>
            {assetsData && (
              <span className="text-xs ml-auto" style={{ color: "#5A6785" }}>
                {assetsData.items.length} assets
              </span>
            )}
          </div>

          {assetsLoading ? (
            <div className="text-center py-12" style={{ color: "#5A6785" }}>Loading assets…</div>
          ) : assetsData?.items.length === 0 ? (
            <div className="text-center py-16">
              <Package className="w-12 h-12 mx-auto mb-3" style={{ color: "#5A6785" }} />
              <p style={{ color: "#8B9BC4" }}>No assets found</p>
              <p className="text-sm mt-1" style={{ color: "#5A6785" }}>Create your first asset to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {assetsData?.items.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onFeature={(id, f) => featureMut.mutate({ id, featured: f })}
                  onActivate={(id, a) => activateMut.mutate({ id, active: a })}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Creators Tab */}
      {tab === "creators" && (
        <div className="space-y-3">
          {creatorsLoading ? (
            <div className="text-center py-12" style={{ color: "#5A6785" }}>Loading creators…</div>
          ) : creatorsData?.items.length === 0 ? (
            <div className="text-center py-16">
              <Users className="w-12 h-12 mx-auto mb-3" style={{ color: "#5A6785" }} />
              <p style={{ color: "#8B9BC4" }}>No creators yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {creatorsData?.items.map((creator) => (
                <div
                  key={creator.id}
                  className="rounded-xl p-5 space-y-3"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="flex items-center gap-3">
                    {creator.avatarUrl ? (
                      <img src={creator.avatarUrl} className="w-10 h-10 rounded-full object-cover" alt="" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ background: "rgba(124,110,250,0.2)", color: "#7C6EFA" }}
                      >
                        {creator.displayName[0]}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate" style={{ color: "#F0F4FF" }}>{creator.displayName}</p>
                      <p className="text-xs truncate" style={{ color: "#8B9BC4" }}>{creator.creatorCode}</p>
                    </div>
                    {creator.isVerified ? (
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#34D399" }} />
                    ) : (
                      <XCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#5A6785" }} />
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: "#8B9BC4" }}>
                    <span className="flex items-center gap-1"><Package className="w-3 h-3" /> {creator.totalAssets} assets</span>
                    <span className="flex items-center gap-1"><Download className="w-3 h-3" /> {creator.totalDownloads.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Star className="w-3 h-3" /> {parseFloat(creator.avgRating).toFixed(1)}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-xs"
                    style={{
                      borderColor: "rgba(255,255,255,0.1)",
                      color: creator.isVerified ? "#F87171" : "#34D399",
                    }}
                    onClick={() => verifyMut.mutate({ id: creator.id, isVerified: !creator.isVerified })}
                  >
                    {creator.isVerified ? "Unverify" : "Verify Creator"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analytics Tab */}
      {tab === "analytics" && analytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Assets" value={analytics.totalAssets} icon={<Package className="w-5 h-5" />} />
            <StatCard label="Free Assets" value={analytics.freeAssets} icon={<CheckCircle className="w-5 h-5" />} color="#34D399" />
            <StatCard label="Premium Assets" value={analytics.premiumAssets} icon={<TrendingUp className="w-5 h-5" />} color="#FBB924" />
            <StatCard label="Total Favorites" value={analytics.totalFavorites} icon={<Heart className="w-5 h-5" />} color="#F87171" />
          </div>

          <div
            className="rounded-xl p-6"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <h3 className="text-sm font-semibold mb-4" style={{ color: "#F0F4FF" }}>Downloads by Asset Type</h3>
            <div className="space-y-3">
              {analytics.byType.map((t) => {
                const max = Math.max(...analytics.byType.map((x) => x.downloads), 1);
                const pct = Math.round((t.downloads / max) * 100);
                return (
                  <div key={t.assetType} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2" style={{ color: "#8B9BC4" }}>
                        {TYPE_ICONS[t.assetType] ?? <Package className="w-3 h-3" />}
                        <span className="capitalize">{t.assetType.replace("_", " ")}</span>
                      </span>
                      <span style={{ color: "#F0F4FF" }}>
                        {t.downloads.toLocaleString()} dl · {t.count} assets
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: "linear-gradient(90deg, #7C6EFA, #5F52D0)" }}
                      />
                    </div>
                  </div>
                );
              })}
              {analytics.byType.length === 0 && (
                <p className="text-sm text-center py-6" style={{ color: "#5A6785" }}>No data yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Downloads Tab */}
      {tab === "downloads" && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                {["ID", "Type", "Item", "Email", "IP", "Date"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium" style={{ color: "#8B9BC4" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(downloadsData?.items ?? []).map((d: Record<string, unknown>, i) => (
                <tr
                  key={i}
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <td className="px-4 py-3 text-xs" style={{ color: "#5A6785" }}>{String(d.id ?? "")}</td>
                  <td className="px-4 py-3 text-xs">
                    <Badge className="text-xs capitalize" style={{ background: "rgba(124,110,250,0.15)", color: "#7C6EFA", border: "none" }}>
                      {String(d.item_type ?? d.itemType ?? "")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#F0F4FF" }}>{String(d.asset_title ?? d.assetTitle ?? `#${String(d.item_id ?? d.itemId ?? "")}`)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#8B9BC4" }}>{String(d.customer_email ?? d.customerEmail ?? "—")}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#5A6785" }}>{String(d.ip_address ?? d.ipAddress ?? "—")}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#5A6785" }}>
                    {d.created_at ? new Date(String(d.created_at)).toLocaleDateString("id-ID") : "—"}
                  </td>
                </tr>
              ))}
              {(downloadsData?.items ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-sm" style={{ color: "#5A6785" }}>
                    No downloads yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
