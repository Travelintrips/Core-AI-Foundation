/**
 * VendorAdminPage — Team 22 (Admin Dashboard)
 * Route: /creative-vendors  (registered by Team 24 in ai-platform App.tsx)
 *
 * Admin list with moderation controls: approve, reject, filter by status.
 */
import { useState } from 'react';
import { CheckCircle, XCircle, Clock, Filter, Search, BarChart3, Users } from 'lucide-react';

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';
const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-api-key': ADMIN_KEY,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((b['error'] as string) ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

type ModerationStatus = 'pending' | 'approved' | 'rejected';

interface VendorAdminRow {
  id: number;
  vendorCode: string;
  displayName: string;
  brandName: string | null;
  vendorType: string;
  city: string | null;
  province: string | null;
  moderationStatus: ModerationStatus;
  status: string;
  isVerified: boolean;
  isFeatured: boolean;
  avgRating: string;
  totalRatings: number;
  totalContactRequests: number;
  createdAt: string;
}

const STATUS_CONFIG = {
  pending: { label: 'Menunggu', icon: Clock, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  approved: { label: 'Disetujui', icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  rejected: { label: 'Ditolak', icon: XCircle, color: 'text-destructive bg-destructive/10 border-destructive/20' },
} as const;

function StatusBadge({ status }: { status: ModerationStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

export default function VendorAdminPage() {
  const [filter, setFilter] = useState<ModerationStatus | ''>('pending');
  const [search, setSearch] = useState('');
  const [vendors, setVendors] = useState<VendorAdminRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [analytics, setAnalytics] = useState<{
    summary: { total: number; approved: number; pending: number; rejected: number; verified: number };
  } | null>(null);

  // Initial load effect
  useState(() => {
    void loadVendors();
    void loadAnalytics();
  });

  async function loadVendors() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (filter) qs.set('moderationStatus', filter);
      const data = await apiFetch<{ items: VendorAdminRow[] }>(`/ai/creative-vendors?${qs}`);
      setVendors(data.items.filter((v) =>
        !search || v.displayName.toLowerCase().includes(search.toLowerCase()),
      ));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalytics() {
    try {
      const data = await apiFetch<typeof analytics>('/ai/creative-vendors/analytics');
      setAnalytics(data);
    } catch { /* non-critical */ }
  }

  async function handleApprove(id: number) {
    try {
      await apiFetch(`/ai/creative-vendors/${id}/approve`, { method: 'POST' });
      setVendors((prev) =>
        prev.map((v) => (v.id === id ? { ...v, moderationStatus: 'approved' } : v)),
      );
    } catch (e) {
      alert(`Gagal approve: ${(e as Error).message}`);
    }
  }

  async function handleReject() {
    if (!rejectModal || !rejectReason.trim()) return;
    try {
      await apiFetch(`/ai/creative-vendors/${rejectModal.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      });
      setVendors((prev) =>
        prev.map((v) =>
          v.id === rejectModal.id ? { ...v, moderationStatus: 'rejected' } : v,
        ),
      );
      setRejectModal(null);
      setRejectReason('');
    } catch (e) {
      alert(`Gagal reject: ${(e as Error).message}`);
    }
  }

  const filtered = vendors.filter((v) =>
    !search || v.displayName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> Creative Vendors
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Moderasi dan kelola vendor kreatif</p>
        </div>
        <button
          onClick={() => { void loadVendors(); }}
          className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Refresh
        </button>
      </div>

      {/* Analytics cards */}
      {analytics?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: analytics.summary.total, color: 'text-foreground' },
            { label: 'Disetujui', value: analytics.summary.approved, color: 'text-emerald-600' },
            { label: 'Menunggu', value: analytics.summary.pending, color: 'text-amber-600' },
            { label: 'Ditolak', value: analytics.summary.rejected, color: 'text-destructive' },
            { label: 'Terverifikasi', value: analytics.summary.verified, color: 'text-blue-600' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari vendor..."
            className="pl-8 pr-3 py-1.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex gap-1">
          {(['', 'pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setFilter(s); void loadVendors(); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${filter === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {s === '' ? 'Semua' : STATUS_CONFIG[s]?.label ?? s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}

      {!loading && (
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Vendor</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Tipe</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Lokasi</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Rating</th>
                <th className="px-4 py-3 text-left font-semibold text-xs text-muted-foreground">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((v) => (
                <tr key={v.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium">{v.displayName}</p>
                    <p className="text-xs text-muted-foreground">{v.vendorCode}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{v.vendorType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{v.city ?? '–'}{v.province ? `, ${v.province}` : ''}</td>
                  <td className="px-4 py-3"><StatusBadge status={v.moderationStatus} /></td>
                  <td className="px-4 py-3 text-xs">{parseFloat(v.avgRating) > 0 ? `⭐ ${parseFloat(v.avgRating).toFixed(1)} (${v.totalRatings})` : '–'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {v.moderationStatus === 'pending' && (
                        <>
                          <button
                            onClick={() => handleApprove(v.id)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => setRejectModal({ id: v.id, name: v.displayName })}
                            className="px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {v.moderationStatus === 'approved' && (
                        <button
                          onClick={() => setRejectModal({ id: v.id, name: v.displayName })}
                          className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors"
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Tidak ada vendor ditemukan.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md p-6 space-y-4">
            <h2 className="font-bold">Tolak Vendor</h2>
            <p className="text-sm text-muted-foreground">
              Masukkan alasan penolakan untuk <strong>{rejectModal.name}</strong>.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Alasan penolakan..."
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="px-4 py-2 rounded-xl border border-border text-sm hover:bg-muted">
                Batal
              </button>
              <button
                onClick={() => { void handleReject(); }}
                disabled={!rejectReason.trim()}
                className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90"
              >
                Tolak Vendor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
