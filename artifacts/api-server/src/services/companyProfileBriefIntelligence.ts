/**
 * companyProfileBriefIntelligence.ts — Company Profile Full Sprint, Workstream 1 (P0)
 *
 * Deterministic, non-fabricating scoring of a Company Profile brief
 * (`ai_service_requests.brief_json`) plus the industry-conditional question
 * groups and the production guard that blocks generation on an incomplete
 * brief.
 *
 * Rules:
 *   - Pure function. Same input → same output. No I/O, no LLM calls.
 *   - Never invents field values — only reads what the customer/admin supplied.
 *   - readinessStatus is the single source of truth the production guard reads.
 */

// ── Brief field keys ────────────────────────────────────────────────────────
//
// The generic brief wizard (artifacts/customer-portal/src/pages/brief.tsx)
// stores every service's brief under the same shape (companyIndustry,
// outputFormats, existingAssets, specialRequirements, ...) inside
// ai_service_requests.brief_json. Company Profile needs ~22 additional,
// service-specific fields that the generic wizard has no room for — these
// are namespaced with a `cp` prefix so they never collide with the generic
// fields or with any other service's brief data.

/** Generic wizard fields this module also reads (never writes). */
export const GENERIC_BRIEF_FIELDS = ["companyIndustry", "existingAssets", "specialRequirements"] as const;

export const NEW_BRIEF_FIELDS = [
  "cpLegalName",
  "cpBusinessTypeDetail",
  "cpYearEstablished",
  "cpCompanyHistory",
  "cpVision",
  "cpMission",
  "cpCompanyValues",
  "cpValueProposition",
  "cpProductsServices",
  "cpGeographicCoverage",
  "cpFacilities",
  "cpProductionCapacity",
  "cpCertifications",
  "cpLegalDocuments",
  "cpOrganizationStructure",
  "cpKeyPeople",
  "cpClientsPartners",
  "cpProjectExperience",
  "cpQualityAssurance",
  "cpSustainability",
  "cpPageTarget",
  "cpUploadedLogo",
  "cpUploadedPhotos",
  "cpReferenceDocuments",
  "cpContactEmail",
  "cpContactPhone",
  "cpContactAddress",
  "cpContactWebsite",
] as const;

export type CompanyProfileBriefInput = Partial<
  Record<(typeof GENERIC_BRIEF_FIELDS)[number] | (typeof NEW_BRIEF_FIELDS)[number], unknown>
>;

// ── Industry-conditional question groups ───────────────────────────────────

export type IndustryQuestionGroupKey =
  | "logistics"
  | "trading_export_import"
  | "manufacturing"
  | "professional_services"
  | "medical_healthcare";

export interface ConditionalQuestion {
  key: string;
  label: string;
  type: "text" | "textarea" | "multiselect" | "checklist";
}

export interface IndustryQuestionGroup {
  key: IndustryQuestionGroupKey;
  label: string;
  questions: ConditionalQuestion[];
}

/** Free-text businessType/industry values that map into each conditional group. */
const INDUSTRY_GROUP_MATCHERS: Record<IndustryQuestionGroupKey, string[]> = {
  logistics: ["logistics", "logistik", "freight", "shipping", "warehousing", "ekspedisi"],
  trading_export_import: ["trading", "export", "import", "export_import", "perdagangan", "ekspor", "impor"],
  manufacturing: ["manufacturing", "factory", "manufaktur", "pabrik", "produksi", "industri"],
  professional_services: ["professional_svcs", "consulting", "law", "accounting", "jasa profesional", "konsultan"],
  medical_healthcare: ["healthcare", "hospital", "clinic", "medical", "kesehatan", "klinik", "rumah sakit"],
};

export const INDUSTRY_QUESTION_GROUPS: Record<IndustryQuestionGroupKey, IndustryQuestionGroup> = {
  logistics: {
    key: "logistics",
    label: "Logistics",
    questions: [
      { key: "serviceCoverage", label: "Service coverage", type: "textarea" },
      { key: "fleet", label: "Fleet", type: "textarea" },
      { key: "warehouse", label: "Warehouse", type: "textarea" },
      { key: "customsClearance", label: "Customs clearance", type: "text" },
      { key: "logisticsCertifications", label: "Certifications", type: "checklist" },
      { key: "operatingRegions", label: "Operating regions", type: "multiselect" },
    ],
  },
  trading_export_import: {
    key: "trading_export_import",
    label: "Trading / Export-Import",
    questions: [
      { key: "commodities", label: "Commodities", type: "textarea" },
      { key: "sourceCountries", label: "Source countries", type: "multiselect" },
      { key: "destinationCountries", label: "Destination countries", type: "multiselect" },
      { key: "monthlyCapacity", label: "Monthly capacity", type: "text" },
      { key: "incoterms", label: "Incoterms", type: "text" },
      { key: "qualityDocuments", label: "Quality documents", type: "checklist" },
    ],
  },
  manufacturing: {
    key: "manufacturing",
    label: "Manufacturing",
    questions: [
      { key: "factory", label: "Factory", type: "textarea" },
      { key: "machinery", label: "Machinery", type: "textarea" },
      { key: "manufacturingCapacity", label: "Capacity", type: "text" },
      { key: "manufacturingQa", label: "Quality assurance", type: "textarea" },
      { key: "manufacturingCertifications", label: "Certifications", type: "checklist" },
    ],
  },
  professional_services: {
    key: "professional_services",
    label: "Professional Services",
    questions: [
      { key: "expertise", label: "Expertise", type: "textarea" },
      { key: "methodology", label: "Methodology", type: "textarea" },
      { key: "team", label: "Team", type: "textarea" },
      { key: "caseExperience", label: "Case experience", type: "textarea" },
      { key: "industriesServed", label: "Industries served", type: "multiselect" },
    ],
  },
  medical_healthcare: {
    key: "medical_healthcare",
    label: "Medical / Healthcare",
    questions: [
      { key: "medicalServices", label: "Services", type: "textarea" },
      { key: "facility", label: "Facility", type: "textarea" },
      { key: "licenses", label: "Licenses", type: "checklist" },
      { key: "doctorsTeam", label: "Doctors / team", type: "textarea" },
      { key: "operatingHours", label: "Operating hours", type: "text" },
      { key: "safetyQuality", label: "Safety / quality", type: "textarea" },
    ],
  },
};

/**
 * Resolve which conditional question group (if any) applies to a business
 * type / industry free-text value. Returns null when nothing matches — the
 * brief simply has no extra conditional questions, which is a valid state,
 * not an error.
 */
export function resolveIndustryQuestionGroup(businessType: string | null | undefined): IndustryQuestionGroup | null {
  if (!businessType) return null;
  const normalized = businessType.toLowerCase();
  for (const [key, needles] of Object.entries(INDUSTRY_GROUP_MATCHERS) as [IndustryQuestionGroupKey, string[]][]) {
    if (needles.some((n) => normalized.includes(n))) {
      return INDUSTRY_QUESTION_GROUPS[key];
    }
  }
  return null;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface CompanyProfileBriefScore {
  identityScore: number;
  storyScore: number;
  serviceScore: number;
  legalScore: number;
  visualScore: number;
  contactScore: number;
  scopeScore: number;
  overallScore: number;
  missingRequiredFields: string[];
  recommendedQuestions: string[];
  readinessStatus: "incomplete" | "needs_information" | "ready_for_generation";
}

/** Required for readiness = "ready_for_generation". Kept intentionally small
 *  and factual — these are the fields the document mapper cannot function
 *  without without fabricating content. */
const REQUIRED_FIELDS: { key: string; present: (b: CompanyProfileBriefInput) => boolean; question: string }[] = [
  { key: "cpLegalName", present: (b) => hasText(b.cpLegalName), question: "What is the company's legal / registered name?" },
  {
    key: "businessType",
    present: (b) => hasText(b.companyIndustry) || hasText(b.cpBusinessTypeDetail),
    question: "What type of business is this?",
  },
  {
    key: "identityNarrative",
    present: (b) => hasText(b.cpCompanyHistory) || hasText(b.cpVision) || hasText(b.cpMission),
    question: "Tell us your company history, vision, or mission (at least one).",
  },
  { key: "cpValueProposition", present: (b) => hasText(b.cpValueProposition), question: "What is your value proposition — why should customers choose you?" },
  { key: "cpProductsServices", present: (b) => hasText(b.cpProductsServices), question: "What products or services do you offer?" },
  {
    key: "contactInfo",
    present: (b) => hasText(b.cpContactEmail) || hasText(b.cpContactPhone),
    question: "What is a contact email or phone number for this business?",
  },
];

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
/** Accepts either a non-empty string (comma/newline separated list, as the
 *  brief wizard stores it) or a genuine array — both count as "provided". */
function hasItems(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return hasText(v);
}
function pct(present: number, total: number): number {
  if (total === 0) return 100;
  return Math.round((present / total) * 100);
}

/**
 * Compute the 7 dimension scores + overall + readiness for a Company
 * Profile brief. Deterministic — no LLM, no randomness.
 */
export function computeCompanyProfileBriefScore(brief: CompanyProfileBriefInput): CompanyProfileBriefScore {
  // identityScore — who the company is
  const identityFields = [hasText(brief.cpLegalName), hasText(brief.companyIndustry) || hasText(brief.cpBusinessTypeDetail), hasText(brief.cpYearEstablished)];
  const identityScore = pct(identityFields.filter(Boolean).length, identityFields.length);

  // storyScore — narrative (history/vision/mission/values/proposition)
  const storyFields = [hasText(brief.cpCompanyHistory), hasText(brief.cpVision), hasText(brief.cpMission), hasItems(brief.cpCompanyValues), hasText(brief.cpValueProposition)];
  const storyScore = pct(storyFields.filter(Boolean).length, storyFields.length);

  // serviceScore — products/services + capabilities + capacity
  const serviceFields = [hasText(brief.cpProductsServices), hasText(brief.cpFacilities), hasText(brief.cpProductionCapacity), hasText(brief.cpGeographicCoverage)];
  const serviceScore = pct(serviceFields.filter(Boolean).length, serviceFields.length);

  // legalScore — certifications / legal documents / org structure
  const legalFields = [hasItems(brief.cpCertifications), hasItems(brief.cpLegalDocuments), hasText(brief.cpOrganizationStructure)];
  const legalScore = pct(legalFields.filter(Boolean).length, legalFields.length);

  // visualScore — logo / photos / brand assets
  const visualFields = [hasText(brief.cpUploadedLogo), hasItems(brief.cpUploadedPhotos)];
  const visualScore = pct(visualFields.filter(Boolean).length, visualFields.length);

  // contactScore — reachability
  const contactFields = [hasText(brief.cpContactEmail), hasText(brief.cpContactPhone), hasText(brief.cpContactAddress), hasText(brief.cpContactWebsite)];
  const contactScore = pct(contactFields.filter(Boolean).length, contactFields.length);

  // scopeScore — page target + reference material + project experience/clients
  const scopeFields = [hasText(brief.cpPageTarget), hasItems(brief.cpReferenceDocuments), hasItems(brief.cpProjectExperience) || hasItems(brief.cpClientsPartners)];
  const scopeScore = pct(scopeFields.filter(Boolean).length, scopeFields.length);

  const overallScore = Math.round(
    (identityScore + storyScore + serviceScore + legalScore + visualScore + contactScore + scopeScore) / 7,
  );

  const missingRequiredFields: string[] = [];
  const recommendedQuestions: string[] = [];
  for (const req of REQUIRED_FIELDS) {
    if (!req.present(brief)) {
      missingRequiredFields.push(req.key);
      recommendedQuestions.push(req.question);
    }
  }

  let readinessStatus: CompanyProfileBriefScore["readinessStatus"];
  if (missingRequiredFields.length > 0) {
    readinessStatus = "incomplete";
  } else if (overallScore < 60) {
    readinessStatus = "needs_information";
  } else {
    readinessStatus = "ready_for_generation";
  }

  return {
    identityScore,
    storyScore,
    serviceScore,
    legalScore,
    visualScore,
    contactScore,
    scopeScore,
    overallScore,
    missingRequiredFields,
    recommendedQuestions,
    readinessStatus,
  };
}

// ── Production guard ──────────────────────────────────────────────────────────

/** The catalog `serviceCode` this guard applies to. Every other service is
 *  unaffected — this sprint is scoped to Company Profile only. */
export const COMPANY_PROFILE_SERVICE_CODE = "company-profile";

export function isCompanyProfileServiceCode(serviceCode: string | null | undefined): boolean {
  return serviceCode === COMPANY_PROFILE_SERVICE_CODE;
}

export const BRIEF_INCOMPLETE = "BRIEF_INCOMPLETE";

export const REQUIRED_READINESS_SCORE = 60;

export class BriefIncompleteError extends Error {
  readonly code = BRIEF_INCOMPLETE;
  constructor(
    public readonly missingFields: string[],
    public readonly currentScore: number,
    public readonly requiredScore: number,
    public readonly nextRecommendedQuestions: string[],
  ) {
    super(
      `Company Profile brief is not ready for generation. Missing: ${missingFields.join(", ") || "(score below threshold)"}.`,
    );
    this.name = "BriefIncompleteError";
  }
}

/**
 * Throws BriefIncompleteError unless the brief's readinessStatus is
 * "ready_for_generation". Callers should catch this and return a 422 with
 * the structured fields (code/missingFields/currentScore/requiredScore/
 * nextRecommendedQuestions), or skip the check entirely when a valid admin
 * override is present on the request row.
 */
export function assertCompanyProfileBriefReady(brief: CompanyProfileBriefInput): CompanyProfileBriefScore {
  const score = computeCompanyProfileBriefScore(brief);
  if (score.readinessStatus !== "ready_for_generation") {
    throw new BriefIncompleteError(
      score.missingRequiredFields,
      score.overallScore,
      REQUIRED_READINESS_SCORE,
      score.recommendedQuestions,
    );
  }
  return score;
}
