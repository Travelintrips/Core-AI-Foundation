/**
 * companyProfileDocumentMapper.ts — Phase 2 Company Profile mapper
 *
 * Maps a creative project brief + existing AI outputs to a CreativeDocumentSpec
 * for the Company Profile document type.
 *
 * Makes ONE additional LLM call to generate structured company-profile-specific
 * content from the brief (about, vision, mission, values, services, etc.).
 * This call is tracked with provider / model / token usage / cost.
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

// ── Brief type (subset of CreativeProject) ─────────────────────────────────────

export interface CompanyProfileBrief {
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  goal: string;
  notes?: string | null;
  colorPreference?: string | null;
  stylePreference?: string | null;
}

// ── LLM call ─────────────────────────────────────────────────────────────────

const COMPANY_PROFILE_SYSTEM_PROMPT = `You are a professional business document writer specializing in company profiles for Indonesian businesses. You write in English (unless the brief is explicitly in Bahasa Indonesia) with a formal, professional tone.

Your task is to generate structured content for a company profile document based on the business brief provided.

Critical rules:
- ONLY include information that can be reasonably derived from the brief
- Do NOT fabricate specific facts (employee counts, founding years, specific revenue figures, specific addresses) unless they are explicitly stated
- Do NOT use placeholders like "[Company Name]", "X employees", or "Lorem ipsum"
- Leave a field as an empty string "" or empty array [] when there is no basis for content
- All content must be professional, concise, and appropriate for a formal business document
- Keep each section appropriately brief (2-4 sentences for paragraphs, 3-6 items for lists)

Always respond with valid JSON only. No markdown, no explanation text.`;

function buildCompanyProfilePrompt(
  brief: CompanyProfileBrief,
  existingCopy: Record<string, unknown>,
  existingBrandStrategy: Record<string, unknown>,
): string {
  const copyTagline = typeof existingCopy["tagline"] === "string" ? existingCopy["tagline"] : "";
  const copyBodyLong = typeof (existingCopy["body_copy"] as Record<string, unknown> | undefined)?.["long"] === "string"
    ? (existingCopy["body_copy"] as Record<string, unknown>)["long"] as string
    : "";
  const strategyPositioning = typeof existingBrandStrategy["positioning"] === "string"
    ? existingBrandStrategy["positioning"]
    : typeof existingBrandStrategy["brand_positioning"] === "string"
      ? existingBrandStrategy["brand_positioning"]
      : "";

  return `Generate structured company profile content for the following business:

BUSINESS BRIEF:
- Company Name: ${brief.brandName}
- Business Type: ${brief.businessType}
- Target Market: ${brief.targetMarket}
- Products/Services: ${brief.productOrService}
- Business Goal: ${brief.goal}
${brief.notes ? `- Additional Notes: ${brief.notes}` : ""}

EXISTING BRAND ANALYSIS:
${strategyPositioning ? `- Brand Positioning: ${strategyPositioning}` : ""}
${copyTagline ? `- Tagline: ${copyTagline}` : ""}
${copyBodyLong ? `- Brand Description: ${copyBodyLong}` : ""}

Return ONLY this JSON object (no markdown, no explanation):
{
  "about": "3-4 sentence professional overview of the company",
  "vision": "vision statement (1-2 sentences)",
  "mission": "mission statement (2-3 sentences describing how they achieve their vision)",
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
  "contactInfo": {
    "email": "",
    "phone": "",
    "address": "",
    "website": ""
  }
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
  const routed = await routeToModel(
    `Generate structured company profile content for ${brief.brandName} (${brief.businessType})`,
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
    temperature:  0.4, // lower temperature for factual/structured content
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
    clientId:    brief.brandName,
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
    about:                  typeof parsed.about === "string" ? parsed.about : "",
    vision:                 typeof parsed.vision === "string" ? parsed.vision : "",
    mission:                typeof parsed.mission === "string" ? parsed.mission : "",
    coreValues:             Array.isArray(parsed.coreValues) ? parsed.coreValues.filter(isStr) : [],
    servicesOrProducts:     Array.isArray(parsed.servicesOrProducts) ? parsed.servicesOrProducts.filter(isServiceItem) : [],
    competitiveAdvantages:  Array.isArray(parsed.competitiveAdvantages) ? parsed.competitiveAdvantages.filter(isStr) : [],
    industriesServed:       Array.isArray(parsed.industriesServed) ? parsed.industriesServed.filter(isStr) : [],
    operationalCapabilities: typeof parsed.operationalCapabilities === "string" ? parsed.operationalCapabilities : "",
    milestones:             Array.isArray(parsed.milestones) ? parsed.milestones.filter(isMilestone) : [],
    teamDescription:        typeof parsed.teamDescription === "string" ? parsed.teamDescription : "",
    certifications:         Array.isArray(parsed.certifications) ? parsed.certifications.filter(isStr) : [],
    tagline:                typeof parsed.tagline === "string" ? parsed.tagline : "",
    closing:                typeof parsed.closing === "string" ? parsed.closing : "",
    contactInfo: {
      email:   typeof parsed.contactInfo?.email === "string" ? parsed.contactInfo.email : "",
      phone:   typeof parsed.contactInfo?.phone === "string" ? parsed.contactInfo.phone : "",
      address: typeof parsed.contactInfo?.address === "string" ? parsed.contactInfo.address : "",
      website: typeof parsed.contactInfo?.website === "string" ? parsed.contactInfo.website : "",
    },
  };

  return {
    content,
    llmUsage: {
      provider:         routed.provider.slug,
      model:            routed.model.modelId,
      tokensUsed:       result.tokensUsed,
      estimatedCostUsd: 0, // populated by costService
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

// ── Spec builder ───────────────────────────────────────────────────────────────

export interface MappingGenerationReport {
  sectionsIncluded: string[];
  sectionsSkipped: SectionGenerationNote[];
  coverImageIncluded: boolean;
  llmProvider: string;
  llmModel: string;
  llmTokensUsed: number;
  llmLatencyMs: number;
}

/**
 * Map a Company Profile LLM result + brief into a full `CreativeDocumentSpec`.
 * Sections with no content are skipped and recorded in the generation report.
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

  function skip(id: string, reason: string) {
    skipped.push({ sectionId: id, included: false, reason });
  }
  function include(id: string, ...newSections: CreativeDocumentSection[]) {
    included.push(id);
    sections.push(...newSections);
  }

  // ── About ──────────────────────────────────────────────────────────────────
  if (content.about.trim()) {
    include(
      "about",
      { type: "heading", title: "About the Company", subtitle: brief.businessType },
      { type: "paragraph", text: content.about },
    );
  } else {
    skip("about", "LLM returned empty about section");
  }

  // ── Vision & Mission ───────────────────────────────────────────────────────
  const hasVision  = content.vision.trim().length > 0;
  const hasMission = content.mission.trim().length > 0;

  if (hasVision || hasMission) {
    include("vision-mission", { type: "heading", title: "Vision & Mission" });
    if (hasVision) {
      sections.push(
        { type: "quote", text: content.vision, attribution: `Vision — ${brief.brandName}` },
      );
      included.push("vision");
    } else {
      skip("vision", "No vision statement available from brief");
    }
    if (hasMission) {
      sections.push({ type: "paragraph", text: content.mission });
      included.push("mission");
    } else {
      skip("mission", "No mission statement available from brief");
    }
  } else {
    skip("vision-mission", "Neither vision nor mission available");
  }

  // ── Core Values ────────────────────────────────────────────────────────────
  if (content.coreValues.length >= 2) {
    include(
      "core-values",
      { type: "heading", title: "Core Values" },
      { type: "bullets", items: content.coreValues },
    );
  } else {
    skip("core-values", "Fewer than 2 core values available");
  }

  // ── Services / Products ────────────────────────────────────────────────────
  if (content.servicesOrProducts.length > 0) {
    include(
      "services",
      { type: "heading", title: "Products & Services", subtitle: brief.productOrService },
    );
    for (const svc of content.servicesOrProducts) {
      sections.push({ type: "paragraph", text: `${svc.name}\n${svc.description}` });
    }
    included.push("services-detail");
  } else {
    // Fall back to brief's productOrService field
    if (brief.productOrService.trim()) {
      include(
        "services",
        { type: "heading", title: "Products & Services" },
        { type: "paragraph", text: brief.productOrService },
      );
    } else {
      skip("services", "No products/services data available");
    }
  }

  // ── Company overview image (if available) ──────────────────────────────────
  if (existingImages.length > 0) {
    const img = existingImages[0];
    if (img) {
      sections.push({
        type: "image",
        imageUrl: "",
        imageBuffer: img.buffer,
        caption: img.caption ?? `${brief.brandName} — Visual Identity`,
      });
      included.push("company-image");
    }
  }

  // ── Competitive Advantages ─────────────────────────────────────────────────
  if (content.competitiveAdvantages.length >= 2) {
    include(
      "competitive-advantages",
      { type: "heading", title: "Our Competitive Advantages" },
      { type: "bullets", items: content.competitiveAdvantages },
    );
  } else {
    skip("competitive-advantages", "Fewer than 2 competitive advantages available");
  }

  // ── Industries / Target Market ─────────────────────────────────────────────
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

  // ── Operational Capabilities ───────────────────────────────────────────────
  if (content.operationalCapabilities.trim()) {
    include(
      "operational",
      { type: "heading", title: "Operational Capabilities" },
      { type: "paragraph", text: content.operationalCapabilities },
    );
  } else {
    skip("operational", "No operational capability data in brief");
  }

  // ── Milestones ─────────────────────────────────────────────────────────────
  if (content.milestones.length >= 2) {
    const rows = content.milestones.map((m) => [m.year, m.event]);
    include(
      "milestones",
      { type: "heading", title: "Our Journey" },
      { type: "table", headers: ["Year", "Milestone"], rows },
    );
  } else {
    skip("milestones", "Fewer than 2 milestones available — milestone table omitted");
  }

  // ── Team ───────────────────────────────────────────────────────────────────
  if (content.teamDescription.trim()) {
    include(
      "team",
      { type: "heading", title: "Our Team" },
      { type: "paragraph", text: content.teamDescription },
    );
  } else {
    skip("team", "No team description available in brief");
  }

  // ── Certifications ─────────────────────────────────────────────────────────
  if (content.certifications.length > 0) {
    include(
      "certifications",
      { type: "heading", title: "Certifications & Compliance" },
      { type: "bullets", items: content.certifications },
    );
  } else {
    skip("certifications", "No certifications provided — section omitted");
  }

  // ── Key Metrics placeholder (from brief goal) ──────────────────────────────
  // Only include if we have concrete metrics to show; skip otherwise

  // ── Contact ────────────────────────────────────────────────────────────────
  const ci = content.contactInfo;
  const contactLines: string[] = [];
  if (ci.website) contactLines.push(`Website: ${ci.website}`);
  if (ci.email)   contactLines.push(`Email: ${ci.email}`);
  if (ci.phone)   contactLines.push(`Phone: ${ci.phone}`);
  if (ci.address) contactLines.push(`Address: ${ci.address}`);

  if (contactLines.length > 0) {
    include(
      "contact",
      { type: "heading", title: "Contact Information" },
      { type: "bullets", items: contactLines },
    );
  } else {
    skip("contact", "No contact information provided in brief");
  }

  // ── Build full spec ────────────────────────────────────────────────────────

  const spec: CreativeDocumentSpec = {
    documentType: "company_profile",
    title: `${brief.brandName} — Company Profile`,
    subtitle: content.tagline || undefined,
    company: {
      name:    brief.brandName,
      email:   ci.email   || undefined,
      phone:   ci.phone   || undefined,
      address: ci.address || undefined,
      website: ci.website || undefined,
    },
    theme: {
      primaryColor:   "#1a365d",
      secondaryColor: "#2d3748",
      accentColor:    "#c05621",
    },
    cover: {
      title:       brief.brandName,
      tagline:     content.tagline || brief.productOrService,
      subtitle:    brief.businessType,
      imageBuffer: coverImageBuffer,
    },
    sections,
    footer: {
      text: `${brief.brandName} — Company Profile`,
      showPageNumber: true,
    },
    closing: {
      text:        content.closing || `Thank you for your interest in ${brief.brandName}.`,
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
  };

  return { spec, report };
}
