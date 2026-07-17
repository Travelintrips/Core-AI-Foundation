/**
 * Universal Template Matching — Default Port Adapters
 *
 * DUPLICATION RULE (remediation): This adapter is the ONLY place that reads
 * from the template data store. It delegates ALL data access to the existing
 * `templateService` (templateService.ts) which owns `ai_templates`. The
 * scoring engine (scoring.ts) never touches the DB directly.
 *
 * Source of truth: templateService.listTemplates() / templateService.getTemplate()
 * Team 11 adds: scoring intelligence, explanation, confidence — not persistence.
 *
 * PERFORMANCE RULE: Candidate fetching uses DB-level filtering (category,
 * industry via templateService SQL WHERE clauses). The hard row cap is 50
 * (max 100) — never a full table scan.
 *
 * SECURITY RULE: templateToBlueprint() strips all private/commercial fields:
 * pricePoints, pdfPreviewUrl, pptPreviewUrl, templateCode, sortOrder.
 * getById() returns null for non-published templates (fail-closed).
 */

import {
  listTemplates as listTemplatesFromService,
  getTemplate as getTemplateFromService,
} from "../templateService.js";
import type {
  Blueprint,
  Component,
  Pattern,
  TokenLibraryEntry,
  BlueprintPort,
  ComponentPort,
  PatternPort,
  TokenLibraryPort,
  MatchingDeps,
} from "./ports.js";
import type { AiTemplate } from "@workspace/db";

// ── AI Template → Blueprint mapper ───────────────────────────────────────────
// SECURITY: Only safe/public fields are copied. Private fields are excluded:
//   - templateCode (internal identifier, not needed by scoring)
//   - pricePoints  (commercial pricing data)
//   - pdfPreviewUrl / pptPreviewUrl (direct asset URLs — not for API consumers)
//   - sortOrder    (internal admin sorting)
//   - previewImages.gallery (only thumbnail used, if needed)

function templateToBlueprint(row: AiTemplate): Blueprint {
  const dna = (row.brandDnaTags ?? {}) as {
    personalities?: string[];
    voices?: string[];
    audiences?: string[];
    industries?: string[];
  };

  // Build keyword list from name + description only (not templateCode — internal)
  const rawText = [row.name, row.description ?? "", row.category, row.style].join(" ");
  const keywords = rawText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  return {
    id: String(row.id),
    name: row.name,
    category: row.category,
    serviceTypes: categoryToServiceTypes(row.category),
    domains: categoryToDomains(row.category),
    // row.industry is the single DB value; dna.industries is the JSONB array
    industries: row.industry
      ? [row.industry, ...(dna.industries ?? [])]
      : (dna.industries ?? []),
    audiences: dna.audiences ?? [],
    styles: row.style ? [row.style] : [],
    outputFormats: categoryToOutputFormats(row.category),
    supportedPackages: (row.supportedPackages ?? []) as string[],
    personalities: dna.personalities ?? [],
    voices: dna.voices ?? [],
    // colorTheme.primary is safe to expose (visual metadata, not commercial)
    primaryColorHex: (row.colorTheme as { primary?: string } | null)?.primary ?? null,
    published: row.status === "published",
    featured: row.featured,
    usageCount: row.conversions ?? 0,
    unsupportedConstraints: [],
    keywords: [...new Set(keywords)],
  };
}

/**
 * Derive service type codes from category names.
 * Centralised here so the heuristic can be extended without touching scoring.
 */
function categoryToServiceTypes(category: string): string[] {
  const cat = category.toLowerCase();
  if (cat.includes("company profile") || cat.includes("profil")) return ["CP"];
  if (cat.includes("pitch") || cat.includes("investor")) return ["PITCH"];
  if (cat.includes("brand") || cat.includes("identity")) return ["BRANDING"];
  if (cat.includes("marketing") || cat.includes("campaign")) return ["MARKETING"];
  if (cat.includes("social") || cat.includes("post")) return ["SOCIAL"];
  if (cat.includes("proposal")) return ["PROPOSAL"];
  if (cat.includes("report") || cat.includes("laporan")) return ["REPORT"];
  if (cat.includes("legal") || cat.includes("contract")) return ["LEGAL"];
  return []; // cross-service
}

function categoryToDomains(category: string): string[] {
  const cat = category.toLowerCase();
  const domains: string[] = [];
  if (cat.includes("brand") || cat.includes("creative") || cat.includes("design")) domains.push("creative");
  if (cat.includes("marketing") || cat.includes("campaign") || cat.includes("social")) domains.push("marketing");
  if (cat.includes("legal") || cat.includes("contract")) domains.push("legal");
  if (cat.includes("finance") || cat.includes("report") || cat.includes("laporan")) domains.push("finance");
  if (cat.includes("pitch") || cat.includes("investor") || cat.includes("proposal")) domains.push("sales");
  if (domains.length === 0) domains.push("creative");
  return domains;
}

function categoryToOutputFormats(category: string): string[] {
  const cat = category.toLowerCase();
  if (cat.includes("social") || cat.includes("post") || cat.includes("banner")) return ["png", "jpg", "webp"];
  if (cat.includes("pitch") || cat.includes("presentation")) return ["pptx", "pdf"];
  return ["pdf"];
}

// ── Blueprint Port (delegates to templateService) ─────────────────────────────
//
// ARCHITECTURE: DbBlueprintPort is the adapter that bridges templateService
// (source of truth for template persistence) with Team 11's scoring engine.
// It does NOT re-implement query logic — it calls templateService and maps rows.
//
// PERFORMANCE: DB-level filtering via templateService.listTemplates():
//   - status: "published" → SQL WHERE clause (never returns draft/archived)
//   - category → SQL WHERE = (exact match, uses B-tree index on category)
//   - industry → SQL WHERE = OR IS NULL (includes cross-industry templates)
// Hard row limit: 50 default, 100 max. Never a full table scan.

export class DbBlueprintPort implements BlueprintPort {
  async listCandidates(opts?: {
    category?: string;
    serviceType?: string;
    industry?: string;
    limit?: number;
  }): Promise<Blueprint[]> {
    // Hard cap: never fetch more than 100 candidates.
    // templateService.listTemplates() enforces its own limit too (max 200 there),
    // but we impose a stricter domain cap here.
    const limit = Math.min(opts?.limit ?? 50, 100);

    const { items } = await listTemplatesFromService({
      status: "published",          // DB-level: never return draft/archived
      category: opts?.category,     // DB-level: exact match on category column
      industry: opts?.industry,     // DB-level: eq OR IS NULL (cross-industry)
      // style intentionally NOT used as pre-filter: style is a soft signal
      // that may have multiple valid values; let the scoring engine handle it
      // to avoid excluding good candidates. Documented: design decision.
      limit,
    });

    // Map to Blueprint (public-safe projection — private fields excluded)
    return items
      .filter((row) => row.status === "published") // belt-and-suspenders guard
      .map(templateToBlueprint);
  }

  async getById(id: string): Promise<Blueprint | null> {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return null;

    // Delegate to templateService (single source of truth for template reads)
    const row = await getTemplateFromService(numId);

    // SECURITY: fail-closed — only return published templates.
    // Draft/archived templates must NOT appear in recommendations.
    if (!row || row.status !== "published") return null;

    return templateToBlueprint(row);
  }
}

// ── Component Port (static fallback — no dedicated table yet) ────────────────

/**
 * Stub: returns a minimal set of generic components.
 * Replace with a DB-backed version when an ai_components table exists.
 * The scoring engine uses this only for enrichment — empty lists degrade
 * gracefully without breaking the score.
 */
export class StaticComponentPort implements ComponentPort {
  private static COMPONENTS: Component[] = [
    { id: "c-header-01", name: "Standard Header", componentType: "header",
      compatibleCategories: ["Company Profile", "Pitch Deck", "Proposal"], compatibleStyles: ["modern", "classic", "minimalist"], outputFormats: ["pdf", "pptx"] },
    { id: "c-hero-01", name: "Hero Banner", componentType: "hero",
      compatibleCategories: ["Company Profile", "Marketing", "Social Post"], compatibleStyles: ["bold", "modern"], outputFormats: ["png", "jpg", "pdf"] },
    { id: "c-chart-01", name: "Data Chart", componentType: "chart",
      compatibleCategories: ["Pitch Deck", "Report", "Proposal"], compatibleStyles: ["modern", "minimalist"], outputFormats: ["pdf", "pptx"] },
    { id: "c-footer-01", name: "Standard Footer", componentType: "footer",
      compatibleCategories: ["Company Profile", "Report", "Proposal"], compatibleStyles: ["modern", "classic", "elegant"], outputFormats: ["pdf"] },
  ];

  async listByCategory(category: string): Promise<Component[]> {
    const cat = category.toLowerCase();
    return StaticComponentPort.COMPONENTS.filter((c) =>
      c.compatibleCategories.some((cc) => cc.toLowerCase().includes(cat) || cat.includes(cc.toLowerCase())),
    );
  }
}

// ── Pattern Port (static catalogue) ──────────────────────────────────────────

export class StaticPatternPort implements PatternPort {
  private static PATTERNS: Pattern[] = [
    { id: "p-grid-01", name: "Two-Column Grid", patternType: "layout",
      applicableServiceTypes: ["CP", "PROPOSAL", "REPORT"], applicableDomains: ["creative", "marketing"], recommendedStyles: ["modern", "minimalist"] },
    { id: "p-hero-text-01", name: "Hero + Text Flow", patternType: "content-structure",
      applicableServiceTypes: ["CP", "BRANDING"], applicableDomains: ["creative"], recommendedStyles: ["bold", "modern"] },
    { id: "p-pitch-flow-01", name: "Problem → Solution → CTA", patternType: "content-structure",
      applicableServiceTypes: ["PITCH", "PROPOSAL"], applicableDomains: ["sales"], recommendedStyles: ["modern", "minimalist", "bold"] },
    { id: "p-social-square-01", name: "Square Social Card", patternType: "layout",
      applicableServiceTypes: ["SOCIAL", "MARKETING"], applicableDomains: ["marketing"], recommendedStyles: ["bold", "modern", "vibrant"] },
  ];

  async listByServiceType(serviceType: string): Promise<Pattern[]> {
    const st = serviceType.toUpperCase();
    return StaticPatternPort.PATTERNS.filter((p) =>
      p.applicableServiceTypes.includes(st) || p.applicableServiceTypes.length === 0,
    );
  }
}

// ── Token Library Port (static catalogue) ────────────────────────────────────

export class StaticTokenLibraryPort implements TokenLibraryPort {
  private static TOKENS: TokenLibraryEntry[] = [
    { id: "tl-tech-mod", industry: "technology", style: "modern",
      primaryColorFamily: "00", secondaryColorFamily: "1a", headingFont: "Inter", bodyFont: "Inter", typographyStyle: "sans-serif" },
    { id: "tl-tech-min", industry: "technology", style: "minimalist",
      primaryColorFamily: "0d", secondaryColorFamily: null, headingFont: "Roboto", bodyFont: "Roboto", typographyStyle: "sans-serif" },
    { id: "tl-fin-clas", industry: "finance", style: "classic",
      primaryColorFamily: "1a", secondaryColorFamily: "2c", headingFont: "Merriweather", bodyFont: "Georgia", typographyStyle: "serif" },
    { id: "tl-fin-mod", industry: "finance", style: "modern",
      primaryColorFamily: "0a", secondaryColorFamily: "1b", headingFont: "Inter", bodyFont: "Inter", typographyStyle: "sans-serif" },
    { id: "tl-log-bold", industry: "logistics", style: "bold",
      primaryColorFamily: "ff", secondaryColorFamily: "00", headingFont: "Oswald", bodyFont: "Open Sans", typographyStyle: "sans-serif" },
    { id: "tl-ret-vib", industry: "retail", style: "vibrant",
      primaryColorFamily: "e5", secondaryColorFamily: "ff", headingFont: "Nunito", bodyFont: "Nunito", typographyStyle: "sans-serif" },
    { id: "tl-hlth-min", industry: "healthcare", style: "minimalist",
      primaryColorFamily: "00", secondaryColorFamily: "b2", headingFont: "Lato", bodyFont: "Lato", typographyStyle: "sans-serif" },
    { id: "tl-edu-clas", industry: "education", style: "classic",
      primaryColorFamily: "00", secondaryColorFamily: "4a", headingFont: "Playfair Display", bodyFont: "Lato", typographyStyle: "serif" },
    { id: "tl-prop-ele", industry: "property", style: "elegant",
      primaryColorFamily: "c8", secondaryColorFamily: "1a", headingFont: "Cormorant Garamond", bodyFont: "Open Sans", typographyStyle: "serif" },
    { id: "tl-fmcg-bold", industry: "fmcg", style: "bold",
      primaryColorFamily: "d4", secondaryColorFamily: "00", headingFont: "Montserrat", bodyFont: "Open Sans", typographyStyle: "sans-serif" },
  ];

  async getEntry(industry: string, style: string): Promise<TokenLibraryEntry | null> {
    const ind = industry.toLowerCase();
    const sty = style.toLowerCase();
    return StaticTokenLibraryPort.TOKENS.find(
      (t) => t.industry.toLowerCase() === ind && t.style.toLowerCase() === sty,
    ) ?? null;
  }

  async listByIndustry(industry: string): Promise<TokenLibraryEntry[]> {
    const ind = industry.toLowerCase();
    return StaticTokenLibraryPort.TOKENS.filter((t) => t.industry.toLowerCase() === ind);
  }
}

// ── Default dependency container ──────────────────────────────────────────────

/**
 * Production default: templateService-backed blueprints, static stubs for
 * components/patterns/tokens (replace with DB-backed versions when tables exist).
 */
export function createDefaultDeps(): MatchingDeps {
  return {
    blueprints: new DbBlueprintPort(),
    components: new StaticComponentPort(),
    patterns: new StaticPatternPort(),
    tokenLibrary: new StaticTokenLibraryPort(),
  };
}
