/**
 * VendorProfilePage — Team 22
 * Route: /vendors/:id  (registered by Team 24 in App.tsx)
 *
 * Shows full vendor profile: gallery, portfolio (approved), capabilities,
 * certifications, ratings, contact request form (workspace-token-gated).
 */
import { useState } from 'react';
import {
  MapPin, Clock, Star, CheckCircle, Globe, Instagram,
  Phone, Mail, Briefcase, Award, ChevronLeft, Send,
} from 'lucide-react';
import {
import { SEOMeta } from "@/components/SEOMeta";
  useVendorDetail,
  useVendorPortfolio,
  useSubmitContactRequest,
  VENDOR_TYPE_LABELS,
  type VendorType,
} from '@/hooks/use-vendors';

// Pull vendor id from URL path /vendors/:id
function useVendorId(): number | null {
  const parts = window.location.pathname.split('/');
  const idx = parts.findIndex((p) => p === 'vendors');
  if (idx === -1) return null;
  const id = parseInt(parts[idx + 1] ?? '', 10);
  return isNaN(id) ? null : id;
}

function useWorkspaceToken(): string | undefined {
  const parts = window.location.pathname.split('/');
  const wi = parts.indexOf('workspace');
  return wi !== -1 && parts[wi + 1] ? parts[wi + 1] : undefined;
}

function StarRating({ rating, count }: { rating: string; count: number }) {
  const r = parseFloat(rating);
  if (r === 0) return <span className="text-xs text-muted-foreground">Belum ada rating</span>;
  return (
    <span className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`w-4 h-4 ${i < Math.round(r) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
      ))}
      <span className="ml-1 text-sm font-semibold">{r.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">({count} ulasan)</span>
    </span>
  );
}

// ── Contact request form ───────────────────────────────────────────────────────
function ContactForm({ vendorId, token }: { vendorId: number; token: string }) {
  const [form, setForm] = useState({
    requesterName: '',
    projectDescription: '',
    budgetRange: '',
    preferredStartDate: '',
  });
  const [sent, setSent] = useState(false);
  const mutation = useSubmitContactRequest(token);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.projectDescription.trim()) return;
    try {
      await mutation.mutateAsync({ vendorId, ...form });
      setSent(true);
    } catch { /* handled by mutation state */ }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center space-y-2">
        <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
        <p className="font-semibold text-emerald-600">Permintaan kontak terkirim!</p>
        <p className="text-xs text-muted-foreground">Vendor akan merespons dalam 1–2 hari kerja.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold mb-1">Nama Anda</label>
        <input
          type="text"
          value={form.requesterName}
          onChange={(e) => setForm((p) => ({ ...p, requesterName: e.target.value }))}
          placeholder="mis. Budi Santoso"
          className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold mb-1">Deskripsi Proyek <span className="text-destructive">*</span></label>
        <textarea
          value={form.projectDescription}
          onChange={(e) => setForm((p) => ({ ...p, projectDescription: e.target.value }))}
          placeholder="Ceritakan kebutuhan Anda..."
          rows={3}
          required
          className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold mb-1">Estimasi Budget</label>
          <input
            type="text"
            value={form.budgetRange}
            onChange={(e) => setForm((p) => ({ ...p, budgetRange: e.target.value }))}
            placeholder="mis. 2jt–5jt"
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1">Target Mulai</label>
          <input
            type="date"
            value={form.preferredStartDate}
            onChange={(e) => setForm((p) => ({ ...p, preferredStartDate: e.target.value }))}
            className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {mutation.error && (
        <p className="text-xs text-destructive">{(mutation.error as Error).message}</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !form.projectDescription.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
      >
        <Send className="w-4 h-4" />
        {mutation.isPending ? 'Mengirim...' : 'Kirim Permintaan Kontak'}
      </button>
      <p className="text-[10px] text-muted-foreground text-center">
        Info kontak lengkap hanya dibagikan setelah vendor menerima permintaan Anda.
      </p>
    </form>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function VendorProfilePage() {
  const vendorId = useVendorId();
  const token = useWorkspaceToken();
  const [activeTab, setActiveTab] = useState<'portfolio' | 'capabilities' | 'ratings'>('portfolio');

  const { data: vendor, isLoading, isError } = useVendorDetail(vendorId);
  const { data: portfolio } = useVendorPortfolio(vendorId);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isError || !vendor) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Vendor tidak ditemukan.</p>
        <button onClick={() => history.back()} className="flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ChevronLeft className="w-4 h-4" /> Kembali
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOMeta
        title={vendor.displayName}
        description={vendor.description ?? `Lihat profil vendor kreatif ${vendor.displayName} — portofolio, layanan, dan informasi kontak.`}
        canonical={`/vendors/${vendor.id}`}
      />
      {/* Hero */}
      <div className="relative h-48 bg-muted overflow-hidden">
        {vendor.coverUrl && (
          <img src={vendor.coverUrl} alt={vendor.displayName} className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-10 space-y-6 pb-16">
        {/* Profile header */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-end gap-4">
            <div className="shrink-0 w-20 h-20 rounded-2xl border-4 border-card bg-muted overflow-hidden">
              {vendor.logoUrl ? (
                <img src={vendor.logoUrl} alt={vendor.displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-primary bg-primary/10">
                  {vendor.displayName[0]}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{vendor.displayName}</h1>
                {vendor.isVerified && (
                  <span className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                    <CheckCircle className="w-3 h-3" /> Verified
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {VENDOR_TYPE_LABELS[vendor.vendorType as VendorType] ?? vendor.vendorType}
                {vendor.city ? ` · ${vendor.city}, ${vendor.province}` : ''}
              </p>
              <StarRating rating={vendor.avgRating} count={vendor.totalRatings} />
            </div>
          </div>

          {vendor.description && (
            <p className="text-sm leading-relaxed text-muted-foreground">{vendor.description}</p>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <Clock className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">Lead Time</p>
              <p className="font-semibold text-sm">{vendor.leadTimeDays} hari</p>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${vendor.isAvailableNow ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-semibold text-sm">{vendor.isAvailableNow ? 'Tersedia' : 'Sibuk'}</p>
            </div>
            {vendor.minPrice && (
              <div className="rounded-xl bg-muted/50 p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">Mulai dari</p>
                <p className="font-semibold text-sm">Rp {vendor.minPrice.toLocaleString('id-ID')}</p>
              </div>
            )}
            <div className="rounded-xl bg-muted/50 p-3 text-center">
              <Briefcase className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-xs text-muted-foreground">Area</p>
              <p className="font-semibold text-sm">{vendor.serviceAreas.length > 0 ? `${vendor.serviceAreas.length} area` : 'Lihat profil'}</p>
            </div>
          </div>

          {/* External links */}
          <div className="flex gap-2 flex-wrap">
            {vendor.websiteUrl && (
              <a href={vendor.websiteUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs hover:bg-muted transition-colors">
                <Globe className="w-3 h-3" /> Website
              </a>
            )}
            {vendor.instagramUrl && (
              <a href={vendor.instagramUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs hover:bg-muted transition-colors">
                <Instagram className="w-3 h-3" /> Instagram
              </a>
            )}
            {vendor.contactWhatsapp && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs text-muted-foreground">
                <Phone className="w-3 h-3" /> {vendor.contactWhatsapp}
              </span>
            )}
            {vendor.contactEmail && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs text-muted-foreground">
                <Mail className="w-3 h-3" /> {vendor.contactEmail}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {(['portfolio', 'capabilities', 'ratings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors ${activeTab === tab ? 'text-primary border-b-2 border-primary -mb-px' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {tab === 'portfolio' ? 'Portfolio' : tab === 'capabilities' ? 'Kapabilitas' : 'Ulasan'}
            </button>
          ))}
        </div>

        {/* Tab: Portfolio */}
        {activeTab === 'portfolio' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(portfolio ?? []).map((item) => (
              <div key={item.id} className="rounded-2xl border border-border bg-card overflow-hidden">
                {item.coverImageUrl && (
                  <div className="h-40 bg-muted overflow-hidden">
                    <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="p-4 space-y-1.5">
                  <p className="font-semibold text-sm">{item.title}</p>
                  {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
                  <div className="flex gap-1 flex-wrap">
                    {(item.tagsJson ?? []).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                  {item.projectDurationDays && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {item.projectDurationDays} hari
                    </p>
                  )}
                </div>
              </div>
            ))}
            {(portfolio ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground col-span-2 text-center py-8">Belum ada portfolio.</p>
            )}
          </div>
        )}

        {/* Tab: Capabilities */}
        {activeTab === 'capabilities' && (
          <div className="space-y-4">
            {vendor.capabilities.map((cap, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">{cap.capabilityName}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    cap.proficiencyLevel === 'expert' ? 'bg-emerald-100 text-emerald-700' :
                    cap.proficiencyLevel === 'intermediate' ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'
                  }`}>{cap.proficiencyLevel}</span>
                </div>
                {cap.yearsExperience && <p className="text-xs text-muted-foreground">{cap.yearsExperience} tahun pengalaman</p>}
                {(cap.toolsJson ?? []).length > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {(cap.toolsJson ?? []).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {vendor.certifications.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Award className="w-4 h-4" /> Sertifikasi</h3>
                <div className="space-y-2">
                  {vendor.certifications.map((cert, i) => (
                    <div key={i} className="rounded-xl border border-border p-3 text-sm">
                      <p className="font-medium">{cert.certificationName}</p>
                      {cert.issuer && <p className="text-xs text-muted-foreground">{cert.issuer}</p>}
                      {cert.issuedAt && <p className="text-xs text-muted-foreground">Diterbitkan: {cert.issuedAt}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {vendor.capabilities.length === 0 && vendor.certifications.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Belum ada data kapabilitas.</p>
            )}
          </div>
        )}

        {/* Tab: Ratings */}
        {activeTab === 'ratings' && (
          <div className="space-y-3">
            {vendor.recentRatings.map((r, i) => (
              <div key={i} className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className={`w-3.5 h-3.5 ${s < r.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                  ))}
                  <span className="text-xs text-muted-foreground ml-1">{new Date(r.createdAt).toLocaleDateString('id-ID')}</span>
                </div>
                {r.projectContext && <p className="text-xs text-muted-foreground italic">{r.projectContext}</p>}
                {r.review && <p className="text-sm">{r.review}</p>}
              </div>
            ))}
            {vendor.recentRatings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Belum ada ulasan.</p>
            )}
          </div>
        )}

        {/* Contact form */}
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
          <h2 className="font-bold text-base">Hubungi Vendor</h2>
          {token ? (
            <ContactForm vendorId={vendor.id} token={token} />
          ) : (
            <div className="rounded-xl bg-muted/50 p-4 text-center text-sm text-muted-foreground">
              Login ke workspace Anda untuk mengirim permintaan kontak.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
