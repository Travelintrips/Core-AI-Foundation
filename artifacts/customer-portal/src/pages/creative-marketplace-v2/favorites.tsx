/**
 * Creative Marketplace V2 — Favorites page (customer portal, workspace token required)
 * Route: /creative-marketplace-v2/favorites?token=...
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Heart, HeartOff, ArrowLeft, Lock, ShoppingBag, Star } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

interface Listing {
  id: number; listingCode: string; itemType: string; title: string;
  priceType: "free" | "premium"; priceAmount: string; currency: string;
  licenseType: string; thumbnailUrl: string | null;
  avgRating: string; ratingsCount: number; downloadsCount: number;
  creator: { displayName: string; isVerified: boolean } | null;
}

interface Favorite {
  id: number; listingId: number; listing: Listing; createdAt: string;
}

function FavoriteCard({ fav, token, onRemove }: { fav: Favorite; token: string; onRemove: () => void }) {
  const { listing } = fav;
  return (
    <div className="group bg-slate-800/50 border border-white/8 rounded-xl overflow-hidden hover:border-indigo-500/40 transition-all">
      {/* Thumbnail */}
      <div className="relative h-40 bg-slate-700/50 flex items-center justify-center overflow-hidden">
        {listing.thumbnailUrl ? (
          <img src={listing.thumbnailUrl} alt={listing.title} className="w-full h-full object-cover" />
        ) : (
          <span className="text-4xl">📁</span>
        )}
        <div className="absolute top-2 right-2">
          {listing.priceType === "free" ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-900/80 text-emerald-300">FREE</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-900/80 text-indigo-300">PREMIUM</span>
          )}
        </div>
      </div>

      <div className="p-3">
        <Link href={`/creative-marketplace-v2/listing/${listing.id}?token=${token}`}>
          <p className="text-sm font-semibold text-white line-clamp-1 hover:text-indigo-300 transition-colors cursor-pointer">
            {listing.title}
          </p>
        </Link>
        {listing.creator && (
          <p className="text-xs text-slate-500 mt-0.5">{listing.creator.displayName}</p>
        )}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/6">
          <span className="flex items-center gap-0.5 text-xs text-amber-400">
            <Star className="w-3 h-3 fill-amber-400" />
            {parseFloat(listing.avgRating).toFixed(1)}
            <span className="text-slate-500 ml-0.5">({listing.ratingsCount})</span>
          </span>
          <button
            onClick={onRemove}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <HeartOff className="w-3 h-3" /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CM2FavoritesPage({ params }: { params?: { token?: string } }) {
  // token can come from query string (?token=...) or from params
  const urlToken = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token") ?? undefined
    : undefined;
  const token = params?.token ?? urlToken;
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<{ items: Favorite[]; total: number }>({
    queryKey: ["cm2-favorites", token],
    queryFn: () => apiFetch(`/public/customer/workspace/${token}/cm2/favorites`),
    enabled: Boolean(token),
  });

  const removeMut = useMutation({
    mutationFn: (listingId: number) =>
      apiFetch(`/public/customer/workspace/${token}/cm2/favorites/${listingId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cm2-favorites", token] });
    },
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4">
        <Lock className="w-12 h-12 text-slate-600" />
        <p className="text-slate-400 text-center max-w-sm">
          You need a workspace token to view your favorites.
          Access this page from your client workspace.
        </p>
        <Link href="/creative-marketplace-v2" className="text-indigo-400 hover:underline text-sm">
          Browse Marketplace →
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/creative-marketplace-v2" className="text-slate-400 hover:text-indigo-400 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Heart className="w-5 h-5 text-red-400" /> My Favorites
            </h1>
            {data && (
              <p className="text-sm text-slate-500 mt-0.5">{data.total} saved items</p>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-slate-800/50 rounded-xl h-56 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-20">
            <p className="text-slate-400">Failed to load favorites. Your session may have expired.</p>
          </div>
        )}

        {!isLoading && !isError && data?.items.length === 0 && (
          <div className="text-center py-20">
            <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 mb-2">No favorites yet.</p>
            <Link href="/creative-marketplace-v2" className="text-indigo-400 hover:underline text-sm">
              Browse the marketplace →
            </Link>
          </div>
        )}

        {!isLoading && !isError && data && data.items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {data.items.map((fav) => (
              <FavoriteCard
                key={fav.id}
                fav={fav}
                token={token}
                onRemove={() => removeMut.mutate(fav.listingId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
