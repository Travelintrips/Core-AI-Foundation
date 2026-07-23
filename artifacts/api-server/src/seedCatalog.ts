/**
 * AI Service Catalog & Pricing Center — seed data.
 * Idempotent: upserts categories/services on unique code, packages on (serviceId, packageType).
 */
import { db, aiServiceCategoriesTable, aiServicesTable, aiServicePackagesTable, aiServicePriceRulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

type PricingModel = "one_time" | "monthly_subscription" | "yearly_subscription" | "enterprise_custom";

interface CategorySeed {
  code: string;
  name: string;
  description: string;
  icon: string;
  displayOrder: number;
  visibility?: string; // "public" | "internal" | "disabled" — defaults to "internal" in DB
  commercialStatus?: string; // "commercial_ready" | "internal_only" | "beta" | "disabled"
}

interface ServiceSeed {
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  fullDescription: string;
  serviceType: string;
  pricingModel: PricingModel;
  startingPrice: string;
  estimatedDelivery: string;
  humanReview: boolean;
  aiOnly: boolean;
  subscriptionSupported: boolean;
  enterpriseSupported: boolean;
  department: string;
  workflowSummary: string;
  aiEmployeesInvolved: string[];
  deliverables: string[];
  revisionPolicy: string;
  currency: string;
}

export const CATEGORIES: CategorySeed[] = [
  { code: "creative", name: "Creative AI", description: "Brand identity, design, and content production.", icon: "palette", displayOrder: 1, visibility: "public", commercialStatus: "commercial_ready" },
  { code: "presentation-document", name: "Presentation & Document AI", description: "Pitch deck, proposal, laporan, dan dokumen bisnis profesional.", icon: "file-text", displayOrder: 2, visibility: "public", commercialStatus: "commercial_ready" },
  { code: "marketing", name: "Marketing AI", description: "Campaigns, positioning, and growth strategy.", icon: "megaphone", displayOrder: 3 },
  { code: "sales", name: "Sales AI", description: "Lead qualification, proposals, and pipeline support.", icon: "handshake", displayOrder: 4 },
  { code: "finance", name: "Finance AI", description: "Financial analysis, forecasting, and reporting.", icon: "line-chart", displayOrder: 5 },
  { code: "accounting", name: "Accounting AI", description: "Bookkeeping, ledgers, and closing support.", icon: "book-open", displayOrder: 6 },
  { code: "tax", name: "Tax AI", description: "Indonesian tax compliance and planning.", icon: "receipt", displayOrder: 7 },
  { code: "hr", name: "HR & Payroll AI", description: "People operations and workforce support.", icon: "users", displayOrder: 8 },
  { code: "legal", name: "Legal AI", description: "Contracts, agreements, and due diligence.", icon: "scale", displayOrder: 9 },
  { code: "logistics", name: "Logistics AI", description: "Freight, shipment, and vendor coordination.", icon: "truck", displayOrder: 10 },
  { code: "customs", name: "Customs & PPJK AI", description: "Import/export compliance and classification.", icon: "ship", displayOrder: 11 },
  { code: "procurement", name: "Procurement AI", description: "Sourcing and purchasing support.", icon: "shopping-cart", displayOrder: 12 },
  { code: "trading", name: "Trading AI", description: "Market analysis and trading support.", icon: "trending-up", displayOrder: 13 },
  { code: "data-analytics", name: "Data Analytics AI", description: "Dashboards, insights, and reporting.", icon: "bar-chart", displayOrder: 14 },
  { code: "executive", name: "Executive AI", description: "Strategic decision support for leadership.", icon: "briefcase", displayOrder: 15 },
  { code: "customer-service", name: "Customer Service AI", description: "Support automation and client communication.", icon: "headset", displayOrder: 16 },
  { code: "graphic-design", name: "Graphic Design AI", description: "Professional print and digital design: logos, cards, flyers, banners, brochures, social kits, and more — AI-generated, brand-consistent, print-ready.", icon: "palette", displayOrder: 17, visibility: "public", commercialStatus: "commercial_ready" },
];

// Category-level disclaimers shown next to any service/quotation in that
// category — AI output is advisory and needs human/authority verification.
export const CATEGORY_DISCLAIMERS: Record<string, string> = {
  finance: "AI memberikan analisis pendukung, bukan keputusan keuangan final.",
  tax: "Hasil wajib diverifikasi petugas pajak atau konsultan yang berwenang.",
  legal: "Hasil AI bukan pengganti pendapat hukum profesional.",
  customs: "HS Code adalah kandidat rekomendasi dan memerlukan verifikasi PPJK atau pejabat/otoritas yang berwenang.",
  creative: "AI-generated concepts dapat memerlukan penyempurnaan desainer manusia untuk kebutuhan cetak, merek dagang, dan penggunaan komersial.",
};

export const SERVICES: Record<string, ServiceSeed[]> = {
  "presentation-document": [
    // ── Pitch Deck ───────────────────────────────────────────────────────────
    svc("pd-pitch-deck",          "Pitch Deck Presentasi",       "Presentasi pitch deck investor-ready dengan narasi visual profesional dan storytelling berbasis data.", "one_time", "120000", "3-5 hari",   true,  ["Creative Director AI", "Copywriter AI"], ["Pitch deck (PPTX)", "PDF export"]),
    // ── Business Proposal ────────────────────────────────────────────────────
    svc("pd-business-proposal",   "Proposal Bisnis",             "Proposal bisnis profesional dengan analisis kebutuhan, solusi terstruktur, dan estimasi anggaran.", "one_time", "75000",  "2-4 hari",   true,  ["Copywriter AI"], ["Business proposal PDF"]),
    // ── Company Profile Document ─────────────────────────────────────────────
    svc("pd-company-profile-doc", "Company Profile Dokumen",     "Dokumen company profile lengkap dengan profil perusahaan, portofolio, dan pencapaian untuk klien & mitra.", "one_time", "105000",  "4-6 hari",   true,  ["Copywriter AI", "Designer AI"], ["Company profile PDF (32+ halaman)"]),
    // ── Annual Report ────────────────────────────────────────────────────────
    svc("pd-annual-report",       "Laporan Tahunan",             "Laporan tahunan perusahaan dengan ringkasan kinerja, highlight finansial, dan narasi strategis.", "one_time", "225000", "7-10 hari",  true,  ["Copywriter AI", "Finance Analyst AI"], ["Annual report PDF"]),
    // ── Executive Summary ────────────────────────────────────────────────────
    svc("pd-executive-summary",   "Executive Summary",           "Ringkasan eksekutif proyek atau strategi bisnis untuk presentasi kepemimpinan.", "one_time", "45000",  "1-2 hari",   true,  ["Copywriter AI"], ["Executive summary PDF"]),
    // ── Product Catalog ──────────────────────────────────────────────────────
    svc("pd-product-catalog",     "Katalog Produk",              "Katalog produk profesional dengan deskripsi, spesifikasi, dan harga — siap cetak dan digital.", "one_time", "105000", "4-6 hari",   false, ["Designer AI", "Copywriter AI"], ["Product catalog PDF"]),
    // ── Meeting Deck ─────────────────────────────────────────────────────────
    svc("pd-meeting-deck",        "Deck Rapat / Presentasi Internal", "Presentasi rapat internal yang rapi: update proyek, status laporan, atau review bulanan.", "one_time", "45000",  "1-2 hari",   false, ["Copywriter AI"], ["Meeting deck (PPTX/PDF)"]),
    // ── Training Material ────────────────────────────────────────────────────
    svc("pd-training-material",   "Materi Pelatihan",            "Slide dan materi pelatihan internal untuk onboarding karyawan atau program training.", "one_time", "75000",  "3-5 hari",   true,  ["Copywriter AI", "Designer AI"], ["Training deck (PPTX)", "Handout PDF"]),
  ],
  creative: [
    svc("logo-design", "Konsep Logo AI", "3 konsep logo awal dengan arah warna, siap dikembangkan lebih lanjut.", "one_time", "45000", "1-2 hari", false, ["Creative Director AI", "Designer AI"], ["3 konsep logo", "1 arah warna", "PNG/JPG concept"]),
    svc("brand-identity", "Paket Identitas Brand", "Sistem identitas visual lengkap: logo, warna, tipografi, dan panduan pakai.", "one_time", "150000", "5-7 hari", true, ["Creative Director AI", "Designer AI", "Brand Strategist AI"], ["Brand guideline", "Logo suite", "Color & type system"]),
    svc("brand-strategy", "Strategi Brand", "Positioning, target audience, USP, dan tone of voice untuk brand Anda.", "one_time", "90000", "5-7 hari", true, ["Brand Strategist AI"], ["Brand strategy document", "Messaging framework"]),
    svc("social-media-design", "Desain Media Sosial", "Desain konten sosial media on-brand per batch.", "one_time", "45000", "1-3 hari", false, ["Designer AI"], ["Desain feed", "Headline/copy pendek"]),
    svc("company-profile", "Company Profile", "Dokumen company profile profesional dengan struktur dan copy.", "one_time", "75000", "4-6 hari", true, ["Designer AI", "Copywriter AI"], ["Company profile PDF"]),
    svc("pitch-deck", "Pitch Deck / Presentasi", "Pitch deck investor-ready dengan storytelling dan arah visual.", "one_time", "105000", "5-7 hari", true, ["Creative Director AI", "Copywriter AI"], ["Pitch deck (PDF/PPTX)"]),
    svc("packaging-design", "Konsep Kemasan", "Konsep desain kemasan produk sesuai brand Anda.", "one_time", "75000", "5-7 hari", true, ["Designer AI"], ["Visual concept kemasan"]),
    svc("poster-banner", "Poster / Banner / Brosur", "Desain poster, banner digital, atau brosur.", "one_time", "45000", "1-2 hari", false, ["Designer AI"], ["Poster/banner file"]),
    svc("copywriting", "Copywriting", "Copy on-brand untuk caption, landing page, atau kampanye.", "one_time", "45000", "1-3 hari", false, ["Copywriter AI"], ["Copy document"]),
    svc("image-generation", "Pembuatan Gambar AI", "Gambar AI untuk kampanye dan konten.", "one_time", "45000", "1-2 hari", false, ["Designer AI"], ["Image set"]),
    svc("creative-consultation", "Konsultasi Kreatif", "Sesi konsultasi kreatif strategis dengan human review.", "one_time", "45000", "1-2 hari", true, ["Creative Director AI"], ["Consultation notes"]),
    // ── Fashion Design Specialist services ──
    svc("fashion-brand-brief", "Fashion Design", "Brief koleksi fashion lengkap: narasi tema, arah estetik, target konsumen, dan panduan visual. Dikerjakan oleh Fashion Design Specialist AI (Claude Opus 4.8).", "one_time", "105000", "3-5 hari", true, ["Fashion Design Specialist AI"], ["Collection concept document", "Brand narrative", "Aesthetic direction guide"]),
    // ── Interior Design Specialist services ──
    svc("interior-concept-design", "Interior Design", "Konsep desain interior lengkap: suasana ruangan, palet material, gaya, dan narasi spasial. Dikerjakan oleh Interior Design Specialist AI (Gemini 2.5 Pro).", "one_time", "105000", "3-5 hari", true, ["Interior Design Specialist AI"], ["Interior concept document", "Material palette", "Spatial narrative"]),
    // ── Team 16: Presentation & Document Creative Services ──
    svc("proposal", "Proposal Bisnis", "Proposal bisnis profesional: latar belakang, ruang lingkup, deliverable, dan langkah selanjutnya. Anti-fabrikasi: tanpa angka harga atau pasal legal yang dikarang.", "one_time", "75000", "3-5 hari", true, ["Copywriter AI", "Brand Strategist AI"], ["Proposal PDF", "Executive summary"]),
    svc("product-catalog", "Katalog Produk / Layanan", "Katalog produk atau layanan on-brand: intro brand, kategori, fitur unggulan, dan informasi pemesanan. Tanpa daftar harga yang dikarang.", "one_time", "105000", "4-6 hari", true, ["Copywriter AI", "Designer AI"], ["Product catalog PDF"]),
    svc("annual-report", "Laporan Tahunan (Annual Report)", "Laporan tahunan perusahaan: pesan kepemimpinan, sorotan kinerja operasional, keberlanjutan, dan outlook. Anti-fabrikasi: tanpa angka keuangan, laporan audit, atau dividen yang dikarang.", "one_time", "225000", "7-10 hari", true, ["Copywriter AI", "Brand Strategist AI"], ["Annual report PDF"]),
    svc("whitepaper", "White Paper / Thought Leadership", "White paper atau thought leadership: abstrak, pengantar, analisis masalah, kerangka solusi, dan rekomendasi. Anti-fabrikasi: tanpa statistik atau sitasi pihak ketiga yang dikarang.", "one_time", "150000", "5-7 hari", true, ["Copywriter AI", "Brand Strategist AI"], ["Whitepaper PDF"]),
    svc("case-study", "Case Study / Studi Kasus", "Studi kasus klien profesional: latar belakang, tantangan, solusi, dan hasil. Hasil kuantitatif hanya dicantumkan jika disediakan klien — tidak dikarang.", "one_time", "105000", "4-6 hari", true, ["Copywriter AI", "Brand Strategist AI"], ["Case study PDF"]),
    svc("ebook", "E-Book / Panduan Edukasi", "E-book edukasi atau panduan thought leadership: pengantar, hingga 5 bab tematis, dan kesimpulan. Dilengkapi daftar isi yang dihasilkan dari bab nyata — tanpa statistik yang dikarang.", "one_time", "150000", "6-8 hari", true, ["Copywriter AI", "Brand Strategist AI"], ["E-book PDF", "Table of contents"]),
  ],
  marketing: [
    svc("marketing-plan", "Rencana Marketing", "Rencana marketing menyeluruh untuk brand atau produk Anda.", "one_time", "75000", "3-5 hari", false, ["Marketing Strategist AI"], ["Marketing plan document"]),
    svc("campaign-plan", "Rencana Kampanye", "Rencana kampanye marketing end-to-end.", "one_time", "120000", "3-5 hari", false, ["Marketing Strategist AI"], ["Campaign plan document"]),
    svc("content-calendar", "Kalender Konten 30 Hari", "Kalender konten 30 hari lintas kanal.", "one_time", "45000", "2-3 hari", false, ["Marketing Strategist AI"], ["Content calendar"]),
    svc("competitor-analysis", "Analisis Kompetitor", "Analisis kompetitor untuk strategi pemasaran.", "one_time", "105000", "3-5 hari", false, ["Marketing Strategist AI"], ["Competitor analysis report"]),
    svc("customer-persona", "Paket Persona Pelanggan", "Persona pelanggan berbasis riset untuk targeting.", "one_time", "75000", "2-4 hari", false, ["Marketing Strategist AI"], ["Customer persona document"]),
    svc("marketing-ai-monthly", "Marketing AI Bulanan", "Subscription strategi dan eksekusi marketing bulanan.", "monthly_subscription", "300000", "Ongoing, bulanan", true, ["Marketing Strategist AI"], ["Monthly marketing plan", "Human review"]),
  ],
  sales: [
    svc("lead-qualification", "Kualifikasi Leads", "Kualifikasi dan scoring leads masuk secara otomatis.", "monthly_subscription", "300000", "Ongoing, bulanan", false, ["Sales AI"], ["Qualified lead list"]),
    svc("proposal-drafting", "Penyusunan Proposal Penjualan", "Penyusunan proposal penjualan yang dipersonalisasi.", "one_time", "45000", "1-2 hari", false, ["Sales AI"], ["Proposal document"]),
    svc("sales-playbook", "Playbook Penjualan", "Playbook penjualan dengan skrip dan objection handling.", "one_time", "150000", "3-5 hari", true, ["Sales AI"], ["Sales playbook document"]),
  ],
  finance: [
    svc("financial-analysis", "Pemeriksaan Kesehatan Keuangan", "Analisis kesehatan keuangan secara menyeluruh.", "one_time", "150000", "3-5 hari", true, ["Finance Analyst AI"], ["Financial analysis report"]),
    svc("cashflow-analysis", "Analisis Cash Flow", "Analisis kesehatan cash flow dan rekomendasi.", "one_time", "150000", "2-4 hari", false, ["Finance Analyst AI"], ["Cashflow report"]),
    svc("budget-planning", "Review Anggaran vs Realisasi", "Perbandingan anggaran vs realisasi.", "one_time", "180000", "3-5 hari", true, ["Finance Analyst AI"], ["Budget review document"]),
    svc("forecasting", "Perkiraan Keuangan", "Model forecasting pendapatan dan pengeluaran.", "monthly_subscription", "600000", "3-5 hari", true, ["Finance Analyst AI"], ["Forecast model", "Monthly updates"]),
    svc("profitability-analysis", "Analisis Laba Rugi", "Analisis profitabilitas produk/segmen.", "one_time", "120000", "3-5 hari", false, ["Finance Analyst AI"], ["P&L analysis report"]),
    svc("bank-reconciliation", "Bantuan Rekonsiliasi Bank", "Rekonsiliasi otomatis laporan bank per periode.", "monthly_subscription", "450000", "Ongoing, bulanan", false, ["Finance Analyst AI"], ["Reconciliation report"]),
    svc("management-report", "Laporan Keuangan Manajemen", "Paket laporan manajemen bulanan.", "monthly_subscription", "450000", "Ongoing, bulanan", true, ["Finance Analyst AI"], ["Management report PDF"]),
  ],
  accounting: [
    svc("journal-review", "Review Jurnal", "Review hingga 100 transaksi jurnal untuk akurasi.", "one_time", "150000", "1-2 hari", true, ["Accounting AI"], ["Journal review notes"]),
    svc("general-ledger-analysis", "Review General Ledger", "Analisis akun general ledger.", "one_time", "180000", "2-4 hari", false, ["Accounting AI"], ["GL analysis report"]),
    svc("trial-balance-review", "Review Trial Balance", "Pemeriksaan akurasi trial balance.", "one_time", "180000", "1-3 hari", true, ["Accounting AI"], ["Trial balance review notes"]),
    svc("closing-assistance", "Bantuan Proses Closing", "Dukungan proses closing bulanan/tahunan.", "monthly_subscription", "600000", "Ongoing, per periode", true, ["Accounting AI"], ["Closing checklist", "Closing report"]),
    svc("account-reconciliation", "Rekonsiliasi Akun", "Rekonsiliasi akun per akun.", "one_time", "150000", "Ongoing, per akun", false, ["Accounting AI"], ["Reconciliation summary"]),
    svc("coa-recommendation", "Rekomendasi Chart of Accounts", "Rekomendasi desain chart of accounts.", "one_time", "150000", "2-3 hari", true, ["Accounting AI"], ["Recommended COA"]),
  ],
  tax: [
    svc("vat-review", "Review PPN", "Review filing PPN per periode.", "one_time", "150000", "2-3 hari", true, ["Tax AI"], ["VAT review report"]),
    svc("pph-analysis", "Review PPh", "Analisis dan rekomendasi PPh per periode.", "one_time", "150000", "2-4 hari", true, ["Tax AI"], ["PPh analysis report"]),
    svc("tax-reconciliation", "Rekonsiliasi Pajak", "Rekonsiliasi pajak per periode.", "one_time", "270000", "3-5 hari", true, ["Tax AI"], ["Tax reconciliation report"]),
    svc("tax-planning", "Perencanaan Pajak", "Strategi perencanaan pajak ke depan.", "one_time", "225000", "4-6 hari", true, ["Tax AI"], ["Tax planning document"]),
    svc("invoice-validation", "Review Faktur Pajak", "Validasi massal faktur pajak.", "one_time", "45000", "Ongoing, per dokumen", false, ["Tax AI"], ["Validation report"]),
    svc("spt-review", "Review Kesiapan SPT", "Review SPT sebelum submisi.", "one_time", "225000", "2-4 hari", true, ["Tax AI"], ["SPT review notes"]),
  ],
  hr: [
    svc("cv-screening", "Penyaringan CV", "Penyaringan CV otomatis per kandidat.", "one_time", "45000", "1-2 hari", false, ["HR AI"], ["Shortlist kandidat"]),
    svc("job-description", "Deskripsi Pekerjaan", "Penyusunan job description profesional.", "one_time", "45000", "1 hari", false, ["HR AI"], ["Job description document"]),
    svc("interview-package", "Paket Interview", "Paket pertanyaan dan panduan interview per role.", "one_time", "45000", "1-2 hari", false, ["HR AI"], ["Interview guide"]),
    svc("payroll-review", "Review Payroll", "Review payroll per periode.", "one_time", "150000", "2-3 hari", true, ["HR AI"], ["Payroll review report"]),
    svc("performance-summary", "Ringkasan Performa", "Ringkasan performa karyawan.", "one_time", "45000", "1-2 hari", false, ["HR AI"], ["Performance summary report"]),
    svc("hr-ai-monthly", "HR AI Bulanan", "Subscription dukungan HR & payroll bulanan.", "monthly_subscription", "300000", "Ongoing, bulanan", true, ["HR AI"], ["Monthly HR support"]),
  ],
  logistics: [
    svc("freight-planning", "Analisis Biaya Freight", "Analisis biaya freight per rute.", "one_time", "75000", "2-4 hari", false, ["Logistics AI"], ["Freight cost report"]),
    svc("vendor-comparison", "Perbandingan Vendor", "Perbandingan penawaran vendor logistik.", "one_time", "45000", "1-2 hari", false, ["Logistics AI"], ["Vendor comparison sheet"]),
    svc("shipment-exception", "Analisis Pengecualian Pengiriman", "Analisis kasus pengecualian pengiriman.", "one_time", "45000", "1-2 hari", false, ["Logistics AI"], ["Exception analysis report"]),
    svc("rfq-generation", "Pembuatan RFQ", "Pembuatan dokumen RFQ otomatis.", "one_time", "45000", "1-2 hari", false, ["Logistics AI"], ["RFQ document"]),
    svc("logistics-ai-monthly", "Logistics AI Bulanan", "Subscription dukungan logistik bulanan.", "monthly_subscription", "450000", "Ongoing, bulanan", true, ["Logistics AI"], ["Monthly logistics support"]),
  ],
  customs: [
    svc("hs-code-classification", "Analisis Kandidat HS Code", "Kandidat klasifikasi HS Code dengan confidence score.", "one_time", "45000", "1-2 hari", true, ["Customs AI"], ["HS code candidate report"]),
    svc("import-compliance", "Checklist Persyaratan Impor", "Checklist persyaratan impor per komoditas.", "one_time", "75000", "2-4 hari", true, ["Customs AI"], ["Import checklist"]),
    svc("export-compliance", "Checklist Persyaratan Ekspor", "Checklist persyaratan ekspor per komoditas.", "one_time", "75000", "2-4 hari", true, ["Customs AI"], ["Export checklist"]),
    svc("pib-review", "Review Kesiapan Dokumen PIB/PEB", "Review kesiapan dokumen PIB/PEB.", "one_time", "150000", "2-3 hari", true, ["Customs AI"], ["Document readiness review"]),
    svc("lartas-checking", "Review Lartas", "Screening barang larangan/pembatasan (Lartas).", "one_time", "45000", "1-2 hari", true, ["Customs AI"], ["Lartas screening report"]),
    svc("duty-simulation", "Simulasi Bea dan Pajak", "Simulasi bea dan pajak impor per skenario.", "one_time", "45000", "1-3 hari", false, ["Customs AI"], ["Duty simulation report"]),
    svc("customs-ai-monthly", "Customs AI Bulanan", "Subscription dukungan customs & PPJK bulanan.", "monthly_subscription", "450000", "Ongoing, bulanan", true, ["Customs AI"], ["Monthly customs support"]),
  ],
  procurement: [
    svc("rfq-preparation", "Penyusunan RFQ", "Penyusunan dokumen RFQ pengadaan.", "one_time", "45000", "1-2 hari", false, ["Procurement AI"], ["RFQ document"]),
    svc("vendor-comparison-proc", "Perbandingan Vendor", "Perbandingan vendor pengadaan.", "one_time", "75000", "1-2 hari", false, ["Procurement AI"], ["Vendor comparison sheet"]),
    svc("supplier-scorecard", "Scorecard Supplier", "Penilaian performa supplier.", "one_time", "90000", "2-3 hari", false, ["Procurement AI"], ["Supplier scorecard"]),
    svc("spend-analysis", "Analisis Pengeluaran", "Analisis pengeluaran procurement.", "one_time", "225000", "3-5 hari", true, ["Procurement AI"], ["Spend analysis report"]),
    svc("procurement-ai-monthly", "Procurement AI Bulanan", "Subscription dukungan procurement bulanan.", "monthly_subscription", "600000", "Ongoing, bulanan", true, ["Procurement AI"], ["Monthly procurement support"]),
  ],
  trading: [
    svc("commercial-offer", "Penawaran Komersial", "Penyusunan penawaran komersial.", "one_time", "45000", "1-2 hari", false, ["Trading AI"], ["Commercial offer document"]),
    svc("buyer-supplier-profile", "Profil Pembeli/Pemasok", "Profil pembeli/pemasok untuk trading.", "one_time", "75000", "2-3 hari", false, ["Trading AI"], ["Profile document"]),
    svc("margin-simulation", "Simulasi Margin", "Simulasi margin transaksi trading.", "one_time", "45000", "1-2 hari", false, ["Trading AI"], ["Margin simulation report"]),
    svc("export-deal-readiness", "Kesiapan Deal Ekspor", "Penilaian kesiapan deal ekspor.", "one_time", "150000", "2-4 hari", true, ["Trading AI"], ["Deal readiness report"]),
    svc("trading-ai-monthly", "Trading AI Bulanan", "Subscription dukungan trading bulanan.", "monthly_subscription", "450000", "Ongoing, bulanan", true, ["Trading AI"], ["Monthly trading support"]),
  ],
  "data-analytics": [
    svc("dashboard-setup", "Penyiapan Dashboard Analitik", "Penyiapan dashboard analitik bisnis.", "one_time", "180000", "3-5 hari", false, ["Data Analyst AI"], ["Dashboard access"]),
    svc("data-insight-report", "Laporan Insight Data", "Laporan insight dari data operasional.", "one_time", "150000", "2-4 hari", false, ["Data Analyst AI"], ["Insight report"]),
    svc("data-analytics-monthly", "Data Analytics AI Bulanan", "Subscription pelaporan data bulanan.", "monthly_subscription", "450000", "Ongoing, bulanan", true, ["Data Analyst AI"], ["Monthly analytics report"]),
  ],
  executive: [
    svc("strategic-review", "Review Keputusan Strategis", "Analisis pendukung keputusan strategis eksekutif.", "one_time", "270000", "3-5 hari", true, ["Executive AI"], ["Strategic review document"]),
    svc("board-brief", "Ringkasan untuk Dewan", "Ringkasan eksekutif untuk rapat dewan.", "one_time", "150000", "2-3 hari", true, ["Executive AI"], ["Board brief document"]),
  ],
  "customer-service": [
    svc("support-macro-library", "Pustaka Respons Dukungan", "Kumpulan respons dukungan pelanggan siap pakai.", "one_time", "45000", "2-3 hari", false, ["Customer Service AI"], ["Macro library"]),
    svc("customer-service-ai-monthly", "Customer Service AI Bulanan", "Subscription otomasi dukungan pelanggan bulanan.", "monthly_subscription", "300000", "Ongoing, bulanan", false, ["Customer Service AI"], ["Monthly support automation"]),
  ],
  legal: [
    svc("contract-review", "Review Risiko Kontrak", "Review risiko kontrak dengan human sign-off.", "one_time", "150000", "2-3 hari", true, ["Legal AI"], ["Contract review notes"]),
    svc("agreement-drafting", "Draf Perjanjian", "Penyusunan draft perjanjian bisnis standar.", "one_time", "150000", "3-5 hari", true, ["Legal AI"], ["Draft agreement"]),
    svc("nda-review", "Draf/Review NDA", "Review perjanjian kerahasiaan.", "one_time", "75000", "1-2 hari", true, ["Legal AI"], ["NDA review notes"]),
    svc("vendor-agreement", "Perjanjian Vendor", "Penyusunan/review perjanjian vendor.", "one_time", "180000", "2-4 hari", true, ["Legal AI"], ["Vendor agreement draft"]),
    svc("contract-summary", "Ringkasan Kontrak", "Ringkasan poin-poin utama kontrak.", "one_time", "45000", "1 hari", false, ["Legal AI"], ["Contract summary document"]),
    svc("legal-ai-monthly", "Legal AI Bulanan", "Subscription dukungan legal bulanan (fair usage 10 dokumen).", "monthly_subscription", "600000", "Ongoing, bulanan", true, ["Legal AI"], ["Monthly legal support"]),
  ],
  "graphic-design": [
    svc("GD-LOGO",       "Logo Concept",       "AI-generated logo concepts: wordmark, lettermark, combination, emblem, or mascot styles.",                  "one_time", "225000",  "3-7 hari",   false, ["Designer AI", "Creative Director AI"], ["Primary logo (SVG/PDF/PNG)", "Dark & monochrome variants", "Favicon set"]),
    svc("GD-BCARD",      "Business Card",      "Print-ready business card design with full bleed, CMYK color profile, and all standard sizes.",              "one_time",  "45000",  "2-4 hari",   false, ["Designer AI"],                        ["Print-ready PDF (CMYK+bleed)", "PNG preview", "Digital PDF"]),
    svc("GD-LTRHEAD",    "Letterhead",         "Professional A4/Letter letterhead with optional envelope, complimentary slip, and second-page variant.",     "one_time",  "75000",  "2-3 hari",   false, ["Designer AI"],                        ["Letterhead PDF (print-ready)", "Digital PDF", "PNG preview"]),
    svc("GD-FLYER",      "Flyer",              "Eye-catching A4/A5/A6 flyers for events, promotions, menus, and product launches. Print-ready + digital.",  "one_time",  "45000",  "1-3 hari",   false, ["Designer AI"],                        ["Print-ready PDF", "PNG preview", "JPG social share"]),
    svc("GD-POSTER",     "Poster",             "Large-format A0–A4 posters at 300dpi. Events, advertising, informational, and artistic styles.",            "one_time",  "75000",  "2-5 hari",   false, ["Designer AI"],                        ["Print-ready PDF", "PNG preview", "JPG web share", "Digital PDF"]),
    svc("GD-BANNER",     "Banner",             "Roll-up, X-banner, backdrop, digital leaderboard, and billboard banners. Indoor and outdoor specs.",        "one_time", "90000",  "2-4 hari",   false, ["Designer AI"],                        ["Print-ready PDF", "PNG preview", "Digital JPG"]),
    svc("GD-BROCHURE",   "Brochure",           "Trifold, bifold, gatefold, and accordion brochures. A4/A5/DL sizes. Company profile to product catalogs.", "one_time", "150000",  "3-5 hari",   false, ["Designer AI", "Copywriter AI"],       ["Print-ready PDF (CMYK+bleed)", "Cover PNG preview", "Digital flat PDF"]),
    svc("GD-SOCIAL",     "Social Media Kit",   "Branded social media design sets for Instagram, Facebook, LinkedIn, Twitter, YouTube, and TikTok.",         "one_time", "150000",  "2-4 hari",   false, ["Designer AI"],                        ["Platform-specific PNGs (all sizes)", "Story variants", "Highlight icons", "ZIP archive"]),
    svc("GD-CERT",       "Certificate",        "Achievement, completion, and appreciation certificates with signatures, seals, and optional security.",     "one_time",  "45000",  "1-3 hari",   false, ["Designer AI"],                        ["Print-ready PDF", "Digital PDF", "PNG preview", "JPG social share"]),
    svc("GD-STATIONERY", "Stationery Suite",   "Complete brand stationery: letterhead, envelope, business card, notepad, folder, ID card — all consistent.", "one_time", "270000", "4-7 hari",   false, ["Designer AI", "Creative Director AI"], ["All stationery PDFs (print-ready)", "PNG previews", "ZIP archive"]),
  ],
};

function svc(
  serviceCode: string,
  serviceName: string,
  shortDescription: string,
  pricingModel: PricingModel,
  startingPrice: string,
  estimatedDelivery: string,
  humanReview: boolean,
  aiEmployeesInvolved: string[],
  deliverables: string[],
): ServiceSeed {
  return {
    serviceCode,
    serviceName,
    shortDescription,
    fullDescription: `${shortDescription} Dikerjakan oleh tim AI kami melalui alur kerja terstruktur, dengan ${humanReview ? "review manusia sebelum pengiriman akhir" : "eksekusi penuh AI untuk kecepatan"}.`,
    serviceType: pricingModel === "one_time" ? "project" : "ongoing",
    pricingModel,
    startingPrice,
    estimatedDelivery,
    humanReview,
    aiOnly: !humanReview,
    subscriptionSupported: pricingModel !== "one_time",
    enterpriseSupported: true,
    department: serviceName,
    workflowSummary: `Permintaan → AI Orchestrator mengarahkan ke departemen terkait → alur kerja dijalankan${humanReview ? " → review manusia" : ""} → pengiriman.`,
    aiEmployeesInvolved,
    deliverables,
    revisionPolicy: "Termasuk 2 kali revisi; revisi tambahan dikenakan biaya sesuai tarif standar.",
    currency: "IDR",
  };
}

interface PriceRuleSeed {
  ruleCode: string;
  ruleName: string;
  conditionType: string;
  conditionJson?: Record<string, unknown>;
  adjustmentType: string;
  adjustmentValue: string;
  minimumCharge?: string;
  priority: number;
}

// Global price rules — apply to every service unless a service-specific rule overrides them.
const GLOBAL_PRICE_RULES: PriceRuleSeed[] = [
  { ruleCode: "rush-48h", ruleName: "Rush delivery (48 jam)", conditionType: "rush_speed", conditionJson: { speed: "48h" }, adjustmentType: "percentage", adjustmentValue: "25", priority: 10 },
  { ruleCode: "rush-24h", ruleName: "Rush delivery (24 jam)", conditionType: "rush_speed", conditionJson: { speed: "24h" }, adjustmentType: "percentage", adjustmentValue: "50", priority: 11 },
  { ruleCode: "rush-same-day", ruleName: "Rush delivery (same day)", conditionType: "rush_speed", conditionJson: { speed: "same_day" }, adjustmentType: "percentage", adjustmentValue: "100", priority: 12 },
  { ruleCode: "extra-revision", ruleName: "Revisi tambahan", conditionType: "extra_revision", adjustmentType: "fixed_amount", adjustmentValue: "150000", priority: 20 },
  { ruleCode: "human-review-addon", ruleName: "Human review tambahan", conditionType: "human_review", adjustmentType: "fixed_amount", adjustmentValue: "250000", priority: 21 },
  { ruleCode: "bilingual", ruleName: "Bilingual (ID/EN) +25%", conditionType: "bilingual", adjustmentType: "percentage", adjustmentValue: "25", priority: 22 },
  { ruleCode: "additional-concept", ruleName: "Konsep tambahan", conditionType: "additional_concept", adjustmentType: "fixed_amount", adjustmentValue: "150000", priority: 23 },
  { ruleCode: "editable-source-file", ruleName: "File sumber (editable)", conditionType: "editable_source_file", adjustmentType: "percentage", adjustmentValue: "20", priority: 24 },
  { ruleCode: "extended-usage-rights", ruleName: "Hak penggunaan komersial diperluas (buyout)", conditionType: "extended_usage_rights", adjustmentType: "percentage", adjustmentValue: "50", priority: 25 },
];

async function upsertPriceRule(seed: PriceRuleSeed) {
  const [existing] = await db.select().from(aiServicePriceRulesTable).where(eq(aiServicePriceRulesTable.ruleCode, seed.ruleCode));
  if (existing) {
    const [updated] = await db
      .update(aiServicePriceRulesTable)
      .set({ ...seed, updatedAt: new Date() })
      .where(eq(aiServicePriceRulesTable.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db.insert(aiServicePriceRulesTable).values({ ...seed, active: true }).returning();
  return created;
}

async function upsertCategory(seed: CategorySeed) {
  const [existing] = await db
    .select()
    .from(aiServiceCategoriesTable)
    .where(eq(aiServiceCategoriesTable.code, seed.code));

  if (existing) {
    const [updated] = await db
      .update(aiServiceCategoriesTable)
      .set({
        name: seed.name,
        description: seed.description,
        icon: seed.icon,
        displayOrder: seed.displayOrder,
        ...(seed.visibility !== undefined ? { visibility: seed.visibility } : {}),
        ...(seed.commercialStatus !== undefined ? { commercialStatus: seed.commercialStatus } : {}),
        updatedAt: new Date(),
      })
      .where(eq(aiServiceCategoriesTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(aiServiceCategoriesTable)
    .values({ ...seed, status: "active" })
    .returning();
  return created;
}

async function upsertService(categoryId: number, seed: ServiceSeed) {
  const [existing] = await db
    .select()
    .from(aiServicesTable)
    .where(eq(aiServicesTable.serviceCode, seed.serviceCode));

  if (existing) {
    const [updated] = await db
      .update(aiServicesTable)
      .set({ ...seed, categoryId, status: "active", updatedAt: new Date() })
      .where(eq(aiServicesTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(aiServicesTable)
    .values({ ...seed, categoryId, status: "active" })
    .returning();
  return created;
}

async function upsertPackage(serviceId: number, packageType: string, data: {
  packageName: string;
  oneTimePrice?: string;
  monthlyPrice?: string;
  yearlyPrice?: string;
  features: string[];
  limitsJson?: Record<string, unknown>;
}) {
  const [existing] = await db
    .select()
    .from(aiServicePackagesTable)
    .where(and(eq(aiServicePackagesTable.serviceId, serviceId), eq(aiServicePackagesTable.packageType, packageType)));

  const values = {
    serviceId,
    packageName: data.packageName,
    packageType,
    oneTimePrice: data.oneTimePrice ?? null,
    monthlyPrice: data.monthlyPrice ?? null,
    yearlyPrice: data.yearlyPrice ?? null,
    featuresJson: data.features,
    limitsJson: data.limitsJson ?? null,
    status: "active" as const,
  };

  if (existing) {
    const [updated] = await db
      .update(aiServicePackagesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(aiServicePackagesTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(aiServicePackagesTable).values(values).returning();
  return created;
}

// Phase 5 — Image Batch Engine structured entitlement, keyed by serviceCode
// (never by package name/tier). This is the real, machine-readable source of
// truth for how many images/views a service promises; imageBatchEntitlementService
// reads this via ai_service_packages.limits_json, falling back to the batch
// definition's hardcoded constant only for legacy orders with no package.
const IMAGE_BATCH_ENTITLEMENTS: Record<string, Record<string, unknown>> = {
  "logo-design": {
    logo_design: {
      zipRequired: true,
      groups: [
        { key: "concept-1", label: "Concept 1 — Wordmark", count: 1, aspectRatio: "1:1" },
        { key: "concept-2", label: "Concept 2 — Icon Mark", count: 1, aspectRatio: "1:1" },
        { key: "concept-3", label: "Concept 3 — Emblem", count: 1, aspectRatio: "1:1" },
      ],
    },
  },
  "social-media-design": {
    social_media: {
      zipRequired: true,
      groups: [
        { key: "instagram-feed", label: "Instagram Feed (1:1)", count: 1, aspectRatio: "1:1", platform: "instagram" },
        { key: "instagram-story", label: "Instagram Story (9:16)", count: 1, aspectRatio: "9:16", platform: "instagram" },
        { key: "facebook-post", label: "Facebook Post (16:9)", count: 1, aspectRatio: "16:9", platform: "facebook" },
        { key: "linkedin-post", label: "LinkedIn Post (1:1)", count: 1, aspectRatio: "1:1", platform: "linkedin" },
      ],
    },
  },
  "packaging-design": {
    // Catalog only promises a single visual concept — do not overclaim multi-view here.
    packaging_design: {
      zipRequired: true,
      groups: [{ key: "front", label: "Front View Concept", count: 1, aspectRatio: "4:5" }],
    },
  },
};

// ── Service-level add-on packages ─────────────────────────────────────────────
// These are seeded as packageType = "addon-<code>" on the base service so the
// service-detail page can display them as optional companion services.
const ADDON_PACKAGES: Record<string, Array<{
  addonCode: string;
  packageName: string;
  oneTimePrice: string;
  description: string;
  deliverables: string[];
}>> = {
  "logo-design": [
    { addonCode: "brand-identity",  packageName: "Paket Identitas Brand",  oneTimePrice: "1500000", description: "Sistem identitas visual lengkap: logo, warna, tipografi, dan panduan pakai.", deliverables: ["Brand guideline", "Logo suite", "Color & type system"] },
    { addonCode: "brand-strategy",  packageName: "Strategi Brand",         oneTimePrice: "900000",  description: "Positioning, target audience, USP, dan tone of voice untuk brand Anda.",    deliverables: ["Brand strategy document", "Messaging framework"] },
  ],
  "social-media-design": [
    { addonCode: "content-monthly", packageName: "Konten Media Sosial Bulanan", oneTimePrice: "900000", description: "Konten sosial media bulanan: ide, caption, visual, dan kalender konten.",    deliverables: ["Content ideas", "Captions", "Content calendar"] },
  ],
  "fashion-brand-brief": [
    { addonCode: "campaign-copy",   packageName: "Fashion Campaign Copy",           oneTimePrice: "600000",  description: "Copy kampanye fashion: product description, caption editorial, tagline koleksi, dan press release.", deliverables: ["Campaign copy document", "Product descriptions", "Social captions"] },
    { addonCode: "brand-strategy",  packageName: "Fashion Brand Strategy",          oneTimePrice: "900000", description: "Strategi brand fashion: positioning pasar, persona konsumen, price-point, dan roadmap koleksi.",   deliverables: ["Brand strategy document", "Consumer persona", "Market positioning"] },
    { addonCode: "visual-campaign", packageName: "Fashion Visual Campaign (AI Image)", oneTimePrice: "450000",  description: "Set gambar kampanye fashion editorial menggunakan FLUX.1 Dev — lookbook photography style.",       deliverables: ["Editorial image set", "Lookbook visuals"] },
  ],
  "interior-concept-design": [
    { addonCode: "client-proposal", packageName: "Interior Client Proposal",   oneTimePrice: "1050000", description: "Proposal klien desain interior profesional: scope of work, estimasi anggaran per elemen, dan spesifikasi material.", deliverables: ["Client proposal PDF", "Scope of work", "Material specification"] },
    { addonCode: "brand-identity",  packageName: "Interior Brand Identity",    oneTimePrice: "1500000", description: "Identitas visual untuk bisnis desain interior: logo, palet warna, tipografi, dan panduan brand.",               deliverables: ["Brand guideline", "Logo suite", "Visual identity system"] },
    { addonCode: "mood-visual",     packageName: "Mood Board (AI Render)",     oneTimePrice: "500000",  description: "Visualisasi mood board interior realistis menggunakan FLUX.1 Dev — render suasana ruangan dan material.",         deliverables: ["Interior mood board visuals", "Room atmosphere renders"] },
  ],
};

export async function seedServiceCatalog() {
  console.log("\n🗂️  Seeding AI Service Catalog...");

  const categoryByCode = new Map<string, { id: number }>();
  for (const cat of CATEGORIES) {
    const row = await upsertCategory(cat);
    categoryByCode.set(cat.code, row);
    console.log(`  ✓ Category: ${cat.name}`);
  }

  let serviceCount = 0;
  let packageCount = 0;

  for (const [categoryCode, services] of Object.entries(SERVICES)) {
    const category = categoryByCode.get(categoryCode);
    if (!category) continue;

    for (const s of services) {
      const service = await upsertService(category.id, s);
      serviceCount += 1;

      const oneTime = Number(s.startingPrice);
      const imageBatchLimits = IMAGE_BATCH_ENTITLEMENTS[s.serviceCode];
      await upsertPackage(service.id, "standard", {
        packageName: "Standard",
        oneTimePrice: s.pricingModel === "one_time" ? String(oneTime) : undefined,
        monthlyPrice: s.pricingModel !== "one_time" ? String(oneTime) : undefined,
        features: [s.shortDescription, "Pengerjaan standar", "1 kali revisi"],
        limitsJson: imageBatchLimits,
      });
      await upsertPackage(service.id, "pro", {
        packageName: "Pro",
        oneTimePrice: s.pricingModel === "one_time" ? String(Math.round(oneTime * 1.8)) : undefined,
        monthlyPrice: s.pricingModel !== "one_time" ? String(Math.round(oneTime * 1.8)) : undefined,
        yearlyPrice: s.subscriptionSupported ? String(Math.round(oneTime * 1.8 * 10)) : undefined,
        features: [s.shortDescription, "Pengerjaan prioritas", "2 kali revisi", "Termasuk review manusia"],
        limitsJson: imageBatchLimits,
      });
      await upsertPackage(service.id, "enterprise", {
        packageName: "Enterprise",
        features: ["Cakupan kustom", "Kapasitas departemen khusus", "Pengiriman bergaransi SLA", "Dukungan prioritas"],
        limitsJson: imageBatchLimits,
      });
      packageCount += 3;

      // Seed service-level add-on packages
      const addons = ADDON_PACKAGES[s.serviceCode];
      if (addons) {
        for (const addon of addons) {
          await upsertPackage(service.id, `addon-${addon.addonCode}`, {
            packageName: addon.packageName,
            oneTimePrice: addon.oneTimePrice,
            features: [addon.description, ...addon.deliverables],
          });
          packageCount += 1;
        }
      }
    }
    console.log(`  ✓ ${services.length} service(s) under ${categoryByCode.get(categoryCode) ? categoryCode : categoryCode}`);
  }

  let ruleCount = 0;
  for (const rule of GLOBAL_PRICE_RULES) {
    await upsertPriceRule(rule);
    ruleCount += 1;
  }

  console.log(`✅ Service Catalog seeded: ${categoryByCode.size} categories, ${serviceCount} services, ${packageCount} packages, ${ruleCount} price rules`);
}
