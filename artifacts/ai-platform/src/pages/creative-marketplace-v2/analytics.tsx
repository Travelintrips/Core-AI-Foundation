/**
 * Creative Marketplace V2 — Analytics dashboard (AI Platform)
 * Route: /creative-marketplace-v2/analytics
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, TrendingUp, Download, Eye, Heart,
  Star, Users, ShoppingBag, Search,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env["VITE_ADMIN_API_KEY"] ?? "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "x-admin-api-key": ADMIN_KEY },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

interface Analytics {
  totalListings: number; totalAll: number;
  byItemType: Record<string, number>;
  byModerationState: Record<string, number>;
  totalCreators: number; verifiedCreators: number;
  totalDownloads: number; totalViews: number; totalFavorites: number;
  avgRating: string; freeListings: number; premiumListings: number;
}

interface ListingAnalytics {
  listing: {
    id: number; title: string; itemType: string; avgRating: string;
    downloadsCount: number; viewsCount: number; favoritesCount: number; ratingsCount: number;
  } | null;
  snapshots: { date: string; viewsDelta: number; downloadsDelta: number; favoritesDelta: number }[];
}

function StatCard({ label, value, sub, icon, color = "text-white" }: {
  label: string; value: string | number; sub?: string;
  icon: React.ReactNode; color?: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-white/8 rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="text-slate-400">{icon}</div>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-32 truncate capitalize">{label.replace(/_/g, " ")}</span>
      <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-300 w-8 text-right">{value}</span>
    </div>
  );
}

export default function CM2AnalyticsPage() {
  const [listingId, setListingId] = useState("");
  const [searchedId, setSearchedId] = useState<number | null>(null);

  const { data: analytics, isLoading } = useQuery<Analytics>({
    queryKey: ["cm2-analytics"],
    queryFn: () => apiFetch("/ai/cm2/analytics"),
  });

  const { data: listingData } = useQuery<ListingAnalytics>({
    queryKey: ["cm2-listing-analytics", searchedId],
    queryFn: () => apiFetch(`/ai/cm2/analytics/listings/${searchedId}`),
    enabled: searchedId !== null,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const maxType = Math.max(...Object.values(analytics?.byItemType ?? {}), 1);
  const typeColors = ["bg-indigo-500","bg-violet-500","bg-fuchsia-500","bg-pink-500","bg-rose-500","bg-orange-500","bg-amber-500","bg-yellow-500","bg-lime-500","bg-emerald-500","bg-teal-500","bg-cyan-500"];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Usage Analytics</h1>
            <p className="text-sm text-slate-500">Platform-wide Creative Marketplace V2 metrics</p>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Approved Listings" value={analytics?.totalListings ?? 0} icon={<ShoppingBag className="w-4 h-4" />} />
          <StatCard label="Total Views" value={(analytics?.totalViews ?? 0).toLocaleString()} icon={<Eye className="w-4 h-4" />} color="text-indigo-400" />
          <StatCard label="Total Downloads" value={(analytics?.totalDownloads ?? 0).toLocaleString()} icon={<Download className="w-4 h-4" />} color="text-emerald-400" />
          <StatCard label="Total Favorites" value={(analytics?.totalFavorites ?? 0).toLocaleString()} icon={<Heart className="w-4 h-4" />} color="text-red-400" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Avg Platform Rating" value={parseFloat(analytics?.avgRating ?? "0").toFixed(2)} icon={<Star className="w-4 h-4 fill-amber-400 text-amber-400" />} color="text-amber-400" />
          <StatCard label="Total Creators" value={analytics?.totalCreators ?? 0} sub={`${analytics?.verifiedCreators ?? 0} verified`} icon={<Users className="w-4 h-4" />} />
          <StatCard label="Free Listings" value={analytics?.freeListings ?? 0} sub={`${analytics?.totalAll ? Math.round(((analytics.freeListings ?? 0) / analytics.totalAll) * 100) : 0}% of all`} icon={<TrendingUp className="w-4 h-4" />} color="text-emerald-400" />
          <StatCard label="Premium Listings" value={analytics?.premiumListings ?? 0} icon={<TrendingUp className="w-4 h-4" />} color="text-indigo-400" />
        </div>

        {/* Moderation state breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-slate-800/50 border border-white/8 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">By Moderation State</h2>
            <div className="space-y-2">
              {Object.entries(analytics?.byModerationState ?? {}).map(([state, count]) => {
                const total = analytics?.totalAll ?? 1;
                const pct = Math.round((count / total) * 100);
                const colMap: Record<string, string> = {
                  approved: "bg-emerald-500", pending: "bg-amber-500",
                  rejected: "bg-red-500", suspended: "bg-orange-500",
                };
                return (
                  <div key={state} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-24 capitalize">{state}</span>
                    <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full ${colMap[state] ?? "bg-slate-500"} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-slate-300 w-8 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* By item type */}
          <div className="bg-slate-800/50 border border-white/8 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">By Item Type (approved)</h2>
            <div className="space-y-2">
              {Object.entries(analytics?.byItemType ?? {})
                .sort(([, a], [, b]) => b - a)
                .map(([type, count], idx) => (
                  <MiniBar
                    key={type}
                    label={type}
                    value={count}
                    max={maxType}
                    color={typeColors[idx % typeColors.length]!}
                  />
                ))}
              {!Object.keys(analytics?.byItemType ?? {}).length && (
                <p className="text-xs text-slate-500 italic">No approved listings yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Per-listing analytics */}
        <div className="bg-slate-800/50 border border-white/8 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Per-Listing Analytics</h2>
          <div className="flex gap-2 mb-4">
            <input
              value={listingId}
              onChange={(e) => setListingId(e.target.value)}
              placeholder="Listing ID…"
              type="number"
              className="bg-slate-700 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 w-40"
            />
            <button
              onClick={() => setSearchedId(listingId ? parseInt(listingId, 10) : null)}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Lookup
            </button>
          </div>

          {listingData?.listing && (
            <div>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Views", value: listingData.listing.viewsCount, icon: <Eye className="w-3.5 h-3.5" /> },
                  { label: "Downloads", value: listingData.listing.downloadsCount, icon: <Download className="w-3.5 h-3.5" /> },
                  { label: "Favorites", value: listingData.listing.favoritesCount, icon: <Heart className="w-3.5 h-3.5" /> },
                  { label: "Avg Rating", value: parseFloat(listingData.listing.avgRating).toFixed(2), icon: <Star className="w-3.5 h-3.5" /> },
                ].map((s) => (
                  <div key={s.label} className="bg-slate-700/50 rounded-lg p-3 text-center">
                    <div className="flex justify-center mb-1 text-indigo-400">{s.icon}</div>
                    <p className="text-lg font-bold text-white">{s.value}</p>
                    <p className="text-xs text-slate-500">{s.label}</p>
                  </div>
                ))}
              </div>

              {listingData.snapshots.length > 0 && (
                <div>
                  <p className="text-xs text-slate-400 mb-2">Daily activity (last 30 days)</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {listingData.snapshots.map((s) => (
                      <div key={s.date} className="flex items-center gap-4 text-xs">
                        <span className="text-slate-500 w-24">{s.date}</span>
                        <span className="text-indigo-300">👁 {s.viewsDelta}</span>
                        <span className="text-emerald-300">↓ {s.downloadsDelta}</span>
                        <span className="text-red-300">♥ {s.favoritesDelta}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {searchedId && !listingData?.listing && (
            <p className="text-sm text-slate-500 italic">No listing found for ID {searchedId}.</p>
          )}
        </div>
      </div>
    </div>
  );
}
