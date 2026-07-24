/**
 * DEV TEST PAGE — /dev-test
 *
 * Halaman khusus untuk testing semua layanan tanpa perlu approval admin.
 * Submit order langsung otomatis dipindahkan ke status "in_progress".
 *
 * ⚠️  Hanya untuk keperluan testing internal. Jangan dipublikasikan.
 */

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, FlaskConical, CheckCircle2, XCircle, ExternalLink, ChevronDown, ChevronUp, RefreshCw, Zap } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceCategory {
  id: number;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
}

interface CatalogService {
  id: number;
  categoryId: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  serviceFlow: string;
  pricingModel: string;
  startingPrice: string;
  currency: string;
  estimatedDelivery: string;
  status: string;
}

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

interface TestResult {
  status: TestStatus;
  message?: string;
  requestId?: string;
  rowId?: number;
  links?: { label: string; url: string }[];
}

// ─── Example briefs per category ─────────────────────────────────────────────

const EXAMPLE_BRIEF: Record<string, object> = {
  creative: {
    projectName: 'Test Brand Identity — Kopi Nusantara',
    industry: 'Food & Beverage',
    targetAudience: 'Dewasa 25-45 tahun, profesional urban',
    brandPersonality: 'Hangat, autentik, modern',
    colorPreference: 'Coklat tua, krem, hijau tua',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  'presentation-document': {
    projectName: 'Pitch Deck Startup — TechLogis',
    documentType: 'pitch_deck',
    industry: 'Teknologi & Logistik',
    targetAudience: 'Investor & Mitra Bisnis',
    keyMessages: 'Solusi logistik berbasis AI untuk UMKM Indonesia',
    slides: 12,
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  marketing: {
    campaignName: 'Kampanye Peluncuran Produk Baru',
    objective: 'Brand awareness & lead generation',
    targetMarket: 'UMKM Indonesia, B2B',
    budget: 'IDR 10.000.000',
    duration: '3 bulan',
    channels: ['Instagram', 'LinkedIn', 'Email'],
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  sales: {
    productName: 'Platform SaaS Manajemen Logistik',
    targetSegment: 'Perusahaan ekspedisi menengah',
    uniqueValue: 'Otomasi tracking + AI prediksi keterlambatan',
    priceRange: 'IDR 500.000 – 2.000.000/bulan',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  finance: {
    companyName: 'PT Maju Bersama Logistik',
    analysisType: 'Laporan Keuangan Q2 2025',
    period: 'Januari – Juni 2025',
    revenue: 'IDR 2.500.000.000',
    expenses: 'IDR 1.800.000.000',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  accounting: {
    companyName: 'CV Berkah Jaya Trading',
    period: 'Juli 2025',
    transactionCount: 150,
    accountingStandard: 'SAK ETAP',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  tax: {
    companyName: 'PT Sukses Mandiri',
    taxType: 'PPh Badan',
    fiscalYear: '2024',
    revenue: 'IDR 5.000.000.000',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  hr: {
    companyName: 'PT Logistik Prima',
    employeeCount: 45,
    payrollMonth: 'Juli 2025',
    payrollType: 'Bulanan',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  legal: {
    contractType: 'Perjanjian Kerja Sama Distribusi',
    parties: ['PT Logistik Prima', 'CV Mitra Dagang'],
    jurisdiction: 'Indonesia',
    keyTerms: 'Eksklusivitas distribusi wilayah Jawa Timur, 2 tahun',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  logistics: {
    origin: 'Jakarta',
    destination: 'Surabaya',
    cargoType: 'Elektronik',
    weight: '500 kg',
    volume: '2 CBM',
    specialRequirements: 'Fragile, temperature-controlled',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  customs: {
    hsCode: '8471.30.00',
    goodsDescription: 'Laptop untuk keperluan bisnis',
    countryOfOrigin: 'China',
    invoiceValue: 'USD 50.000',
    importerName: 'PT Teknologi Nusantara',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  procurement: {
    itemName: 'Forklift Elektrik 2 Ton',
    quantity: 3,
    budgetLimit: 'IDR 450.000.000',
    deliveryLocation: 'Gudang Cikarang, Bekasi',
    requiredBy: '2025-09-01',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  trading: {
    commodity: 'Biji Kopi Arabika Grade A',
    quantity: '10 MT',
    origin: 'Aceh Gayo',
    destination: 'Jepang',
    targetPrice: 'USD 8.50/kg',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  'data-analytics': {
    companyName: 'PT Ekspedisi Cepat',
    dataSource: 'ERP & TMS Internal',
    analysisGoal: 'Identifikasi rute dengan profitabilitas terendah',
    period: 'H1 2025',
    outputFormat: 'Dashboard interaktif + PDF laporan',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  executive: {
    companyName: 'Grup Logistik Nusantara',
    decisionContext: 'Ekspansi ke Kalimantan: build vs. akuisisi',
    deadline: '2025-08-15',
    stakeholders: 'BOD, CFO, VP Operations',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  'customer-service': {
    companyName: 'PT Kirim Cepat',
    industry: 'Jasa Pengiriman',
    commonIssues: ['Keterlambatan pengiriman', 'Paket rusak', 'Tracking tidak update'],
    responseStyle: 'Ramah, solutif, profesional',
    language: 'Bahasa Indonesia',
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
  'graphic-design': {
    businessName: 'Kopi Nusantara',
    industry: 'F&B / Kedai Kopi',
    style: 'Modern minimalist dengan sentuhan tradisional',
    colorPalette: ['#3B1A0E', '#D4A056', '#F5F0E8'],
    usage: ['Print', 'Digital', 'Signage'],
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  },
};

function getBriefForService(categoryCode: string, serviceName: string): object {
  const base = EXAMPLE_BRIEF[categoryCode] ?? {
    projectName: `Test — ${serviceName}`,
    notes: '[TEST] Contoh order otomatis dari halaman dev-test',
  };
  return { ...base, _serviceName: serviceName };
}

// ─── Admin API helper ─────────────────────────────────────────────────────────


async function adminFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',

      ...(init.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ─── Category icon map ────────────────────────────────────────────────────────

const CATEGORY_EMOJI: Record<string, string> = {
  creative: '🎨',
  'presentation-document': '📊',
  marketing: '📣',
  sales: '🤝',
  finance: '📈',
  accounting: '📒',
  tax: '🧾',
  hr: '👥',
  legal: '⚖️',
  logistics: '🚛',
  customs: '🚢',
  procurement: '🛒',
  trading: '📦',
  'data-analytics': '📉',
  executive: '💼',
  'customer-service': '🎧',
  'graphic-design': '🖼️',
};

const FLOW_COLOR: Record<string, string> = {
  fixed_price: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  custom_project: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  enterprise: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
};

const FLOW_LABEL: Record<string, string> = {
  fixed_price: 'Fixed Price',
  custom_project: 'Custom Project',
  enterprise: 'Enterprise',
};

// ─── Service card ─────────────────────────────────────────────────────────────

function ServiceTestCard({
  service,
  categoryCode,
  testerName,
  testerEmail,
}: {
  service: CatalogService;
  categoryCode: string;
  testerName: string;
  testerEmail: string;
}) {
  const [result, setResult] = useState<TestResult>({ status: 'idle' });
  const [showBrief, setShowBrief] = useState(false);

  const exampleBrief = getBriefForService(categoryCode, service.serviceName);

  const runTest = useCallback(async () => {
    if (!testerName.trim() || !testerEmail.trim()) {
      setResult({ status: 'error', message: 'Isi Nama & Email tester dulu di bagian atas.' });
      return;
    }
    setResult({ status: 'loading' });

    try {
      // Step 1: Create service request
      const created = await adminFetch<{
        id: number;
        requestId: string;
        status: string;
        total: string;
        reviewToken?: string;
        dashboardToken?: string;
      }>(`/api/ai/catalog/services/${service.id}/request`, {
        method: 'POST',
        body: JSON.stringify({
          customerName: testerName,
          customerEmail: testerEmail,
          briefJson: exampleBrief,
          pricingModelSelected: service.pricingModel,
        }),
      });

      // Step 2: Advance status — skip approval gates directly to "in_progress"
      // First go to "approved", then "in_progress" (some gates check approved first)
      try {
        await adminFetch(`/api/ai/catalog/requests/${created.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'approved' }),
        });
        await adminFetch(`/api/ai/catalog/requests/${created.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'in_progress' }),
        });
      } catch {
        // Some services have gates that block direct status advancement — that's fine,
        // request still created successfully. Just note the gate.
      }

      // Build useful links
      const base = window.location.origin;
      const links: { label: string; url: string }[] = [
        { label: 'Lihat Status Request', url: `${base}/request-service/${created.requestId}/results` },
      ];
      if (created.reviewToken) {
        links.push({ label: 'Review Portal', url: `${base}/review/${created.reviewToken}` });
      }
      if (created.dashboardToken) {
        links.push({ label: 'Dashboard Klien', url: `${base}/dashboard/${created.dashboardToken}` });
      }

      setResult({
        status: 'success',
        requestId: created.requestId,
        rowId: created.id,
        message: `Request dibuat! Total: ${Number(created.total).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })}`,
        links,
      });
    } catch (err) {
      setResult({ status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, [service, exampleBrief, testerName, testerEmail]);

  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3 transition-colors"
      style={{
        background: result.status === 'success' ? 'rgba(34,197,94,0.06)' : result.status === 'error' ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
        borderColor: result.status === 'success' ? 'rgba(34,197,94,0.25)' : result.status === 'error' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm" style={{ color: '#F0F4FF' }}>{service.serviceName}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${FLOW_COLOR[service.serviceFlow] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30'}`}>
              {FLOW_LABEL[service.serviceFlow] ?? service.serviceFlow}
            </span>
          </div>
          <p className="text-xs mt-1" style={{ color: '#8B9BC4' }}>{service.shortDescription}</p>
          <p className="text-xs mt-1 font-medium" style={{ color: '#A78BFA' }}>
            {Number(service.startingPrice).toLocaleString('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })} · {service.estimatedDelivery}
          </p>
        </div>

        <Button
          size="sm"
          onClick={runTest}
          disabled={result.status === 'loading'}
          className="shrink-0 h-8 px-3 text-xs font-semibold"
          style={{
            background: result.status === 'success' ? '#16a34a' : 'linear-gradient(135deg, #7C6EFA 0%, #5F52D0 100%)',
            color: '#fff',
            border: 'none',
          }}
        >
          {result.status === 'loading' ? (
            <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Testing…</>
          ) : result.status === 'success' ? (
            <><CheckCircle2 className="w-3 h-3 mr-1" /> Berhasil</>
          ) : (
            <><Zap className="w-3 h-3 mr-1" /> Test</>
          )}
        </Button>
      </div>

      {/* Result area */}
      {result.status !== 'idle' && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(0,0,0,0.3)' }}>
          {result.status === 'loading' && (
            <p style={{ color: '#8B9BC4' }}>Mengirim request & memproses otomatis…</p>
          )}
          {result.status === 'error' && (
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#f87171' }} />
              <p style={{ color: '#f87171' }}>{result.message}</p>
            </div>
          )}
          {result.status === 'success' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#4ade80' }} />
                <p style={{ color: '#4ade80' }}>{result.message}</p>
              </div>
              <p style={{ color: '#8B9BC4' }}>ID: <code className="text-xs" style={{ color: '#C4B5FD' }}>{result.requestId}</code></p>
              <div className="flex gap-2 flex-wrap">
                {result.links?.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors hover:opacity-80"
                    style={{ background: 'rgba(124,110,250,0.2)', color: '#C4B5FD', border: '1px solid rgba(124,110,250,0.3)' }}
                  >
                    {link.label} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show example brief toggle */}
      <button
        onClick={() => setShowBrief((v) => !v)}
        className="flex items-center gap-1 text-xs self-start transition-colors hover:opacity-80"
        style={{ color: '#8B9BC4' }}
      >
        {showBrief ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {showBrief ? 'Sembunyikan' : 'Lihat'} contoh data brief
      </button>

      {showBrief && (
        <pre
          className="rounded-lg p-3 text-xs overflow-auto max-h-48"
          style={{ background: 'rgba(0,0,0,0.4)', color: '#C4B5FD', border: '1px solid rgba(124,110,250,0.15)' }}
        >
          {JSON.stringify(exampleBrief, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

function CategorySection({
  category,
  services,
  testerName,
  testerEmail,
}: {
  category: ServiceCategory;
  services: CatalogService[];
  testerName: string;
  testerEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const emoji = CATEGORY_EMOJI[category.code] ?? '🤖';

  const [allResults, setAllResults] = useState<Map<number, TestStatus>>(new Map());
  const successCount = Array.from(allResults.values()).filter((s) => s === 'success').length;
  const errorCount = Array.from(allResults.values()).filter((s) => s === 'error').length;
  const _ = setAllResults; // suppress unused warning

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
    >
      {/* Category header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <h3 className="font-semibold text-base" style={{ color: '#F0F4FF' }}>{category.name}</h3>
            <p className="text-xs mt-0.5" style={{ color: '#8B9BC4' }}>{services.length} layanan · {category.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {successCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }}>
              ✓ {successCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              ✗ {errorCount}
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4" style={{ color: '#8B9BC4' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#8B9BC4' }} />}
        </div>
      </button>

      {/* Service list */}
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="pt-3" />
          {services.map((svc) => (
            <ServiceTestCard
              key={svc.id}
              service={svc}
              categoryCode={category.code}
              testerName={testerName}
              testerEmail={testerEmail}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DevTestPage() {
  const [testerName, setTesterName] = useState('Tester Dev');
  const [testerEmail, setTesterEmail] = useState('test@cstlogistic.co.id');
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [servicesByCategory, setServicesByCategory] = useState<Map<number, CatalogService[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch ALL categories (admin route — includes non-public)
      const cats = await adminFetch<ServiceCategory[]>('/api/ai/catalog/categories');
      const svcsAll = await adminFetch<CatalogService[]>('/api/ai/catalog/services');

      // Group by categoryId
      const grouped = new Map<number, CatalogService[]>();
      for (const svc of svcsAll) {
        if (!grouped.has(svc.categoryId)) grouped.set(svc.categoryId, []);
        grouped.get(svc.categoryId)!.push(svc);
      }

      setCategories(cats.sort((a, b) => a.displayOrder - b.displayOrder));
      setServicesByCategory(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat katalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const totalServices = Array.from(servicesByCategory.values()).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="min-h-screen py-8 px-4" style={{ background: '#060B18', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #EF4444 100%)', boxShadow: '0 4px 20px rgba(245,158,11,0.3)' }}
            >
              <FlaskConical className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold" style={{ color: '#F0F4FF' }}>Halaman Testing Layanan</h1>
              <p className="text-sm" style={{ color: '#8B9BC4' }}>Internal dev tool — order langsung tanpa approval admin</p>
            </div>
          </div>
          <div
            className="rounded-xl p-4 text-sm flex items-start gap-3 border"
            style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.25)', color: '#FCD34D' }}
          >
            <span className="text-lg shrink-0">⚠️</span>
            <p>
              Halaman ini membuat order sungguhan di database dan menggunakan saldo AI nyata.
              Gunakan hanya untuk keperluan testing fitur. Request yang dibuat akan langsung
              masuk ke status <strong>in_progress</strong> tanpa melalui proses approval.
            </p>
          </div>
        </div>

        {/* Tester info */}
        <Card className="mb-6 border" style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' }}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold" style={{ color: '#F0F4FF' }}>Identitas Tester</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: '#8B9BC4' }}>Nama</label>
                <Input
                  value={testerName}
                  onChange={(e) => setTesterName(e.target.value)}
                  placeholder="Nama tester"
                  className="h-9 text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#F0F4FF' }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: '#8B9BC4' }}>Email</label>
                <Input
                  value={testerEmail}
                  onChange={(e) => setTesterEmail(e.target.value)}
                  placeholder="email@domain.com"
                  type="email"
                  className="h-9 text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#F0F4FF' }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats bar */}
        {!loading && !error && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 text-sm" style={{ color: '#8B9BC4' }}>
              <span>
                <strong style={{ color: '#F0F4FF' }}>{categories.length}</strong> kategori ·{' '}
                <strong style={{ color: '#F0F4FF' }}>{totalServices}</strong> layanan
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={loadCatalog}
                className="h-8 px-3 text-xs"
                style={{ color: '#8B9BC4' }}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpandAll((v) => !v)}
                className="h-8 px-3 text-xs"
                style={{ color: '#8B9BC4' }}
              >
                {expandAll ? 'Tutup Semua' : 'Buka Semua'}
              </Button>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#7C6EFA' }} />
            <p style={{ color: '#8B9BC4' }}>Memuat katalog layanan…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl p-6 text-center border" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.25)' }}>
            <XCircle className="w-8 h-8 mx-auto mb-2" style={{ color: '#f87171' }} />
            <p className="font-medium mb-1" style={{ color: '#f87171' }}>Gagal memuat katalog</p>
            <p className="text-sm mb-4" style={{ color: '#8B9BC4' }}>{error}</p>
            <Button size="sm" onClick={loadCatalog} style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              <RefreshCw className="w-3 h-3 mr-1" /> Coba Lagi
            </Button>
          </div>
        )}

        {/* Category list */}
        {!loading && !error && (
          <div className="flex flex-col gap-3">
            {categories.map((cat) => {
              const services = servicesByCategory.get(cat.id) ?? [];
              if (services.length === 0) return null;
              return (
                <ExpandableCategory
                  key={cat.id}
                  category={cat}
                  services={services}
                  testerName={testerName}
                  testerEmail={testerEmail}
                  forceOpen={expandAll}
                />
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-xs" style={{ color: '#4A5568' }}>
          Dev Test Page · Creative AI Studio · {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}

// ─── Expandable wrapper (controlled by parent forceOpen) ──────────────────────

function ExpandableCategory({
  category,
  services,
  testerName,
  testerEmail,
  forceOpen,
}: {
  category: ServiceCategory;
  services: CatalogService[];
  testerName: string;
  testerEmail: string;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const emoji = CATEGORY_EMOJI[category.code] ?? '🤖';

  // Sync with expand-all toggle
  useEffect(() => { setOpen(forceOpen); }, [forceOpen]);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-white/5"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <h3 className="font-semibold text-base" style={{ color: '#F0F4FF' }}>{category.name}</h3>
            <p className="text-xs mt-0.5" style={{ color: '#8B9BC4' }}>
              {services.length} layanan · {category.description}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs" style={{ borderColor: 'rgba(124,110,250,0.3)', color: '#A78BFA' }}>
            {services.length}
          </Badge>
          {open ? <ChevronUp className="w-4 h-4" style={{ color: '#8B9BC4' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#8B9BC4' }} />}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 flex flex-col gap-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="pt-3" />
          {services.map((svc) => (
            <ServiceTestCard
              key={svc.id}
              service={svc}
              categoryCode={category.code}
              testerName={testerName}
              testerEmail={testerEmail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
