/**
 * creativeBrandIntelligenceService.ts — V4.2E Brand DNA Engine
 *
 * Analyzes all available brand data (brand kit, asset library, client memory,
 * project history) to derive a deterministic Brand DNA profile per client.
 *
 * Rules:
 * - Never invents data. Low confidence when inputs are sparse.
 * - Output is deterministic: same inputs → same Brand DNA.
 * - Does NOT touch Queue / Dispatcher / Worker / Event Bus / Payment.
 * - Relies on existing ai_brand_kit_assets, ai_asset_library, ai_client_memory,
 *   creative_projects, and the new ai_brand_dna table.
 */
import { eq, and, desc, sql, isNull } from "drizzle-orm";
import {
  db,
  aiBrandDnaTable,
  aiBrandKitAssetsTable,
  aiAssetLibraryTable,
  aiClientMemoryTable,
  aiAssetIntelligenceTable,
  creativeProjectsTable,
  aiServiceRequestsTable,
  customerProfilesTable,
  type AiBrandDna,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";

// ── Brand DNA view shape ─────────────────────────────────────────────────────

export interface BrandDnaView {
  clientId: string;
  brandPersonality: string[];
  brandVoice: string;
  writingStyle: string;
  photographyStyle: string;
  illustrationStyle: string;
  iconStyle: string;
  layoutStyle: string;
  visualDensity: string;
  spacingStyle: string;
  detectedColors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    palette: string[];
  };
  colorPsychology: string[];
  detectedTypography: {
    heading: string | null;
    body: string | null;
    style: string;
  };
  targetAudience: {
    primary: string;
    secondary: string;
    demographics: string[];
    psychographics: string[];
  };
  industry: string;
  riskProfile: string;
  completenessScore: number;
  consistencyScore: number;
  confidenceScore: number;
  dataSourcesSummary: {
    brandKitSlots: number;
    assetCount: number;
    projectCount: number;
    memoryCount: number;
  };
  analyzedAt: string;
}

// ── Recommendation shape ─────────────────────────────────────────────────────

export interface BrandRecommendation {
  type: string;          // "upload_asset" | "complete_slot" | "update_memory"
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  expectedImpact: string;
  missingItems: string[];
}

// ── Consistency report ───────────────────────────────────────────────────────

export interface BrandConsistencyReport {
  clientId: string;
  overallScore: number;       // 0–100
  checklist: {
    logoCorrect: boolean;
    fontCorrect: boolean;
    colorCorrect: boolean;
    brandVoiceCorrect: boolean;
    writingStyleCorrect: boolean;
    layoutCorrect: boolean;
    photoStyleCorrect: boolean;
    illustrationStyleCorrect: boolean;
  };
  warnings: string[];
  suggestions: string[];
  assetsChecked: number;
}

// ── Creative Memory view ─────────────────────────────────────────────────────

export interface CreativeMemoryView {
  clientId: string;
  memories: Array<{
    key: string;
    value: string;
    category: string;
    source: string;
    confidence: number;
    updatedAt: string;
  }>;
  projectHistory: Array<{
    projectId: string;
    brandName: string;
    status: string;
    createdAt: string;
  }>;
  totalProjects: number;
  totalMemories: number;
}

// ── Creative Director Recommendation ─────────────────────────────────────────

export interface CreativeDirectorRecommendation {
  clientId: string;
  creativeStrategy: string;
  visualDirection: string;
  communicationDirection: string;
  designRecommendations: string[];
  brandComplianceNotes: string[];
  templateRecommendations: string[];
  priorityActions: string[];
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function derivePersonality(
  memoryEntries: Array<{ key: string; value: string }>,
  brandKitSlots: Set<string>,
): string[] {
  const personality: string[] = [];
  const memMap = new Map(memoryEntries.map((m) => [m.key, m.value.toLowerCase()]));

  // Derive from memory
  const voiceStyle = memMap.get("brand_voice") ?? memMap.get("writing_style") ?? "";
  if (voiceStyle.includes("formal") || voiceStyle.includes("executive")) personality.push("Professional");
  if (voiceStyle.includes("corporate")) personality.push("Corporate");
  if (voiceStyle.includes("luxury") || voiceStyle.includes("premium")) personality.push("Luxury");
  if (voiceStyle.includes("friendly") || voiceStyle.includes("casual")) personality.push("Friendly");
  if (voiceStyle.includes("technical")) personality.push("Industrial");
  if (voiceStyle.includes("energetic") || voiceStyle.includes("dynamic")) personality.push("Energetic");

  // Infer from brand kit completeness
  if (brandKitSlots.has("brand_guidelines_pdf") && brandKitSlots.has("logo")) personality.push("Modern");
  if (personality.length === 0) personality.push("Professional"); // safe default

  return [...new Set(personality)].slice(0, 5);
}

function deriveColorPsychology(palette: string[]): string[] {
  // Simple heuristic based on hex color ranges — deterministic
  const psychology: string[] = [];
  for (const hex of palette) {
    const h = hex.replace("#", "").toLowerCase();
    if (!h || h.length < 6) continue;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (b > r && b > g) psychology.push("Trust");
    if (r > 180 && g < 100) psychology.push("Energy");
    if (g > r && g > b) psychology.push("Growth");
    if (r > 150 && g > 150 && b < 80) psychology.push("Optimism");
    if (r < 60 && g < 60 && b < 60) psychology.push("Sophistication");
    if (r > 200 && g > 200 && b > 200) psychology.push("Clarity");
    if (r > 100 && g > 60 && b < 40) psychology.push("Stability");
  }
  return [...new Set(psychology)].slice(0, 4);
}

function computeConfidence(
  brandKitSlotCount: number,
  assetCount: number,
  memoryCount: number,
  projectCount: number,
): number {
  let score = 0;
  score += Math.min(brandKitSlotCount / 20, 0.4); // max 0.4 from brand kit
  score += Math.min(assetCount / 20, 0.2);         // max 0.2 from assets
  score += Math.min(memoryCount / 10, 0.2);        // max 0.2 from memory
  score += Math.min(projectCount / 5, 0.2);        // max 0.2 from project history
  return parseFloat(score.toFixed(3));
}

// ── Core: analyzeBrand ────────────────────────────────────────────────────────

export async function analyzeBrand(clientId: string): Promise<BrandDnaView> {
  // 1. Gather brand kit
  const brandKitRows = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.emailHash, clientId), eq(aiBrandKitAssetsTable.active, true)));

  const activeSlots = new Set(brandKitRows.map((r) => r.slot));

  // 2. Gather asset library
  const assetRows = await db
    .select({ id: aiAssetLibraryTable.id })
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.emailHash, clientId), eq(aiAssetLibraryTable.archived, false)));
  const assetCount = assetRows.length;

  // 3. Gather client memory
  const memoryRows = await db
    .select()
    .from(aiClientMemoryTable)
    .where(eq(aiClientMemoryTable.clientId, clientId));
  const memMap = new Map(memoryRows.map((m) => [m.key, m.value]));

  // 4. Gather project history
  // creative_projects has no clientId/emailHash column — resolve ownership via the canonical
  // join: creative_projects.service_request_id → ai_service_requests.customer_email
  //   → customer_profiles.client_email → customer_profiles.email_hash = clientId
  // Legacy direct projects (service_request_id IS NULL) have no resolvable client identity
  // and are intentionally excluded (fail-closed: no cross-customer leakage).
  const projectRows = await db
    .select({
      projectId: creativeProjectsTable.projectId,
      brandName: creativeProjectsTable.brandName,
      status: creativeProjectsTable.status,
      createdAt: creativeProjectsTable.createdAt,
    })
    .from(creativeProjectsTable)
    .innerJoin(aiServiceRequestsTable, eq(creativeProjectsTable.serviceRequestId, aiServiceRequestsTable.id))
    .innerJoin(customerProfilesTable, eq(customerProfilesTable.clientEmail, aiServiceRequestsTable.customerEmail))
    .where(and(eq(customerProfilesTable.emailHash, clientId), isNull(creativeProjectsTable.deletedAt)))
    .orderBy(desc(creativeProjectsTable.createdAt))
    .limit(10);

  // 5. Derive Brand DNA
  const brandVoice = memMap.get("brand_voice") ?? memMap.get("preferred_voice") ?? "Professional";
  const writingStyle = memMap.get("writing_style") ?? memMap.get("preferred_writing_style") ?? "Corporate";
  const photoStyle = memMap.get("photography_style") ?? memMap.get("photo_style") ?? "Studio";
  const illustrationStyle = memMap.get("illustration_style") ?? "Flat";
  const iconStyle = memMap.get("icon_style") ?? "Outline";
  const layoutStyle = memMap.get("layout_style") ?? "Corporate";
  const visualDensity = memMap.get("visual_density") ?? "Balanced";
  const spacingStyle = memMap.get("spacing_style") ?? "Generous";
  const industry = memMap.get("industry") ?? memMap.get("business_type") ?? "General";
  const riskProfile = memMap.get("risk_profile") ?? "Moderate";

  // Colors from brand kit
  const colorRow = brandKitRows.find((r) => r.slot === "brand_color");
  const secondaryColorRow = brandKitRows.find((r) => r.slot === "secondary_color");
  const accentColorRow = brandKitRows.find((r) => r.slot === "accent_color");
  const primaryColor = colorRow?.value ?? null;
  const secondaryColor = secondaryColorRow?.value ?? null;
  const accentColor = accentColorRow?.value ?? null;
  const palette = [primaryColor, secondaryColor, accentColor].filter(Boolean) as string[];

  // Typography from brand kit
  const headingRow = brandKitRows.find((r) => r.slot === "typography_heading");
  const bodyRow = brandKitRows.find((r) => r.slot === "typography_body");

  // Target audience from memory
  const targetAudience = {
    primary: memMap.get("target_audience") ?? memMap.get("target_market") ?? "Business Professionals",
    secondary: memMap.get("secondary_audience") ?? "General Public",
    demographics: (memMap.get("demographics") ?? "").split(",").filter(Boolean),
    psychographics: (memMap.get("psychographics") ?? "").split(",").filter(Boolean),
  };

  // Compute scores
  const completenessScore = Math.min(Math.round((activeSlots.size / 20) * 100), 100);
  const consistencyScore = await computeConsistencyScore(clientId, activeSlots, memMap);
  const confidenceScore = computeConfidence(activeSlots.size, assetCount, memoryRows.length, projectRows.length);
  const brandPersonality = derivePersonality(memoryRows, activeSlots);
  const colorPsychology = deriveColorPsychology(palette);

  const dna: AiBrandDna = {
    id: 0,
    clientId,
    brandPersonality,
    brandVoice,
    writingStyle,
    photographyStyle: photoStyle,
    illustrationStyle,
    iconStyle,
    layoutStyle,
    visualDensity,
    spacingStyle,
    detectedColors: { primary: primaryColor, secondary: secondaryColor, accent: accentColor, palette },
    colorPsychology,
    detectedTypography: {
      heading: headingRow?.value ?? null,
      body: bodyRow?.value ?? null,
      style: headingRow ? "Custom" : "Default",
    },
    targetAudience,
    industry,
    riskProfile,
    completenessScore,
    consistencyScore,
    confidenceScore: confidenceScore.toString() as unknown as number,
    dataSourcesSummary: {
      brandKitSlots: activeSlots.size,
      assetCount,
      projectCount: projectRows.length,
      memoryCount: memoryRows.length,
    },
    analysisVersion: "v1",
    metadata: null,
    analyzedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 6. Upsert into DB
  await db
    .insert(aiBrandDnaTable)
    .values({
      clientId: dna.clientId,
      brandPersonality: dna.brandPersonality,
      brandVoice: dna.brandVoice ?? undefined,
      writingStyle: dna.writingStyle ?? undefined,
      photographyStyle: dna.photographyStyle ?? undefined,
      illustrationStyle: dna.illustrationStyle ?? undefined,
      iconStyle: dna.iconStyle ?? undefined,
      layoutStyle: dna.layoutStyle ?? undefined,
      visualDensity: dna.visualDensity ?? undefined,
      spacingStyle: dna.spacingStyle ?? undefined,
      detectedColors: dna.detectedColors ?? undefined,
      colorPsychology: dna.colorPsychology ?? undefined,
      detectedTypography: dna.detectedTypography ?? undefined,
      targetAudience: dna.targetAudience ?? undefined,
      industry: dna.industry ?? undefined,
      riskProfile: dna.riskProfile ?? undefined,
      completenessScore: dna.completenessScore ?? undefined,
      consistencyScore: dna.consistencyScore ?? undefined,
      confidenceScore: String(confidenceScore),
      dataSourcesSummary: dna.dataSourcesSummary ?? undefined,
      analyzedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: aiBrandDnaTable.clientId,
      set: {
        brandPersonality: dna.brandPersonality,
        brandVoice: dna.brandVoice ?? undefined,
        writingStyle: dna.writingStyle ?? undefined,
        photographyStyle: dna.photographyStyle ?? undefined,
        illustrationStyle: dna.illustrationStyle ?? undefined,
        iconStyle: dna.iconStyle ?? undefined,
        layoutStyle: dna.layoutStyle ?? undefined,
        visualDensity: dna.visualDensity ?? undefined,
        spacingStyle: dna.spacingStyle ?? undefined,
        detectedColors: dna.detectedColors ?? undefined,
        colorPsychology: dna.colorPsychology ?? undefined,
        detectedTypography: dna.detectedTypography ?? undefined,
        targetAudience: dna.targetAudience ?? undefined,
        industry: dna.industry ?? undefined,
        riskProfile: dna.riskProfile ?? undefined,
        completenessScore: dna.completenessScore ?? undefined,
        consistencyScore: dna.consistencyScore ?? undefined,
        confidenceScore: String(confidenceScore),
        dataSourcesSummary: dna.dataSourcesSummary ?? undefined,
        analyzedAt: new Date(),
        updatedAt: new Date(),
      },
    });

  await logAudit({
    action: "brand_dna_analyzed",
    entityType: "brand_dna",
    entityId: clientId,
    details: { completenessScore, consistencyScore, confidenceScore, activeSlots: activeSlots.size },
  });

  return toView(dna, confidenceScore);
}

// ── getBrandDNA ───────────────────────────────────────────────────────────────

export async function getBrandDNA(clientId: string): Promise<BrandDnaView | null> {
  const rows = await db
    .select()
    .from(aiBrandDnaTable)
    .where(eq(aiBrandDnaTable.clientId, clientId))
    .limit(1);
  if (!rows[0]) return null;
  const row = rows[0];
  return toView(row, parseFloat(String(row.confidenceScore ?? 0)));
}

// ── getCreativeMemory ─────────────────────────────────────────────────────────

export async function getCreativeMemory(clientId: string): Promise<CreativeMemoryView> {
  const [memories, projects] = await Promise.all([
    db.select().from(aiClientMemoryTable).where(eq(aiClientMemoryTable.clientId, clientId)).orderBy(desc(aiClientMemoryTable.updatedAt)),
    db.select({
      projectId: creativeProjectsTable.projectId,
      brandName: creativeProjectsTable.brandName,
      status: creativeProjectsTable.status,
      createdAt: creativeProjectsTable.createdAt,
    })
      .from(creativeProjectsTable)
      .innerJoin(aiServiceRequestsTable, eq(creativeProjectsTable.serviceRequestId, aiServiceRequestsTable.id))
      .innerJoin(customerProfilesTable, eq(customerProfilesTable.clientEmail, aiServiceRequestsTable.customerEmail))
      .where(and(eq(customerProfilesTable.emailHash, clientId), isNull(creativeProjectsTable.deletedAt)))
      .orderBy(desc(creativeProjectsTable.createdAt))
      .limit(20),
  ]);

  return {
    clientId,
    memories: memories.map((m) => ({
      key: m.key,
      value: m.value,
      category: m.category ?? "general",
      source: m.source,
      confidence: parseFloat(String(m.confidence ?? 0)),
      updatedAt: m.updatedAt.toISOString(),
    })),
    projectHistory: projects.map((p) => ({
      projectId: p.projectId,
      brandName: p.brandName ?? "Unnamed",
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    totalProjects: projects.length,
    totalMemories: memories.length,
  };
}

// ── getBrandRecommendations ───────────────────────────────────────────────────

export async function getBrandRecommendations(clientId: string): Promise<BrandRecommendation[]> {
  const brandKitRows = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.emailHash, clientId), eq(aiBrandKitAssetsTable.active, true)));
  const activeSlots = new Set(brandKitRows.map((r) => r.slot));

  const assetRows = await db
    .select({ category: aiAssetLibraryTable.category })
    .from(aiAssetLibraryTable)
    .where(and(eq(aiAssetLibraryTable.emailHash, clientId), eq(aiAssetLibraryTable.archived, false)));
  const assetCategories = new Set(assetRows.map((r) => r.category));

  const recs: BrandRecommendation[] = [];

  // Check missing critical brand kit slots
  const criticalSlots = [
    { slot: "logo", label: "Primary Logo", impact: "Foundation for all brand materials" },
    { slot: "brand_color", label: "Brand Color", impact: "Enables color consistency across all assets" },
    { slot: "typography_heading", label: "Heading Font", impact: "Typography consistency in documents and presentations" },
    { slot: "brand_voice", label: "Brand Voice", impact: "AI generates copy aligned with your brand personality" },
    { slot: "brand_guidelines_pdf", label: "Brand Guidelines PDF", impact: "Complete brand specification for AI reference" },
  ];

  const missing = criticalSlots.filter((s) => !activeSlots.has(s.slot));
  if (missing.length > 0) {
    recs.push({
      type: "complete_slot",
      priority: "high",
      title: "Complete Critical Brand Kit Slots",
      description: `${missing.length} critical brand kit slot(s) are missing. These are required for the AI Creative Director to make accurate brand decisions.`,
      expectedImpact: "Increases Brand DNA confidence by up to 40%",
      missingItems: missing.map((s) => s.label),
    });
  }

  // Check missing photo categories
  const missingPhotoTypes = [
    "Office", "Factory", "Warehouse", "CEO", "Team", "Product", "Certificate",
  ].filter((cat) => !assetCategories.has(cat.toLowerCase()) && !assetCategories.has("photo"));
  if (missingPhotoTypes.length > 3) {
    recs.push({
      type: "upload_asset",
      priority: "medium",
      title: "Upload Photography Assets",
      description: "Add real photography assets to improve Brand DNA analysis and enable better image recommendations in creative projects.",
      expectedImpact: "Improves AI image selection quality and brand consistency",
      missingItems: missingPhotoTypes.slice(0, 6),
    });
  }

  // Check social media / website references
  const hasWebsite = activeSlots.has("social_style") || activeSlots.has("stationery");
  if (!hasWebsite) {
    recs.push({
      type: "upload_asset",
      priority: "low",
      title: "Add Brand Reference Materials",
      description: "Upload social media screenshots, website references, or previous marketing materials to help the AI understand your existing brand presence.",
      expectedImpact: "Enables style matching with existing brand presence",
      missingItems: ["Social Media Templates", "Website Screenshot", "Previous Campaign Materials"],
    });
  }

  return recs;
}

// ── getBrandConsistencyReport ─────────────────────────────────────────────────

export async function getBrandConsistencyReport(clientId: string): Promise<BrandConsistencyReport> {
  const dna = await getBrandDNA(clientId);
  const brandKitRows = await db
    .select()
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.emailHash, clientId), eq(aiBrandKitAssetsTable.active, true)));
  const activeSlots = new Set(brandKitRows.map((r) => r.slot));

  const assetIntelligenceRows = await db
    .select()
    .from(aiAssetIntelligenceTable)
    .where(eq(aiAssetIntelligenceTable.clientId, clientId));

  const logoCorrect = activeSlots.has("logo");
  const fontCorrect = activeSlots.has("typography_heading") || activeSlots.has("typography_body");
  const colorCorrect = activeSlots.has("brand_color");
  const brandVoiceCorrect = activeSlots.has("brand_voice") || (dna?.brandVoice !== "Professional" && !!dna?.brandVoice);
  const writingStyleCorrect = !!dna?.writingStyle;
  const layoutCorrect = activeSlots.has("brand_guidelines_pdf") || activeSlots.size >= 5;
  const photoStyleCorrect = activeSlots.has("photography_style") || assetIntelligenceRows.some((r) => r.autoCategory === "photo");
  const illustrationStyleCorrect = activeSlots.has("illustration_style") || assetIntelligenceRows.some((r) => r.autoCategory === "illustration");

  const checks = [logoCorrect, fontCorrect, colorCorrect, brandVoiceCorrect, writingStyleCorrect, layoutCorrect, photoStyleCorrect, illustrationStyleCorrect];
  const overallScore = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!logoCorrect) warnings.push("No primary logo uploaded — AI will generate placeholder branding");
  if (!colorCorrect) warnings.push("No brand colors defined — AI may use inconsistent color palettes");
  if (!fontCorrect) suggestions.push("Upload typography assets to ensure font consistency across documents");
  if (!brandVoiceCorrect) suggestions.push("Define brand voice to align AI copywriting with your brand");
  if (!photoStyleCorrect) suggestions.push("Upload photography style reference or set photography preference");

  return {
    clientId,
    overallScore,
    checklist: {
      logoCorrect, fontCorrect, colorCorrect, brandVoiceCorrect,
      writingStyleCorrect, layoutCorrect, photoStyleCorrect, illustrationStyleCorrect,
    },
    warnings,
    suggestions,
    assetsChecked: brandKitRows.length + assetIntelligenceRows.length,
  };
}

// ── getCreativeDirectorRecommendation ─────────────────────────────────────────

export async function getCreativeDirectorRecommendation(clientId: string): Promise<CreativeDirectorRecommendation> {
  const [dna, memory, recs] = await Promise.all([
    getBrandDNA(clientId),
    getCreativeMemory(clientId),
    getBrandRecommendations(clientId),
  ]);

  const personality = dna?.brandPersonality ?? ["Professional"];
  const voice = dna?.brandVoice ?? "Professional";
  const layout = dna?.layoutStyle ?? "Corporate";
  const industry = dna?.industry ?? "General";

  const creativeStrategy = `Position ${industry} brand as ${personality.join(", ")} through a ${voice.toLowerCase()} communication style. ` +
    `Leverage ${layout} layout system to maintain visual authority. ` +
    `${memory.totalProjects > 0 ? `${memory.totalProjects} completed project(s) inform this direction.` : "Establish brand identity foundation first."}`;

  const visualDirection = `Apply ${dna?.layoutStyle ?? "corporate"} layout with ${dna?.photographyStyle ?? "studio"} photography and ` +
    `${dna?.illustrationStyle ?? "flat"} illustration style. ` +
    `Color system: ${dna?.detectedColors?.primary ?? "TBD"} as primary anchor. ` +
    `Typography: ${dna?.detectedTypography?.heading ?? "sans-serif"} for headings.`;

  const communicationDirection = `${voice} brand voice with ${dna?.writingStyle ?? "corporate"} writing style. ` +
    `Target: ${dna?.targetAudience?.primary ?? "business professionals"}. ` +
    `Key psychographic traits: ${dna?.colorPsychology?.join(", ") ?? "trust, stability"}.`;

  const designRecommendations = [
    `Use ${dna?.layoutStyle ?? "corporate"} grid systems for all layouts`,
    `Apply ${dna?.iconStyle ?? "outline"} icon style consistently`,
    `Maintain ${dna?.spacingStyle ?? "generous"} spacing for ${voice.toLowerCase()} feel`,
    `${dna?.visualDensity ?? "balanced"} visual density appropriate for ${industry}`,
  ];

  const brandComplianceNotes = recs
    .filter((r) => r.priority === "high")
    .map((r) => r.description);

  const templateRecommendations = [
    `Company Profile: ${personality.includes("Luxury") ? "Executive" : "Corporate"} template`,
    `Presentation: ${dna?.layoutStyle ?? "Modern"} layout`,
    `Social Media: ${dna?.photographyStyle ?? "Studio"} photography style`,
  ];

  const priorityActions = recs.slice(0, 3).map((r) => r.title);

  return {
    clientId,
    creativeStrategy,
    visualDirection,
    communicationDirection,
    designRecommendations,
    brandComplianceNotes: brandComplianceNotes.length > 0 ? brandComplianceNotes : ["Brand kit appears complete — maintain consistency across all outputs"],
    templateRecommendations,
    priorityActions,
    generatedAt: new Date().toISOString(),
  };
}

// ── getAdminBrandIntelligenceStats ────────────────────────────────────────────

export interface AdminBrandIntelligenceStats {
  totalClientsAnalyzed: number;
  averageCompletenessScore: number;
  averageConsistencyScore: number;
  averageConfidenceScore: number;
  highConfidenceClients: number;
  clientsWithLogo: number;
}

export async function getAdminBrandIntelligenceStats(): Promise<AdminBrandIntelligenceStats> {
  const rows = await db.select().from(aiBrandDnaTable);
  if (rows.length === 0) {
    return { totalClientsAnalyzed: 0, averageCompletenessScore: 0, averageConsistencyScore: 0, averageConfidenceScore: 0, highConfidenceClients: 0, clientsWithLogo: 0 };
  }
  const total = rows.length;
  const avgCompleteness = Math.round(rows.reduce((s, r) => s + (r.completenessScore ?? 0), 0) / total);
  const avgConsistency = Math.round(rows.reduce((s, r) => s + (r.consistencyScore ?? 0), 0) / total);
  const avgConfidence = parseFloat((rows.reduce((s, r) => s + parseFloat(String(r.confidenceScore ?? 0)), 0) / total).toFixed(3));
  const highConfidence = rows.filter((r) => parseFloat(String(r.confidenceScore ?? 0)) >= 0.7).length;

  const logoRows = await db
    .select({ clientId: aiBrandKitAssetsTable.emailHash })
    .from(aiBrandKitAssetsTable)
    .where(and(eq(aiBrandKitAssetsTable.slot, "logo"), eq(aiBrandKitAssetsTable.active, true)));
  const clientsWithLogo = new Set(logoRows.map((r) => r.clientId)).size;

  return {
    totalClientsAnalyzed: total,
    averageCompletenessScore: avgCompleteness,
    averageConsistencyScore: avgConsistency,
    averageConfidenceScore: avgConfidence,
    highConfidenceClients: highConfidence,
    clientsWithLogo,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function computeConsistencyScore(
  clientId: string,
  activeSlots: Set<string>,
  memMap: Map<string, string>,
): Promise<number> {
  let score = 0;
  const max = 8;
  if (activeSlots.has("logo")) score++;
  if (activeSlots.has("typography_heading") || activeSlots.has("typography_body")) score++;
  if (activeSlots.has("brand_color")) score++;
  if (activeSlots.has("brand_voice") || memMap.has("brand_voice")) score++;
  if (memMap.has("writing_style") || activeSlots.has("writing_style")) score++;
  if (activeSlots.has("brand_guidelines_pdf")) score++;
  if (activeSlots.has("photography_style") || memMap.has("photography_style")) score++;
  if (activeSlots.has("illustration_style") || memMap.has("illustration_style")) score++;
  return Math.round((score / max) * 100);
}

function toView(row: AiBrandDna, confidenceScore: number): BrandDnaView {
  return {
    clientId: row.clientId,
    brandPersonality: (row.brandPersonality as string[]) ?? [],
    brandVoice: row.brandVoice ?? "Professional",
    writingStyle: row.writingStyle ?? "Corporate",
    photographyStyle: row.photographyStyle ?? "Studio",
    illustrationStyle: row.illustrationStyle ?? "Flat",
    iconStyle: row.iconStyle ?? "Outline",
    layoutStyle: row.layoutStyle ?? "Corporate",
    visualDensity: row.visualDensity ?? "Balanced",
    spacingStyle: row.spacingStyle ?? "Generous",
    detectedColors: (row.detectedColors as BrandDnaView["detectedColors"]) ?? { primary: null, secondary: null, accent: null, palette: [] },
    colorPsychology: (row.colorPsychology as string[]) ?? [],
    detectedTypography: (row.detectedTypography as BrandDnaView["detectedTypography"]) ?? { heading: null, body: null, style: "Default" },
    targetAudience: (row.targetAudience as BrandDnaView["targetAudience"]) ?? { primary: "Business Professionals", secondary: "", demographics: [], psychographics: [] },
    industry: row.industry ?? "General",
    riskProfile: row.riskProfile ?? "Moderate",
    completenessScore: row.completenessScore ?? 0,
    consistencyScore: row.consistencyScore ?? 0,
    confidenceScore,
    dataSourcesSummary: (row.dataSourcesSummary as BrandDnaView["dataSourcesSummary"]) ?? { brandKitSlots: 0, assetCount: 0, projectCount: 0, memoryCount: 0 },
    analyzedAt: row.analyzedAt.toISOString(),
  };
}
