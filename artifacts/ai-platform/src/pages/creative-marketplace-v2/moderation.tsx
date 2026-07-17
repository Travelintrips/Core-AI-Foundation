/**
 * Creative Marketplace V2 — Moderation queue (AI Platform)
 * Route: /creative-marketplace-v2/moderation
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, CheckCircle, XCircle, Ban, Clock, X, Tag } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const ADMIN_KEY = import.meta.env["VITE_ADMIN_API_KEY"] ?? "";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_KEY },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

interface Listing {
  id: number; listingCode: string; itemType: string; title: string;
  description: string | null; category: string; tags: string[];
  priceType: string; priceAmount: string; currency: string;
  licenseType: string; moderationState: string; moderationNote: string | null;
  thumbnailUrl: string | null; fileUrl: string | null; previewUrls: string[];
  creator: { displayName: string; isVerified: boolean } | null;
  createdAt: string;
}

interface ModerationLog {
  id: number; fromState: string; toState: string; reason: string | null;
  adminNote: string | null; performedBy: string | null; createdAt: string;
}

function ModerationCard({ listing, onModerate }: {
  listing: Listing;
  onModerate: (id: number, state: "approved" | "rejected" | "suspended", reason?: string, note?: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [showLog, setShowLog] = useState(false);

  const { data: logData } = useQuery<{ items: ModerationLog[] }>({
    queryKey: ["cm2-mod-log", listing.id],
    queryFn: () => apiFetch(`/ai/cm2/listings/${listing.id}/moderation-log`),
    enabled: showLog,
  });

  return (
    <div className="bg-slate-800/50 border border-white/8 rounded-xl overflow-hidden">
      <div className="flex gap-4 p-4">
        {/* Preview */}
        <div className="flex-shrink-0 w-28 h-28 bg-slate-700/50 rounded-lg flex items-center justify-center overflow-hidden">
          {listing.thumbnailUrl ? (
            <img src={listing.thumbnailUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-4xl">📁</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div>
              <h3 className="text-sm font-semibold text-white">{listing.title}</h3>
              <p className="text-xs text-slate-500">{listing.listingCode} · {listing.itemType.replace(/_/g, " ")} · {listing.category}</p>
            </div>
            <span className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border text-amber-400 bg-amber-900/30 border-amber-700/40">
              <Clock className="w-3 h-3" /> Pending
            </span>
          </div>

          {listing.description && (
            <p className="text-xs text-slate-400 line-clamp-2 mb-2">{listing.description}</p>
          )}

          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-300 rounded">
              {listing.priceType === "free" ? "Free" : `${listing.currency} ${Number(listing.priceAmount).toLocaleString()}`}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-300 rounded">{listing.licenseType}</span>
            {listing.creator && (
              <span className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-300 rounded flex items-center gap-1">
                by {listing.creator.displayName}
                {listing.creator.isVerified && <CheckCircle className="w-2.5 h-2.5 text-indigo-400" />}
              </span>
            )}
          </div>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {listing.tags.slice(0, 5).map((t) => (
                <span key={t} className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-900/30 text-indigo-300 rounded-full">
                  <Tag className="w-2 h-2" />{t}
                </span>
              ))}
            </div>
          )}

          {listing.fileUrl && (
            <p className="text-xs text-slate-500 truncate">
              File: <span className="text-slate-400">{listing.fileUrl}</span>
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="border-t border-white/6 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason (optional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Quality standard met"
              className="w-full bg-slate-700 border border-white/8 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Admin Note (internal)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note…"
              className="w-full bg-slate-700 border border-white/8 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onModerate(listing.id, "approved", reason, note)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-medium transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Approve
          </button>
          <button
            onClick={() => onModerate(listing.id, "rejected", reason, note)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded text-xs font-medium transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" /> Reject
          </button>
          <button
            onClick={() => onModerate(listing.id, "suspended", reason, note)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded text-xs font-medium transition-colors"
          >
            <Ban className="w-3.5 h-3.5" /> Suspend
          </button>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="ml-auto text-xs text-slate-400 hover:text-white transition-colors"
          >
            {showLog ? "Hide" : "History"}
          </button>
        </div>

        {showLog && (
          <div className="mt-2 space-y-1">
            {!logData?.items.length && (
              <p className="text-xs text-slate-500 italic">No moderation history.</p>
            )}
            {logData?.items.map((log) => (
              <div key={log.id} className="text-xs text-slate-400 flex items-center gap-2">
                <span className="text-slate-600">{new Date(log.createdAt).toLocaleDateString()}</span>
                <span>{log.fromState} → {log.toState}</span>
                {log.reason && <span className="text-slate-500">"{log.reason}"</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CM2ModerationPage() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<{ items: Listing[]; total: number }>({
    queryKey: ["cm2-moderation-queue"],
    queryFn: () => apiFetch("/ai/cm2/moderation-queue"),
  });

  const moderateMut = useMutation({
    mutationFn: ({ id, state, reason, adminNote }: {
      id: number; state: string; reason?: string; adminNote?: string;
    }) => apiFetch(`/ai/cm2/listings/${id}/moderate`, {
      method: "POST",
      body: JSON.stringify({ state, reason, adminNote }),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cm2-moderation-queue"] });
      void qc.invalidateQueries({ queryKey: ["cm2-admin-listings"] });
    },
  });

  const handleModerate = (
    id: number,
    state: "approved" | "rejected" | "suspended",
    reason?: string,
    note?: string,
  ) => {
    moderateMut.mutate({ id, state, reason, adminNote: note });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-6 h-6 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Moderation Queue</h1>
            <p className="text-sm text-slate-500">Review pending listings before they go live</p>
          </div>
          {data && (
            <span className="ml-auto px-3 py-1 bg-amber-900/30 border border-amber-700/40 rounded-full text-sm text-amber-400 font-medium">
              {data.total} pending
            </span>
          )}
        </div>

        {isLoading && (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-slate-800/50 rounded-xl h-48 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="text-center py-20">
            <X className="w-10 h-10 text-red-400 mx-auto mb-2" />
            <p className="text-slate-400">Failed to load moderation queue.</p>
          </div>
        )}

        {!isLoading && !isError && data?.items.length === 0 && (
          <div className="text-center py-20">
            <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-white mb-1">Queue is clear!</h2>
            <p className="text-slate-400">No listings pending moderation.</p>
          </div>
        )}

        <div className="space-y-4">
          {data?.items.map((l) => (
            <ModerationCard key={l.id} listing={l} onModerate={handleModerate} />
          ))}
        </div>
      </div>
    </div>
  );
}
