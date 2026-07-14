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

const CATEGORIES: CategorySeed[] = [
  { code: "creative", name: "Creative AI", description: "Brand identity, design, and content production.", icon: "palette", displayOrder: 1 },
  { code: "marketing", name: "Marketing AI", description: "Campaigns, positioning, and growth strategy.", icon: "megaphone", displayOrder: 2 },
  { code: "sales", name: "Sales AI", description: "Lead qualification, proposals, and pipeline support.", icon: "handshake", displayOrder: 3 },
  { code: "finance", name: "Finance AI", description: "Financial analysis, forecasting, and reporting.", icon: "line-chart", displayOrder: 4 },
  { code: "accounting", name: "Accounting AI", description: "Bookkeeping, ledgers, and closing support.", icon: "book-open", displayOrder: 5 },
  { code: "tax", name: "Tax AI", description: "Indonesian tax compliance and planning.", icon: "receipt", displayOrder: 6 },
  { code: "hr", name: "HR & Payroll AI", description: "People operations and workforce support.", icon: "users", displayOrder: 7 },
  { code: "legal", name: "Legal AI", description: "Contracts, agreements, and due diligence.", icon: "scale", displayOrder: 8 },
  { code: "logistics", name: "Logistics AI", description: "Freight, shipment, and vendor coordination.", icon: "truck", displayOrder: 9 },
  { code: "customs", name: "Customs & PPJK AI", description: "Import/export compliance and classification.", icon: "ship", displayOrder: 10 },
  { code: "procurement", name: "Procurement AI", description: "Sourcing and purchasing support.", icon: "shopping-cart", displayOrder: 11 },
  { code: "trading", name: "Trading AI", description: "Market analysis and trading support.", icon: "trending-up", displayOrder: 12 },
  { code: "data-analytics", name: "Data Analytics AI", description: "Dashboards, insights, and reporting.", icon: "bar-chart", displayOrder: 13 },
  { code: "executive", name: "Executive AI", description: "Strategic decision support for leadership.", icon: "briefcase", displayOrder: 14 },
  { code: "customer-service", name: "Customer Service AI", description: "Support automation and client communication.", icon: "headset", displayOrder: 15 },
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

const SERVICES: Record<string, ServiceSeed[]> = {
  creative: [
    svc("logo-design",          "Logo Concept AI",             "3 konsep logo awal dengan arah warna, siap dikembangkan lebih lanjut.", "one_time", "299000",  "30-60 menit", false, ["Creative Director AI", "Designer AI"], ["3 konsep logo", "1 arah warna", "PNG/JPG concept"]),
    svc("brand-identity",       "Brand Identity Package",      "Sistem identitas visual lengkap: logo, warna, tipografi, dan panduan pakai.", "one_time", "1750000", "2-3 hari",    true,  ["Creative Director AI", "Designer AI", "Brand Strategist AI"], ["Brand guideline", "Logo suite", "Color & type system"]),
    svc("brand-strategy",       "Brand Strategy",              "Positioning, target audience, USP, dan tone of voice untuk brand Anda.", "one_time", "750000",  "2-3 hari",    true,  ["Brand Strategist AI"], ["Brand strategy document", "Messaging framework"]),
    svc("social-media-design",  "Social Media Design",         "Desain konten sosial media on-brand per batch.", "one_time", "75000",   "30-60 menit", false, ["Designer AI"], ["Desain feed", "Headline/copy pendek"]),
    svc("social-media-content", "Social Media Content Monthly","Konten sosial media bulanan: ide, caption, visual, dan kalender konten.", "monthly_subscription", "999000",  "Ongoing, bulanan", false, ["Designer AI", "Copywriter AI"], ["Content ideas", "Captions", "Content calendar"]),
    svc("company-profile",      "Company Profile",             "Dokumen company profile profesional dengan struktur dan copy.", "one_time", "750000",  "1-2 hari",    true,  ["Designer AI", "Copywriter AI"], ["Company profile PDF"]),
    svc("pitch-deck",           "Pitch Deck / Presentation",   "Pitch deck investor-ready dengan storytelling dan arah visual.", "one_time", "1250000", "2-3 hari",    true,  ["Creative Director AI", "Copywriter AI"], ["Pitch deck (PDF/PPTX)"]),
    svc("packaging-design",     "Packaging Concept",           "Konsep desain kemasan produk sesuai brand Anda.", "one_time", "750000",  "2-3 hari",    true,  ["Designer AI"], ["Visual concept kemasan"]),
    svc("poster-banner",        "Poster / Banner / Brochure",  "Desain poster, banner digital, atau brosur.", "one_time", "150000",  "30-60 menit", false, ["Designer AI"], ["Poster/banner file"]),
    svc("copywriting",          "Copywriting",                 "Copy on-brand untuk caption, landing page, atau kampanye.", "one_time", "350000",  "30-60 menit", false, ["Copywriter AI"], ["Copy document"]),
    svc("image-generation",     "Image Generation",            "Gambar AI untuk kampanye dan konten.", "one_time", "75000",   "15-30 menit", false, ["Designer AI"], ["Image set"]),
    svc("creative-consultation","Creative Consultation",        "Sesi konsultasi kreatif strategis dengan human review.", "one_time", "500000",  "4-8 jam",     true,  ["Creative Director AI"], ["Consultation notes"]),
  ],
  marketing: [
    svc("marketing-plan",       "Marketing Plan",              "Rencana marketing menyeluruh untuk brand atau produk Anda.", "one_time", "750000",  "1-2 jam",     false, ["Marketing Strategist AI"], ["Marketing plan document"]),
    svc("campaign-plan",        "Campaign Plan",               "Rencana kampanye marketing end-to-end.", "one_time", "1500000", "1-2 jam",     false, ["Marketing Strategist AI"], ["Campaign plan document"]),
    svc("content-calendar",     "30-Day Content Calendar",     "Kalender konten 30 hari lintas kanal.", "one_time", "500000",  "1-2 jam",     false, ["Marketing Strategist AI"], ["Content calendar"]),
    svc("competitor-analysis",  "Competitor Analysis",         "Analisis kompetitor untuk strategi pemasaran.", "one_time", "1250000", "1-2 jam",     false, ["Marketing Strategist AI"], ["Competitor analysis report"]),
    svc("customer-persona",     "Customer Persona Package",    "Persona pelanggan berbasis riset untuk targeting.", "one_time", "750000",  "1-2 jam",     false, ["Marketing Strategist AI"], ["Customer persona document"]),
    svc("marketing-ai-monthly", "Marketing AI Monthly",        "Subscription strategi dan eksekusi marketing bulanan.", "monthly_subscription", "1250000", "Ongoing, bulanan", true, ["Marketing Strategist AI"], ["Monthly marketing plan", "Human review"]),
  ],
  sales: [
    svc("lead-qualification",   "Lead Qualification",          "Kualifikasi dan scoring leads masuk secara otomatis.", "monthly_subscription", "1500000", "Ongoing, bulanan", false, ["Sales AI"], ["Qualified lead list"]),
    svc("proposal-drafting",    "Sales Proposal Drafting",     "Penyusunan proposal penjualan yang dipersonalisasi.", "one_time", "500000",  "30-60 menit", false, ["Sales AI"], ["Proposal document"]),
    svc("sales-playbook",       "Sales Playbook",              "Playbook penjualan dengan skrip dan objection handling.", "one_time", "1500000", "1-2 hari",    true,  ["Sales AI"], ["Sales playbook document"]),
  ],
  finance: [
    svc("financial-analysis",   "Financial Health Check",      "Analisis kesehatan keuangan secara menyeluruh.", "one_time", "1500000", "1-2 hari",    true,  ["Finance Analyst AI"], ["Financial analysis report"]),
    svc("cashflow-analysis",    "Cash Flow Analysis",          "Analisis kesehatan cash flow dan rekomendasi.", "one_time", "1500000", "1-2 jam",     false, ["Finance Analyst AI"], ["Cashflow report"]),
    svc("budget-planning",      "Budget vs Actual Review",     "Perbandingan anggaran vs realisasi.", "one_time", "2000000", "1-2 hari",    true,  ["Finance Analyst AI"], ["Budget review document"]),
    svc("forecasting",          "Financial Forecast",          "Model forecasting pendapatan dan pengeluaran.", "monthly_subscription", "3500000", "1-2 hari",    true,  ["Finance Analyst AI"], ["Forecast model", "Monthly updates"]),
    svc("profitability-analysis","Profit and Loss Analysis",   "Analisis profitabilitas produk/segmen.", "one_time", "1250000", "1-2 jam",     false, ["Finance Analyst AI"], ["P&L analysis report"]),
    svc("bank-reconciliation",  "Bank Reconciliation Assistance","Rekonsiliasi otomatis laporan bank per periode.", "monthly_subscription", "2500000", "Ongoing, bulanan", false, ["Finance Analyst AI"], ["Reconciliation report"]),
    svc("management-report",    "Management Finance Report",   "Paket laporan manajemen bulanan.", "monthly_subscription", "2500000", "Ongoing, bulanan", true,  ["Finance Analyst AI"], ["Management report PDF"]),
  ],
  accounting: [
    svc("journal-review",         "Journal Review",            "Review hingga 100 transaksi jurnal untuk akurasi.", "one_time", "1500000", "4-8 jam",     true,  ["Accounting AI"], ["Journal review notes"]),
    svc("general-ledger-analysis","GL Review",                 "Analisis akun general ledger.", "one_time", "2000000", "1-2 jam",     false, ["Accounting AI"], ["GL analysis report"]),
    svc("trial-balance-review",   "Trial Balance Review",      "Pemeriksaan akurasi trial balance.", "one_time", "2000000", "4-8 jam",     true,  ["Accounting AI"], ["Trial balance review notes"]),
    svc("closing-assistance",     "Closing Assistance",        "Dukungan proses closing bulanan/tahunan.", "monthly_subscription", "3500000", "Ongoing, per periode", true, ["Accounting AI"], ["Closing checklist", "Closing report"]),
    svc("account-reconciliation", "Account Reconciliation",    "Rekonsiliasi akun per akun.", "one_time", "1500000", "Ongoing, per akun", false, ["Accounting AI"], ["Reconciliation summary"]),
    svc("coa-recommendation",     "COA Recommendation",        "Rekomendasi desain chart of accounts.", "one_time", "1500000", "1 hari",      true,  ["Accounting AI"], ["Recommended COA"]),
  ],
  tax: [
    svc("vat-review",         "PPN Review",              "Review filing PPN per periode.", "one_time", "1500000", "1 hari",      true,  ["Tax AI"], ["VAT review report"]),
    svc("pph-analysis",       "PPh Review",              "Analisis dan rekomendasi PPh per periode.", "one_time", "1500000", "1 hari",      true,  ["Tax AI"], ["PPh analysis report"]),
    svc("tax-reconciliation", "Tax Reconciliation",      "Rekonsiliasi pajak per periode.", "one_time", "3000000", "1-2 hari",    true,  ["Tax AI"], ["Tax reconciliation report"]),
    svc("tax-planning",       "Tax Planning",            "Strategi perencanaan pajak ke depan.", "one_time", "2500000", "1-2 hari",    true,  ["Tax AI"], ["Tax planning document"]),
    svc("invoice-validation", "Invoice Tax Review",      "Validasi massal faktur pajak.", "one_time", "500000",  "Ongoing, per dokumen", false, ["Tax AI"], ["Validation report"]),
    svc("spt-review",         "SPT Readiness Review",    "Review SPT sebelum submisi.", "one_time", "2500000", "1 hari",      true,  ["Tax AI"], ["SPT review notes"]),
  ],
  hr: [
    svc("cv-screening",       "CV Screening",            "Penyaringan CV otomatis per kandidat.", "one_time", "300000",  "30-60 menit", false, ["HR AI"], ["Shortlist kandidat"]),
    svc("job-description",    "Job Description",         "Penyusunan job description profesional.", "one_time", "250000",  "30-60 menit", false, ["HR AI"], ["Job description document"]),
    svc("interview-package",  "Interview Package",       "Paket pertanyaan dan panduan interview per role.", "one_time", "350000",  "30-60 menit", false, ["HR AI"], ["Interview guide"]),
    svc("payroll-review",     "Payroll Review",          "Review payroll per periode.", "one_time", "1500000", "1 hari",      true,  ["HR AI"], ["Payroll review report"]),
    svc("performance-summary","Performance Summary",     "Ringkasan performa karyawan.", "one_time", "500000",  "30-60 menit", false, ["HR AI"], ["Performance summary report"]),
    svc("hr-ai-monthly",      "HR AI Monthly",           "Subscription dukungan HR & payroll bulanan.", "monthly_subscription", "1500000", "Ongoing, bulanan", true, ["HR AI"], ["Monthly HR support"]),
  ],
  logistics: [
    svc("freight-planning",   "Freight Cost Analysis",         "Analisis biaya freight per rute.", "one_time", "750000",  "1-2 jam",     false, ["Logistics AI"], ["Freight cost report"]),
    svc("vendor-comparison",  "Vendor Comparison",             "Perbandingan penawaran vendor logistik.", "one_time", "500000",  "30-60 menit", false, ["Logistics AI"], ["Vendor comparison sheet"]),
    svc("shipment-exception", "Shipment Exception Analysis",   "Analisis kasus pengecualian pengiriman.", "one_time", "500000",  "30-60 menit", false, ["Logistics AI"], ["Exception analysis report"]),
    svc("rfq-generation",     "RFQ Generation",                "Pembuatan dokumen RFQ otomatis.", "one_time", "250000",  "30-60 menit", false, ["Logistics AI"], ["RFQ document"]),
    svc("logistics-ai-monthly","Logistics AI Monthly",         "Subscription dukungan logistik bulanan.", "monthly_subscription", "2500000", "Ongoing, bulanan", true, ["Logistics AI"], ["Monthly logistics support"]),
  ],
  customs: [
    svc("hs-code-classification","HS Code Candidate Analysis", "Kandidat klasifikasi HS Code dengan confidence score.", "one_time", "250000",  "4-8 jam",     true,  ["Customs AI"], ["HS code candidate report"]),
    svc("import-compliance",   "Import Requirement Checklist", "Checklist persyaratan impor per komoditas.", "one_time", "750000",  "1 hari",      true,  ["Customs AI"], ["Import checklist"]),
    svc("export-compliance",   "Export Requirement Checklist", "Checklist persyaratan ekspor per komoditas.", "one_time", "750000",  "1 hari",      true,  ["Customs AI"], ["Export checklist"]),
    svc("pib-review",          "PIB/PEB Document Readiness Review","Review kesiapan dokumen PIB/PEB.", "one_time", "1500000", "1 hari",      true,  ["Customs AI"], ["Document readiness review"]),
    svc("lartas-checking",     "Lartas Review",                "Screening barang larangan/pembatasan (Lartas).", "one_time", "500000",  "4-8 jam",     true,  ["Customs AI"], ["Lartas screening report"]),
    svc("duty-simulation",     "Duty and Tax Simulation",      "Simulasi bea dan pajak impor per skenario.", "one_time", "350000",  "30-60 menit", false, ["Customs AI"], ["Duty simulation report"]),
    svc("customs-ai-monthly",  "Customs AI Monthly",           "Subscription dukungan customs & PPJK bulanan.", "monthly_subscription", "2500000", "Ongoing, bulanan", true, ["Customs AI"], ["Monthly customs support"]),
  ],
  procurement: [
    svc("rfq-preparation",        "RFQ Preparation",           "Penyusunan dokumen RFQ pengadaan.", "one_time", "350000",  "30-60 menit", false, ["Procurement AI"], ["RFQ document"]),
    svc("vendor-comparison-proc", "Vendor Comparison",         "Perbandingan vendor pengadaan.", "one_time", "750000",  "30-60 menit", false, ["Procurement AI"], ["Vendor comparison sheet"]),
    svc("supplier-scorecard",     "Supplier Scorecard",        "Penilaian performa supplier.", "one_time", "1000000", "1-2 jam",     false, ["Procurement AI"], ["Supplier scorecard"]),
    svc("spend-analysis",         "Spend Analysis",            "Analisis pengeluaran procurement.", "one_time", "2500000", "1-2 hari",    true,  ["Procurement AI"], ["Spend analysis report"]),
    svc("procurement-ai-monthly", "Monthly Procurement AI",    "Subscription dukungan procurement bulanan.", "monthly_subscription", "3500000", "Ongoing, bulanan", true, ["Procurement AI"], ["Monthly procurement support"]),
  ],
  trading: [
    svc("commercial-offer",      "Commercial Offer",           "Penyusunan penawaran komersial.", "one_time", "500000",  "30-60 menit", false, ["Trading AI"], ["Commercial offer document"]),
    svc("buyer-supplier-profile","Buyer/Supplier Profile",     "Profil pembeli/pemasok untuk trading.", "one_time", "750000",  "1-2 jam",     false, ["Trading AI"], ["Profile document"]),
    svc("margin-simulation",     "Margin Simulation",          "Simulasi margin transaksi trading.", "one_time", "500000",  "30-60 menit", false, ["Trading AI"], ["Margin simulation report"]),
    svc("export-deal-readiness", "Export Deal Readiness",      "Penilaian kesiapan deal ekspor.", "one_time", "1500000", "1 hari",      true,  ["Trading AI"], ["Deal readiness report"]),
    svc("trading-ai-monthly",    "Trading AI Monthly",         "Subscription dukungan trading bulanan.", "monthly_subscription", "2500000", "Ongoing, bulanan", true, ["Trading AI"], ["Monthly trading support"]),
  ],
  "data-analytics": [
    svc("dashboard-setup",        "Analytics Dashboard Setup", "Penyiapan dashboard analitik bisnis.", "one_time", "2000000", "1-2 jam",     false, ["Data Analyst AI"], ["Dashboard access"]),
    svc("data-insight-report",    "Data Insight Report",       "Laporan insight dari data operasional.", "one_time", "1500000", "1-2 jam",     false, ["Data Analyst AI"], ["Insight report"]),
    svc("data-analytics-monthly", "Data Analytics AI Monthly", "Subscription pelaporan data bulanan.", "monthly_subscription", "2500000", "Ongoing, bulanan", true, ["Data Analyst AI"], ["Monthly analytics report"]),
  ],
  executive: [
    svc("strategic-review","Strategic Decision Review","Analisis pendukung keputusan strategis eksekutif.", "one_time", "3000000", "1-2 hari", true,  ["Executive AI"], ["Strategic review document"]),
    svc("board-brief",     "Board Brief",             "Ringkasan eksekutif untuk rapat dewan.", "one_time", "1500000", "1 hari",   true,  ["Executive AI"], ["Board brief document"]),
  ],
  "customer-service": [
    svc("support-macro-library",      "Support Macro Library",       "Kumpulan respons dukungan pelanggan siap pakai.", "one_time", "500000",  "1-2 jam",     false, ["Customer Service AI"], ["Macro library"]),
    svc("customer-service-ai-monthly","Customer Service AI Monthly", "Subscription otomasi dukungan pelanggan bulanan.", "monthly_subscription", "1500000", "Ongoing, bulanan", false, ["Customer Service AI"], ["Monthly support automation"]),
  ],
  legal: [
    svc("contract-review",    "Contract Risk Review",   "Review risiko kontrak dengan human sign-off.", "one_time", "1500000", "1 hari",      true,  ["Legal AI"], ["Contract review notes"]),
    svc("agreement-drafting", "Agreement Draft",        "Penyusunan draft perjanjian bisnis standar.", "one_time", "1500000", "1-2 hari",    true,  ["Legal AI"], ["Draft agreement"]),
    svc("nda-review",         "NDA Draft/Review",       "Review perjanjian kerahasiaan.", "one_time", "750000",  "4-8 jam",     true,  ["Legal AI"], ["NDA review notes"]),
    svc("vendor-agreement",   "Vendor Agreement",       "Penyusunan/review perjanjian vendor.", "one_time", "2000000", "1 hari",      true,  ["Legal AI"], ["Vendor agreement draft"]),
    svc("contract-summary",   "Contract Summary",       "Ringkasan poin-poin utama kontrak.", "one_time", "500000",  "30-60 menit", false, ["Legal AI"], ["Contract summary document"]),
    svc("legal-ai-monthly",   "Legal AI Monthly",       "Subscription dukungan legal bulanan (fair usage 10 dokumen).", "monthly_subscription", "3500000", "Ongoing, bulanan", true, ["Legal AI"], ["Monthly legal support"]),
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
