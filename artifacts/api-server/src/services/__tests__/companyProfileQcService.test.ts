/**
 * companyProfileQcService.test.ts — P1 Workstream 2 (P1.3)
 *
 * Unit tests for the Company Profile QC scoring service.
 * All tests are pure-function — no DB, no LLM, no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  scoreCompanyProfileDocument,
  scoreFromAssetMetadata,
  QC_PASS_THRESHOLD,
  REQUIRED_SECTIONS,
  BONUS_SECTIONS,
} from "../companyProfileQcService.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_REPORT = {
  sectionsIncluded: [
    "about",
    "vision-mission", "vision", "mission",
    "core-values",
    "services", "services-detail",
    "company-image",
    "competitive-advantages",
    "industries",
    "operational",
    "milestones",
    "team",
    "certifications",
    "key-people",
    "org-structure",
    "clients-partners",
    "quality-assurance",
    "sustainability",
    "contact",
  ],
  sectionsSkipped: [],
  packageLevel: "enterprise",
  pageTarget: 16,
};

const MINIMAL_REPORT = {
  sectionsIncluded: ["about", "vision-mission", "services", "contact"],
  sectionsSkipped: [],
  packageLevel: "starter",
  pageTarget: 5,
};

const MISSING_CONTACT_REPORT = {
  sectionsIncluded: ["about", "vision-mission", "services"],
  sectionsSkipped: [{ sectionId: "contact", included: false, reason: "No contact info" }],
  packageLevel: "starter",
  pageTarget: 5,
};

// ── Section coverage ──────────────────────────────────────────────────────────

describe("scoreCompanyProfileDocument — section coverage", () => {
  it("all required sections present → sectionCoverage = 100", () => {
    const result = scoreCompanyProfileDocument(FULL_REPORT, 16, 16);
    expect(result.dimensions.sectionCoverage).toBe(100);
  });

  it("only 2 of 4 required sections → sectionCoverage = 50", () => {
    const report = { ...MINIMAL_REPORT, sectionsIncluded: ["about", "services"] };
    const result = scoreCompanyProfileDocument(report, 5, 5);
    expect(result.dimensions.sectionCoverage).toBe(50);
  });

  it("no sections → sectionCoverage = 0 and all required in sectionsMissing", () => {
    const result = scoreCompanyProfileDocument({ ...MINIMAL_REPORT, sectionsIncluded: [] }, 0, 5);
    expect(result.dimensions.sectionCoverage).toBe(0);
    expect(result.sectionsMissing).toEqual(expect.arrayContaining([...REQUIRED_SECTIONS]));
  });

  it("sectionsPresent reflects what was in the report", () => {
    const result = scoreCompanyProfileDocument(MINIMAL_REPORT, 5, 5);
    expect(result.sectionsPresent).toContain("about");
    expect(result.sectionsPresent).toContain("contact");
  });
});

// ── Contact completeness ──────────────────────────────────────────────────────

describe("scoreCompanyProfileDocument — contact completeness", () => {
  it("contact section absent → contactCompleteness = 0 and warning emitted", () => {
    const result = scoreCompanyProfileDocument(MISSING_CONTACT_REPORT, 5, 5);
    expect(result.dimensions.contactCompleteness).toBe(0);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("Contact section")]));
  });

  it("contact section present but no contactInfo detail → 50 (section exists, fields unknown)", () => {
    // report with contact section but no contactInfo key
    const result = scoreCompanyProfileDocument(MINIMAL_REPORT, 5, 5);
    // contact is in sectionsPresent — treated as partial (50)
    expect(result.dimensions.contactCompleteness).toBe(50);
  });

  it("contactInfo with all 4 fields → 100", () => {
    const report = {
      ...MINIMAL_REPORT,
      contactInfo: { email: "a@b.com", phone: "+62111", address: "Jl. X", website: "https://x.com" },
    };
    const result = scoreCompanyProfileDocument(report, 5, 5);
    expect(result.dimensions.contactCompleteness).toBe(100);
  });

  it("contactInfo with 2 of 4 fields → 50", () => {
    const report = {
      ...MINIMAL_REPORT,
      contactInfo: { email: "a@b.com", phone: "+62111", address: "", website: "" },
    };
    const result = scoreCompanyProfileDocument(report, 5, 5);
    expect(result.dimensions.contactCompleteness).toBe(50);
  });
});

// ── Content depth ─────────────────────────────────────────────────────────────

describe("scoreCompanyProfileDocument — content depth", () => {
  it("all bonus sections → contentDepth = 100", () => {
    const result = scoreCompanyProfileDocument(FULL_REPORT, 16, 16);
    // All bonus sections are in FULL_REPORT
    expect(result.dimensions.contentDepth).toBe(100);
  });

  it("no bonus sections → contentDepth = 0", () => {
    const result = scoreCompanyProfileDocument(MINIMAL_REPORT, 5, 5);
    expect(result.dimensions.contentDepth).toBe(0);
  });

  it("half of bonus sections → contentDepth ~50", () => {
    const half = (BONUS_SECTIONS as readonly string[]).slice(0, Math.ceil(BONUS_SECTIONS.length / 2));
    const report = {
      ...MINIMAL_REPORT,
      sectionsIncluded: [...MINIMAL_REPORT.sectionsIncluded, ...half],
    };
    const result = scoreCompanyProfileDocument(report, 5, 5);
    const expected = Math.round((half.length / BONUS_SECTIONS.length) * 100);
    expect(result.dimensions.contentDepth).toBe(expected);
  });
});

// ── Page count met ────────────────────────────────────────────────────────────

describe("scoreCompanyProfileDocument — page count enforcement", () => {
  it("pageCount >= pageTarget → pageCountMet = true, no warning", () => {
    const result = scoreCompanyProfileDocument(FULL_REPORT, 16, 16);
    expect(result.dimensions.pageCountMet).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("Page count"))).toBe(false);
  });

  it("pageCount < pageTarget → pageCountMet = false and warning emitted", () => {
    const result = scoreCompanyProfileDocument(FULL_REPORT, 4, 16);
    expect(result.dimensions.pageCountMet).toBe(false);
    expect(result.warnings.some((w) => w.includes("below package target"))).toBe(true);
  });

  it("pageCount = 0 → pageCountMet = false", () => {
    const result = scoreCompanyProfileDocument(MINIMAL_REPORT, 0, 5);
    expect(result.dimensions.pageCountMet).toBe(false);
  });
});

// ── Overall score and pass/fail ───────────────────────────────────────────────

describe("scoreCompanyProfileDocument — overall score", () => {
  it("perfect document → qcScore = 100 and passed = true", () => {
    const report = {
      ...FULL_REPORT,
      contactInfo: { email: "a@b.com", phone: "+62111", address: "Jl. X", website: "https://x.com" },
    };
    const result = scoreCompanyProfileDocument(report, 16, 16);
    expect(result.qcScore).toBe(100);
    expect(result.passed).toBe(true);
  });

  it("document with no sections at all → qcScore = 0 and passed = false", () => {
    const result = scoreCompanyProfileDocument({ sectionsIncluded: [], sectionsSkipped: [], pageTarget: 5 }, 0, 5);
    expect(result.qcScore).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("qcScore >= QC_PASS_THRESHOLD → passed", () => {
    // Minimal: all required sections, contact section, 0 bonus, page met
    const report = {
      ...MINIMAL_REPORT,
      contactInfo: { email: "a@b.com", phone: "+62111", address: "", website: "" },
    };
    const result = scoreCompanyProfileDocument(report, 5, 5);
    // sectionCoverage=100 * 0.4 = 40
    // contactCompleteness=50 * 0.3 = 15
    // contentDepth=0 * 0.2 = 0
    // pageScore=100 * 0.1 = 10
    // total = 65
    expect(result.qcScore).toBe(65);
    expect(result.passed).toBe(result.qcScore >= QC_PASS_THRESHOLD);
  });

  it("QC_PASS_THRESHOLD is 60", () => {
    expect(QC_PASS_THRESHOLD).toBe(60);
  });
});

// ── scoreFromAssetMetadata convenience wrapper ────────────────────────────────

describe("scoreFromAssetMetadata", () => {
  it("returns null when generationReport is missing", () => {
    const result = scoreFromAssetMetadata({ pageCount: 5 });
    expect(result).toBeNull();
  });

  it("returns null when generationReport is not an object", () => {
    const result = scoreFromAssetMetadata({ generationReport: "string", pageCount: 5 });
    expect(result).toBeNull();
  });

  it("scores correctly from a well-formed metadata blob", () => {
    const metadata = {
      pageCount: 8,
      generationReport: {
        ...MINIMAL_REPORT,
        pageTarget: 5,
        // 2 of 4 contact fields present → contactCompleteness = 50
        // score: 100*0.4 + 50*0.3 + 0*0.2 + 100*0.1 = 40+15+0+10 = 65 → passes
        contactInfo: { email: "a@b.com", phone: "+62111", address: "", website: "" },
      },
    };
    const result = scoreFromAssetMetadata(metadata);
    expect(result).not.toBeNull();
    expect(result?.passed).toBe(true);
  });

  it("uses pageTarget from generationReport if present", () => {
    const metadata = {
      pageCount: 3,
      generationReport: { ...MINIMAL_REPORT, pageTarget: 8 }, // target higher than actual
    };
    const result = scoreFromAssetMetadata(metadata);
    expect(result?.dimensions.pageCountMet).toBe(false);
  });
});
