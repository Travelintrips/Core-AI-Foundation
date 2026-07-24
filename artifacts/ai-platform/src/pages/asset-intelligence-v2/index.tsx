/**
 * Asset Intelligence V2 — Admin Dashboard Page (Team 06)
 *
 * Tabs: Overview | Duplicates | Version Chains | Safety | Knowledge Tags
 * Uses apiFetch pattern (same as creative-intelligence.tsx).
 * NOT registered in App.tsx yet — Team 24 handles that.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Brain, Shield, GitBranch, Copy, Tag, Search,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  ChevronRight, Layers, Sparkles, FileText, Image,
  Package, Shirt, Sofa, Palette, BarChart3, Info,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ── API helper ─────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const key = import.meta.env.VITE_ADMIN_API_KEY;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "x-admin-api-key": key } : {}),
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

// ── Types ──────────────────────────────────────────────────────────────────────

interface IntelligenceRecord {
  id: number;
  assetId: number;
  assetSource: string;
  clientId: string;
  assetTypeV2: string | null;
  autoTags: string[];
  knowledgeTags: string[];
  isDuplicate: boolean;
  duplicateOfId: number | null;
  versionType: string;
  versionChainId: number | null;
  quality: { overallScore: number; isVector: boolean; recommendation: string } | null;
  suggestedUsage: string[];
  safety: { safetyLevel: string; brandSafetyScore: number; flags: string[] } | null;
  analysisFailed: boolean;
  confidenceScore: number;
  analyzedAt: string;
}

interface DuplicateReport {
  clientId: string;
  totalAnalyzed: number;
  totalDuplicates: number;
  duplicateGroups: Array<{
    perceptualHash: string;
    hashTier: string;
    assetIds: number[];
    versionTypes: string[];
    recommendation: string;
  }>;
}

interface VersionChain {
  chainId: number;
  clientId: string;
  primaryAssetId: number | null;
  totalVariants: number;
  members: Array<{ assetId: number; assetSource: string; versionType: string; versionLabel: string; role: string }>;
  createdAt: string;
}

interface SafetyReport {
  clientId: string;
  flaggedAssets: Array<{
    assetId: number; assetSource: string; safetyLevel: string;
    brandSafetyScore: number; flags: string[]; reviewRequired: boolean;
  }>;
  total: number;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const ASSET_TYPE_ICONS: Record<string, typeof Brain> = {
  graphic: Palette,
  photo: Image,
  illustration: Sparkles,
  svg: FileText,
  document: FileText,
  interior_material: Sofa,
  furniture_image: Sofa,
  fashion_motif: Shirt,
  garment_mockup: Shirt,
  packaging_asset: Package,
};

function AssetTypeBadge({ type }: { type: string | null }) {
  const Icon = ASSET_TYPE_ICONS[type ?? ""] ?? Tag;
  const colors: Record<string, string> = {
    graphic: "bg-purple-100 text-purple-800",
    photo: "bg-blue-100 text-blue-800",
    illustration: "bg-pink-100 text-pink-800",
    svg: "bg-green-100 text-green-800",
    document: "bg-gray-100 text-gray-800",
    interior_material: "bg-amber-100 text-amber-800",
    furniture_image: "bg-orange-100 text-orange-800",
    fashion_motif: "bg-rose-100 text-rose-800",
    garment_mockup: "bg-indigo-100 text-indigo-800",
    packaging_asset: "bg-teal-100 text-teal-800",
  };
  const cls = colors[type ?? ""] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      <Icon className="w-3 h-3" />
      {type ? type.replace(/_/g, " ") : "unknown"}
    </span>
  );
}

function QualityBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-600 w-8 text-right">{score}</span>
    </div>
  );
}

function SafetyBadge({ level, score }: { level: string; score: number }) {
  const config = {
    safe:   { cls: "bg-green-100 text-green-800",  icon: CheckCircle2, label: "Safe" },
    review: { cls: "bg-yellow-100 text-yellow-800", icon: AlertTriangle, label: "Review" },
    unsafe: { cls: "bg-red-100 text-red-800",       icon: XCircle,       label: "Unsafe" },
  }[level] ?? { cls: "bg-gray-100 text-gray-700", icon: Info, label: level };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.cls}`}>
      <Icon className="w-3 h-3" />
      {config.label} ({score})
    </span>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-v2-client", clientId],
    queryFn: () => apiFetch<{ items: IntelligenceRecord[]; total: number }>(
      `/ai/asset-intelligence/v2/client/${encodeURIComponent(clientId)}`
    ),
    enabled: !!clientId,
  });

  const { toast } = useToast();
  const qc = useQueryClient();
  const analyzeMut = useMutation({
    mutationFn: ({ assetId, assetSource }: { assetId: number; assetSource: string }) =>
      apiFetch(`/ai/asset-intelligence/v2/analyze/${assetId}`, {
        method: "POST",
        body: JSON.stringify({ assetSource, clientId, reanalyze: true }),
      }),
    onSuccess: () => { toast({ title: "Re-analyzed" }); void qc.invalidateQueries({ queryKey: ["ai-v2-client", clientId] }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!clientId) return <p className="text-gray-400 text-sm">Enter a client ID above to load data.</p>;
  if (isLoading) return <div className="flex items-center gap-2 text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" />Loading…</div>;
  if (error) return <p className="text-red-500 text-sm">{(error as Error).message}</p>;
  if (!data?.items.length) return <p className="text-gray-400 text-sm">No intelligence records yet. Run /analyze on assets first.</p>;

  const stats = {
    total: data.total,
    duplicates: data.items.filter((i) => i.isDuplicate).length,
    failed: data.items.filter((i) => i.analysisFailed).length,
    avgQuality: Math.round(data.items.filter((i) => i.quality).reduce((s, i) => s + (i.quality?.overallScore ?? 0), 0) / (data.items.filter((i) => i.quality).length || 1)),
  };

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Analyzed", value: stats.total, icon: Brain, color: "text-blue-600" },
          { label: "Duplicates", value: stats.duplicates, icon: Copy, color: "text-orange-600" },
          { label: "Failed", value: stats.failed, icon: XCircle, color: "text-red-600" },
          { label: "Avg Quality", value: `${stats.avgQuality}/100`, icon: BarChart3, color: "text-green-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-lg border p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-gray-500">{label}</span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Records table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Asset</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Type</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Tags</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Quality</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Safety</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.items.map((item) => (
              <tr key={`${item.assetId}-${item.assetSource}`} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">#{item.assetId}</div>
                  <div className="text-xs text-gray-400">{item.assetSource}</div>
                </td>
                <td className="px-4 py-3"><AssetTypeBadge type={item.assetTypeV2} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {item.autoTags.slice(0, 4).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{t}</span>
                    ))}
                    {item.autoTags.length > 4 && <span className="text-xs text-gray-400">+{item.autoTags.length - 4}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 w-32">
                  {item.quality ? <QualityBar score={item.quality.overallScore} /> : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {item.safety
                    ? <SafetyBadge level={item.safety.safetyLevel} score={item.safety.brandSafetyScore} />
                    : <span className="text-gray-400 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  {item.analysisFailed
                    ? <Badge variant="destructive">Failed</Badge>
                    : item.isDuplicate
                      ? <Badge className="bg-orange-100 text-orange-700 border-0">Duplicate</Badge>
                      : <Badge className="bg-green-100 text-green-700 border-0">OK</Badge>}
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => analyzeMut.mutate({ assetId: item.assetId, assetSource: item.assetSource })}
                    disabled={analyzeMut.isPending}
                  >
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Duplicates ───────────────────────────────────────────────────────────

function DuplicatesTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-v2-duplicates", clientId],
    queryFn: () => apiFetch<DuplicateReport>(`/ai/asset-intelligence/v2/duplicates/${encodeURIComponent(clientId)}`),
    enabled: !!clientId,
  });

  if (!clientId) return <p className="text-gray-400 text-sm">Enter a client ID above.</p>;
  if (isLoading) return <div className="flex items-center gap-2 text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" />Loading…</div>;
  if (error) return <p className="text-red-500 text-sm">{(error as Error).message}</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="bg-white border rounded-lg px-5 py-3">
          <p className="text-xs text-gray-500">Analyzed</p>
          <p className="text-2xl font-bold">{data?.totalAnalyzed ?? 0}</p>
        </div>
        <div className="bg-white border rounded-lg px-5 py-3">
          <p className="text-xs text-gray-500">Duplicates found</p>
          <p className="text-2xl font-bold text-orange-600">{data?.totalDuplicates ?? 0}</p>
        </div>
        <div className="bg-white border rounded-lg px-5 py-3">
          <p className="text-xs text-gray-500">Duplicate groups</p>
          <p className="text-2xl font-bold">{data?.duplicateGroups.length ?? 0}</p>
        </div>
      </div>

      {data?.duplicateGroups.length === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <p className="text-green-800 text-sm">No duplicates detected in this client's library.</p>
        </div>
      )}

      {data?.duplicateGroups.map((g, i) => (
        <div key={i} className="bg-white border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Copy className="w-4 h-4 text-orange-500" />
              <span className="font-medium text-sm">Group {i + 1} — {g.assetIds.length} assets</span>
              <Badge variant="outline" className="text-xs">{g.hashTier} hash</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {g.assetIds.map((id) => (
              <span key={id} className="px-2 py-1 bg-orange-50 border border-orange-200 rounded text-xs font-mono">#{id}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {g.versionTypes.map((vt, vi) => (
              <span key={vi} className="px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">{vt}</span>
            ))}
          </div>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <Info className="w-3 h-3" /> {g.recommendation}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Version Chains ───────────────────────────────────────────────────────

function VersionChainsTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["ai-v2-chains", clientId],
    queryFn: () => apiFetch<{ chains: VersionChain[]; total: number }>(
      `/ai/asset-intelligence/v2/version-chains/${encodeURIComponent(clientId)}`
    ),
    enabled: !!clientId,
  });

  const { toast } = useToast();
  const autoGroupMut = useMutation({
    mutationFn: () => apiFetch<{ chainsCreated: number; assetsGrouped: number }>(
      "/ai/asset-intelligence/v2/version-chains/auto-group",
      { method: "POST", body: JSON.stringify({ clientId }) }
    ),
    onSuccess: (r) => {
      toast({ title: `Auto-grouped: ${r.chainsCreated} chains, ${r.assetsGrouped} assets` });
      void refetch();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!clientId) return <p className="text-gray-400 text-sm">Enter a client ID above.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{data?.total ?? 0} version chains found</p>
        <Button size="sm" variant="outline" onClick={() => autoGroupMut.mutate()} disabled={autoGroupMut.isPending || isLoading}>
          {autoGroupMut.isPending ? <RefreshCw className="w-3 h-3 animate-spin mr-1" /> : <Layers className="w-3 h-3 mr-1" />}
          Auto-group
        </Button>
      </div>

      {isLoading && <div className="flex items-center gap-2 text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" />Loading…</div>}
      {error && <p className="text-red-500 text-sm">{(error as Error).message}</p>}

      {data?.chains.map((chain) => (
        <div key={chain.chainId} className="bg-white border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <GitBranch className="w-4 h-4 text-blue-500" />
            <span className="font-medium text-sm">Chain #{chain.chainId}</span>
            {chain.primaryAssetId && (
              <span className="text-xs text-gray-400">Primary: #{chain.primaryAssetId}</span>
            )}
            <Badge variant="outline" className="text-xs ml-auto">{chain.totalVariants} variants</Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {chain.members.map((m) => (
              <div key={`${m.assetId}-${m.assetSource}`}
                className={`rounded border px-3 py-2 text-xs ${m.role === "primary" ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50"}`}>
                <div className="font-medium">#{m.assetId}</div>
                <div className="text-gray-500">{m.versionLabel}</div>
                {m.role === "primary" && <div className="text-blue-600 font-medium">primary</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {!isLoading && data?.chains.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No version chains yet. Run "Auto-group" to detect them.</p>
        </div>
      )}
    </div>
  );
}

// ── Tab: Safety ───────────────────────────────────────────────────────────────

function SafetyTab({ clientId }: { clientId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-v2-safety", clientId],
    queryFn: () => apiFetch<SafetyReport>(`/ai/asset-intelligence/v2/safety-report/${encodeURIComponent(clientId)}`),
    enabled: !!clientId,
  });

  if (!clientId) return <p className="text-gray-400 text-sm">Enter a client ID above.</p>;
  if (isLoading) return <div className="flex items-center gap-2 text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" />Loading…</div>;
  if (error) return <p className="text-red-500 text-sm">{(error as Error).message}</p>;

  if (data?.total === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
        <Shield className="w-5 h-5 text-green-600 shrink-0" />
        <p className="text-green-800 text-sm">All assets are brand-safe. No flags detected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{data?.total} assets require review</p>
      {data?.flaggedAssets.map((a, i) => (
        <div key={i} className={`bg-white border rounded-lg p-4 space-y-2 ${a.safetyLevel === "unsafe" ? "border-red-200" : "border-yellow-200"}`}>
          <div className="flex items-center gap-3">
            <SafetyBadge level={a.safetyLevel} score={a.brandSafetyScore} />
            <span className="font-medium text-sm">Asset #{a.assetId}</span>
            <span className="text-xs text-gray-400">{a.assetSource}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {a.flags.map((f) => (
              <span key={f} className="px-2 py-0.5 bg-red-50 border border-red-200 rounded text-xs text-red-700">{f}</span>
            ))}
          </div>
          {a.reviewRequired && (
            <p className="text-xs text-yellow-700 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Manual review required
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tab: Knowledge Tags ───────────────────────────────────────────────────────

function KnowledgeTagsTab() {
  const [selectedType, setSelectedType] = useState<string>("graphic");

  const ASSET_TYPES = [
    "graphic", "photo", "illustration", "svg", "document",
    "interior_material", "furniture_image", "fashion_motif",
    "garment_mockup", "packaging_asset",
  ];

  const { data, isLoading } = useQuery({
    queryKey: ["ai-v2-knowledge-tags", selectedType],
    queryFn: () => apiFetch<{ assetType: string; tags: Array<{ tag: string; category: string; subcategory: string | null; weight: number }> }>(
      `/ai/asset-intelligence/v2/knowledge-tags?assetType=${selectedType}`
    ),
  });

  const grouped = data?.tags.reduce<Record<string, typeof data.tags>>((acc, t) => {
    const k = t.category;
    if (!acc[k]) acc[k] = [];
    acc[k]!.push(t);
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {ASSET_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setSelectedType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              selectedType === t
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
            }`}
          >
            {t.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {isLoading && <div className="flex items-center gap-2 text-gray-500"><RefreshCw className="w-4 h-4 animate-spin" />Loading…</div>}

      <div className="grid md:grid-cols-2 gap-4">
        {Object.entries(grouped).map(([category, tags]) => (
          <div key={category} className="bg-white border rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">{category.replace(/_/g, " ")}</h4>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t.tag}
                  className="px-2 py-1 bg-blue-50 border border-blue-100 rounded text-xs text-blue-800"
                  title={`Weight: ${t.weight} | Sub: ${t.subcategory ?? "—"}`}
                >
                  {t.tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "duplicates" | "chains" | "safety" | "knowledge";

const TABS: Array<{ id: Tab; label: string; icon: typeof Brain }> = [
  { id: "overview",   label: "Overview",        icon: Brain },
  { id: "duplicates", label: "Duplicates",      icon: Copy },
  { id: "chains",     label: "Version Chains",  icon: GitBranch },
  { id: "safety",     label: "Safety",          icon: Shield },
  { id: "knowledge",  label: "Knowledge Tags",  icon: Tag },
];

export default function AssetIntelligenceV2Page() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [clientId, setClientId] = useState("");
  const [clientIdInput, setClientIdInput] = useState("");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center gap-3 mb-1">
          <Brain className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-semibold text-gray-900">Asset Intelligence V2</h1>
          <Badge className="bg-blue-100 text-blue-700 border-0 text-xs">Team 06</Badge>
        </div>
        <p className="text-sm text-gray-500">
          Auto-tagging · Duplicate detection · Version chains · Quality scoring · Safety classification · Knowledge taxonomy
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Client ID input */}
        <div className="bg-white rounded-lg border p-4">
          <label className="text-sm font-medium text-gray-700 block mb-2">Client ID (sha256 email hash)</label>
          <div className="flex gap-2">
            <Input
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setClientId(clientIdInput.trim()); }}
              placeholder="Enter client ID (sha256 email hash)…"
              className="font-mono text-sm"
            />
            <Button onClick={() => setClientId(clientIdInput.trim())}>
              <Search className="w-4 h-4 mr-1" /> Load
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white rounded-lg border p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
                activeTab === id
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "overview"   && <OverviewTab clientId={clientId} />}
          {activeTab === "duplicates" && <DuplicatesTab clientId={clientId} />}
          {activeTab === "chains"     && <VersionChainsTab clientId={clientId} />}
          {activeTab === "safety"     && <SafetyTab clientId={clientId} />}
          {activeTab === "knowledge"  && <KnowledgeTagsTab />}
        </div>
      </div>
    </div>
  );
}
