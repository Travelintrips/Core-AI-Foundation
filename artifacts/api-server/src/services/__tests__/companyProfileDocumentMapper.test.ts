/**
 * companyProfileDocumentMapper.test.ts — P1 Workstream 2
 *
 * Tests that the updated mapper:
 *   1. Uses cp* fields from the brief in the prompt / spec
 *   2. Prefers cp* contact fields over LLM-generated contact info
 *   3. Includes package-level-gated sections at the right tiers
 *   4. Falls back to generic fields for legacy projects without cp* data
 *   5. Skips sections when data is missing (no fabrication)
 */

import { describe, it, expect } from "vitest";
import {
  mapCompanyProfileToDocumentSpec,
  PACKAGE_PAGE_TARGETS,
  type CompanyProfileBrief,
  type CompanyProfileContent,
} from "../companyProfileDocumentMapper.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_CONTENT: CompanyProfileContent = {
  about:                  "A leading logistics company.",
  vision:                 "LLM-generated vision",
  mission:                "LLM-generated mission",
  coreValues:             ["Quality", "Integrity", "Speed"],
  servicesOrProducts:     [{ name: "Freight", description: "Full freight forwarding." }],
  competitiveAdvantages:  ["Fast", "Reliable", "Experienced"],
  industriesServed:       ["Manufacturing", "Retail"],
  operationalCapabilities: "We operate 24/7 with a fleet of 50 trucks.",
  milestones:             [{ year: "2010", event: "Founded" }, { year: "2020", event: "ISO certified" }],
  teamDescription:        "Led by experienced professionals.",
  certifications:         ["ISO 9001"],
  tagline:                "Moving business forward",
  closing:                "Thank you for considering us.",
  contactInfo: { email: "llm@example.com", phone: "+6200000000", address: "LLM Address", website: "https://llm.com" },
};

const BASE_BRIEF: CompanyProfileBrief = {
  brandName:        "Acme Logistics",
  businessType:     "Logistics",
  targetMarket:     "Enterprise shippers",
  productOrService: "Freight forwarding",
  goal:             "Expand to ASEAN",
  packageLevel:     "professional",
};

// ── P1.1 Document sections — cp* field usage ──────────────────────────────────

describe("mapCompanyProfileToDocumentSpec — cp* contact fields take priority", () => {
  it("uses cpContactEmail over LLM-generated email in contact section", () => {
    const brief: CompanyProfileBrief = {
      ...BASE_BRIEF,
      cpContactEmail:   "real@acme.co.id",
      cpContactPhone:   "+62811234567",
      cpContactAddress: "Jl. Sudirman No. 1, Jakarta",
      cpContactWebsite: "https://acme.co.id",
    };

    const { spec } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(spec.company?.email).toBe("real@acme.co.id");
    expect(spec.company?.phone).toBe("+62811234567");
    expect(spec.company?.website).toBe("https://acme.co.id");

    // The contact section bullets must reference cp* values, not LLM output
    const contactSection = spec.sections.find((s) => s.type === "bullets" && (s as { items?: unknown[] }).items?.some((i) => typeof i === "string" && i.includes("real@acme.co.id")));
    expect(contactSection).toBeDefined();
  });

  it("falls back to LLM contact info when cp* contact fields are absent (legacy)", () => {
    const brief: CompanyProfileBrief = { ...BASE_BRIEF }; // no cp* contact fields

    const { spec } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    // LLM email should be used as fallback
    expect(spec.company?.email).toBe("llm@example.com");
  });
});

describe("mapCompanyProfileToDocumentSpec — cp* identity fields", () => {
  it("uses cpLegalName as the document title instead of brandName", () => {
    const brief: CompanyProfileBrief = {
      ...BASE_BRIEF,
      cpLegalName: "PT Acme Logistik Indonesia",
    };

    const { spec } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(spec.title).toBe("PT Acme Logistik Indonesia — Company Profile");
    expect(spec.cover?.title).toBe("PT Acme Logistik Indonesia");
    expect(spec.company?.name).toBe("PT Acme Logistik Indonesia");
  });

  it("falls back to brandName when cpLegalName is absent", () => {
    const { spec } = mapCompanyProfileToDocumentSpec(BASE_BRIEF, BASE_CONTENT, null, []);
    expect(spec.title).toBe("Acme Logistics — Company Profile");
  });

  it("uses cpVision verbatim in the vision section over LLM-generated vision", () => {
    const brief: CompanyProfileBrief = {
      ...BASE_BRIEF,
      cpVision: "Our customer-provided vision statement",
    };

    const { spec } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    const quoteSection = spec.sections.find(
      (s) => s.type === "quote" && (s as { text?: string }).text === "Our customer-provided vision statement",
    );
    expect(quoteSection).toBeDefined();
  });

  it("uses cpCompanyValues (brief) over LLM core values", () => {
    const brief: CompanyProfileBrief = {
      ...BASE_BRIEF,
      cpCompanyValues: "Integritas, Inovasi, Keunggulan",
    };

    const { spec } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    const bulletsSection = spec.sections.find(
      (s) => s.type === "bullets" &&
        (s as { items?: unknown[] }).items?.includes("Integritas"),
    );
    expect(bulletsSection).toBeDefined();
  });
});

// ── P1.2 Package enforcement — section gating ─────────────────────────────────

describe("mapCompanyProfileToDocumentSpec — package level section gating", () => {
  const briefWithExtras: CompanyProfileBrief = {
    ...BASE_BRIEF,
    cpKeyPeople:          "Budi Santoso (CEO), Rina Dewi (COO)",
    cpOrganizationStructure: "Flat structure with 3 divisions",
    cpClientsPartners:    "PLN, Pertamina, Telkom",
    cpQualityAssurance:   "ISO-certified 100% QC per batch",
    cpSustainability:     "Solar-powered facility, zero-waste target 2030",
  };

  it("starter — excludes key-people, org-structure, clients-partners, QA, sustainability", () => {
    const brief: CompanyProfileBrief = { ...briefWithExtras, packageLevel: "starter" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("key-people");
    expect(skippedIds).toContain("org-structure");
    expect(skippedIds).toContain("clients-partners");
    expect(skippedIds).toContain("quality-assurance");
    expect(skippedIds).toContain("sustainability");
  });

  it("professional — includes key-people, org-structure, clients-partners; skips QA, sustainability", () => {
    const brief: CompanyProfileBrief = { ...briefWithExtras, packageLevel: "professional" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(report.sectionsIncluded).toContain("key-people");
    expect(report.sectionsIncluded).toContain("org-structure");
    expect(report.sectionsIncluded).toContain("clients-partners");

    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("quality-assurance");
    expect(skippedIds).toContain("sustainability");
  });

  it("business — includes QA; skips sustainability", () => {
    const brief: CompanyProfileBrief = { ...briefWithExtras, packageLevel: "business" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(report.sectionsIncluded).toContain("quality-assurance");
    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("sustainability");
  });

  it("enterprise — includes all sections including sustainability", () => {
    const brief: CompanyProfileBrief = { ...briefWithExtras, packageLevel: "enterprise" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(report.sectionsIncluded).toContain("key-people");
    expect(report.sectionsIncluded).toContain("org-structure");
    expect(report.sectionsIncluded).toContain("clients-partners");
    expect(report.sectionsIncluded).toContain("quality-assurance");
    expect(report.sectionsIncluded).toContain("sustainability");
  });

  it("report carries correct packageLevel and pageTarget", () => {
    const brief: CompanyProfileBrief = { ...BASE_BRIEF, packageLevel: "business" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);

    expect(report.packageLevel).toBe("business");
    expect(report.pageTarget).toBe(PACKAGE_PAGE_TARGETS["business"]);
  });
});

// ── Milestone threshold ───────────────────────────────────────────────────────

describe("mapCompanyProfileToDocumentSpec — milestone threshold", () => {
  const contentSingleMilestone: CompanyProfileContent = {
    ...BASE_CONTENT,
    milestones: [{ year: "2010", event: "Founded" }],
  };

  it("starter — requires 2 milestones, skips with only 1", () => {
    const brief: CompanyProfileBrief = { ...BASE_BRIEF, packageLevel: "starter" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, contentSingleMilestone, null, []);
    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("milestones");
  });

  it("business — only requires 1 milestone, includes it", () => {
    const brief: CompanyProfileBrief = { ...BASE_BRIEF, packageLevel: "business" };
    const { report } = mapCompanyProfileToDocumentSpec(brief, contentSingleMilestone, null, []);
    expect(report.sectionsIncluded).toContain("milestones");
  });
});

// ── Certifications — brief values over LLM ───────────────────────────────────

describe("mapCompanyProfileToDocumentSpec — certifications from brief", () => {
  it("uses cpCertifications from brief rather than LLM certifications", () => {
    const brief: CompanyProfileBrief = {
      ...BASE_BRIEF,
      cpCertifications: "ISO 9001, ISO 14001, OHSAS 18001",
    };
    const contentNoCerts: CompanyProfileContent = { ...BASE_CONTENT, certifications: [] };

    const { report, spec } = mapCompanyProfileToDocumentSpec(brief, contentNoCerts, null, []);

    expect(report.sectionsIncluded).toContain("certifications");

    // Check the bullets appear in the spec
    const certBullets = spec.sections.find(
      (s) => s.type === "bullets" &&
        (s as { items?: unknown[] }).items?.some((i) => typeof i === "string" && i.includes("ISO 9001")),
    );
    expect(certBullets).toBeDefined();
  });
});

// ── No fabrication — skips sections without data ─────────────────────────────

describe("mapCompanyProfileToDocumentSpec — no fabrication rule", () => {
  it("skips contact section when no contact data in brief or content", () => {
    const emptyContactContent: CompanyProfileContent = {
      ...BASE_CONTENT,
      contactInfo: { email: "", phone: "", address: "", website: "" },
    };
    const briefNoContact: CompanyProfileBrief = { ...BASE_BRIEF }; // no cpContact* fields

    const { report } = mapCompanyProfileToDocumentSpec(briefNoContact, emptyContactContent, null, []);
    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("contact");
  });

  it("skips key-people even at professional tier when cpKeyPeople is absent", () => {
    const brief: CompanyProfileBrief = { ...BASE_BRIEF, packageLevel: "professional" }; // no cpKeyPeople
    const { report } = mapCompanyProfileToDocumentSpec(brief, BASE_CONTENT, null, []);
    const skippedIds = report.sectionsSkipped.map((s) => s.sectionId);
    expect(skippedIds).toContain("key-people");
  });
});
