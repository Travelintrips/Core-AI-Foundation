/**
 * Goal Discovery API Adapter — Team 03
 *
 * Wraps the public Goal Taxonomy endpoints from Team 2:
 *   GET /api/ai/goals
 *   GET /api/ai/goals/:slug
 *   GET /api/ai/goals/:slug/services
 *
 * STATUS: WAITING FOR TEAM-02 INTEGRATION
 *
 * Team 2's Goal Taxonomy API is not yet available in this branch.
 * All functions below try the real endpoints first. When the API returns
 * 404 or a network error they fall back to the development fixture so
 * that Team 3 UI can be built and tested independently.
 *
 * To connect the real API: remove `USE_FIXTURE` and the fixture import.
 * No component changes are needed — the adapter boundary is here.
 */

// ── Public types (customer-facing view models, never raw DB rows) ────────────

export type GoalSummary = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  /** Emoji icon or lucide icon name supplied by the API */
  icon: string;
  imageUrl?: string | null;
  serviceCount: number;
  displayOrder: number;
};

export type GoalService = {
  id: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  serviceFlow: "fixed_price" | "custom_project" | "enterprise";
  startingPrice: string;
  currency: string;
  estimatedDelivery: string;
};

export type GoalDetail = GoalSummary & {
  description: string;
  services: GoalService[];
};

// ── Normalisation helpers ────────────────────────────────────────────────────

function normaliseGoal(raw: Record<string, unknown>): GoalSummary {
  return {
    id: Number(raw.id ?? 0),
    slug: String(raw.slug ?? ""),
    name: String(raw.name ?? ""),
    shortDescription: String(raw.short_description ?? raw.shortDescription ?? ""),
    icon: String(raw.icon ?? "🎯"),
    imageUrl: raw.image_url != null ? String(raw.image_url) : (raw.imageUrl != null ? String(raw.imageUrl) : null),
    serviceCount: Number(raw.service_count ?? raw.serviceCount ?? 0),
    displayOrder: Number(raw.display_order ?? raw.displayOrder ?? 0),
  };
}

function normaliseGoalService(raw: Record<string, unknown>): GoalService {
  return {
    id: Number(raw.id ?? 0),
    serviceCode: String(raw.service_code ?? raw.serviceCode ?? ""),
    serviceName: String(raw.service_name ?? raw.serviceName ?? ""),
    shortDescription: String(raw.short_description ?? raw.shortDescription ?? ""),
    serviceFlow: (raw.service_flow ?? raw.serviceFlow ?? "fixed_price") as GoalService["serviceFlow"],
    startingPrice: String(raw.starting_price ?? raw.startingPrice ?? "0"),
    currency: String(raw.currency ?? "IDR"),
    estimatedDelivery: String(raw.estimated_delivery ?? raw.estimatedDelivery ?? ""),
  };
}

// ── Development fixture (used while Team 2 API is absent) ───────────────────

const FIXTURE_GOALS: GoalSummary[] = [
  { id: 1, slug: "luncurkan-merek",        name: "Luncurkan Merek Saya",          shortDescription: "Bangun identitas merek yang kuat dari nol",                   icon: "🚀", serviceCount: 4, displayOrder: 1 },
  { id: 2, slug: "tingkatkan-identitas",   name: "Tingkatkan Identitas Merek",    shortDescription: "Perkuat visual dan pesan merek yang sudah ada",               icon: "✨", serviceCount: 3, displayOrder: 2 },
  { id: 3, slug: "konten-marketing",       name: "Buat Konten Marketing",         shortDescription: "Produksi konten siap pakai untuk kampanye bisnis Anda",       icon: "📢", serviceCount: 5, displayOrder: 3 },
  { id: 4, slug: "presentasi-bisnis",      name: "Siapkan Presentasi Bisnis",     shortDescription: "Buat deck profesional untuk investor atau klien penting",      icon: "📊", serviceCount: 2, displayOrder: 4 },
  { id: 5, slug: "kemasan-produk",         name: "Tingkatkan Kemasan Produk",     shortDescription: "Desain packaging yang menarik dan meningkatkan penjualan",    icon: "📦", serviceCount: 3, displayOrder: 5 },
  { id: 6, slug: "media-sosial",           name: "Bangun Kehadiran Media Sosial", shortDescription: "Strategi visual dan konten untuk semua platform sosial",       icon: "📱", serviceCount: 4, displayOrder: 6 },
  { id: 7, slug: "materi-bisnis",          name: "Desain Materi Bisnis",          shortDescription: "Kartu nama, letterhead, dan materi cetak profesional",        icon: "🎨", serviceCount: 3, displayOrder: 7 },
  { id: 8, slug: "profil-perusahaan",      name: "Buat Profil Perusahaan",        shortDescription: "Dokumen company profile yang memukau untuk klien dan mitra",  icon: "🏢", serviceCount: 2, displayOrder: 8 },
];

const FIXTURE_DETAIL: Record<string, Pick<GoalDetail, "description" | "services">> = {
  "luncurkan-merek": {
    description: "Dari logo pertama Anda hingga panduan merek yang lengkap — kami membantu Anda membangun identitas yang berkesan dan konsisten di semua saluran.",
    services: [
      { id: 1, serviceCode: "BRAND_LOGO",    serviceName: "Branding & Logo",          shortDescription: "Logo profesional dengan panduan merek lengkap",            serviceFlow: "fixed_price",    startingPrice: "500000",  currency: "IDR", estimatedDelivery: "3-5 hari" },
      { id: 2, serviceCode: "BRAND_KIT",     serviceName: "Brand Kit Lengkap",         shortDescription: "Palet warna, tipografi, dan aset merek siap pakai",       serviceFlow: "custom_project", startingPrice: "1500000", currency: "IDR", estimatedDelivery: "5-7 hari" },
      { id: 3, serviceCode: "BIZ_CARD",      serviceName: "Kartu Nama Profesional",    shortDescription: "Desain kartu nama dua sisi siap cetak",                    serviceFlow: "fixed_price",    startingPrice: "200000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
      { id: 4, serviceCode: "BRAND_GUIDE",   serviceName: "Panduan Merek",             shortDescription: "Panduan penggunaan merek untuk tim dan vendor",            serviceFlow: "custom_project", startingPrice: "2000000", currency: "IDR", estimatedDelivery: "7-10 hari" },
    ],
  },
  "tingkatkan-identitas": {
    description: "Evaluasi dan perbarui identitas visual Anda agar lebih relevan, modern, dan konsisten di semua titik sentuh pelanggan.",
    services: [
      { id: 1, serviceCode: "BRAND_LOGO",    serviceName: "Redesain Logo",             shortDescription: "Refresh logo Anda tanpa kehilangan esensi merek",          serviceFlow: "custom_project", startingPrice: "750000",  currency: "IDR", estimatedDelivery: "4-6 hari" },
      { id: 2, serviceCode: "BRAND_KIT",     serviceName: "Pembaruan Brand Kit",       shortDescription: "Update panduan visual agar sesuai tren terkini",           serviceFlow: "custom_project", startingPrice: "1200000", currency: "IDR", estimatedDelivery: "5-7 hari" },
      { id: 3, serviceCode: "BRAND_GUIDE",   serviceName: "Audit Merek",               shortDescription: "Analisis konsistensi merek Anda saat ini",                 serviceFlow: "fixed_price",    startingPrice: "500000",  currency: "IDR", estimatedDelivery: "2-3 hari" },
    ],
  },
  "konten-marketing": {
    description: "Buat aset konten berkualitas tinggi yang siap digunakan untuk iklan, media sosial, email, dan kampanye digital Anda.",
    services: [
      { id: 1, serviceCode: "SOC_CONTENT",   serviceName: "Konten Media Sosial",       shortDescription: "Set konten terdesain untuk Instagram, TikTok, dan LinkedIn", serviceFlow: "fixed_price",    startingPrice: "300000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
      { id: 2, serviceCode: "CAMPAIGN_IMG",  serviceName: "AI Image Campaign",         shortDescription: "Gambar kampanye AI untuk iklan digital",                   serviceFlow: "fixed_price",    startingPrice: "250000",  currency: "IDR", estimatedDelivery: "1 hari" },
      { id: 3, serviceCode: "MARKETING",     serviceName: "Creative Marketing",        shortDescription: "Materi pemasaran lengkap untuk berbagai kanal",             serviceFlow: "custom_project", startingPrice: "1000000", currency: "IDR", estimatedDelivery: "5-7 hari" },
      { id: 4, serviceCode: "WEBSITE_COPY",  serviceName: "Konten Website",            shortDescription: "Teks website yang menarik dan SEO-friendly",               serviceFlow: "fixed_price",    startingPrice: "400000",  currency: "IDR", estimatedDelivery: "2-3 hari" },
      { id: 5, serviceCode: "EMAIL_CAMP",    serviceName: "Template Email Marketing",  shortDescription: "Template email profesional untuk kampanye Anda",           serviceFlow: "fixed_price",    startingPrice: "350000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
    ],
  },
  "presentasi-bisnis": {
    description: "Impress investor, klien, atau mitra dengan deck presentasi yang dirancang secara profesional dan storytelling yang kuat.",
    services: [
      { id: 1, serviceCode: "PITCH_DECK",    serviceName: "Pitch Deck",                shortDescription: "Deck investor dengan desain premium dan narasi yang kuat",  serviceFlow: "custom_project", startingPrice: "2500000", currency: "IDR", estimatedDelivery: "5-7 hari" },
      { id: 2, serviceCode: "COMPANY_PROF",  serviceName: "Profil Perusahaan",         shortDescription: "Presentasi company profile untuk klien dan mitra",          serviceFlow: "custom_project", startingPrice: "1800000", currency: "IDR", estimatedDelivery: "7-10 hari" },
    ],
  },
  "kemasan-produk": {
    description: "Packaging yang tepat bisa meningkatkan persepsi nilai produk Anda secara signifikan. Kami merancang kemasan yang menarik di rak maupun di foto.",
    services: [
      { id: 1, serviceCode: "PACKAGING",     serviceName: "Desain Kemasan Produk",     shortDescription: "Desain kemasan 3D dan mockup siap cetak",                  serviceFlow: "custom_project", startingPrice: "1200000", currency: "IDR", estimatedDelivery: "4-6 hari" },
      { id: 2, serviceCode: "LABEL_DESIGN",  serviceName: "Desain Label Produk",       shortDescription: "Label produk profesional sesuai regulasi",                 serviceFlow: "fixed_price",    startingPrice: "400000",  currency: "IDR", estimatedDelivery: "2-3 hari" },
      { id: 3, serviceCode: "PACKAGING_3D",  serviceName: "Mockup Kemasan 3D",         shortDescription: "Visualisasi 3D realistis kemasan produk Anda",             serviceFlow: "fixed_price",    startingPrice: "500000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
    ],
  },
  "media-sosial": {
    description: "Bangun kehadiran yang kuat dan konsisten di semua platform sosial dengan strategi visual dan konten yang tepat sasaran.",
    services: [
      { id: 1, serviceCode: "SOC_CONTENT",   serviceName: "Konten Media Sosial",       shortDescription: "Set konten terdesain siap posting",                        serviceFlow: "fixed_price",    startingPrice: "300000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
      { id: 2, serviceCode: "SOC_STRATEGY",  serviceName: "Strategi Konten",           shortDescription: "Kalender konten 30 hari dengan panduan visual",            serviceFlow: "custom_project", startingPrice: "800000",  currency: "IDR", estimatedDelivery: "3-4 hari" },
      { id: 3, serviceCode: "HIGHLIGHT",     serviceName: "Highlight Cover Instagram", shortDescription: "Set cover highlights Instagram yang branded",               serviceFlow: "fixed_price",    startingPrice: "150000",  currency: "IDR", estimatedDelivery: "1 hari" },
      { id: 4, serviceCode: "CAMPAIGN_IMG",  serviceName: "AI Image Campaign",         shortDescription: "Gambar kampanye AI untuk feed dan story",                   serviceFlow: "fixed_price",    startingPrice: "250000",  currency: "IDR", estimatedDelivery: "1 hari" },
    ],
  },
  "materi-bisnis": {
    description: "Dari kartu nama hingga letterhead — semua materi cetak bisnis Anda dirancang secara konsisten dan profesional.",
    services: [
      { id: 1, serviceCode: "BIZ_CARD",      serviceName: "Kartu Nama",                shortDescription: "Kartu nama dua sisi siap cetak dalam 1-2 hari",           serviceFlow: "fixed_price",    startingPrice: "200000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
      { id: 2, serviceCode: "LETTERHEAD",    serviceName: "Kop Surat & Amplop",        shortDescription: "Template kop surat dan amplop perusahaan",                 serviceFlow: "fixed_price",    startingPrice: "300000",  currency: "IDR", estimatedDelivery: "1-2 hari" },
      { id: 3, serviceCode: "BROCHURE",      serviceName: "Brosur & Flyer",            shortDescription: "Brosur lipat tiga atau flyer promosi siap cetak",          serviceFlow: "fixed_price",    startingPrice: "350000",  currency: "IDR", estimatedDelivery: "2-3 hari" },
    ],
  },
  "profil-perusahaan": {
    description: "Tampilkan bisnis Anda secara profesional dengan dokumen company profile yang lengkap, informatif, dan visual yang memukau.",
    services: [
      { id: 1, serviceCode: "COMPANY_PROF",  serviceName: "Company Profile PDF",       shortDescription: "Dokumen profil perusahaan 16–24 halaman",                  serviceFlow: "custom_project", startingPrice: "1800000", currency: "IDR", estimatedDelivery: "7-10 hari" },
      { id: 2, serviceCode: "PITCH_DECK",    serviceName: "Presentasi Perusahaan",     shortDescription: "Deck ringkas perusahaan untuk pertemuan bisnis",            serviceFlow: "custom_project", startingPrice: "2000000", currency: "IDR", estimatedDelivery: "5-7 hari" },
    ],
  },
};

function fixtureDetail(slug: string): GoalDetail | null {
  const summary = FIXTURE_GOALS.find((g) => g.slug === slug);
  const detail = FIXTURE_DETAIL[slug];
  if (!summary || !detail) return null;
  return { ...summary, ...detail };
}

// ── API flag ─────────────────────────────────────────────────────────────────
// Set to false when Team 2 Goal API is confirmed in the integration branch.
const USE_FIXTURE = true;

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Public API functions ──────────────────────────────────────────────────────

/** Fetch all active goals. Falls back to fixture when Team 2 API is absent. */
export async function fetchGoals(signal?: AbortSignal): Promise<GoalSummary[]> {
  if (USE_FIXTURE) return FIXTURE_GOALS;
  try {
    const raw = await apiGet<{ goals: Record<string, unknown>[] }>("/api/ai/goals", signal);
    return (raw.goals ?? []).map(normaliseGoal);
  } catch {
    return FIXTURE_GOALS;
  }
}

/** Fetch a single goal with its services. Falls back to fixture. */
export async function fetchGoalDetail(slug: string, signal?: AbortSignal): Promise<GoalDetail | null> {
  if (USE_FIXTURE) return fixtureDetail(slug);
  try {
    const [summaryRaw, servicesRaw] = await Promise.all([
      apiGet<Record<string, unknown>>(`/api/ai/goals/${slug}`, signal),
      apiGet<{ services: Record<string, unknown>[] }>(`/api/ai/goals/${slug}/services`, signal),
    ]);
    const summary = normaliseGoal(summaryRaw);
    const services = (servicesRaw.services ?? []).map(normaliseGoalService);
    return {
      ...summary,
      description: String(summaryRaw.description ?? summary.shortDescription),
      services,
    };
  } catch {
    return fixtureDetail(slug);
  }
}
