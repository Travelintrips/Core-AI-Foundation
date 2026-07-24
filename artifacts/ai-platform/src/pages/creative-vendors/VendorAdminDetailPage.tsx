/**
 * VendorAdminDetailPage — Team 22 (Admin Dashboard)
 * Route: /creative-vendors/:id  (registered by Team 24 in ai-platform App.tsx)
 *
 * Full vendor detail for admins: portfolio moderation, contact requests, edit.
 */
import { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, Clock, ChevronLeft,
  ImageIcon, MessageSquare, Edit3,
} from 'lucide-react';

const BASE = "";
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

function useVendorId(): number | null {
  const parts = window.location.pathname.split('/');
  const idx = parts.findIndex((p) => p === 'creative-vendors');
  if (idx === -1) return null;
  const id = parseInt(parts[idx + 1] ?? '', 10);
  return isNaN(id) ? null : id;
}

interface PortfolioItem {
  id: number;
  vendorId: number;
  title: string;
  coverImageUrl: string | null;
  moderationStatus: string;
  moderationNote: string | null;
  category: string | null;
  createdAt: string;
}

interface ContactRequest {
  id: number;
  requesterEmailHash: string;
  projectDescription: string;
  budgetRange: string | null;
  status: string;
  createdAt: string;
}

type Tab = 'portfolio' | 'contact-requests';

export default function VendorAdminDetailPage() {
  const vendorId = useVendorId();
  const [tab, setTab] = useState<Tab>('portfolio');
  const [vendor, setVendor] = useState<Record<string, unknown> | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioItem[]>([]);
  const [contactRequests, setContactRequests] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState<{ id: number; type: 'portfolio' } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    if (!vendorId) return;
    void loadAll();
  }, [vendorId]);

  async function loadAll() {
    if (!vendorId) return;
    setLoading(true);
    try {
      const [v, p, cr] = await Promise.all([
        apiFetch<{ vendor: Record<string, unknown> }>(`/ai/creative-vendors/${vendorId}`),
        apiFetch<{ items: PortfolioItem[] }>(`/ai/creative-vendors/${vendorId}/portfolio`),
        apiFetch<{ requests: ContactRequest[] }>(`/ai/creative-vendors/contact-requests?vendorId=${vendorId}`),
      ]);
      setVendor(v.vendor);
      setPortfolio(p.items);
      setContactRequests(cr.requests);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function approvePortfolio(itemId: number) {
    if (!vendorId) return;
    try {
      await apiFetch(`/ai/creative-vendors/${vendorId}/portfolio/${itemId}/approve`, { method: 'PATCH' });
      setPortfolio((prev) =>
        prev.map((p) => (p.id === itemId ? { ...p, moderationStatus: 'approved' } : p)),
      );
    } catch (e) { alert((e as Error).message); }
  }

  async function rejectPortfolio() {
    if (!rejectModal || !vendorId || !rejectReason.trim()) return;
    try {
      await apiFetch(`/ai/creative-vendors/${vendorId}/portfolio/${rejectModal.id}/reject`, {
        method: 'PATCH',
        body: JSON.stringify({ reason: rejectReason }),
      });
      setPortfolio((prev) =>
        prev.map((p) => (p.id === rejectModal.id ? { ...p, moderationStatus: 'rejected', moderationNote: rejectReason } : p)),
      );
      setRejectModal(null);
      setRejectReason('');
    } catch (e) { alert((e as Error).message); }
  }

  async function updateContactRequest(id: number, status: 'accepted' | 'declined') {
    try {
      await apiFetch(`/ai/creative-vendors/contact-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setContactRequests((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } catch (e) { alert((e as Error).message); }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Vendor tidak ditemukan.</p>
        <button onClick={() => history.back()} className="mt-2 flex items-center gap-1 text-sm text-primary hover:underline">
          <ChevronLeft className="w-4 h-4" /> Kembali
        </button>
      </div>
    );
  }

  const pendingPortfolio = portfolio.filter((p) => p.moderationStatus === 'pending').length;
  const pendingContacts = contactRequests.filter((r) => r.status === 'pending').length;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => history.back()} className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{vendor['displayName'] as string}</h1>
          <p className="text-xs text-muted-foreground">{vendor['vendorCode'] as string} · {(vendor['vendorType'] as string).replace(/_/g, ' ')}</p>
        </div>
        <div className="ml-auto flex gap-2">
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${vendor['moderationStatus'] === 'approved' ? 'bg-emerald-100 text-emerald-700' : vendor['moderationStatus'] === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-destructive/10 text-destructive'}`}>
            {vendor['moderationStatus'] as string}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { id: 'portfolio', label: 'Portfolio', count: pendingPortfolio, icon: ImageIcon },
          { id: 'contact-requests', label: 'Permintaan Kontak', count: pendingContacts, icon: MessageSquare },
        ] as const).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t.id ? 'text-primary border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
              {t.count > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Portfolio moderation */}
      {tab === 'portfolio' && (
        <div className="space-y-3">
          {portfolio.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card p-4 flex gap-4">
              <div className="shrink-0 w-20 h-16 rounded-lg bg-muted overflow-hidden">
                {item.coverImageUrl ? (
                  <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{item.title}</p>
                    {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    item.moderationStatus === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    item.moderationStatus === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-destructive/10 text-destructive'
                  }`}>{item.moderationStatus}</span>
                </div>
                {item.moderationNote && (
                  <p className="text-xs text-destructive mt-1">Alasan: {item.moderationNote}</p>
                )}
              </div>
              {item.moderationStatus === 'pending' && (
                <div className="shrink-0 flex flex-col gap-1">
                  <button onClick={() => approvePortfolio(item.id)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200">
                    Approve
                  </button>
                  <button onClick={() => setRejectModal({ id: item.id, type: 'portfolio' })}
                    className="px-2.5 py-1 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20">
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
          {portfolio.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Belum ada portfolio.</p>
          )}
        </div>
      )}

      {/* Contact requests */}
      {tab === 'contact-requests' && (
        <div className="space-y-3">
          {contactRequests.map((req) => (
            <div key={req.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{new Date(req.createdAt).toLocaleDateString('id-ID')}</p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  req.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                  req.status === 'declined' ? 'bg-destructive/10 text-destructive' : 'bg-amber-100 text-amber-700'
                }`}>{req.status}</span>
              </div>
              <p className="text-sm">{req.projectDescription}</p>
              {req.budgetRange && <p className="text-xs text-muted-foreground">Budget: {req.budgetRange}</p>}
              {req.status === 'pending' && (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => updateContactRequest(req.id, 'accepted')}
                    className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200">
                    Terima
                  </button>
                  <button onClick={() => updateContactRequest(req.id, 'declined')}
                    className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-muted/80">
                    Tolak
                  </button>
                </div>
              )}
            </div>
          ))}
          {contactRequests.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">Belum ada permintaan kontak.</p>
          )}
        </div>
      )}

      {/* Reject portfolio modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border w-full max-w-md p-6 space-y-4">
            <h2 className="font-bold">Tolak Portfolio Item</h2>
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
              <button onClick={() => { void rejectPortfolio(); }}
                disabled={!rejectReason.trim()}
                className="px-4 py-2 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium disabled:opacity-50">
                Tolak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
