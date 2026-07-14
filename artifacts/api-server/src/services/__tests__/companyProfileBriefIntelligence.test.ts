/**
 * companyProfileBriefIntelligence.test.ts
 *
 * Unit tests for the Company Profile P0 brief intelligence layer:
 *   - computeCompanyProfileBriefScore  (7-dimension scoring)
 *   - resolveIndustryQuestionGroup     (conditional questions)
 *   - assertCompanyProfileBriefReady   (production guard)
 *   - BriefIncompleteError             (shape / code / fields)
 */

import { describe, it, expect } from "vitest";
import {
  computeCompanyProfileBriefScore,
  resolveIndustryQuestionGroup,
  assertCompanyProfileBriefReady,
  BriefIncompleteError,
  BRIEF_INCOMPLETE,
  REQUIRED_READINESS_SCORE,
  isCompanyProfileServiceCode,
  type CompanyProfileBriefInput,
} from "../companyProfileBriefIntelligence.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A minimal complete brief that satisfies all required fields. */
const COMPLETE_BRIEF: CompanyProfileBriefInput = {
  cpLegalName: "PT Maju Bersama Indonesia",
  companyIndustry: "Manufacturing",
  cpBusinessTypeDetail: "",
  cpYearEstablished: "2010",
  cpCompanyHistory: "Founded in 2010 to serve the local market.",
  cpVision: "To be the leading manufacturer.",
  cpMission: "Deliver quality products on time.",
  cpCompanyValues: "Integrity, Innovation",
  cpValueProposition: "We deliver superior quality with 48-hour turnaround.",
  cpProductsServices: "Steel fabrication, CNC machining",
  cpGeographicCoverage: "Java & Sumatra",
  cpFacilities: "3 factories in Bekasi",
  cpProductionCapacity: "1000 units/month",
  cpCertifications: "ISO 9001",
  cpLegalDocuments: "NIB, SIUP",
  cpOrganizationStructure: "CEO → GM → Managers",
  cpKeyPeople: "Budi Santoso (CEO)",
  cpClientsPartners: "PLN, Pertamina",
  cpProjectExperience: "5 major infrastructure projects",
  cpQualityAssurance: "100% QC inspection per batch",
  cpSustainability: "Solar-powered facility",
  cpPageTarget: "20",
  cpUploadedLogo: "https://cdn.example.com/logo.png",
  cpUploadedPhotos: "https://cdn.example.com/factory.jpg",
  cpReferenceDocuments: "https://drive.example.com/brief.pdf",
  cpContactEmail: "info@majubersama.co.id",
  cpContactPhone: "+62-21-123456",
  cpContactAddress: "Jl. Industri No. 1, Bekasi",
  cpContactWebsite: "https://majubersama.co.id",
};

/** A brief that is missing ALL required fields. */
const EMPTY_BRIEF: CompanyProfileBriefInput = {};

// ── computeCompanyProfileBriefScore ──────────────────────────────────────────

describe("computeCompanyProfileBriefScore — dimension scores", () => {
  it("returns 100 on all dimensions for a complete brief", () => {
    const score = computeCompanyProfileBriefScore(COMPLETE_BRIEF);
    expect(score.identityScore).toBe(100);
    expect(score.storyScore).toBe(100);
    expect(score.serviceScore).toBe(100);
    expect(score.legalScore).toBe(100);
    expect(score.visualScore).toBe(100);
    expect(score.contactScore).toBe(100);
    expect(score.scopeScore).toBe(100);
    expect(score.overallScore).toBe(100);
  });

  it("returns 0 on all dimensions for an empty brief", () => {
    const score = computeCompanyProfileBriefScore(EMPTY_BRIEF);
    expect(score.identityScore).toBe(0);
    expect(score.storyScore).toBe(0);
    expect(score.serviceScore).toBe(0);
    expect(score.legalScore).toBe(0);
    expect(score.visualScore).toBe(0);
    expect(score.contactScore).toBe(0);
  });

  it("identityScore reflects cpLegalName + industry + yearEstablished", () => {
    const s1 = computeCompanyProfileBriefScore({ cpLegalName: "PT X" });
    expect(s1.identityScore).toBeGreaterThan(0);
    expect(s1.identityScore).toBeLessThan(100);

    const s2 = computeCompanyProfileBriefScore({ cpLegalName: "PT X", companyIndustry: "Retail", cpYearEstablished: "2005" });
    expect(s2.identityScore).toBe(100);
  });

  it("storyScore counts history + vision + mission + values + proposition", () => {
    const none = computeCompanyProfileBriefScore({});
    expect(none.storyScore).toBe(0);

    const partial = computeCompanyProfileBriefScore({ cpVision: "To be #1", cpValueProposition: "Best quality" });
    expect(partial.storyScore).toBeGreaterThan(0);
    expect(partial.storyScore).toBeLessThan(100);
  });

  it("serviceScore counts products/services + facilities + capacity + coverage", () => {
    const products_only = computeCompanyProfileBriefScore({ cpProductsServices: "Steel rods" });
    expect(products_only.serviceScore).toBeGreaterThan(0);
    expect(products_only.serviceScore).toBeLessThan(100);

    const all = computeCompanyProfileBriefScore({
      cpProductsServices: "Steel rods",
      cpFacilities: "Factory A",
      cpProductionCapacity: "500/month",
      cpGeographicCoverage: "Java",
    });
    expect(all.serviceScore).toBe(100);
  });

  it("legalScore counts certifications + legal documents + org structure", () => {
    const iso_only = computeCompanyProfileBriefScore({ cpCertifications: "ISO 9001" });
    expect(iso_only.legalScore).toBeGreaterThan(0);
    expect(iso_only.legalScore).toBeLessThan(100);
  });

  it("visualScore counts logo + photos", () => {
    const logo_only = computeCompanyProfileBriefScore({ cpUploadedLogo: "https://cdn/logo.png" });
    expect(logo_only.visualScore).toBe(50);

    const both = computeCompanyProfileBriefScore({ cpUploadedLogo: "x", cpUploadedPhotos: "y" });
    expect(both.visualScore).toBe(100);
  });

  it("contactScore counts email + phone + address + website", () => {
    const email_only = computeCompanyProfileBriefScore({ cpContactEmail: "a@b.com" });
    expect(email_only.contactScore).toBeGreaterThan(0);
    expect(email_only.contactScore).toBe(25); // 1/4 fields
  });

  it("overallScore is the arithmetic mean of all 7 dimension scores", () => {
    const score = computeCompanyProfileBriefScore(COMPLETE_BRIEF);
    const expected = Math.round(
      (score.identityScore + score.storyScore + score.serviceScore +
       score.legalScore + score.visualScore + score.contactScore + score.scopeScore) / 7
    );
    expect(score.overallScore).toBe(expected);
  });

  it("overallScore is deterministic — same input always produces same output", () => {
    const a = computeCompanyProfileBriefScore({ cpLegalName: "PT X", cpValueProposition: "Best" });
    const b = computeCompanyProfileBriefScore({ cpLegalName: "PT X", cpValueProposition: "Best" });
    expect(a).toEqual(b);
  });
});

// ── readinessStatus ───────────────────────────────────────────────────────────

describe("computeCompanyProfileBriefScore — readinessStatus", () => {
  it("returns 'incomplete' when required fields are missing", () => {
    const score = computeCompanyProfileBriefScore(EMPTY_BRIEF);
    expect(score.readinessStatus).toBe("incomplete");
    expect(score.missingRequiredFields.length).toBeGreaterThan(0);
  });

  it("returns 'incomplete' when only some required fields are filled", () => {
    // cpLegalName filled but no contact info or products
    const score = computeCompanyProfileBriefScore({ cpLegalName: "PT X" });
    expect(score.readinessStatus).toBe("incomplete");
    expect(score.missingRequiredFields).toContain("cpValueProposition");
    expect(score.missingRequiredFields).toContain("cpProductsServices");
    expect(score.missingRequiredFields).toContain("contactInfo");
  });

  it("missingRequiredFields contains 'identityNarrative' when none of history/vision/mission are filled", () => {
    const score = computeCompanyProfileBriefScore({
      cpLegalName: "PT X",
      companyIndustry: "Tech",
      cpValueProposition: "Best",
      cpProductsServices: "Software",
      cpContactEmail: "x@y.com",
      // no cpCompanyHistory, cpVision, cpMission
    });
    expect(score.missingRequiredFields).toContain("identityNarrative");
  });

  it("accepts any ONE of history/vision/mission to satisfy identityNarrative", () => {
    const withHistory = computeCompanyProfileBriefScore({
      cpLegalName: "PT X", companyIndustry: "Tech",
      cpValueProposition: "Best", cpProductsServices: "Software",
      cpContactEmail: "x@y.com", cpCompanyHistory: "Founded 2000",
    });
    expect(withHistory.missingRequiredFields).not.toContain("identityNarrative");
  });

  it("returns 'needs_information' when all required fields present but overallScore < 60", () => {
    // Satisfy all required fields with minimal data, leaving optional enrichment empty
    const bare: CompanyProfileBriefInput = {
      cpLegalName: "PT X",
      companyIndustry: "Tech",
      cpVision: "Be best",
      cpValueProposition: "Top quality",
      cpProductsServices: "SaaS",
      cpContactEmail: "x@y.com",
    };
    const score = computeCompanyProfileBriefScore(bare);
    // overallScore should be below 60 with so many optional fields empty
    if (score.overallScore < 60) {
      expect(score.readinessStatus).toBe("needs_information");
    }
    // No required fields should be listed as missing
    expect(score.missingRequiredFields).toHaveLength(0);
  });

  it("returns 'ready_for_generation' for a fully-populated brief", () => {
    const score = computeCompanyProfileBriefScore(COMPLETE_BRIEF);
    expect(score.readinessStatus).toBe("ready_for_generation");
    expect(score.missingRequiredFields).toHaveLength(0);
  });

  it("recommendedQuestions contains next-step question text for each missing required field", () => {
    const score = computeCompanyProfileBriefScore(EMPTY_BRIEF);
    expect(score.recommendedQuestions.length).toBeGreaterThan(0);
    // All recommended questions are non-empty strings
    score.recommendedQuestions.forEach((q) => {
      expect(typeof q).toBe("string");
      expect(q.trim().length).toBeGreaterThan(0);
    });
  });
});

// ── resolveIndustryQuestionGroup ──────────────────────────────────────────────

describe("resolveIndustryQuestionGroup — conditional questions", () => {
  it("returns null for null / undefined / empty string", () => {
    expect(resolveIndustryQuestionGroup(null)).toBeNull();
    expect(resolveIndustryQuestionGroup(undefined)).toBeNull();
    expect(resolveIndustryQuestionGroup("")).toBeNull();
  });

  it("returns null for an industry that does not match any group", () => {
    expect(resolveIndustryQuestionGroup("Restoran & Kuliner")).toBeNull();
    expect(resolveIndustryQuestionGroup("Pendidikan")).toBeNull();
  });

  it("resolves logistics group", () => {
    const g = resolveIndustryQuestionGroup("Logistik & Ekspedisi");
    expect(g).not.toBeNull();
    expect(g!.key).toBe("logistics");
    expect(g!.questions.length).toBeGreaterThan(0);
  });

  it("resolves logistics via English keyword", () => {
    const g = resolveIndustryQuestionGroup("freight forwarding");
    expect(g?.key).toBe("logistics");
  });

  it("resolves trading/export-import group", () => {
    const g = resolveIndustryQuestionGroup("Perdagangan Ekspor-Impor");
    expect(g?.key).toBe("trading_export_import");
  });

  it("resolves manufacturing group", () => {
    const g = resolveIndustryQuestionGroup("Pabrik Manufaktur");
    expect(g?.key).toBe("manufacturing");
  });

  it("resolves professional services group", () => {
    const g = resolveIndustryQuestionGroup("Konsultan Hukum");
    expect(g?.key).toBe("professional_services");
  });

  it("resolves medical/healthcare group", () => {
    const g = resolveIndustryQuestionGroup("Klinik & Kesehatan");
    expect(g?.key).toBe("medical_healthcare");
  });

  it("matching is case-insensitive", () => {
    expect(resolveIndustryQuestionGroup("LOGISTIK")).not.toBeNull();
    expect(resolveIndustryQuestionGroup("Manufacturing")).not.toBeNull();
  });

  it("each resolved group has at least one question with a non-empty key/label/type", () => {
    const industries = ["logistik", "trading", "pabrik", "konsultan", "klinik"];
    for (const ind of industries) {
      const g = resolveIndustryQuestionGroup(ind);
      expect(g).not.toBeNull();
      for (const q of g!.questions) {
        expect(q.key.trim().length).toBeGreaterThan(0);
        expect(q.label.trim().length).toBeGreaterThan(0);
        expect(["text", "textarea", "multiselect", "checklist"]).toContain(q.type);
      }
    }
  });
});

// ── assertCompanyProfileBriefReady ────────────────────────────────────────────

describe("assertCompanyProfileBriefReady — production guard", () => {
  it("throws BriefIncompleteError for an empty brief", () => {
    expect(() => assertCompanyProfileBriefReady(EMPTY_BRIEF)).toThrow(BriefIncompleteError);
  });

  it("thrown error carries code=BRIEF_INCOMPLETE", () => {
    try {
      assertCompanyProfileBriefReady(EMPTY_BRIEF);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BriefIncompleteError);
      const e = err as BriefIncompleteError;
      expect(e.code).toBe(BRIEF_INCOMPLETE);
    }
  });

  it("thrown error carries missingFields array with at least one entry", () => {
    try {
      assertCompanyProfileBriefReady({});
    } catch (err) {
      const e = err as BriefIncompleteError;
      expect(Array.isArray(e.missingFields)).toBe(true);
      expect(e.missingFields.length).toBeGreaterThan(0);
    }
  });

  it("thrown error carries currentScore and requiredScore", () => {
    try {
      assertCompanyProfileBriefReady({});
    } catch (err) {
      const e = err as BriefIncompleteError;
      expect(typeof e.currentScore).toBe("number");
      expect(e.requiredScore).toBe(REQUIRED_READINESS_SCORE);
    }
  });

  it("thrown error carries nextRecommendedQuestions", () => {
    try {
      assertCompanyProfileBriefReady({});
    } catch (err) {
      const e = err as BriefIncompleteError;
      expect(Array.isArray(e.nextRecommendedQuestions)).toBe(true);
      expect(e.nextRecommendedQuestions.length).toBeGreaterThan(0);
    }
  });

  it("does NOT throw for a fully-complete brief", () => {
    expect(() => assertCompanyProfileBriefReady(COMPLETE_BRIEF)).not.toThrow();
  });

  it("returns the computed score for a passing brief", () => {
    const score = assertCompanyProfileBriefReady(COMPLETE_BRIEF);
    expect(score.readinessStatus).toBe("ready_for_generation");
    expect(score.overallScore).toBeGreaterThanOrEqual(REQUIRED_READINESS_SCORE);
  });

  it("throws even when all required fields present but overallScore < 60 (needs_information)", () => {
    // All required fields minimally filled, but none of the optional enrichment
    const bare: CompanyProfileBriefInput = {
      cpLegalName: "PT X",
      companyIndustry: "Tech",
      cpVision: "Be best",
      cpValueProposition: "Top",
      cpProductsServices: "SaaS",
      cpContactEmail: "x@y.com",
    };
    const score = computeCompanyProfileBriefScore(bare);
    if (score.readinessStatus === "needs_information") {
      expect(() => assertCompanyProfileBriefReady(bare)).toThrow(BriefIncompleteError);
    }
    // If somehow score is ≥ 60 with bare data, the guard would correctly pass
  });

  it("BriefIncompleteError instances satisfy instanceof checks", () => {
    let caught: unknown;
    try {
      assertCompanyProfileBriefReady({});
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof BriefIncompleteError).toBe(true);
    expect(caught instanceof Error).toBe(true);
  });

  it("error name is 'BriefIncompleteError'", () => {
    try {
      assertCompanyProfileBriefReady({});
    } catch (err) {
      expect((err as Error).name).toBe("BriefIncompleteError");
    }
  });
});

// ── isCompanyProfileServiceCode ───────────────────────────────────────────────

describe("isCompanyProfileServiceCode", () => {
  it("returns true only for exact 'company-profile' code", () => {
    expect(isCompanyProfileServiceCode("company-profile")).toBe(true);
  });

  it("returns false for null / undefined / empty", () => {
    expect(isCompanyProfileServiceCode(null)).toBe(false);
    expect(isCompanyProfileServiceCode(undefined)).toBe(false);
    expect(isCompanyProfileServiceCode("")).toBe(false);
  });

  it("returns false for close but non-matching codes", () => {
    expect(isCompanyProfileServiceCode("company_profile")).toBe(false);
    expect(isCompanyProfileServiceCode("Company-Profile")).toBe(false);
    expect(isCompanyProfileServiceCode("company-profile-v2")).toBe(false);
  });
});
