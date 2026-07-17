/**
 * Creative Marketplace V2 — Admin listings management (AI Platform)
 * Route: /creative-marketplace-v2
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Plus, Search, ChevronDown, Star, Download,
  Eye, CheckCircle, XCircle, Clock, Ban, Sparkles, Pencil, X,
} from "lucide-react";

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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Listing {
  id: number; listingCode: string; itemType: string; title: string;
  category: string; priceType: string; priceAmount: string; currency: string;
  licenseType: string; moderationState: string; isActive: boolean;
  isFeatured: boolean; downloadsCount: number; viewsCount: number;
  favoritesCount: number; avgRating: string; ratingsCount: number;
  thumbnailUrl: string | null; fileUrl: string | null;
  creator: { displayName: string; isVerified: boolean } | null;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ITEM_TYPES = [
  "blueprint","template","pattern","icon","illustration","layout",
  "typography_pairing","palette","interior_material","furniture_reference",
  "fashion_motif","brand_pack",
];

const MOD_STATE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending:   { label: "Pending",   icon: <Clock className="w-3 h-3" />,     color: "text-amber-400 bg-amber-900/30 border-amber-700/40" },
  approved:  { label: "Approved",  icon: <CheckCircle className="w-3 h-3" />, color: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40" },
  rejected:  { label: "Rejected",  icon: <XCircle className="w-3 h-3" />,   color: "text-red-400 bg-red-900/30 border-red-700/40" },
  suspended: { label: "Suspended", icon: <Ban className="w-3 h-3" />,       color: "text-orange-400 bg-orange-900/30 border-orange-700/40" },
};

// ── Create dialog ─────────────────────────────────────────────────────────────

function CreateListingDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    listingCode: "", itemType: "blueprint", title: "", category: "",
    description: "", priceType: "free", priceAmount: "0", licenseType: "standard",
    fileUrl: "", thumbnailUrl: "", fileFormat: "", tags: "",
    creatorId: "",
  });
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () => apiFetch("/ai/cm2/listings", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : [],
        creatorId: form.creatorId || undefined,
        priceAmount: form.priceAmount,
      }),
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Error"),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-lg font-bold text-white">Create Listing</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded p-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Listing Code *</label>
              <input value={form.listingCode} onChange={set("listingCode")} placeholder="BP-001"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Item Type *</label>
              <select value={form.itemType} onChange={set("itemType")}
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                {ITEM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Title *</label>
              <input value={form.title} onChange={set("title")} placeholder="Modern Office Blueprint"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category *</label>
              <input value={form.category} onChange={set("category")} placeholder="architecture"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Creator ID</label>
              <input value={form.creatorId} onChange={set("creatorId")} placeholder="Leave empty for none" type="number"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Price Type</label>
              <select value={form.priceType} onChange={set("priceType")}
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="free">Free</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Price Amount (IDR)</label>
              <input value={form.priceAmount} onChange={set("priceAmount")} type="number" placeholder="0"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">License Type</label>
              <select value={form.licenseType} onChange={set("licenseType")}
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                <option value="standard">Standard</option>
                <option value="extended">Extended</option>
                <option value="exclusive">Exclusive</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">File Format</label>
              <input value={form.fileFormat} onChange={set("fileFormat")} placeholder="PDF, AI, PNG…"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Tags (comma-separated)</label>
              <input value={form.tags} onChange={set("tags")} placeholder="modern, office, minimal"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">File URL (internal)</label>
              <input value={form.fileUrl} onChange={set("fileUrl")} placeholder="https://storage.internal/..."
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Thumbnail URL</label>
              <input value={form.thumbnailUrl} onChange={set("thumbnailUrl")} placeholder="https://cdn.example.com/..."
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Description</label>
              <textarea value={form.description} onChange={set("description")} rows={3} placeholder="Describe this listing…"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => mut.mutate()}
              disabled={!form.listingCode || !form.title || !form.category || mut.isPending}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {mut.isPending ? "Creating…" : "Create Listing"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Moderate modal ────────────────────────────────────────────────────────────

function ModerateModal({ listing, onClose, onDone }: { listing: Listing; onClose: () => void; onDone: () => void }) {
  const [state, setState] = useState<"approved" | "rejected" | "suspended" | "pending">("approved");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const mut = useMutation({
    mutationFn: () => apiFetch(`/ai/cm2/listings/${listing.id}/moderate`, {
      method: "POST",
      body: JSON.stringify({ state, reason, adminNote: note }),
    }),
    onSuccess: () => { onDone(); onClose(); },
  });

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-base font-bold text-white">Moderate: {listing.title}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-2">New State</label>
            <div className="grid grid-cols-2 gap-2">
              {(["approved", "rejected", "suspended", "pending"] as const).map((s) => {
                const cfg = MOD_STATE_CONFIG[s]!;
                return (
                  <button
                    key={s}
                    onClick={() => setState(s)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      state === s ? cfg.color : "border-white/10 text-slate-400 hover:border-white/20"
                    }`}
                  >
                    {cfg.icon}{cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional reason"
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Admin Note (internal)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {mut.isPending ? "Saving…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────────────────────

function ListingRow({ listing, onModerate, onFeature }: {
  listing: Listing;
  onModerate: () => void;
  onFeature: () => void;
}) {
  const cfg = MOD_STATE_CONFIG[listing.moderationState] ?? MOD_STATE_CONFIG["pending"]!;
  return (
    <tr className="border-t border-white/6 hover:bg-white/2 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {listing.thumbnailUrl ? (
            <img src={listing.thumbnailUrl} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded bg-slate-700 flex-shrink-0 flex items-center justify-center text-lg">📁</div>
          )}
          <div>
            <p className="text-sm font-medium text-white">{listing.title}</p>
            <p className="text-xs text-slate-500">{listing.listingCode} · {listing.itemType.replace(/_/g, " ")}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${cfg.color}`}>
          {cfg.icon}{cfg.label}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-300">{listing.priceType === "free" ? "Free" : `IDR ${Number(listing.priceAmount).toLocaleString()}`}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{listing.licenseType}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="flex items-center gap-0.5"><Eye className="w-3 h-3" />{listing.viewsCount}</span>
          <span className="flex items-center gap-0.5"><Download className="w-3 h-3" />{listing.downloadsCount}</span>
          <span className="flex items-center gap-0.5"><Star className="w-3 h-3 fill-amber-400 text-amber-400" />{listing.avgRating}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onModerate}
            className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            title="Moderate"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onFeature}
            className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${listing.isFeatured ? "text-amber-400" : "text-slate-400 hover:text-amber-400"}`}
            title={listing.isFeatured ? "Remove from featured" : "Feature"}
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CM2AdminPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [itemType, setItemType] = useState("");
  const [modState, setModState] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [moderating, setModerating] = useState<Listing | null>(null);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (itemType) params.set("itemType", itemType);
  if (modState) params.set("moderationState", modState);
  params.set("limit", "100");

  const { data, isLoading } = useQuery<{ items: Listing[]; total: number }>({
    queryKey: ["cm2-admin-listings", search, itemType, modState],
    queryFn: () => apiFetch(`/ai/cm2/listings?${params.toString()}`),
  });

  const featureMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/cm2/listings/${id}/feature`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cm2-admin-listings"] }),
  });

  const { data: queueData } = useQuery<{ items: Listing[]; total: number }>({
    queryKey: ["cm2-moderation-queue"],
    queryFn: () => apiFetch("/ai/cm2/moderation-queue"),
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {showCreate && (
        <CreateListingDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["cm2-admin-listings"] })}
        />
      )}
      {moderating && (
        <ModerateModal
          listing={moderating}
          onClose={() => setModerating(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ["cm2-admin-listings", "cm2-moderation-queue"] })}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShoppingBag className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Creative Marketplace V2</h1>
            <p className="text-sm text-slate-500">Manage listings, moderate content, feature items</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> New Listing
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Listings", value: data?.total ?? "—", color: "text-white" },
          { label: "Pending Review", value: queueData?.total ?? "—", color: "text-amber-400" },
          { label: "Approved", value: data?.items.filter((l) => l.moderationState === "approved").length ?? "—", color: "text-emerald-400" },
          { label: "Rejected/Suspended", value: data?.items.filter((l) => ["rejected","suspended"].includes(l.moderationState)).length ?? "—", color: "text-red-400" },
        ].map((s) => (
          <div key={s.label} className="bg-slate-800/50 border border-white/8 rounded-xl p-4">
            <p className="text-xs text-slate-500 mb-1">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search listings…"
            className="w-full bg-slate-800 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="relative">
          <select value={itemType} onChange={(e) => setItemType(e.target.value)}
            className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-2 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">All Types</option>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={modState} onChange={(e) => setModState(e.target.value)}
            className="appearance-none bg-slate-800 border border-white/10 rounded-lg px-3 py-2 pr-7 text-sm text-white focus:outline-none focus:border-indigo-500">
            <option value="">All States</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="suspended">Suspended</option>
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900/50 border border-white/8 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-800/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Listing</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">State</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Price</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">License</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Stats</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-500">Loading…</td>
              </tr>
            )}
            {!isLoading && (!data?.items.length) && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-500">No listings found</td>
              </tr>
            )}
            {data?.items.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                onModerate={() => setModerating(l)}
                onFeature={() => featureMut.mutate(l.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
