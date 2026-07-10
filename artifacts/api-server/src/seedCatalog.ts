/**
 * AI Service Catalog & Pricing Center — seed data.
 * Idempotent: upserts categories/services on unique code, packages on (serviceId, packageType).
 */
import { db, aiServiceCategoriesTable, aiServicesTable, aiServicePackagesTable } from "@workspace/db";
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
}

const CATEGORIES: CategorySeed[] = [
  { code: "creative", name: "Creative AI", description: "Brand identity, design, and content production.", icon: "palette", displayOrder: 1 },
  { code: "marketing", name: "Marketing AI", description: "Campaigns, positioning, and growth strategy.", icon: "megaphone", displayOrder: 2 },
  { code: "finance", name: "Finance AI", description: "Financial analysis, forecasting, and reporting.", icon: "line-chart", displayOrder: 3 },
  { code: "accounting", name: "Accounting AI", description: "Bookkeeping, ledgers, and closing support.", icon: "book-open", displayOrder: 4 },
  { code: "tax", name: "Tax AI", description: "Indonesian tax compliance and planning.", icon: "receipt", displayOrder: 5 },
  { code: "hr", name: "HR AI", description: "People operations and workforce support.", icon: "users", displayOrder: 6 },
  { code: "legal", name: "Legal AI", description: "Contracts, agreements, and due diligence.", icon: "scale", displayOrder: 7 },
  { code: "logistics", name: "Logistics AI", description: "Freight, shipment, and vendor coordination.", icon: "truck", displayOrder: 8 },
  { code: "customs", name: "Customs AI", description: "Import/export compliance and classification.", icon: "ship", displayOrder: 9 },
  { code: "procurement", name: "Procurement AI", description: "Sourcing and purchasing support.", icon: "shopping-cart", displayOrder: 10 },
  { code: "trading", name: "Trading AI", description: "Market analysis and trading support.", icon: "trending-up", displayOrder: 11 },
  { code: "data-analytics", name: "Data Analytics AI", description: "Dashboards, insights, and reporting.", icon: "bar-chart", displayOrder: 12 },
  { code: "executive", name: "Executive AI", description: "Strategic decision support for leadership.", icon: "briefcase", displayOrder: 13 },
  { code: "customer-service", name: "Customer Service AI", description: "Support automation and client communication.", icon: "headset", displayOrder: 14 },
];

const SERVICES: Record<string, ServiceSeed[]> = {
  creative: [
    svc("logo-design", "Logo Design", "A distinctive logo built from your brand brief.", "one_time", "80", "2-3 days", false, ["Creative Director AI", "Designer AI"], ["Primary logo", "Logo variations", "Usage guide"]),
    svc("brand-identity", "Brand Identity", "Full visual identity system: logo, colors, type, and usage rules.", "one_time", "250", "5-7 days", true, ["Creative Director AI", "Designer AI", "Brand Strategist AI"], ["Brand guideline PDF", "Logo suite", "Color & type system"]),
    svc("brand-strategy", "Brand Strategy", "Positioning, voice, and messaging strategy for your brand.", "one_time", "300", "5-7 days", true, ["Brand Strategist AI"], ["Brand strategy document", "Messaging framework"]),
    svc("social-media-design", "Social Media Design", "On-brand templates for your social channels.", "monthly_subscription", "150", "3-5 days", false, ["Designer AI"], ["Template pack", "Monthly refresh"]),
    svc("instagram-content", "Instagram Content", "Ongoing content creation for Instagram.", "monthly_subscription", "200", "Ongoing, weekly delivery", false, ["Designer AI", "Copywriter AI"], ["Weekly post set", "Captions"]),
    svc("company-profile", "Company Profile", "A professional company profile document.", "one_time", "180", "4-6 days", true, ["Designer AI", "Copywriter AI"], ["Company profile PDF"]),
    svc("pitch-deck", "Pitch Deck", "Investor-ready pitch deck design and narrative.", "one_time", "350", "5-7 days", true, ["Creative Director AI", "Copywriter AI"], ["Pitch deck (PDF/PPTX)"]),
    svc("packaging-design", "Packaging Design", "Product packaging design aligned to your brand.", "one_time", "220", "5-7 days", true, ["Designer AI"], ["Packaging artwork files"]),
    svc("presentation-design", "Presentation Design", "Polished presentation design for any audience.", "one_time", "120", "2-4 days", false, ["Designer AI"], ["Presentation (PPTX/PDF)"]),
    svc("copywriting", "Copywriting", "On-brand copy for web, ads, or campaigns.", "one_time", "60", "1-3 days", false, ["Copywriter AI"], ["Copy document"]),
    svc("image-generation", "Image Generation", "AI-generated imagery for campaigns and content.", "one_time", "40", "1-2 days", false, ["Designer AI"], ["Image set"]),
    svc("creative-consultation", "Creative Consultation", "Strategic creative guidance session with human review.", "one_time", "100", "1-2 days", true, ["Creative Director AI"], ["Consultation notes"]),
  ],
  finance: [
    svc("financial-analysis", "Financial Analysis", "In-depth analysis of your financial statements.", "one_time", "200", "3-5 days", true, ["Finance Analyst AI"], ["Financial analysis report"]),
    svc("cashflow-analysis", "Cashflow Analysis", "Cash flow health check and recommendations.", "one_time", "150", "2-4 days", false, ["Finance Analyst AI"], ["Cashflow report"]),
    svc("budget-planning", "Budget Planning", "Annual or quarterly budget planning support.", "one_time", "180", "3-5 days", true, ["Finance Analyst AI"], ["Budget plan document"]),
    svc("forecasting", "Forecasting", "Revenue and expense forecasting models.", "monthly_subscription", "220", "3-5 days", true, ["Finance Analyst AI"], ["Forecast model", "Monthly updates"]),
    svc("profitability-analysis", "Profitability Analysis", "Product/segment profitability breakdown.", "one_time", "200", "3-5 days", false, ["Finance Analyst AI"], ["Profitability report"]),
    svc("bank-reconciliation", "Bank Reconciliation", "Automated reconciliation of bank statements.", "monthly_subscription", "100", "Ongoing, monthly", false, ["Finance Analyst AI"], ["Reconciliation report"]),
    svc("financial-dashboard", "Financial Dashboard", "Live dashboard of key financial metrics.", "monthly_subscription", "180", "5-7 days setup", false, ["Finance Analyst AI"], ["Dashboard access"]),
    svc("management-report", "Management Report", "Monthly management reporting package.", "monthly_subscription", "150", "Ongoing, monthly", true, ["Finance Analyst AI"], ["Management report PDF"]),
  ],
  accounting: [
    svc("journal-review", "Journal Review", "Review of journal entries for accuracy.", "one_time", "80", "1-2 days", true, ["Accounting AI"], ["Journal review notes"]),
    svc("general-ledger-analysis", "General Ledger Analysis", "Analysis of general ledger accounts.", "one_time", "150", "2-4 days", false, ["Accounting AI"], ["GL analysis report"]),
    svc("trial-balance-review", "Trial Balance Review", "Trial balance accuracy check.", "one_time", "100", "1-3 days", true, ["Accounting AI"], ["Trial balance review notes"]),
    svc("closing-assistance", "Closing Assistance", "Support through month/year-end closing.", "monthly_subscription", "200", "Ongoing, monthly", true, ["Accounting AI"], ["Closing checklist", "Closing report"]),
    svc("account-reconciliation", "Account Reconciliation", "Reconciliation across accounts.", "monthly_subscription", "120", "Ongoing, monthly", false, ["Accounting AI"], ["Reconciliation summary"]),
    svc("coa-recommendation", "COA Recommendation", "Chart of accounts design recommendations.", "one_time", "150", "2-3 days", true, ["Accounting AI"], ["Recommended COA"]),
  ],
  tax: [
    svc("vat-review", "VAT Review", "Review of VAT/PPN filings for accuracy.", "one_time", "120", "2-3 days", true, ["Tax AI"], ["VAT review report"]),
    svc("pph-analysis", "PPh Analysis", "Income tax (PPh) analysis and recommendations.", "one_time", "150", "2-4 days", true, ["Tax AI"], ["PPh analysis report"]),
    svc("tax-planning", "Tax Planning", "Forward-looking tax planning strategy.", "one_time", "250", "4-6 days", true, ["Tax AI"], ["Tax planning document"]),
    svc("coretax-assistance", "Coretax Assistance", "Guided support for Coretax system filings.", "one_time", "100", "1-3 days", true, ["Tax AI"], ["Coretax filing checklist"]),
    svc("invoice-validation", "Invoice Validation", "Bulk validation of tax invoices (Faktur Pajak).", "monthly_subscription", "150", "Ongoing, monthly", false, ["Tax AI"], ["Validation report"]),
    svc("spt-review", "SPT Review", "Review of SPT tax returns before submission.", "one_time", "180", "2-4 days", true, ["Tax AI"], ["SPT review notes"]),
  ],
  logistics: [
    svc("freight-planning", "Freight Planning", "Route and freight planning optimization.", "one_time", "150", "2-4 days", false, ["Logistics AI"], ["Freight plan"]),
    svc("vendor-comparison", "Vendor Comparison", "Comparison of logistics vendor quotes.", "one_time", "80", "1-2 days", false, ["Logistics AI"], ["Vendor comparison sheet"]),
    svc("shipment-monitoring", "Shipment Monitoring", "Ongoing tracking of active shipments.", "monthly_subscription", "120", "Ongoing", false, ["Logistics AI"], ["Monitoring dashboard"]),
    svc("eta-prediction", "ETA Prediction", "Predictive ETA modeling for shipments.", "monthly_subscription", "150", "Ongoing", false, ["Logistics AI"], ["ETA predictions"]),
    svc("rfq-generation", "RFQ Generation", "Automated RFQ document generation.", "one_time", "60", "1-2 days", false, ["Logistics AI"], ["RFQ document"]),
    svc("quotation-assistant", "Quotation Assistant", "Assistance preparing logistics quotations.", "one_time", "70", "1-2 days", false, ["Logistics AI"], ["Quotation draft"]),
  ],
  customs: [
    svc("hs-code-classification", "HS Code Classification", "Accurate HS code classification for products.", "one_time", "80", "1-2 days", true, ["Customs AI"], ["HS code report"]),
    svc("import-compliance", "Import Compliance", "Import compliance review and checklist.", "one_time", "180", "2-4 days", true, ["Customs AI"], ["Compliance report"]),
    svc("export-compliance", "Export Compliance", "Export compliance review and checklist.", "one_time", "180", "2-4 days", true, ["Customs AI"], ["Compliance report"]),
    svc("pib-review", "PIB Review", "Review of Import Declaration (PIB) documents.", "one_time", "150", "2-3 days", true, ["Customs AI"], ["PIB review notes"]),
    svc("peb-review", "PEB Review", "Review of Export Declaration (PEB) documents.", "one_time", "150", "2-3 days", true, ["Customs AI"], ["PEB review notes"]),
    svc("lartas-checking", "Lartas Checking", "Restricted/prohibited goods (Lartas) screening.", "one_time", "100", "1-2 days", true, ["Customs AI"], ["Lartas screening report"]),
    svc("duty-simulation", "Duty Simulation", "Simulation of import duties and taxes.", "one_time", "120", "1-3 days", false, ["Customs AI"], ["Duty simulation report"]),
  ],
  legal: [
    svc("contract-review", "Contract Review", "AI-assisted review of contracts with human sign-off.", "one_time", "150", "2-3 days", true, ["Legal AI"], ["Contract review notes"]),
    svc("agreement-drafting", "Agreement Drafting", "Drafting of standard business agreements.", "one_time", "200", "3-5 days", true, ["Legal AI"], ["Draft agreement"]),
    svc("legal-due-diligence", "Legal Due Diligence", "Due diligence review for transactions.", "one_time", "400", "5-8 days", true, ["Legal AI"], ["Due diligence report"]),
    svc("nda-review", "NDA Review", "Review of non-disclosure agreements.", "one_time", "80", "1-2 days", true, ["Legal AI"], ["NDA review notes"]),
    svc("vendor-agreement", "Vendor Agreement", "Drafting/review of vendor agreements.", "one_time", "150", "2-4 days", true, ["Legal AI"], ["Vendor agreement draft"]),
    svc("commitment-fee-agreement", "Commitment Fee Agreement", "Drafting of commitment fee agreements.", "one_time", "150", "2-4 days", true, ["Legal AI"], ["Agreement draft"]),
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
    fullDescription: `${shortDescription} Delivered by our AI department working through a structured workflow, with ${humanReview ? "human review before final delivery" : "AI-only execution for speed"}.`,
    serviceType: pricingModel === "one_time" ? "project" : "ongoing",
    pricingModel,
    startingPrice,
    estimatedDelivery,
    humanReview,
    aiOnly: !humanReview,
    subscriptionSupported: pricingModel !== "one_time",
    enterpriseSupported: true,
    department: serviceName,
    workflowSummary: `Request → AI Orchestrator routes to the relevant department → workflow executes${humanReview ? " → human review" : ""} → delivery.`,
    aiEmployeesInvolved,
    deliverables,
    revisionPolicy: "2 rounds of revisions included; additional rounds billed at standard rate.",
  };
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
      await upsertPackage(service.id, "standard", {
        packageName: "Standard",
        oneTimePrice: s.pricingModel === "one_time" ? String(oneTime) : undefined,
        monthlyPrice: s.pricingModel !== "one_time" ? String(oneTime) : undefined,
        features: [s.shortDescription, "Standard turnaround", "1 revision round"],
      });
      await upsertPackage(service.id, "pro", {
        packageName: "Pro",
        oneTimePrice: s.pricingModel === "one_time" ? String(Math.round(oneTime * 1.8)) : undefined,
        monthlyPrice: s.pricingModel !== "one_time" ? String(Math.round(oneTime * 1.8)) : undefined,
        yearlyPrice: s.subscriptionSupported ? String(Math.round(oneTime * 1.8 * 10)) : undefined,
        features: [s.shortDescription, "Priority turnaround", "2 revision rounds", "Human review included"],
      });
      await upsertPackage(service.id, "enterprise", {
        packageName: "Enterprise",
        features: ["Custom scope", "Dedicated department capacity", "SLA-backed delivery", "Priority support"],
      });
      packageCount += 3;
    }
    console.log(`  ✓ ${services.length} service(s) under ${categoryByCode.get(categoryCode) ? categoryCode : categoryCode}`);
  }

  console.log(`✅ Service Catalog seeded: ${categoryByCode.size} categories, ${serviceCount} services, ${packageCount} packages`);
}
