/**
 * Creative Marketplace V2 — Creator management (AI Platform)
 * Route: /creative-marketplace-v2/creators
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, CheckCircle, X, Globe, Mail, Star, ShoppingBag, Pencil } from "lucide-react";

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

interface Creator {
  id: number; creator_code: string; display_name: string;
  bio: string | null; avatar_url: string | null; website_url: string | null;
  email: string | null; is_verified: boolean; is_active: boolean;
  total_listings: number; total_downloads: number; avg_rating: string;
  created_at: string;
}

// ── Create creator dialog ────────────────────────────────────────────────────

function CreateCreatorDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    creatorCode: "", displayName: "", bio: "", email: "",
    avatarUrl: "", websiteUrl: "",
  });
  const [error, setError] = useState("");

  const mut = useMutation({
    mutationFn: () => apiFetch("/ai/cm2/creators", {
      method: "POST",
      body: JSON.stringify(form),
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Error"),
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-base font-bold text-white">Create Creator Profile</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          {error && <p className="text-sm text-red-400 bg-red-900/20 border border-red-700/30 rounded p-2">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Creator Code * (unique slug)</label>
              <input value={form.creatorCode} onChange={set("creatorCode")} placeholder="studio-arc"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Display Name *</label>
              <input value={form.displayName} onChange={set("displayName")} placeholder="Studio Arc"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email</label>
              <input value={form.email} onChange={set("email")} type="email" placeholder="creator@studio.com"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Website URL</label>
              <input value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="https://studio.com"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Avatar URL</label>
              <input value={form.avatarUrl} onChange={set("avatarUrl")} placeholder="https://cdn.example.com/avatar.jpg"
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Bio</label>
            <textarea value={form.bio} onChange={set("bio")} rows={3} placeholder="Short bio…"
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none" />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={!form.creatorCode || !form.displayName || mut.isPending}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {mut.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditCreatorModal({ creator, onClose, onSaved }: { creator: Creator; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    displayName: creator.display_name,
    bio: creator.bio ?? "",
    email: creator.email ?? "",
    avatarUrl: creator.avatar_url ?? "",
    websiteUrl: creator.website_url ?? "",
  });

  const mut = useMutation({
    mutationFn: () => apiFetch(`/ai/cm2/creators/${creator.id}`, {
      method: "PATCH",
      body: JSON.stringify(form),
    }),
    onSuccess: () => { onSaved(); onClose(); },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/8">
          <h2 className="text-base font-bold text-white">Edit Creator</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          {[
            { key: "displayName" as const, label: "Display Name" },
            { key: "email" as const, label: "Email", type: "email" },
            { key: "avatarUrl" as const, label: "Avatar URL" },
            { key: "websiteUrl" as const, label: "Website URL" },
          ].map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input value={form[key]} onChange={set(key)} type={type ?? "text"}
                className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
            </div>
          ))}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Bio</label>
            <textarea value={form.bio} onChange={set("bio")} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-sm text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {mut.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CM2CreatorsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Creator | null>(null);

  const { data, isLoading } = useQuery<{ items: Creator[]; total: number }>({
    queryKey: ["cm2-creators-admin"],
    queryFn: () => apiFetch("/ai/cm2/creators?limit=200"),
  });

  const verifyMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/ai/cm2/creators/${id}/verify`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cm2-creators-admin"] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["cm2-creators-admin"] });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      {showCreate && <CreateCreatorDialog onClose={() => setShowCreate(false)} onCreated={refresh} />}
      {editing && <EditCreatorModal creator={editing} onClose={() => setEditing(null)} onSaved={refresh} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Creator Profiles</h1>
            <p className="text-sm text-slate-500">Manage and verify marketplace creators</p>
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Creator
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800/50 border border-white/8 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Total Creators</p>
          <p className="text-2xl font-bold text-white">{data?.total ?? "—"}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/8 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Verified</p>
          <p className="text-2xl font-bold text-indigo-400">{data?.items.filter((c) => c.is_verified).length ?? "—"}</p>
        </div>
        <div className="bg-slate-800/50 border border-white/8 rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Active</p>
          <p className="text-2xl font-bold text-emerald-400">{data?.items.filter((c) => c.is_active).length ?? "—"}</p>
        </div>
      </div>

      {/* Creator cards */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-slate-800/50 rounded-xl h-40 animate-pulse" />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.items.map((creator) => (
          <div key={creator.id} className="bg-slate-800/50 border border-white/8 rounded-xl p-4 hover:border-indigo-500/30 transition-colors">
            <div className="flex items-start gap-3 mb-3">
              {creator.avatar_url ? (
                <img src={creator.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-sm font-semibold text-white truncate">{creator.display_name}</span>
                  {creator.is_verified && <CheckCircle className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />}
                </div>
                <p className="text-xs text-slate-500">{creator.creator_code}</p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => setEditing(creator)}
                  className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => verifyMut.mutate(creator.id)}
                  disabled={verifyMut.isPending}
                  className={`p-1.5 rounded hover:bg-slate-700 transition-colors ${
                    creator.is_verified ? "text-indigo-400" : "text-slate-400 hover:text-indigo-400"
                  }`}
                  title={creator.is_verified ? "Unverify" : "Verify"}
                >
                  <CheckCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {creator.bio && (
              <p className="text-xs text-slate-400 line-clamp-2 mb-3">{creator.bio}</p>
            )}

            <div className="flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <ShoppingBag className="w-3 h-3" />{creator.total_listings} listings
              </span>
              <span className="flex items-center gap-1">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />{parseFloat(creator.avg_rating).toFixed(1)}
              </span>
              {creator.email && (
                <span className="flex items-center gap-1 truncate max-w-[120px]">
                  <Mail className="w-3 h-3 flex-shrink-0" />{creator.email}
                </span>
              )}
              {creator.website_url && (
                <a
                  href={creator.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-indigo-400 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Globe className="w-3 h-3" />Site
                </a>
              )}
            </div>

            {!creator.is_active && (
              <div className="mt-2 text-xs text-orange-400 bg-orange-900/20 border border-orange-700/30 rounded px-2 py-1">
                Inactive
              </div>
            )}
          </div>
        ))}
      </div>

      {!isLoading && !data?.items.length && (
        <div className="text-center py-20">
          <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No creators yet. Add the first one!</p>
        </div>
      )}
    </div>
  );
}
