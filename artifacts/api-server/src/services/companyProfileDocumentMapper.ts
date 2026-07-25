/**
 * companyProfileDocumentMapper.ts — Company Profile Full Sprint, Workstream 2 (P1)
 *
 * Maps a creative project brief + existing AI outputs to a CreativeDocumentSpec
 * for the Company Profile document type.
 *
 * P1 changes (document sections):
 *   - CompanyProfileBrief now includes all 27 cp* fields from brief_json
 *   - Prompt uses cp* fields (cpVision, cpMission, cpValueProposition, etc.) —
 *     falls back to generic project columns for legacy projects without cp* data
 *   - Spec builder prefers cp* contact fields over LLM-generated contact info
 *   - New sections: Key People, Org Structure, Clients & Partners, Quality
 *     Assurance, Sustainability — gated by packageLevel
 *   - Package enforcement: packageLevel drives section inclusion and pageTarget
 *
 * Rules from spec:
 *   - Do NOT fabricate facts not present in the brief
 *   - Do NOT include Lorem ipsum or placeholders
 *   - Skip missing optional sections (record in generationReport)
 *   - Contact section only includes data that was provided
 */

import { routeToModel } from "./aiModelRouter.js";
import { executeAI } from "./aiExecutionService.js";
import { recordCost } from "./costService.js";
import { parseJsonResponse } from "./creativeAiService.js";
import type { CreativeDocumentSpec, CreativeDocumentSection } from "./creativeDocumentService.js";

// ── LLM output type ────────────────────────────────────────────────────────────

export interface CompanyProfileContent {
  about: string;
  vision: string;
  mission: string;
  coreValues: string[];
  servicesOrProducts: Array<{ name: string; description: string }>;
  competitiveAdvantages: string[];
  industriesServed: string[];
  operationalCapabilities: string;
  milestones: Array<{ year: string; event: string }>;
  teamDescription: string;
  certifications: string[];
  tagline: string;
  closing: string;
  contactInfo: {
    email: string;
    phone: string;
    address: string;
    website: string;
  };
}

// ── Generation report ──────────────────────────────────────────────────────────

export interface SectionGenerationNote {
  sectionId: string;
  included: boolean;
  reason?: string;
}

// ── Package level constants ────────────────────────────────────────────────────

/** Numeric rank per packageLevel — used for "packageLevel >= X" guards. */
const PACKAGE_RANK: Record<string, number> = {
  starter: 0,
  professional: 1,
  business: 2,
  enterprise: 3,
};

/** Minimum page counts expected per package level. */
export const PACKAGE_PAGE_TARGETS: Record<string, number> = {
  starter: 5,
  professional: 8,
  business: 12,
  enterprise: 16,
};

function packageRank(level: string | undefined): number {
  return PACKAGE_RANK[level ?? "starter"] ?? 0;
}

// ── Brief type ─────────────────────────────────────────────────────────────────

export interface CompanyProfileBrief {
  // ── Generic project columns (always present on creative_projects) ──
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  goal: string;
  notes?: string | null;
  colorPreference?: string | null;
  stylePreference?: string | null;
  // ── P1: cp* enriched fields from ai_service_requests.brief_json ──
  // All optional — absent for legacy projects that predate P0.
  cpLegalName?: string;
  cpCompanyHistory?: string;
  cpVision?: string;
  cpMission?: string;
  cpCompanyValues?: string;
  cpValueProposition?: string;
  cpProductsServices?: string;
  cpGeographicCoverage?: string;
  cpFacilities?: string;
  cpProductionCapacity?: string;
  cpCertifications?: string;
  cpLegalDocuments?: string;
  cpOrganizationStructure?: string;
  cpKeyPeople?: string;
  cpClientsPartners?: string;
  cpProjectExperience?: string;
  cpQualityAssurance?: string;
  cpSustainability?: string;
  cpPageTarget?: string;
  cpContactEmail?: string;
  cpContactPhone?: string;
  cpContactAddress?: string;
  cpContactWebsite?: string;
  // ── P1.3: uploaded assets (object storage URLs, not embedded in the PDF —
  // logo/photos are only used for brief-completeness scoring today; the
  // PDF's images still come from the AI image pipeline, see
  // mapCompanyProfileToDocumentSpec's `existingImages` param) ──
  cpUploadedLogo?: string;
  cpUploadedPhotos?: string;
  cpReferenceDocuments?: string;
  cpVideo?: string;
  // ── P1.2: Package enforcement ──
  packageLevel?: string;  // starter | professional | business | enterprise
  packageName?: string;
}

// ── LLM call ─────────────────────────────────────────────────────────────────

const COMPANY_PROFILE_SYSTEM_PROMPT = `You are a professional business document writer specializing in company profiles for Indonesian businesses. You write in Bahasa Indonesia yang formal dan profesional.

Your task is to generate structured content for a company profile document based on the business brief provided.

Critical rules:
- ONLY include information that can be reasonably derived from the brief
- Do NOT fabricate specific facts (employee counts, founding years, specific revenue figures, specific addresses) unless they are explicitly stated
- Do NOT use placeholders like "[Company Name]", "X employees", or "Lorem ipsum"
- Leave a field as an empty string "" or empty array [] when there is no basis for content
- All content must be professional, concise, and appropriate for a formal business document
- Keep each section appropriately brief (2-4 sentences for paragraphs, 3-6 items for lists)

Always respond with valid JSON only. No markdown, no explanation text.`;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function buildCompanyProfilePrompt(
  brief: CompanyProfileBrief,
  existingCopy: Record<string, unknown>,
  existingBrandStrategy: Record<string, unknown>,
): string {
  // Prefer cp* fields; fall back to generic project columns for legacy projects.
  const companyName       = str(brief.cpLegalName) || str(brief.brandName);
  const businessType      = str(brief.businessType);
  const valueProposition  = str(brief.cpValueProposition);
  const productsServices  = str(brief.cpProductsServices) || str(brief.productOrService);
  const vision            = str(brief.cpVision);
  const mission           = str(brief.cpMission);
  const companyHistory    = str(brief.cpCompanyHistory);
  const companyValues     = str(brief.cpCompanyValues);
  const targetMarket      = str(brief.targetMarket);
  const goal              = str(brief.goal);
  const notes             = str(brief.notes ?? "");

  const copyTagline = str(existingCopy["tagline"] as unknown);
  const copyBodyLong = str(
    (existingCopy["body_copy"] as Record<string, unknown> | undefined)?.["long"] as unknown,
  );
  const strategyPositioning =
    str(existingBrandStrategy["positioning"] as unknown) ||
    str(existingBrandStrategy["brand_positioning"] as unknown);

  return `Generate structured company profile content for the following business:

BUSINESS BRIEF:
- Company Name: ${companyName}
- Business Type: ${businessType}
- Target Market: ${targetMarket}
- Business Goal: ${goal}
${valueProposition ? `- Value Proposition: ${valueProposition}` : ""}
${productsServices ? `- Products/Services: ${productsServices}` : ""}
${vision ? `- Company Vision: ${vision}` : ""}
${mission ? `- Company Mission: ${mission}` : ""}
${companyHistory ? `- Company History: ${companyHistory}` : ""}
${companyValues ? `- Core Values (from brief): ${companyValues}` : ""}
${notes ? `- Additional Notes: ${notes}` : ""}

EXISTING BRAND ANALYSIS:
${strategyPositioning ? `- Brand Positioning: ${strategyPositioning}` : ""}
${copyTagline ? `- Tagline: ${copyTagline}` : ""}
${copyBodyLong ? `- Brand Description: ${copyBodyLong}` : ""}

INSTRUCTIONS:
- For vision/mission: use the provided text verbatim if present; do NOT rewrite it
- For coreValues: extract from the provided core values text if present; do NOT invent new values
- For servicesOrProducts: expand the provided products/services list into professional descriptions
- For contactInfo: leave ALL contact fields empty — they will be supplied directly from the brief

Return ONLY this JSON object (no markdown, no explanation):
{
  "about": "3-4 sentence professional overview of the company",
  "vision": "vision statement (1-2 sentences — use brief text verbatim if provided)",
  "mission": "mission statement (use brief text verbatim if provided)",
  "coreValues": ["value1", "value2", "value3"],
  "servicesOrProducts": [
    { "name": "service/product name", "description": "1-2 sentence description" }
  ],
  "competitiveAdvantages": ["advantage1", "advantage2", "advantage3"],
  "industriesServed": ["industry1", "industry2"],
  "operationalCapabilities": "paragraph describing operational capabilities and capacity",
  "milestones": [],
  "teamDescription": "brief description of team or organizational approach (leave empty if not stated)",
  "certifications": [],
  "tagline": "the company tagline (use the provided tagline if available)",
  "closing": "closing statement for the company profile (1-2 sentences)",
  "contactInfo": { "email": "", "phone": "", "address": "", "website": "" }
}`;
}

// ── Main LLM call ──────────────────────────────────────────────────────────────

export async function generateCompanyProfileContent(
  brief: CompanyProfileBrief,
  existingOutputs: {
    copy?: Record<string, unknown>;
    brandStrategy?: Record<string, unknown>;
  },
  projectId: string,
  projectDbId: number,
): Promise<{
  content: CompanyProfileContent;
  llmUsage: {
    provider: string;
    model: string;
    tokensUsed: number;
    estimatedCostUsd: number;
    latencyMs: number;
  };
}> {
  const companyName = str(brief.cpLegalName) || str(brief.brandName);
  const businessType = str(brief.businessType);

  const routed = await routeToModel(
    `Generate structured company profile content for ${companyName} (${businessType})`,
  );

  if (!routed) {
    throw new Error(
      "No active AI model available for company profile content generation. " +
      "Please configure a provider API key in Settings.",
    );
  }

  const prompt = buildCompanyProfilePrompt(
    brief,
    existingOutputs.copy ?? {},
    existingOutputs.brandStrategy ?? {},
  );

  const result = await executeAI({
    prompt,
    systemPrompt: COMPANY_PROFILE_SYSTEM_PROMPT,
    model:        routed.model,
    provider:     routed.provider,
    temperature:  0.4,
    maxTokens:    2000,
    observability: {
      agentName:    "company-profile-mapper",
      providerName: routed.provider.slug,
      modelName:    routed.model.modelId,
      requestType:  "text",
    },
  });

  // Record cost (non-blocking)
  await recordCost({
    projectId,
    stepId:      null as unknown as number,
    clientId:    companyName,
    agentSlug:   "company-profile-mapper",
    provider:    routed.provider.slug,
    model:       routed.model.modelId,
    inputTokens: result.promptTokens,
    outputTokens: result.completionTokens,
    latencyMs:   result.latencyMs,
    retryCount:  0,
    fallbackCount: 0,
    status:      "success",
    modelRecord: routed.model,
  }).catch((err) => {
    console.warn("[company-profile-mapper] Cost recording failed (non-blocking):", err);
  });

  // Parse JSON
  const parsed = parseJsonResponse(result.content) as Partial<CompanyProfileContent>;

  // Provide safe defaults for all fields
  const content: CompanyProfileContent = {
    about:                  str(parsed.about),
    vision:                 str(parsed.vision),
    mission:                str(parsed.mission),
    coreValues:             Array.isArray(parsed.coreValues) ? parsed.coreValues.filter(isStr) : [],
    servicesOrProducts:     Array.isArray(parsed.servicesOrProducts) ? parsed.servicesOrProducts.filter(isServiceItem) : [],
    competitiveAdvantages:  Array.isArray(parsed.competitiveAdvantages) ? parsed.competitiveAdvantages.filter(isStr) : [],
    industriesServed:       Array.isArray(parsed.industriesServed) ? parsed.industriesServed.filter(isStr) : [],
    operationalCapabilities: str(parsed.operationalCapabilities),
    milestones:             Array.isArray(parsed.milestones) ? parsed.milestones.filter(isMilestone) : [],
    teamDescription:        str(parsed.teamDescription),
    certifications:         Array.isArray(parsed.certifications) ? parsed.certifications.filter(isStr) : [],
    tagline:                str(parsed.tagline),
    closing:                str(parsed.closing),
    contactInfo: {
      email:   "",
      phone:   "",
      address: "",
      website: "",
    },
  };

  return {
    content,
    llmUsage: {
      provider:         routed.provider.slug,
      model:            routed.model.modelId,
      tokensUsed:       result.tokensUsed,
      estimatedCostUsd: 0,
      latencyMs:        result.latencyMs,
    },
  };
}

// ── Type guards ────────────────────────────────────────────────────────────────

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isServiceItem(v: unknown): v is { name: string; description: string } {
  return !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>)["name"] === "string" &&
    typeof (v as Record<string, unknown>)["description"] === "string";
}
function isMilestone(v: unknown): v is { year: string; event: string } {
  return !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>)["year"] === "string" &&
    typeof (v as Record<string, unknown>)["event"] === "string";
}

/** Split a free-text list (comma or newline separated) into an array of items. */
function splitList(v: string): string[] {
  return v
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ── Spec builder ───────────────────────────────────────────────────────────────

export interface MappingGenerationReport {
  sectionsIncluded: string[];
  sectionsSkipped: SectionGenerationNote[];
  coverImageIncluded: boolean;
  llmProvider: string;
  llmModel: string;
  llmTokensUsed: number;
  llmLatencyMs: number;
  packageLevel: string;
  pageTarget: number;
}

/**
 * Map a Company Profile LLM result + brief into a full `CreativeDocumentSpec`.
 *
 * P1 changes:
 *   - Prefers cp* contact fields over LLM-generated contact info
 *   - Adds Key People, Org Structure, Clients & Partners, Quality Assurance,
 *     and Sustainability sections (gated by packageLevel)
 *   - Milestones threshold lowered to 1 for business/enterprise packages
 */
export function mapCompanyProfileToDocumentSpec(
  brief: CompanyProfileBrief,
  content: CompanyProfileContent,
  coverImageBuffer: Buffer | null,
  existingImages: Array<{ buffer: Buffer; caption?: string }>,
): { spec: CreativeDocumentSpec; report: MappingGenerationReport } {
  const sections: CreativeDocumentSection[] = [];
  const included: string[] = [];
  const skipped: SectionGenerationNote[] = [];
  const rank = packageRank(brief.packageLevel);
  const effectivePageTarget = PACKAGE_PAGE_TARGETS[brief.packageLevel ?? "starter"] ?? 5;

  function skip(id: string, reason: string) {
    skipped.push({ sectionId: id, included: false, reason });
  }
  function include(id: string, ...newSections: CreativeDocumentSection[]) {
    included.push(id);
    sections.push(...newSections);
  }

  // ── About ────────────────────────────────────────────────────────────────────
  if (content.about.trim()) {
    include(
      "about",
      { type: "heading", title: "About the Company", subtitle: brief.businessType },
      { type: "paragraph", text: content.about },
    );
  } else {
    skip("about", "LLM returned empty about section");
  }

  // ── Vision & Mission ─────────────────────────────────────────────────────────
  // Prefer brief-supplied text; fall through to LLM output
  const visionText  = str(brief.cpVision)   || content.vision;
  const missionText = str(brief.cpMission)  || content.mission;
  const hasVision   = visionText.length > 0;
  const hasMission  = missionText.length > 0;

  if (hasVision || hasMission) {
    include("vision-mission", { type: "heading", title: "Vision & Mission" });
    if (hasVision) {
      const companyName = str(brief.cpLegalName) || str(brief.brandName);
      sections.push(
        { type: "quote", text: visionText, attribution: `Vision — ${companyName}` },
      );
      included.push("vision");
    } else {
      skip("vision", "No vision statement available");
    }
    if (hasMission) {
      sections.push({ type: "paragraph", text: missionText });
      included.push("mission");
    } else {
      skip("mission", "No mission statement available");
    }
  } else {
    skip("vision-mission", "Neither vision nor mission available");
  }

  // ── Core Values ──────────────────────────────────────────────────────────────
  // Use brief's cpCompanyValues first (split if free-text), fall back to LLM
  const briefValues = str(brief.cpCompanyValues) ? splitList(str(brief.cpCompanyValues)) : [];
  const valuesItems = briefValues.length > 0 ? briefValues : content.coreValues;

  if (valuesItems.length >= 2) {
    include(
      "core-values",
      { type: "heading", title: "Core Values" },
      { type: "bullets", items: valuesItems },
    );
  } else {
    skip("core-values", "Fewer than 2 core values available");
  }

  // ── Services / Products ──────────────────────────────────────────────────────
  if (content.servicesOrProducts.length > 0) {
    include(
      "services",
      { type: "heading", title: "Products & Services", subtitle: str(brief.cpProductsServices) || brief.productOrService },
    );
    for (const svc of content.servicesOrProducts) {
      sections.push({ type: "paragraph", text: `${svc.name}\n${svc.description}` });
    }
    included.push("services-detail");
  } else {
    const fallback = str(brief.cpProductsServices) || str(brief.productOrService);
    if (fallback) {
      include(
        "services",
        { type: "heading", title: "Products & Services" },
        { type: "paragraph", text: fallback },
      );
    } else {
      skip("services", "No products/services data available");
    }
  }

  // ── Company overview image ───────────────────────────────────────────────────
  if (existingImages.length > 0 && existingImages[0]) {
    const img = existingImages[0];
    const companyName = str(brief.cpLegalName) || str(brief.brandName);
    sections.push({
      type: "image",
      imageUrl: "",
      imageBuffer: img.buffer,
      caption: img.caption ?? `${companyName} — Visual Identity`,
    });
    included.push("company-image");
  }

  // ── Competitive Advantages ───────────────────────────────────────────────────
  if (content.competitiveAdvantages.length >= 2) {
    include(
      "competitive-advantages",
      { type: "heading", title: "Our Competitive Advantages" },
      { type: "bullets", items: content.competitiveAdvantages },
    );
  } else {
    skip("competitive-advantages", "Fewer than 2 competitive advantages available");
  }

  // ── Industries / Target Market ───────────────────────────────────────────────
  const industryItems = content.industriesServed.length > 0
    ? content.industriesServed
    : [brief.targetMarket];

  if (industryItems.some((i) => i.trim())) {
    include(
      "industries",
      { type: "heading", title: "Industries & Customers Served" },
      { type: "bullets", items: industryItems.filter((i) => i.trim()) },
    );
  } else {
    skip("industries", "No industry data available");
  }

  // ── Operational Capabilities ─────────────────────────────────────────────────
  const opCapabilities = content.operationalCapabilities.trim() ||
    [str(brief.cpFacilities), str(brief.cpProductionCapacity), str(brief.cpGeographicCoverage)]
      .filter(Boolean)
      .join("\n");

  if (opCapabilities) {
    include(
      "operational",
      { type: "heading", title: "Operational Capabilities" },
      { type: "paragraph", text: opCapabilities },
    );
  } else {
    skip("operational", "No operational capability data in brief");
  }

  // ── Milestones ───────────────────────────────────────────────────────────────
  // Threshold: enterprise/business → 1+ milestone; others → 2+
  const milestonesThreshold = rank >= packageRank("business") ? 1 : 2;
  if (content.milestones.length >= milestonesThreshold) {
    const rows = content.milestones.map((m) => [m.year, m.event]);
    include(
      "milestones",
      { type: "heading", title: "Our Journey" },
      { type: "table", headers: ["Year", "Milestone"], rows },
    );
  } else {
    skip("milestones", `Fewer than ${milestonesThreshold} milestones available`);
  }

  // ── Team ─────────────────────────────────────────────────────────────────────
  if (content.teamDescription.trim()) {
    include(
      "team",
      { type: "heading", title: "Our Team" },
      { type: "paragraph", text: content.teamDescription },
    );
  } else {
    skip("team", "No team description available in brief");
  }

  // ── Certifications ───────────────────────────────────────────────────────────
  // Use brief cpCertifications first (more reliable), then LLM output
  const briefCerts = str(brief.cpCertifications) ? splitList(str(brief.cpCertifications)) : [];
  const certItems  = briefCerts.length > 0 ? briefCerts : content.certifications;

  if (certItems.length > 0) {
    include(
      "certifications",
      { type: "heading", title: "Certifications & Compliance" },
      { type: "bullets", items: certItems },
    );
  } else {
    skip("certifications", "No certifications provided — section omitted");
  }

  // ── P1: Key People (professional+) ──────────────────────────────────────────
  if (rank >= packageRank("professional") && str(brief.cpKeyPeople)) {
    include(
      "key-people",
      { type: "heading", title: "Key People" },
      { type: "paragraph", text: str(brief.cpKeyPeople) },
    );
  } else if (str(brief.cpKeyPeople)) {
    skip("key-people", "Key people available but package level below professional");
  } else {
    skip("key-people", "No key people information provided");
  }

  // ── P1: Organization Structure (professional+) ───────────────────────────────
  if (rank >= packageRank("professional") && str(brief.cpOrganizationStructure)) {
    include(
      "org-structure",
      { type: "heading", title: "Organization Structure" },
      { type: "paragraph", text: str(brief.cpOrganizationStructure) },
    );
  } else if (str(brief.cpOrganizationStructure)) {
    skip("org-structure", "Org structure available but package level below professional");
  } else {
    skip("org-structure", "No organization structure provided");
  }

  // ── P1: Clients & Partners (professional+) ───────────────────────────────────
  if (rank >= packageRank("professional") && str(brief.cpClientsPartners)) {
    const clientItems = splitList(str(brief.cpClientsPartners));
    if (clientItems.length > 0) {
      include(
        "clients-partners",
        { type: "heading", title: "Clients & Partners" },
        { type: "bullets", items: clientItems },
      );
    } else {
      skip("clients-partners", "Client/partner list is empty after parsing");
    }
  } else {
    skip("clients-partners", str(brief.cpClientsPartners) ? "Below professional tier" : "No clients/partners provided");
  }

  // ── P1: Quality Assurance (business+) ───────────────────────────────────────
  if (rank >= packageRank("business") && str(brief.cpQualityAssurance)) {
    include(
      "quality-assurance",
      { type: "heading", title: "Quality Assurance" },
      { type: "paragraph", text: str(brief.cpQualityAssurance) },
    );
  } else {
    skip("quality-assurance", str(brief.cpQualityAssurance) ? "Below business tier" : "No QA information provided");
  }

  // ── P1: Sustainability (enterprise) ─────────────────────────────────────────
  if (rank >= packageRank("enterprise") && str(brief.cpSustainability)) {
    include(
      "sustainability",
      { type: "heading", title: "Sustainability & CSR" },
      { type: "paragraph", text: str(brief.cpSustainability) },
    );
  } else {
    skip("sustainability", str(brief.cpSustainability) ? "Below enterprise tier" : "No sustainability information provided");
  }

  // ── Contact ──────────────────────────────────────────────────────────────────
  // P1: Prefer cp* contact fields from the brief (explicitly provided by customer)
  // over LLM-generated contact info (which may hallucinate).
  const ci = content.contactInfo;
  const contactWebsite  = str(brief.cpContactWebsite)  || str(ci.website);
  const contactEmail    = str(brief.cpContactEmail)    || str(ci.email);
  const contactPhone    = str(brief.cpContactPhone)    || str(ci.phone);
  const contactAddress  = str(brief.cpContactAddress)  || str(ci.address);

  const contactLines: string[] = [];
  if (contactWebsite) contactLines.push(`Website: ${contactWebsite}`);
  if (contactEmail)   contactLines.push(`Email: ${contactEmail}`);
  if (contactPhone)   contactLines.push(`Phone: ${contactPhone}`);
  if (contactAddress) contactLines.push(`Address: ${contactAddress}`);

  if (contactLines.length > 0) {
    include(
      "contact",
      { type: "heading", title: "Contact Information" },
      { type: "bullets", items: contactLines },
    );
  } else {
    skip("contact", "No contact information provided in brief");
  }

  // ── Build full spec ──────────────────────────────────────────────────────────
  const companyName = str(brief.cpLegalName) || str(brief.brandName);

  const spec: CreativeDocumentSpec = {
    documentType: "company_profile",
    title: `${companyName} — Company Profile`,
    subtitle: content.tagline || undefined,
    company: {
      name:    companyName,
      email:   contactEmail   || undefined,
      phone:   contactPhone   || undefined,
      address: contactAddress || undefined,
      website: contactWebsite || undefined,
    },
    theme: {
      primaryColor:   "#1a365d",
      secondaryColor: "#2d3748",
      accentColor:    "#c05621",
    },
    cover: {
      title:       companyName,
      tagline:     content.tagline || str(brief.cpValueProposition) || str(brief.productOrService),
      subtitle:    str(brief.businessType),
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text: `${companyName} — Company Profile`,
      showPageNumber: true,
    },
    closing: {
      text:        content.closing || `Thank you for your interest in ${companyName}.`,
      contactText: contactLines.join("  ·  ") || undefined,
    },
  };

  const report: MappingGenerationReport = {
    sectionsIncluded:    included,
    sectionsSkipped:     skipped,
    coverImageIncluded:  !!coverImageBuffer,
    llmProvider:         "",
    llmModel:            "",
    llmTokensUsed:       0,
    llmLatencyMs:        0,
    packageLevel:        brief.packageLevel ?? "starter",
    pageTarget:          effectivePageTarget,
  };

  return { spec, report };
}
