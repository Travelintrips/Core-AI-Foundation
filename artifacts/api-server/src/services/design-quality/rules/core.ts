/**
 * design-quality/rules/core.ts — Team 33
 *
 * Core built-in rules for the Universal Design Quality Assurance Engine.
 *
 * Rules cover all 12 required categories:
 *   schema, completeness, consistency, technical, visual,
 *   accessibility, brand, compliance, export, workflow,
 *   provenance, security.
 *
 * Each exported item is a BoundRule — rule metadata + evaluator function.
 * All evaluators are pure functions (no DB, no AI, no side effects).
 * They return a DesignQualityFinding when the rule is violated, or null.
 */

import type {
  BoundRule,
  DesignQualityCheckRequest,
  DesignQualityFinding,
} from "../types.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function finding(
  ruleId: string,
  ruleName: string,
  category: BoundRule["rule"]["category"],
  severity: BoundRule["rule"]["severity"],
  message: string,
  evidence?: DesignQualityFinding["evidence"],
): DesignQualityFinding {
  return { ruleId, ruleName, category, severity, message, evidence: evidence ?? null };
}

function ctx(req: DesignQualityCheckRequest): Record<string, unknown> {
  return req.context;
}

// ── SCHEMA ────────────────────────────────────────────────────────────────────

export const ruleSchemaArtifactType: BoundRule = {
  rule: {
    id: "core:schema:001",
    version: "1.0.0",
    name: "Artifact Type Declared",
    description: "The artifactType field must be a non-empty string.",
    category: "schema",
    severity: "blocking",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    if (!req.artifactType || typeof req.artifactType !== "string") {
      return finding(
        "core:schema:001",
        "Artifact Type Declared",
        "schema",
        "blocking",
        "artifactType is missing or not a string.",
        { field: "artifactType", actual: req.artifactType, expected: "non-empty string" },
      );
    }
    return null;
  },
};

export const ruleSchemaContextObject: BoundRule = {
  rule: {
    id: "core:schema:002",
    version: "1.0.0",
    name: "Context Is Object",
    description: "The context field must be a plain object.",
    category: "schema",
    severity: "error",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    if (!req.context || typeof req.context !== "object" || Array.isArray(req.context)) {
      return finding(
        "core:schema:002",
        "Context Is Object",
        "schema",
        "error",
        "context must be a plain object.",
        { field: "context", actual: typeof req.context },
      );
    }
    return null;
  },
};

// ── COMPLETENESS ──────────────────────────────────────────────────────────────

export const ruleCompletenessTitle: BoundRule = {
  rule: {
    id: "core:completeness:001",
    version: "1.0.0",
    name: "Title Present",
    description: "Artifact must have a non-empty title in context.",
    category: "completeness",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const title = ctx(req)["title"];
    if (!title || typeof title !== "string" || title.trim() === "") {
      return finding(
        "core:completeness:001",
        "Title Present",
        "completeness",
        "warning",
        "Artifact is missing a title. Add context.title for discoverability.",
        { field: "context.title", actual: title },
      );
    }
    return null;
  },
};

export const ruleCompletenessContent: BoundRule = {
  rule: {
    id: "core:completeness:002",
    version: "1.0.0",
    name: "Content Or Description Present",
    description: "Artifact must have at least one of: description, content, summary, or assetUrl.",
    category: "completeness",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const hasContent =
      (typeof c["description"] === "string" && c["description"].trim() !== "") ||
      (typeof c["content"] === "string" && c["content"].trim() !== "") ||
      (typeof c["summary"] === "string" && c["summary"].trim() !== "") ||
      (typeof c["assetUrl"] === "string" && c["assetUrl"].trim() !== "");
    if (!hasContent) {
      return finding(
        "core:completeness:002",
        "Content Or Description Present",
        "completeness",
        "warning",
        "Artifact has no description, content, summary, or assetUrl.",
      );
    }
    return null;
  },
};

// ── CONSISTENCY ───────────────────────────────────────────────────────────────

export const ruleConsistencyVersion: BoundRule = {
  rule: {
    id: "core:consistency:001",
    version: "1.0.0",
    name: "Version Format Consistent",
    description: "If context.version is present, it must match semver format (N.N.N).",
    category: "consistency",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const version = ctx(req)["version"];
    if (version === undefined || version === null) return null; // optional field
    const semver = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
    if (typeof version !== "string" || !semver.test(version)) {
      return finding(
        "core:consistency:001",
        "Version Format Consistent",
        "consistency",
        "warning",
        `context.version "${String(version)}" does not match semver format (e.g. 1.0.0).`,
        { field: "context.version", actual: version, expected: "semver (N.N.N)" },
      );
    }
    return null;
  },
};

export const ruleConsistencyNamingConvention: BoundRule = {
  rule: {
    id: "core:consistency:002",
    version: "1.0.0",
    name: "Artifact Type Naming Convention",
    description: "artifactType must use snake_case (lowercase letters and underscores only).",
    category: "consistency",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const snake = /^[a-z][a-z0-9_]*$/;
    if (!snake.test(req.artifactType)) {
      return finding(
        "core:consistency:002",
        "Artifact Type Naming Convention",
        "consistency",
        "warning",
        `artifactType "${req.artifactType}" does not follow snake_case convention.`,
        { field: "artifactType", actual: req.artifactType, expected: "snake_case" },
      );
    }
    return null;
  },
};

// ── TECHNICAL ─────────────────────────────────────────────────────────────────

export const ruleTechnicalFormatDeclared: BoundRule = {
  rule: {
    id: "core:technical:001",
    version: "1.0.0",
    name: "Output Format Declared",
    description: "context.format or context.outputFormat must be specified.",
    category: "technical",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const format = c["format"] ?? c["outputFormat"];
    if (!format || typeof format !== "string" || format.trim() === "") {
      return finding(
        "core:technical:001",
        "Output Format Declared",
        "technical",
        "warning",
        "context.format (or outputFormat) is not declared. Specify the output format for this artifact.",
      );
    }
    return null;
  },
};

export const ruleTechnicalResolutionForRaster: BoundRule = {
  rule: {
    id: "core:technical:002",
    version: "1.0.0",
    name: "Resolution Declared For Raster",
    description: "Raster images must declare context.resolutionDpi or context.widthPx + heightPx.",
    category: "technical",
    severity: "error",
    source: "core",
    applicableTo: ["image", "graphic_design", "photo"],
    capabilityRequirement: "raster_metadata",
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const hasDpi = typeof c["resolutionDpi"] === "number";
    const hasDimensions = typeof c["widthPx"] === "number" && typeof c["heightPx"] === "number";
    if (!hasDpi && !hasDimensions) {
      return finding(
        "core:technical:002",
        "Resolution Declared For Raster",
        "technical",
        "error",
        "Raster artifact is missing resolution information (resolutionDpi or widthPx+heightPx).",
      );
    }
    return null;
  },
};

// ── VISUAL ────────────────────────────────────────────────────────────────────

export const ruleVisualColorSpace: BoundRule = {
  rule: {
    id: "core:visual:001",
    version: "1.0.0",
    name: "Color Space Declared",
    description: "Raster/print assets should declare context.colorMode (RGB, CMYK, sRGB, etc.).",
    category: "visual",
    severity: "info",
    source: "core",
    applicableTo: ["image", "graphic_design", "print_asset"],
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const colorMode = ctx(req)["colorMode"];
    if (!colorMode) {
      return finding(
        "core:visual:001",
        "Color Space Declared",
        "visual",
        "info",
        "context.colorMode is not declared. Declare RGB, sRGB, or CMYK for accurate color output.",
      );
    }
    return null;
  },
};

export const ruleVisualAspectRatioDeclared: BoundRule = {
  rule: {
    id: "core:visual:002",
    version: "1.0.0",
    name: "Aspect Ratio Documented",
    description: "Visual assets should document aspect ratio or canvas dimensions.",
    category: "visual",
    severity: "info",
    source: "core",
    applicableTo: ["image", "graphic_design", "banner", "social_media"],
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const hasRatio = c["aspectRatio"] || (c["widthPx"] && c["heightPx"]);
    if (!hasRatio) {
      return finding(
        "core:visual:002",
        "Aspect Ratio Documented",
        "visual",
        "info",
        "Aspect ratio or canvas dimensions not declared (context.aspectRatio or widthPx/heightPx).",
      );
    }
    return null;
  },
};

// ── ACCESSIBILITY ─────────────────────────────────────────────────────────────

export const ruleAccessibilityAltText: BoundRule = {
  rule: {
    id: "core:accessibility:001",
    version: "1.0.0",
    name: "Alt Text For Visual Assets",
    description: "Visual artifacts must have context.altText for screen-reader accessibility.",
    category: "accessibility",
    severity: "warning",
    source: "core",
    applicableTo: ["image", "graphic_design", "banner", "social_media", "photo"],
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const altText = ctx(req)["altText"];
    if (!altText || typeof altText !== "string" || altText.trim() === "") {
      return finding(
        "core:accessibility:001",
        "Alt Text For Visual Assets",
        "accessibility",
        "warning",
        "Visual artifact is missing context.altText. Provide a descriptive alt text for accessibility.",
      );
    }
    return null;
  },
};

export const ruleAccessibilityContrastRatio: BoundRule = {
  rule: {
    id: "core:accessibility:002",
    version: "1.0.0",
    name: "Minimum Contrast Ratio",
    description: "Text elements must meet WCAG AA minimum contrast ratio of 4.5:1.",
    category: "accessibility",
    severity: "error",
    source: "core",
    capabilityRequirement: "contrast_analysis",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine, WCAG 2.1 AA",
  },
  evaluate(req) {
    const c = ctx(req);
    const contrast = c["contrastRatio"];
    if (contrast === undefined || contrast === null) return null; // not available
    if (typeof contrast === "number" && contrast < 4.5) {
      return finding(
        "core:accessibility:002",
        "Minimum Contrast Ratio",
        "accessibility",
        "error",
        `Contrast ratio ${contrast.toFixed(2)} is below WCAG AA minimum of 4.5:1.`,
        { field: "context.contrastRatio", actual: contrast, expected: ">= 4.5" },
      );
    }
    return null;
  },
};

// ── BRAND ─────────────────────────────────────────────────────────────────────

export const ruleBrandGuidelinesReference: BoundRule = {
  rule: {
    id: "core:brand:001",
    version: "1.0.0",
    name: "Brand Guidelines Reference",
    description: "Design artifacts should reference context.brandGuidelinesId or brandPolicyId.",
    category: "brand",
    severity: "info",
    source: "core",
    applicableTo: ["graphic_design", "branding", "logo", "banner", "social_media"],
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const hasRef =
      c["brandGuidelinesId"] || c["brandPolicyId"] || c["brandId"] || c["tenantBrandId"];
    if (!hasRef) {
      return finding(
        "core:brand:001",
        "Brand Guidelines Reference",
        "brand",
        "info",
        "No brand guidelines reference found. Link context.brandGuidelinesId for brand compliance tracking.",
      );
    }
    return null;
  },
};

export const ruleBrandColorConstraint: BoundRule = {
  rule: {
    id: "core:brand:002",
    version: "1.0.0",
    name: "Brand Color Palette Declared",
    description:
      "When brandColors is provided in context, used colors must be a subset of approved palette.",
    category: "brand",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const brandColors = c["brandColors"];
    const usedColors = c["usedColors"];
    if (!Array.isArray(brandColors) || !Array.isArray(usedColors)) return null;

    const normalized = (colors: unknown[]) =>
      colors.map((c) => String(c).toLowerCase().replace(/\s/g, ""));
    const approvedSet = new Set(normalized(brandColors));
    const violations = normalized(usedColors).filter((col) => !approvedSet.has(col));

    if (violations.length > 0) {
      return finding(
        "core:brand:002",
        "Brand Color Palette Declared",
        "brand",
        "warning",
        `${violations.length} color(s) not in approved brand palette: ${violations.slice(0, 5).join(", ")}.`,
        { field: "context.usedColors", actual: violations, expected: "subset of brandColors" },
      );
    }
    return null;
  },
};

// ── COMPLIANCE ────────────────────────────────────────────────────────────────

/**
 * CRITICAL: Never emit a compliance certification without real evidence.
 * This rule is the "no false certification" guard.
 */
export const ruleComplianceNoCertificationWithoutEvidence: BoundRule = {
  rule: {
    id: "core:compliance:001",
    version: "1.0.0",
    name: "No Compliance Certification Without Evidence",
    description:
      "If context.complianceCertified is true, context.complianceEvidence must be present and non-empty.",
    category: "compliance",
    severity: "blocking",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    if (c["complianceCertified"] !== true) return null;

    const evidence = c["complianceEvidence"];
    const hasEvidence =
      (typeof evidence === "string" && evidence.trim() !== "") ||
      (Array.isArray(evidence) && evidence.length > 0) ||
      (evidence && typeof evidence === "object" && !Array.isArray(evidence));

    if (!hasEvidence) {
      return finding(
        "core:compliance:001",
        "No Compliance Certification Without Evidence",
        "compliance",
        "blocking",
        "context.complianceCertified is true but complianceEvidence is missing or empty. " +
          "Do not assert compliance without verifiable evidence.",
        { field: "context.complianceEvidence", actual: evidence, expected: "non-empty evidence" },
      );
    }
    return null;
  },
};

export const ruleComplianceTrademarkCheck: BoundRule = {
  rule: {
    id: "core:compliance:002",
    version: "1.0.0",
    name: "Trademark Clearance Documented",
    description: "If trademark-sensitive artifact, context.trademarkCleared must be declared.",
    category: "compliance",
    severity: "warning",
    source: "core",
    applicableTo: ["logo", "branding", "brand_kit"],
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    if (c["trademarkCleared"] === undefined) {
      return finding(
        "core:compliance:002",
        "Trademark Clearance Documented",
        "compliance",
        "warning",
        "Branding artifact does not declare context.trademarkCleared. " +
          "Document trademark clearance status before use.",
      );
    }
    return null;
  },
};

// ── EXPORT ────────────────────────────────────────────────────────────────────

export const ruleExportFormatDeclared: BoundRule = {
  rule: {
    id: "core:export:001",
    version: "1.0.0",
    name: "Export Format Declared",
    description: "context.exportFormats must be a non-empty array of format strings.",
    category: "export",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const exportFormats = ctx(req)["exportFormats"];
    if (!Array.isArray(exportFormats) || exportFormats.length === 0) {
      return finding(
        "core:export:001",
        "Export Format Declared",
        "export",
        "warning",
        "context.exportFormats is missing or empty. Declare the intended export formats.",
      );
    }
    return null;
  },
};

export const ruleExportNoProprietary: BoundRule = {
  rule: {
    id: "core:export:002",
    version: "1.0.0",
    name: "No Proprietary-Only Export",
    description: "Artifacts must include at least one open/standard format alongside any proprietary format.",
    category: "export",
    severity: "info",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const exportFormats = ctx(req)["exportFormats"];
    if (!Array.isArray(exportFormats) || exportFormats.length === 0) return null;

    const OPEN_FORMATS = new Set(["pdf", "svg", "png", "jpg", "jpeg", "webp", "json", "csv", "xml"]);
    const proprietary = ["ai", "psd", "indd", "xd", "sketch", "fig", "figma"];

    const fmts = exportFormats.map((f) => String(f).toLowerCase());
    const hasOpen = fmts.some((f) => OPEN_FORMATS.has(f));
    const hasProprietary = fmts.some((f) => proprietary.includes(f));

    if (hasProprietary && !hasOpen) {
      return finding(
        "core:export:002",
        "No Proprietary-Only Export",
        "export",
        "info",
        "Export includes proprietary formats but no open standard format (PDF, SVG, PNG, etc.). " +
          "Add at least one open format for portability.",
        { field: "context.exportFormats", actual: fmts },
      );
    }
    return null;
  },
};

// ── WORKFLOW ──────────────────────────────────────────────────────────────────

export const ruleWorkflowReviewStatus: BoundRule = {
  rule: {
    id: "core:workflow:001",
    version: "1.0.0",
    name: "Review Status Declared",
    description: "Workflow artifacts must declare context.reviewStatus.",
    category: "workflow",
    severity: "warning",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const reviewStatus = ctx(req)["reviewStatus"];
    if (reviewStatus === undefined || reviewStatus === null) {
      return finding(
        "core:workflow:001",
        "Review Status Declared",
        "workflow",
        "warning",
        "context.reviewStatus is not set. Declare the review state (e.g. draft, in_review, approved).",
      );
    }
    return null;
  },
};

export const ruleWorkflowApprovalGate: BoundRule = {
  rule: {
    id: "core:workflow:002",
    version: "1.0.0",
    name: "Approval Gate Before Export",
    description: "context.reviewStatus must not be 'draft' or 'in_review' for export-ready artifacts.",
    category: "workflow",
    severity: "error",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const isExportReady = c["exportReady"] === true || c["readyForExport"] === true;
    const reviewStatus = c["reviewStatus"];
    if (!isExportReady) return null; // only applies when marked export-ready

    if (reviewStatus === "draft" || reviewStatus === "in_review") {
      return finding(
        "core:workflow:002",
        "Approval Gate Before Export",
        "workflow",
        "error",
        `Artifact is marked export-ready but has reviewStatus "${String(reviewStatus)}". ` +
          "Approval is required before export.",
        { field: "context.reviewStatus", actual: reviewStatus, expected: "approved" },
      );
    }
    return null;
  },
};

// ── PROVENANCE ────────────────────────────────────────────────────────────────

export const ruleProvenanceAiModelAttribution: BoundRule = {
  rule: {
    id: "core:provenance:001",
    version: "1.0.0",
    name: "AI-Generated Content Attributed",
    description:
      "When context.aiGenerated is true, context.modelProvenance or context.modelId must be declared.",
    category: "provenance",
    severity: "error",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    if (c["aiGenerated"] !== true) return null;

    const hasProvenance =
      (c["modelProvenance"] && String(c["modelProvenance"]).trim() !== "") ||
      (c["modelId"] && String(c["modelId"]).trim() !== "");

    if (!hasProvenance) {
      return finding(
        "core:provenance:001",
        "AI-Generated Content Attributed",
        "provenance",
        "error",
        "context.aiGenerated is true but no model provenance is declared " +
          "(context.modelProvenance or context.modelId).",
      );
    }
    return null;
  },
};

export const ruleProvenanceSourceAsset: BoundRule = {
  rule: {
    id: "core:provenance:002",
    version: "1.0.0",
    name: "Source Asset Reference",
    description: "Derivative artifacts should reference their source asset via context.sourceAssetId.",
    category: "provenance",
    severity: "info",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const isDerivative = c["isDerivative"] === true || c["derivedFrom"] !== undefined;
    if (!isDerivative) return null;

    const hasSource = c["sourceAssetId"] || c["derivedFrom"];
    if (!hasSource) {
      return finding(
        "core:provenance:002",
        "Source Asset Reference",
        "provenance",
        "info",
        "Derivative artifact does not reference its source. Set context.sourceAssetId for traceability.",
      );
    }
    return null;
  },
};

// ── SECURITY ──────────────────────────────────────────────────────────────────

export const ruleSecurityNoRawProviderPayload: BoundRule = {
  rule: {
    id: "core:security:001",
    version: "1.0.0",
    name: "No Raw Provider API Payload",
    description:
      "context must not contain raw AI provider API payloads (apiKey, authorization, Bearer tokens, rawResponse).",
    category: "security",
    severity: "blocking",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const dangerousKeys = [
      "apiKey",
      "api_key",
      "authorization",
      "Authorization",
      "bearer",
      "rawResponse",
      "raw_response",
      "providerPayload",
      "provider_payload",
    ];
    const found = dangerousKeys.filter((k) => k in c);
    if (found.length > 0) {
      return finding(
        "core:security:001",
        "No Raw Provider API Payload",
        "security",
        "blocking",
        `context contains sensitive/provider fields that must not be stored: ${found.join(", ")}. ` +
          "Remove these before persisting or sharing the artifact context.",
        { field: found.join(", "), actual: "[REDACTED]", expected: "absent" },
      );
    }
    return null;
  },
};

export const ruleSecurityNoInternalPii: BoundRule = {
  rule: {
    id: "core:security:002",
    version: "1.0.0",
    name: "No Unmasked PII In Context",
    description:
      "context must not expose unmasked passwords, secret keys, or private tokens.",
    category: "security",
    severity: "blocking",
    source: "core",
    applicableTo: null,
    autoFixable: false,
    sourceAttribution: "Team 33 — Universal Design QA Engine",
  },
  evaluate(req) {
    const c = ctx(req);
    const sensitivePatterns: Array<[string, RegExp]> = [
      ["password", /password/i],
      ["secret", /secret[_-]?key/i],
      ["private_key", /private[_-]?key/i],
      ["token", /^token$/i],
    ];
    const violations: string[] = [];
    for (const [label, pattern] of sensitivePatterns) {
      for (const key of Object.keys(c)) {
        if (pattern.test(key)) {
          violations.push(`${label} field "${key}"`);
        }
      }
    }
    if (violations.length > 0) {
      return finding(
        "core:security:002",
        "No Unmasked PII In Context",
        "security",
        "blocking",
        `context contains sensitive field(s): ${violations.join(", ")}. Remove or mask before use.`,
        { field: violations.join(", "), actual: "[REDACTED]", expected: "absent" },
      );
    }
    return null;
  },
};

// ── Export all core rules ──────────────────────────────────────────────────────

export const CORE_RULES: BoundRule[] = [
  // schema
  ruleSchemaArtifactType,
  ruleSchemaContextObject,
  // completeness
  ruleCompletenessTitle,
  ruleCompletenessContent,
  // consistency
  ruleConsistencyVersion,
  ruleConsistencyNamingConvention,
  // technical
  ruleTechnicalFormatDeclared,
  ruleTechnicalResolutionForRaster,
  // visual
  ruleVisualColorSpace,
  ruleVisualAspectRatioDeclared,
  // accessibility
  ruleAccessibilityAltText,
  ruleAccessibilityContrastRatio,
  // brand
  ruleBrandGuidelinesReference,
  ruleBrandColorConstraint,
  // compliance
  ruleComplianceNoCertificationWithoutEvidence,
  ruleComplianceTrademarkCheck,
  // export
  ruleExportFormatDeclared,
  ruleExportNoProprietary,
  // workflow
  ruleWorkflowReviewStatus,
  ruleWorkflowApprovalGate,
  // provenance
  ruleProvenanceAiModelAttribution,
  ruleProvenanceSourceAsset,
  // security
  ruleSecurityNoRawProviderPayload,
  ruleSecurityNoInternalPii,
];
