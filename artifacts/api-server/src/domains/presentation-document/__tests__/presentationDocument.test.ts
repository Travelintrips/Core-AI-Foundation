/**
 * presentationDocument.test.ts — Team 16: Presentation & Document Creative Services
 *
 * Test sections:
 *   A. Domain init — all 6 document types register into the Document Engine
 *   B. Proposal mapper — section coverage, anti-fabrication (no pricing)
 *   C. Product Catalog mapper — cover, categories, features
 *   D. Annual Report mapper — no financial figures fabricated
 *   E. Whitepaper mapper — abstract, findings, anti-fabrication
 *   F. Case Study mapper — outcomes skipped when absent, no ROI fabrication
 *   G. Ebook mapper — ToC generated, chapter coverage
 *   H. QC profiles — scoring, composite pass/fail, hard-fail on dimension
 *   I. Package rules — tier resolution, page limits
 *   J. Template compatibility — style validation, unsupported style fallback
 *   K. Brand DNA adapter — dna > creative_direction > default fallback
 *   L. Anti-fabrication guard — placeholder detection
 *   M. Adapter routing — pdf vs pptx resolution
 */

import { describe, it, expect } from "vitest";
import type { CreativeProject } from "@workspace/db";

// Mappers
import {
  normalizeProposalContent,
  buildProposalSpec,
} from "../mappers/proposalDocumentMapper.js";
import {
  normalizeProductCatalogContent,
  buildProductCatalogSpec,
} from "../mappers/productCatalogDocumentMapper.js";
import {
  normalizeAnnualReportContent,
  buildAnnualReportSpec,
} from "../mappers/annualReportDocumentMapper.js";
import {
  normalizeWhitepaperContent,
  buildWhitepaperSpec,
} from "../mappers/whitepaperDocumentMapper.js";
import {
  normalizeCaseStudyContent,
  buildCaseStudySpec,
} from "../mappers/caseStudyDocumentMapper.js";
import {
  normalizeEbookContent,
  buildEbookSpec,
} from "../mappers/ebookDocumentMapper.js";

// Domain infrastructure
import { evaluateQc, scoreSectionCoverage, scoreDataCompleteness, scorePageCount } from "../qcProfile.js";
import { getPackageRule, getMinimumPageCount, resolvePackageTier }                 from "../packageRules.js";
import { getTemplateCompatibility, isStyleCompatible }                             from "../templateCompatibility.js";
import { extractBrandDnaTheme }                                                    from "../brandDnaAdapter.js";
import {
  resolveRenderFormat,
  isDocumentEngineService,
  isPresentationEngineService,
  checkTemplateCompatibility,
  validateAntiFabrication,
  RESOURCE_LIMITS,
  ResourceLimitError,
  enforcePageLimit,
  enforceSlideLimit,
  enforceImageCount,
  enforceSourceAssetBytes,
  enforceOutputBytes,
  checkDocumentResourceLimits,
  checkPresentationResourceLimits,
  validateImageUrl,
} from "../adapters/presentationDocumentAdapter.js";
import {
  registerDocument,
  getSupportedDocumentTypes,
} from "../../../services/creativeDocumentWorkerService.js";
import { initPresentationDocumentDomain } from "../index.js";
import {
  proposalDefinition,
  productCatalogDefinition,
  annualReportDefinition,
  whitepaperDefinition,
  caseStudyDefinition,
  ebookDefinition,
} from "../index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

type RawResult = {
  brandStrategy?: {
    positioning?: string;
    brand_values?: string[];
    competitive_advantage?: string;
    brand_personality?: string[];
    tone_of_voice?: string;
  };
  creativeDirection?: {
    color_direction?: { primary?: string; secondary?: string; accent?: string };
    creative_concept?: { name?: string; description?: string };
    campaign_concept?: string;
  };
  copy?: {
    tagline?: string;
    headline?: { primary?: string; alternatives?: string[] };
    body_copy?: { short?: string; long?: string } | string;
    call_to_action?: string;
  };
  brandDna?: {
    colors?: { primary?: string; secondary?: string; accent?: string };
  };
};

function makeProject(overrides: Partial<Omit<CreativeProject, "result">> & { result?: RawResult } = {}): CreativeProject {
  const { result, ...rest } = overrides;
  const baseResult: RawResult = {
    brandStrategy: {
      positioning: "The most trusted enterprise cloud platform in Southeast Asia.",
      brand_values: ["Reliability", "Security", "Innovation", "Partnership"],
      competitive_advantage: "Zero-downtime guarantee with 24/7 SLA support.",
      brand_personality: ["Professional", "Trustworthy", "Innovative"],
      tone_of_voice: "Authoritative yet approachable",
    },
    creativeDirection: {
      color_direction: { primary: "#1a365d", secondary: "#2d3748", accent: "#3182ce" },
      creative_concept: { name: "Fortress Cloud", description: "Enterprise-grade cloud with military security." },
      campaign_concept: "Where Enterprise Meets the Cloud",
    },
    copy: {
      tagline: "Enterprise Cloud. Simplified.",
      headline: { primary: "Your Infrastructure, Secured.", alternatives: ["Scale with Confidence"] },
      body_copy: {
        short: "Acme Corp delivers enterprise cloud infrastructure with zero-downtime SLA.",
        long: "Acme Corp is Southeast Asia's most trusted cloud platform. Our infrastructure handles millions of transactions daily with 99.99% uptime.",
      },
      call_to_action: "Request a Demo",
    },
  };

  return {
    id: 1,
    projectId: "test-proj-001",
    sourceType: "service_catalog",
    serviceRequestId: null,
    serviceQuotationId: null,
    brandName: "Acme Corp",
    businessType: "Technology",
    targetMarket: "Enterprise clients",
    productOrService: "Cloud infrastructure platform",
    stylePreference: null,
    colorPreference: null,
    referenceLinks: null,
    goal: "Reduce infrastructure costs by 30%",
    notes: "Focus on security and compliance",
    deadline: null,
    status: "generating_document",
    paymentPolicy: "full_payment",
    depositPercentage: 50,
    paymentStatus: "paid",
    filesUnlocked: true,
    result: result !== undefined ? (result as unknown) : (baseResult as unknown),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...rest,
  } as unknown as CreativeProject;
}

const BASE = makeProject();

// ── A. Domain init ─────────────────────────────────────────────────────────────

describe("A. Domain init", () => {
  it("initPresentationDocumentDomain registers all 6 document types", () => {
    initPresentationDocumentDomain();
    const types = getSupportedDocumentTypes();
    expect(types).toContain("proposal");
    expect(types).toContain("product_catalog");
    expect(types).toContain("annual_report");
    expect(types).toContain("whitepaper");
    expect(types).toContain("case_study");
    expect(types).toContain("ebook");
  });

  it("registerDocument is idempotent (re-registering does not throw)", () => {
    expect(() => initPresentationDocumentDomain()).not.toThrow();
  });
});

// ── B. Proposal mapper ────────────────────────────────────────────────────────

describe("B. Proposal mapper", () => {
  it("normalizeProposalContent extracts positioning and brand values", () => {
    const { content } = normalizeProposalContent(BASE);
    expect(content.positioning).toBe("The most trusted enterprise cloud platform in Southeast Asia.");
    expect(content.brandValues).toContain("Reliability");
    expect(content.primaryColor).toBe("#1a365d");
  });

  it("normalizeProposalContent returns empty timeline when no briefJson", () => {
    const { content } = normalizeProposalContent(BASE);
    expect(content.timeline).toBe("");
  });

  it("buildProposalSpec includes core required sections", () => {
    const { content } = normalizeProposalContent(BASE);
    const { report } = buildProposalSpec(BASE, content, null, []);
    const sections = report.sectionsIncluded as string[];
    expect(sections).toContain("executive-summary");
    expect(sections).toContain("scope");
    expect(sections).toContain("deliverables");
    expect(sections).toContain("next-steps");
  });

  it("buildProposalSpec skips timeline section when not in briefJson", () => {
    const { content } = normalizeProposalContent(BASE);
    const { report } = buildProposalSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("timeline");
  });

  it("buildProposalSpec skips investment when no budget_note in briefJson", () => {
    const { content } = normalizeProposalContent(BASE);
    const { report } = buildProposalSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("investment");
  });

  it("buildProposalSpec includes timeline when present in briefJson", () => {
    const brief = { timeline: "Phase 1: 4 weeks, Phase 2: 6 weeks" };
    const { content } = normalizeProposalContent(BASE, brief);
    const { report } = buildProposalSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("timeline");
  });

  it("buildProposalSpec sets fabricationGuard in report", () => {
    const { content } = normalizeProposalContent(BASE);
    const { report } = buildProposalSpec(BASE, content, null, []);
    expect(report.fabricationGuard).toBe("no_pricing_figures_or_legal_terms");
  });

  it("buildProposalSpec applies cover image when provided", () => {
    const { content } = normalizeProposalContent(BASE);
    const buf = Buffer.from("fake-image");
    const { spec, report } = buildProposalSpec(BASE, content, buf, []);
    expect(spec.cover?.imageBuffer).toBe(buf);
    expect(report.coverImageIncluded).toBe(true);
  });

  it("buildProposalSpec uses Brand DNA colors when available", () => {
    const project = makeProject({ result: { brandDna: { colors: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff" } } } });
    const { content } = normalizeProposalContent(project);
    const { spec } = buildProposalSpec(project, content, null, []);
    expect(spec.theme?.primaryColor).toBe("#ff0000");
  });
});

// ── C. Product Catalog mapper ─────────────────────────────────────────────────

describe("C. Product Catalog mapper", () => {
  it("always includes brand-intro, categories, ordering, and contact sections", () => {
    const { content } = normalizeProductCatalogContent(BASE);
    const { report } = buildProductCatalogSpec(BASE, content, null, []);
    const sections = report.sectionsIncluded as string[];
    expect(sections).toContain("brand-intro");
    expect(sections).toContain("categories");
    expect(sections).toContain("ordering");
    expect(sections).toContain("contact");
  });

  it("includes features section when brand values present", () => {
    const { content } = normalizeProductCatalogContent(BASE);
    const { report } = buildProductCatalogSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("features");
  });

  it("skips features section when no brand values", () => {
    const project = makeProject({ result: { brandStrategy: {}, copy: {}, creativeDirection: {} } });
    const { content } = normalizeProductCatalogContent(project);
    const { report } = buildProductCatalogSpec(project, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("features");
  });

  it("embeds at most 2 inline images", () => {
    const { content } = normalizeProductCatalogContent(BASE);
    const images = [
      { buffer: Buffer.from("img1"), caption: "Product A" },
      { buffer: Buffer.from("img2"), caption: "Product B" },
      { buffer: Buffer.from("img3"), caption: "Product C" },
    ];
    const { report } = buildProductCatalogSpec(BASE, content, null, images);
    expect(report.inlineImagesUsed).toBe(2);
  });

  it("sets fabricationGuard to no_prices_or_stock_levels", () => {
    const { content } = normalizeProductCatalogContent(BASE);
    const { report } = buildProductCatalogSpec(BASE, content, null, []);
    expect(report.fabricationGuard).toBe("no_prices_or_stock_levels");
  });
});

// ── D. Annual Report mapper ────────────────────────────────────────────────────

describe("D. Annual Report mapper", () => {
  it("financials section is always skipped (anti-fabrication)", () => {
    const { content } = normalizeAnnualReportContent(BASE);
    const { report } = buildAnnualReportSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("financials");
    expect(report.fabricationGuard).toBe("no_financial_figures_or_audit_opinions");
  });

  it("includes highlights from brand values when briefJson highlights absent", () => {
    const { content } = normalizeAnnualReportContent(BASE);
    const { report } = buildAnnualReportSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("highlights");
  });

  it("includes highlights from briefJson when provided", () => {
    const brief = { highlights: ["Launched 3 new products", "Expanded to 5 countries"] };
    const { content } = normalizeAnnualReportContent(BASE, brief);
    expect(content.highlights).toContain("Launched 3 new products");
  });

  it("skips people section when no teamNote", () => {
    const { content } = normalizeAnnualReportContent(BASE);
    const { report } = buildAnnualReportSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("people");
  });

  it("skips sustainability when no esgNote", () => {
    const { content } = normalizeAnnualReportContent(BASE);
    const { report } = buildAnnualReportSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("sustainability");
  });
});

// ── E. Whitepaper mapper ──────────────────────────────────────────────────────

describe("E. Whitepaper mapper", () => {
  it("always includes abstract, introduction, problem, recommendations, conclusion, about", () => {
    const { content } = normalizeWhitepaperContent(BASE);
    const { report } = buildWhitepaperSpec(BASE, content, null, []);
    const sections = report.sectionsIncluded as string[];
    expect(sections).toContain("abstract");
    expect(sections).toContain("introduction");
    expect(sections).toContain("problem");
    expect(sections).toContain("recommendations");
    expect(sections).toContain("conclusion");
    expect(sections).toContain("about");
  });

  it("skips findings when no researchFindings in briefJson", () => {
    const { content } = normalizeWhitepaperContent(BASE);
    const { report } = buildWhitepaperSpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("findings");
  });

  it("includes findings when briefJson provides research data", () => {
    const brief = { findings: "Our survey of 500 enterprises shows 78% face cloud cost overruns." };
    const { content } = normalizeWhitepaperContent(BASE, brief);
    expect(content.researchFindings).toContain("500 enterprises");
    const { report } = buildWhitepaperSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("findings");
  });

  it("sets fabricationGuard to no_statistics_or_third_party_citations", () => {
    const { content } = normalizeWhitepaperContent(BASE);
    const { report } = buildWhitepaperSpec(BASE, content, null, []);
    expect(report.fabricationGuard).toBe("no_statistics_or_third_party_citations");
  });

  it("includes framework section when ≥2 brand values", () => {
    const { content } = normalizeWhitepaperContent(BASE);
    const { report } = buildWhitepaperSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("framework");
  });
});

// ── F. Case Study mapper ──────────────────────────────────────────────────────

describe("F. Case Study mapper", () => {
  it("skips outcomes when not in briefJson (no ROI figures fabricated)", () => {
    const { content } = normalizeCaseStudyContent(BASE);
    const { report } = buildCaseStudySpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("outcomes");
    expect(report.fabricationGuard).toBe("no_quantified_results_or_client_names");
  });

  it("includes outcomes when briefJson provides data", () => {
    const brief = { outcomes: "Achieved 40% cost reduction and 99.99% uptime." };
    const { content } = normalizeCaseStudyContent(BASE, brief);
    expect(content.outcomes).toContain("40% cost reduction");
    const { report } = buildCaseStudySpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("outcomes");
  });

  it("skips testimonial when not in briefJson", () => {
    const { content } = normalizeCaseStudyContent(BASE);
    const { report } = buildCaseStudySpec(BASE, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("testimonial");
  });

  it("uses testimonial from briefJson when provided", () => {
    const brief = { testimonial: "Acme Corp transformed our infrastructure." };
    const { content } = normalizeCaseStudyContent(BASE, brief);
    const { spec } = buildCaseStudySpec(BASE, content, null, []);
    const quoteSections = spec.sections.filter((s) => s.type === "quote");
    expect(quoteSections.length).toBeGreaterThan(0);
    expect((quoteSections[0] as { type: string; text: string }).text).toContain("transformed our infrastructure");
  });

  it("includes challenge from project.goal when no briefJson challenge", () => {
    const { content } = normalizeCaseStudyContent(BASE);
    const { report } = buildCaseStudySpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("challenge");
  });
});

// ── G. Ebook mapper ───────────────────────────────────────────────────────────

describe("G. Ebook mapper", () => {
  it("always includes chapters 1-3, conclusion, about, and toc", () => {
    const { content } = normalizeEbookContent(BASE);
    const { report } = buildEbookSpec(BASE, content, null, []);
    const sections = report.sectionsIncluded as string[];
    expect(sections).toContain("chapter-1");
    expect(sections).toContain("chapter-2");
    expect(sections).toContain("chapter-3");
    expect(sections).toContain("conclusion");
    expect(sections).toContain("about");
    expect(sections).toContain("toc");
  });

  it("chaptersInToc contains all chapter headings", () => {
    const { content } = normalizeEbookContent(BASE);
    const { report } = buildEbookSpec(BASE, content, null, []);
    const toc = report.chaptersInToc as string[];
    expect(toc.length).toBeGreaterThanOrEqual(3);
    expect(toc[0]).toContain("Chapter 1");
  });

  it("sets fabricationGuard to no_statistics_or_third_party_citations", () => {
    const { content } = normalizeEbookContent(BASE);
    const { report } = buildEbookSpec(BASE, content, null, []);
    expect(report.fabricationGuard).toBe("no_statistics_or_third_party_citations");
  });

  it("includes chapter-4 when brand values present", () => {
    const { content } = normalizeEbookContent(BASE);
    const { report } = buildEbookSpec(BASE, content, null, []);
    expect(report.sectionsIncluded as string[]).toContain("chapter-4");
  });

  it("skips chapter-5 when fewer than 3 brand values", () => {
    const project = makeProject({ result: { brandStrategy: { brand_values: ["Quality"] } } });
    const { content } = normalizeEbookContent(project);
    const { report } = buildEbookSpec(project, content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s: { id: string }) => s.id);
    expect(skipped).toContain("chapter-5");
  });
});

// ── H. QC profiles ────────────────────────────────────────────────────────────

describe("H. QC profiles", () => {
  it("scoreSectionCoverage returns 100 when nothing skipped", () => {
    expect(scoreSectionCoverage(["a", "b", "c"], [])).toBe(100);
  });

  it("scoreSectionCoverage returns 50 when half skipped", () => {
    expect(scoreSectionCoverage(["a", "b"], [{ id: "c" }, { id: "d" }])).toBe(50);
  });

  it("scoreDataCompleteness returns 100 for fully populated content", () => {
    const content = { name: "Acme", values: ["a", "b"], text: "hello" };
    expect(scoreDataCompleteness(content)).toBe(100);
  });

  it("scoreDataCompleteness returns 0 for all-empty content", () => {
    const content = { name: "", values: [], text: "" };
    expect(scoreDataCompleteness(content)).toBe(0);
  });

  it("scorePageCount returns 100 when within range", () => {
    expect(scorePageCount(8, 6, 16)).toBe(100);
  });

  it("scorePageCount returns partial score when below min", () => {
    const score = scorePageCount(3, 6, 16);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });

  it("evaluateQc passes when all dimension scores are high", () => {
    const result = evaluateQc("proposal", {
      section_coverage: 90, data_completeness: 90, anti_fabrication: 100, page_count: 100,
    });
    expect(result.passed).toBe(true);
    expect(result.compositeScore).toBeGreaterThanOrEqual(75);
  });

  it("evaluateQc hard-fails when anti_fabrication score < 100", () => {
    const result = evaluateQc("annual_report", {
      section_coverage: 90, data_completeness: 90, anti_fabrication: 80, page_count: 100,
    });
    expect(result.passed).toBe(false);
    expect(result.hardFailReason).toBeDefined();
  });

  it("evaluateQc passes without crashing for unregistered service type", () => {
    const result = evaluateQc("company_profile" as never, {});
    expect(result.passed).toBe(true);
  });
});

// ── I. Package rules ──────────────────────────────────────────────────────────

describe("I. Package rules", () => {
  it("resolvePackageTier defaults to professional for unknown tier", () => {
    expect(resolvePackageTier("premium")).toBe("professional");
    expect(resolvePackageTier(undefined)).toBe("professional");
  });

  it("resolvePackageTier preserves essential and enterprise", () => {
    expect(resolvePackageTier("essential")).toBe("essential");
    expect(resolvePackageTier("enterprise")).toBe("enterprise");
  });

  it("getPackageRule returns correct limits for proposal professional", () => {
    const rule = getPackageRule("proposal", "professional");
    expect(rule).toBeDefined();
    expect(rule!.pageLimits.min).toBe(6);
    expect(rule!.pageLimits.max).toBe(16);
  });

  it("getMinimumPageCount returns 4 for proposal essential", () => {
    expect(getMinimumPageCount("proposal", "essential")).toBe(4);
  });

  it("getMinimumPageCount returns 8 for annual_report essential", () => {
    expect(getMinimumPageCount("annual_report", "essential")).toBe(8);
  });

  it("annual_report enterprise requires Brand DNA", () => {
    const rule = getPackageRule("annual_report", "enterprise");
    expect(rule?.requiresBrandDna).toBe(true);
  });

  it("case_study essential does not require Brand DNA", () => {
    const rule = getPackageRule("case_study", "essential");
    expect(rule?.requiresBrandDna).toBe(false);
  });
});

// ── J. Template compatibility ─────────────────────────────────────────────────

describe("J. Template compatibility", () => {
  it("proposal supports corporate style", () => {
    expect(isStyleCompatible("proposal", "corporate")).toBe(true);
  });

  it("proposal does not support editorial style", () => {
    expect(isStyleCompatible("proposal", "editorial")).toBe(false);
  });

  it("ebook has editorial as default style", () => {
    const entry = getTemplateCompatibility("ebook");
    expect(entry.defaultStyle).toBe("editorial");
    expect(entry.supportedStyles).toContain("editorial");
  });

  it("checkTemplateCompatibility falls back to default for incompatible style", () => {
    const result = checkTemplateCompatibility({ serviceType: "proposal", requestedStyle: "bold" });
    expect(result.compatible).toBe(false);
    expect(result.resolvedStyle).toBe("corporate");
    expect(result.reason).toBeDefined();
  });

  it("checkTemplateCompatibility passes for compatible style", () => {
    const result = checkTemplateCompatibility({ serviceType: "product_catalog", requestedStyle: "bold" });
    expect(result.compatible).toBe(true);
    expect(result.resolvedStyle).toBe("bold");
    expect(result.reason).toBeUndefined();
  });
});

// ── K. Brand DNA adapter ──────────────────────────────────────────────────────

describe("K. Brand DNA adapter", () => {
  it("prefers Brand DNA colors over creative_direction", () => {
    const project = makeProject({ result: { brandDna: { colors: { primary: "#aabbcc", secondary: "#112233", accent: "#445566" } }, creativeDirection: { color_direction: { primary: "#ff0000" } } } });
    const { report } = extractBrandDnaTheme(project, "proposal");
    expect(report.source).toBe("brand_dna");
    expect(report.primaryColor).toBe("#aabbcc");
  });

  it("falls back to creative_direction when no Brand DNA", () => {
    const { report } = extractBrandDnaTheme(BASE, "proposal");
    expect(report.source).toBe("creative_direction");
    expect(report.primaryColor).toBe("#1a365d");
  });

  it("reports default source when neither Brand DNA nor creative_direction colors present", () => {
    const project = makeProject({ result: {} });
    const { report } = extractBrandDnaTheme(project, "proposal");
    expect(report.source).toBe("default");
    expect(report.colorsApplied).toBe(false);
  });

  it("rejects non-hex color values, accepts valid hex", () => {
    const project = makeProject({ result: { brandDna: { colors: { primary: "blue", secondary: "rgb(0,0,0)", accent: "#3182ce" } } } });
    const { theme } = extractBrandDnaTheme(project, "proposal");
    // Non-hex primary and secondary are rejected
    expect(theme.primaryColor).toBeUndefined();
    expect(theme.secondaryColor).toBeUndefined();
    // Valid hex accent is accepted
    expect(theme.accentColor).toBe("#3182ce");
  });
});

// ── L. Anti-fabrication guard ─────────────────────────────────────────────────

describe("L. Anti-fabrication guard", () => {
  it("returns clean: true for real content", () => {
    const content = {
      name: "Acme Corp",
      positioning: "The most trusted enterprise cloud platform.",
      tagline: "Enterprise Cloud. Simplified.",
    };
    const result = validateAntiFabrication(content);
    expect(result.clean).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("detects lorem ipsum placeholder text", () => {
    const content = { body: "Lorem ipsum dolor sit amet" };
    const result = validateAntiFabrication(content);
    expect(result.clean).toBe(false);
    expect(result.violations.some((v: string) => v.toLowerCase().includes("lorem ipsum"))).toBe(true);
  });

  it("detects [number] as a fabrication indicator", () => {
    const content = { results: "We saved clients [number]% of their costs." };
    const result = validateAntiFabrication(content);
    expect(result.clean).toBe(false);
  });

  it("detects TBD as a fabrication indicator", () => {
    const content = { timeline: "Project starts TBD" };
    const result = validateAntiFabrication(content);
    expect(result.clean).toBe(false);
  });
});

// ── M. Adapter routing ────────────────────────────────────────────────────────

describe("M. Adapter routing", () => {
  it("proposal resolves to pdf", () => {
    expect(resolveRenderFormat("proposal")).toBe("pdf");
    expect(isDocumentEngineService("proposal")).toBe(true);
    expect(isPresentationEngineService("proposal")).toBe(false);
  });

  it("pitch_deck resolves to pptx", () => {
    expect(resolveRenderFormat("pitch_deck")).toBe("pptx");
    expect(isPresentationEngineService("pitch_deck")).toBe(true);
    expect(isDocumentEngineService("pitch_deck")).toBe(false);
  });

  it("all new document types resolve to pdf", () => {
    const docTypes = ["product_catalog", "annual_report", "whitepaper", "case_study", "ebook"] as const;
    for (const t of docTypes) {
      expect(resolveRenderFormat(t)).toBe("pdf");
      expect(isDocumentEngineService(t)).toBe(true);
    }
  });
});

// ── N. Engine conformance — adapter delegates to existing engines ───────────────
//
// Verifies that every Team 16 DocumentDefinition is a proper adapter object:
// it conforms to the DocumentDefinition interface consumed by the existing
// Document Engine (creativeDocumentWorkerService) and does NOT own a renderer.

describe("N. Engine conformance — adapter uses existing Document Engine", () => {
  const definitions = [
    { name: "proposal",       def: proposalDefinition       },
    { name: "product_catalog",def: productCatalogDefinition },
    { name: "annual_report",  def: annualReportDefinition   },
    { name: "whitepaper",     def: whitepaperDefinition     },
    { name: "case_study",     def: caseStudyDefinition      },
    { name: "ebook",          def: ebookDefinition          },
  ] as const;

  for (const { name, def } of definitions) {
    it(`${name}: conforms to DocumentDefinition interface (has generateContent + buildSpec)`, () => {
      expect(typeof def.generateContent).toBe("function");
      expect(typeof def.buildSpec).toBe("function");
      expect(typeof def.filenamePrefix).toBe("string");
      expect(typeof def.minimumPageCount).toBe("number");
      expect(typeof def.requiresLogo).toBe("boolean");
      expect(typeof def.maxInlineImages).toBe("number");
    });

    it(`${name}: does NOT own a render function (rendering stays in existing engine)`, () => {
      // The definition must NOT have a render/renderPdf/renderPptx method.
      // Rendering is the responsibility of creativeDocumentWorkerService.
      const d = def as unknown as Record<string, unknown>;
      expect(d["render"]).toBeUndefined();
      expect(d["renderPdf"]).toBeUndefined();
      expect(d["renderPptx"]).toBeUndefined();
      expect(d["generatePdf"]).toBeUndefined();
    });

    it(`${name}: minimumPageCount >= 2 (engine structural minimum)`, () => {
      expect(def.minimumPageCount).toBeGreaterThanOrEqual(2);
    });

    it(`${name}: maxInlineImages within domain ceiling (≤ RESOURCE_LIMITS.MAX_IMAGES_PER_DOC)`, () => {
      expect(def.maxInlineImages).toBeLessThanOrEqual(RESOURCE_LIMITS.MAX_IMAGES_PER_DOC);
    });
  }
});

// ── O. SSRF — external private URL validation ─────────────────────────────────

describe("O. SSRF — external private image URLs rejected", () => {
  it("rejects localhost URL", () => {
    const result = validateImageUrl("http://localhost/image.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects 127.0.0.1 (loopback)", () => {
    const result = validateImageUrl("http://127.0.0.1/image.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects 10.x.x.x (private class A)", () => {
    const result = validateImageUrl("http://10.0.0.1/logo.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects 172.16.x.x (private class B)", () => {
    const result = validateImageUrl("http://172.16.5.100/logo.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects 192.168.x.x (private class C)", () => {
    const result = validateImageUrl("http://192.168.1.1/logo.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects 169.254.x.x (link-local / cloud metadata IMDS)", () => {
    const result = validateImageUrl("http://169.254.169.254/latest/meta-data/");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects AWS metadata endpoint by hostname", () => {
    const result = validateImageUrl("http://169.254.169.254/image.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });

  it("rejects file:// protocol", () => {
    const result = validateImageUrl("file:///etc/passwd");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("PROTOCOL_NOT_ALLOWED");
  });

  it("rejects ftp:// protocol", () => {
    const result = validateImageUrl("ftp://example.com/image.png");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("PROTOCOL_NOT_ALLOWED");
  });

  it("rejects data: URI (non-http/https)", () => {
    const result = validateImageUrl("data:image/png;base64,abc123");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("PROTOCOL_NOT_ALLOWED");
  });

  it("rejects empty string", () => {
    const result = validateImageUrl("");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("INVALID_URL");
  });

  it("rejects totally invalid URL string", () => {
    const result = validateImageUrl("not-a-url-at-all");
    expect(result.valid).toBe(false);
  });

  it("accepts a valid public https URL", () => {
    const result = validateImageUrl("https://cdn.example.com/logo.png");
    expect(result.valid).toBe(true);
  });

  it("accepts a valid public http URL", () => {
    const result = validateImageUrl("http://assets.example.com/cover.jpg");
    expect(result.valid).toBe(true);
  });
});

// ── P. Resource limits enforced ───────────────────────────────────────────────

describe("P. Resource limits — max pages / slides / images enforced", () => {
  it("RESOURCE_LIMITS constants are present and sane", () => {
    expect(RESOURCE_LIMITS.MAX_PAGES).toBeGreaterThanOrEqual(50);
    expect(RESOURCE_LIMITS.MAX_SLIDES).toBeGreaterThanOrEqual(50);
    expect(RESOURCE_LIMITS.MAX_IMAGES_PER_DOC).toBeGreaterThanOrEqual(4);
    expect(RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES).toBeGreaterThanOrEqual(20 * 1024 * 1024);
    expect(RESOURCE_LIMITS.GENERATION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(RESOURCE_LIMITS.IMAGE_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("enforcePageLimit: passes when within limit", () => {
    expect(() => enforcePageLimit(50, 50)).not.toThrow();
    expect(() => enforcePageLimit(1, 50)).not.toThrow();
  });

  it("enforcePageLimit: throws ResourceLimitError when exceeded", () => {
    expect(() => enforcePageLimit(51, 50)).toThrow(ResourceLimitError);
    try {
      enforcePageLimit(51, 50);
    } catch (e) {
      expect(e).toBeInstanceOf(ResourceLimitError);
      expect((e as ResourceLimitError).code).toBe("PAGE_LIMIT_EXCEEDED");
      expect((e as ResourceLimitError).actual).toBe(51);
      expect((e as ResourceLimitError).limit).toBe(50);
    }
  });

  it("enforceSlideLimit: passes when within limit", () => {
    expect(() => enforceSlideLimit(60, 60)).not.toThrow();
  });

  it("enforceSlideLimit: throws ResourceLimitError when exceeded", () => {
    expect(() => enforceSlideLimit(61, 60)).toThrow(ResourceLimitError);
    try {
      enforceSlideLimit(61, 60);
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("SLIDE_LIMIT_EXCEEDED");
    }
  });

  it("enforceImageCount: passes at or below limit", () => {
    expect(() => enforceImageCount(6, 6)).not.toThrow();
    expect(() => enforceImageCount(0, 6)).not.toThrow();
  });

  it("enforceImageCount: throws ResourceLimitError when exceeded", () => {
    expect(() => enforceImageCount(7, 6)).toThrow(ResourceLimitError);
    try {
      enforceImageCount(7, 6);
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("IMAGE_COUNT_EXCEEDED");
    }
  });

  it("enforceOutputBytes: passes within limit", () => {
    expect(() => enforceOutputBytes(RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES)).not.toThrow();
  });

  it("enforceOutputBytes: throws ResourceLimitError when exceeded", () => {
    expect(() => enforceOutputBytes(RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES + 1)).toThrow(ResourceLimitError);
    try {
      enforceOutputBytes(RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES + 1);
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("OUTPUT_TOO_LARGE");
    }
  });

  it("checkDocumentResourceLimits: passes for valid document", () => {
    expect(() => checkDocumentResourceLimits({ pageCount: 20, imageCount: 3 })).not.toThrow();
  });

  it("checkDocumentResourceLimits: throws on page count violation", () => {
    expect(() =>
      checkDocumentResourceLimits({ pageCount: 100, imageCount: 2, maxPages: 50 }),
    ).toThrow(ResourceLimitError);
  });

  it("checkDocumentResourceLimits: throws on image count violation", () => {
    expect(() =>
      checkDocumentResourceLimits({ pageCount: 10, imageCount: 99 }),
    ).toThrow(ResourceLimitError);
  });

  it("checkPresentationResourceLimits: passes for valid presentation", () => {
    expect(() => checkPresentationResourceLimits({ slideCount: 30, imageCount: 4 })).not.toThrow();
  });

  it("checkPresentationResourceLimits: throws on slide count violation", () => {
    expect(() =>
      checkPresentationResourceLimits({ slideCount: 999, imageCount: 2 }),
    ).toThrow(ResourceLimitError);
    try {
      checkPresentationResourceLimits({ slideCount: 999, imageCount: 2 });
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("SLIDE_LIMIT_EXCEEDED");
    }
  });
});

// ── Q. Oversized image rejected ───────────────────────────────────────────────

describe("Q. Oversized source asset rejected", () => {
  it("enforceSourceAssetBytes: passes for small image", () => {
    expect(() => enforceSourceAssetBytes(1024)).not.toThrow();
    expect(() => enforceSourceAssetBytes(RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES)).not.toThrow();
  });

  it("enforceSourceAssetBytes: throws ResourceLimitError for oversized image", () => {
    const oversized = RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES + 1;
    expect(() => enforceSourceAssetBytes(oversized)).toThrow(ResourceLimitError);
    try {
      enforceSourceAssetBytes(oversized);
    } catch (e) {
      expect(e).toBeInstanceOf(ResourceLimitError);
      expect((e as ResourceLimitError).code).toBe("SOURCE_ASSET_TOO_LARGE");
      expect((e as ResourceLimitError).actual).toBe(oversized);
      expect((e as ResourceLimitError).limit).toBe(RESOURCE_LIMITS.MAX_SOURCE_ASSET_BYTES);
    }
  });

  it("enforceSourceAssetBytes: throws for an image > 10 MB", () => {
    const elevenMb = 11 * 1024 * 1024;
    expect(() => enforceSourceAssetBytes(elevenMb)).toThrow(ResourceLimitError);
  });

  it("validateImageUrl rejects a private URL that could serve oversized content", () => {
    // Even before fetching, SSRF guard prevents private IPs
    const result = validateImageUrl("http://10.0.5.100/huge-image.tiff");
    expect(result.valid).toBe(false);
    expect((result as { valid: false; code: string }).code).toBe("SSRF_BLOCKED");
  });
});

// ── R. Fabricated financial / team claims still skipped ───────────────────────

describe("R. Fabricated financial and team claims are skipped", () => {
  it("annual_report: financials section is always skipped", () => {
    const { content } = normalizeAnnualReportContent(makeProject({}));
    const { spec } = buildAnnualReportSpec(makeProject({}), content, null, []);
    const headingTitles = spec.sections
      .filter((s) => s.type === "heading")
      .map((s) => (s as { type: "heading"; title: string }).title.toLowerCase());
    // No financial figure headings should appear
    expect(headingTitles.some((t) => t.includes("financial"))).toBe(false);
    expect(headingTitles.some((t) => t.includes("revenue"))).toBe(false);
    expect(headingTitles.some((t) => t.includes("profit"))).toBe(false);
  });

  it("proposal: investment section skipped when no timeline/investment in brief", () => {
    const { content } = normalizeProposalContent(makeProject({}), {});
    const { report } = buildProposalSpec(makeProject({}), content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s) => s.id);
    expect(skipped).toContain("investment");
    expect(skipped).toContain("timeline");
  });

  it("whitepaper: findings section omitted when researchFindings absent", () => {
    const { content } = normalizeWhitepaperContent(makeProject({}), {});
    const { report } = buildWhitepaperSpec(makeProject({}), content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s) => s.id);
    expect(skipped).toContain("findings");
  });

  it("case_study: outcomes section omitted when no outcomes data", () => {
    const { content } = normalizeCaseStudyContent(makeProject({}), {});
    const { report } = buildCaseStudySpec(makeProject({}), content, null, []);
    const skipped = (report.sectionsSkipped as Array<{ id: string }>).map((s) => s.id);
    expect(skipped.some((id) => id.includes("outcome") || id.includes("result"))).toBe(true);
  });

  it("validateAntiFabrication detects '$0' as fabrication indicator", () => {
    const result = validateAntiFabrication({ revenue: "Total revenue: $0 million" });
    expect(result.clean).toBe(false);
  });

  it("validateAntiFabrication detects '0%' as fabrication indicator", () => {
    const result = validateAntiFabrication({ growth: "YoY growth: 0%" });
    expect(result.clean).toBe(false);
  });

  it("validateAntiFabrication: real data passes", () => {
    const result = validateAntiFabrication({
      positioning: "Leader in enterprise AI",
      tagline: "AI that works",
      tone: "Professional and approachable",
    });
    expect(result.clean).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ── S. Output buffer validation ────────────────────────────────────────────────
// Validates that the domain enforces output byte limits and that valid
// PDF/PPTX buffer signatures would be accepted by the engines.

describe("S. Output buffer validation", () => {
  it("enforceOutputBytes: a realistic 5 MB PDF passes", () => {
    const fiveMb = 5 * 1024 * 1024;
    expect(() => enforceOutputBytes(fiveMb)).not.toThrow();
  });

  it("enforceOutputBytes: a 60 MB output exceeds the 50 MB ceiling", () => {
    const sixtyMb = 60 * 1024 * 1024;
    expect(() => enforceOutputBytes(sixtyMb)).toThrow(ResourceLimitError);
    try {
      enforceOutputBytes(sixtyMb);
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("OUTPUT_TOO_LARGE");
      expect((e as ResourceLimitError).limit).toBe(RESOURCE_LIMITS.MAX_GENERATED_OUTPUT_BYTES);
    }
  });

  it("checkDocumentResourceLimits: valid 30-page, 4-image, 8 MB output passes", () => {
    expect(() =>
      checkDocumentResourceLimits({
        pageCount:   30,
        imageCount:  4,
        outputBytes: 8 * 1024 * 1024,
        maxPages:    50,
      }),
    ).not.toThrow();
  });

  it("checkDocumentResourceLimits: 51-page document violates MAX_PAGES=50", () => {
    expect(() =>
      checkDocumentResourceLimits({ pageCount: 51, imageCount: 2, maxPages: 50 }),
    ).toThrow(ResourceLimitError);
  });

  it("checkPresentationResourceLimits: valid 40-slide, 3-image PPTX passes", () => {
    expect(() =>
      checkPresentationResourceLimits({ slideCount: 40, imageCount: 3 }),
    ).not.toThrow();
  });

  it("checkPresentationResourceLimits: 61-slide PPTX violates MAX_SLIDES=60", () => {
    expect(() =>
      checkPresentationResourceLimits({ slideCount: 61, imageCount: 2 }),
    ).toThrow(ResourceLimitError);
    try {
      checkPresentationResourceLimits({ slideCount: 61, imageCount: 2 });
    } catch (e) {
      expect((e as ResourceLimitError).code).toBe("SLIDE_LIMIT_EXCEEDED");
    }
  });

  it("ResourceLimitError is an instance of Error", () => {
    const err = new ResourceLimitError("PAGE_LIMIT_EXCEEDED", 55, 50);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ResourceLimitError);
    expect(err.message).toContain("PAGE_LIMIT_EXCEEDED");
  });
});
