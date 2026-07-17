/**
 * Creative Marketplace V2 — Listing detail page (customer portal)
 * Route: /creative-marketplace-v2/listing/:id
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Star, Download, Heart, HeartOff, CheckCircle,
  FileText, Tag, Shield, User, AlertCircle, ExternalLink,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LicenseMeta {
  allowedUses: string[];
  requiresAttribution: boolean;
  commercialUse: boolean;
  editorialUse: boolean;
  printUse: boolean;
  digitalUse: boolean;
  resellAllowed: boolean;
  modificationAllowed: boolean;
  numberOfSeats: number | null;
  geographicRestrictions: string[];
  notes: string | null;
}

interface Listing {
  id: number; listingCode: string; itemType: string; title: string;
  description: string | null; category: string; tags: string[];
  priceType: "free" | "premium"; priceAmount: string; currency: string;
  licenseType: string; licenseSummary: string; licenseMetadata: LicenseMeta;
  previewUrls: string[]; thumbnailUrl: string | null;
  fileFormat: string | null; fileSizeBytes: number | null;
  isFeatured: boolean; downloadsCount: number; viewsCount: number;
  favoritesCount: number; avgRating: string; ratingsCount: number;
  createdAt: string;
  creator: {
    id: number; creatorCode: string; displayName: string;
    avatarUrl: string | null; isVerified: boolean; totalListings: number; avgRating: string;
  } | null;
}

interface Rating {
  id: number; customerEmailMasked: string; rating: number;
  review: string | null; createdAt: string;
}

// ── Star display ──────────────────────────────────────────────────────────────

function Stars({ value, interactive = false, onChange }: {
  value: number; interactive?: boolean; onChange?: (v: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-5 h-5 transition-colors ${
            i <= (interactive ? hover || value : value)
              ? "fill-amber-400 text-amber-400"
              : "text-slate-600"
          } ${interactive ? "cursor-pointer" : ""}`}
          onMouseEnter={interactive ? () => setHover(i) : undefined}
          onMouseLeave={interactive ? () => setHover(0) : undefined}
          onClick={interactive && onChange ? () => onChange(i) : undefined}
        />
      ))}
    </div>
  );
}

function LicenseMetaTable({ meta }: { meta: LicenseMeta }) {
  const rows: [string, boolean | string | number | null][] = [
    ["Commercial Use", meta.commercialUse],
    ["Editorial Use", meta.editorialUse],
    ["Print Use", meta.printUse],
    ["Digital Use", meta.digitalUse],
    ["Resell Allowed", meta.resellAllowed],
    ["Modification Allowed", meta.modificationAllowed],
    ["Requires Attribution", meta.requiresAttribution],
    ["Number of Seats", meta.numberOfSeats ?? "Unlimited"],
  ];
  return (
    <div className="divide-y divide-white/6 text-sm">
      {rows.map(([label, val]) => (
        <div key={label as string} className="flex justify-between py-2">
          <span className="text-slate-400">{label as string}</span>
          {typeof val === "boolean" ? (
            <span className={val ? "text-emerald-400" : "text-red-400"}>
              {val ? "✓ Yes" : "✗ No"}
            </span>
          ) : (
            <span className="text-slate-200">{String(val)}</span>
          )}
        </div>
      ))}
      {meta.allowedUses.length > 0 && (
        <div className="flex justify-between py-2">
          <span className="text-slate-400">Allowed Uses</span>
          <span className="text-slate-200 text-right">{meta.allowedUses.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CM2ListingPage({ params }: { params: { id: string; token?: string } }) {
  const id = parseInt(params.id, 10);
  const token = params.token;
  const qc = useQueryClient();

  const [selectedPreview, setSelectedPreview] = useState(0);
  const [myRating, setMyRating] = useState(0);
  const [myReview, setMyReview] = useState("");
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  const { data: listing, isLoading, isError } = useQuery<Listing>({
    queryKey: ["cm2-listing", id],
    queryFn: () => apiFetch(`/public/cm2/listings/${id}`),
    enabled: !isNaN(id),
  });

  const { data: ratingsData } = useQuery<{ items: Rating[]; total: number }>({
    queryKey: ["cm2-ratings", id],
    queryFn: () => apiFetch(`/public/cm2/listings/${id}/ratings`),
    enabled: !isNaN(id),
  });

  const downloadMut = useMutation({
    mutationFn: () =>
      apiFetch(`/public/cm2/listings/${id}/download`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cm2-listing", id] });
    },
  });

  const rateMut = useMutation({
    mutationFn: (data: { rating: number; review: string }) => {
      if (token) {
        return apiFetch(`/public/customer/workspace/${token}/cm2/listings/${id}/rate`, {
          method: "POST", body: JSON.stringify(data),
        });
      }
      return apiFetch(`/public/cm2/listings/${id}/rate`, {
        method: "POST",
        body: JSON.stringify({ ...data, customerEmail: "guest@example.com" }),
      });
    },
    onSuccess: () => {
      setRatingSubmitted(true);
      void qc.invalidateQueries({ queryKey: ["cm2-ratings", id] });
    },
  });

  const favMut = useMutation({
    mutationFn: () => {
      if (!token) throw new Error("Login required");
      if (isFavorited) {
        return apiFetch(`/public/customer/workspace/${token}/cm2/favorites/${id}`, { method: "DELETE" });
      }
      return apiFetch(`/public/customer/workspace/${token}/cm2/favorites/${id}`, { method: "POST" });
    },
    onSuccess: () => setIsFavorited((f) => !f),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (isError || !listing) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-3">
        <AlertCircle className="w-12 h-12 text-red-400" />
        <p className="text-slate-300">Listing not found or not available.</p>
        <Link href="/creative-marketplace-v2" className="text-indigo-400 hover:underline text-sm">
          ← Back to Marketplace
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <Link href="/creative-marketplace-v2" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-indigo-400 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Marketplace
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          {/* Left: preview */}
          <div>
            <div className="bg-slate-800/50 rounded-xl overflow-hidden mb-3 aspect-video flex items-center justify-center">
              {listing.previewUrls[selectedPreview] ? (
                <img
                  src={listing.previewUrls[selectedPreview]}
                  alt={listing.title}
                  className="w-full h-full object-contain"
                />
              ) : (
                <span className="text-8xl">📁</span>
              )}
            </div>
            {listing.previewUrls.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {listing.previewUrls.map((url, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPreview(i)}
                    className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                      i === selectedPreview ? "border-indigo-500" : "border-white/10"
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: info */}
          <div>
            <div className="flex items-start justify-between gap-3 mb-3">
              <h1 className="text-2xl font-bold text-white leading-tight">{listing.title}</h1>
              {listing.isFeatured && (
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-black">
                  FEATURED
                </span>
              )}
            </div>

            {/* Price */}
            <div className="flex items-center gap-3 mb-4">
              {listing.priceType === "free" ? (
                <span className="text-2xl font-bold text-emerald-400">Free</span>
              ) : (
                <span className="text-2xl font-bold text-white">
                  {listing.currency} {Number(listing.priceAmount).toLocaleString("id-ID")}
                </span>
              )}
              <span className="text-sm text-slate-500">· {listing.licenseType} license</span>
            </div>

            {/* Rating summary */}
            <div className="flex items-center gap-2 mb-4">
              <Stars value={Math.round(parseFloat(listing.avgRating))} />
              <span className="text-sm text-slate-300 font-medium">{parseFloat(listing.avgRating).toFixed(1)}</span>
              <span className="text-sm text-slate-500">({listing.ratingsCount} reviews)</span>
            </div>

            {/* Stats row */}
            <div className="flex gap-4 mb-5 text-sm text-slate-400">
              <span className="flex items-center gap-1"><Download className="w-4 h-4" />{listing.downloadsCount} downloads</span>
              <span className="flex items-center gap-1"><Heart className="w-4 h-4" />{listing.favoritesCount} favorites</span>
            </div>

            {/* Description */}
            {listing.description && (
              <p className="text-slate-300 text-sm leading-relaxed mb-5">{listing.description}</p>
            )}

            {/* Tags */}
            {listing.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-5">
                {listing.tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 text-xs px-2 py-0.5 bg-slate-700/50 text-slate-300 rounded-full">
                    <Tag className="w-2.5 h-2.5" />{t}
                  </span>
                ))}
              </div>
            )}

            {/* File info */}
            {(listing.fileFormat || listing.fileSizeBytes) && (
              <div className="flex gap-3 mb-5 text-sm text-slate-400">
                {listing.fileFormat && (
                  <span className="flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{listing.fileFormat}</span>
                )}
                {listing.fileSizeBytes && (
                  <span>{(listing.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                )}
              </div>
            )}

            {/* Creator */}
            {listing.creator && (
              <Link href={`/creative-marketplace-v2/creator/${listing.creator.creatorCode}`}>
                <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg mb-5 hover:bg-slate-700/50 transition-colors cursor-pointer">
                  {listing.creator.avatarUrl ? (
                    <img src={listing.creator.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-400" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium text-white">{listing.creator.displayName}</span>
                      {listing.creator.isVerified && <CheckCircle className="w-3.5 h-3.5 text-indigo-400" />}
                    </div>
                    <p className="text-xs text-slate-500">{listing.creator.totalListings} listings · {parseFloat(listing.creator.avgRating).toFixed(1)} avg rating</p>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500 ml-auto" />
                </div>
              </Link>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => downloadMut.mutate()}
                disabled={downloadMut.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                {listing.priceType === "free" ? "Download Free" : "Purchase & Download"}
              </button>
              <button
                onClick={() => favMut.mutate()}
                disabled={!token || favMut.isPending}
                title={!token ? "Login required to save favorites" : undefined}
                className={`p-3 rounded-lg border transition-colors ${
                  isFavorited
                    ? "border-red-500/50 bg-red-900/20 text-red-400"
                    : "border-white/10 text-slate-400 hover:border-white/20 hover:text-white"
                } disabled:opacity-40`}
              >
                {isFavorited ? <HeartOff className="w-5 h-5" /> : <Heart className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* License details */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-400" /> License Details
            </h2>
            <p className="text-sm text-slate-400 mb-4">{listing.licenseSummary}</p>
            <LicenseMetaTable meta={listing.licenseMetadata} />
          </div>

          {/* Ratings */}
          <div>
            <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> Reviews ({ratingsData?.total ?? 0})
            </h2>

            {/* Submit rating */}
            {!ratingSubmitted ? (
              <div className="bg-slate-800/50 rounded-lg p-4 mb-4">
                <p className="text-sm text-slate-400 mb-2">Rate this listing:</p>
                <Stars value={myRating} interactive onChange={setMyRating} />
                <textarea
                  value={myReview}
                  onChange={(e) => setMyReview(e.target.value)}
                  placeholder="Write a review (optional)"
                  rows={2}
                  className="w-full mt-2 bg-slate-700 border border-white/10 rounded text-sm text-white placeholder-slate-500 p-2 focus:outline-none focus:border-indigo-500 resize-none"
                />
                <button
                  onClick={() => myRating > 0 && rateMut.mutate({ rating: myRating, review: myReview })}
                  disabled={myRating === 0 || rateMut.isPending}
                  className="mt-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
                >
                  Submit Review
                </button>
              </div>
            ) : (
              <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 mb-4 text-sm text-emerald-300">
                ✓ Thank you for your review!
              </div>
            )}

            {/* Reviews list */}
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {ratingsData?.items.map((r) => (
                <div key={r.id} className="bg-slate-800/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <Stars value={r.rating} />
                    <span className="text-xs text-slate-500">{r.customerEmailMasked}</span>
                  </div>
                  {r.review && <p className="text-sm text-slate-300 leading-relaxed">{r.review}</p>}
                </div>
              ))}
              {(!ratingsData?.items.length) && (
                <p className="text-sm text-slate-500 text-center py-4">No reviews yet. Be the first!</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
