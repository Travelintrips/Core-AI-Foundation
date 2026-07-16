/**
 * Brand Intelligence 2.0 — Brand DNA Adapter (Team 5)
 *
 * Reads the existing Brand DNA (v1) without modifying it.
 * Normalises the V1 shape into BrandDnaAdapterInput for use by the V2 engine.
 * Never touches aiBrandDnaTable schema — adapter-only, read-only contract.
 */
import { eq } from "drizzle-orm";
import {
  db,
  aiBrandDnaTable,
  aiClientMemoryTable,
  creativeProjectsTable,
  type AiBrandDna,
} from "@workspace/db";
import type { BrandDnaAdapterInput } from "./types.js";

// ── Shape normalizers ─────────────────────────────────────────────────────────

function normStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).filter((x) => typeof x === "string") as string[];
  if (typeof raw === "string") return [raw];
  return [];
}

function normColors(raw: unknown): BrandDnaAdapterInput["detectedColors"] {
  const defaults = { primary: null, secondary: null, accent: null, palette: [] };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  return {
    primary: typeof r["primary"] === "string" ? r["primary"] : null,
    secondary: typeof r["secondary"] === "string" ? r["secondary"] : null,
    accent: typeof r["accent"] === "string" ? r["accent"] : null,
    palette: normStringArray(r["palette"]),
  };
}

function normTypography(raw: unknown): BrandDnaAdapterInput["detectedTypography"] {
  const defaults = { heading: null, body: null, style: "" };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  return {
    heading: typeof r["heading"] === "string" ? r["heading"] : null,
    body: typeof r["body"] === "string" ? r["body"] : null,
    style: typeof r["style"] === "string" ? r["style"] : "",
  };
}

function normAudience(raw: unknown): BrandDnaAdapterInput["targetAudience"] {
  const defaults = { primary: "", secondary: "", demographics: [], psychographics: [] };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  return {
    primary: typeof r["primary"] === "string" ? r["primary"] : "",
    secondary: typeof r["secondary"] === "string" ? r["secondary"] : "",
    demographics: normStringArray(r["demographics"]),
    psychographics: normStringArray(r["psychographics"]),
  };
}

function normDataSources(raw: unknown): BrandDnaAdapterInput["dataSourcesSummary"] {
  const defaults = { brandKitSlots: 0, assetCount: 0, projectCount: 0, memoryCount: 0 };
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Record<string, unknown>;
  return {
    brandKitSlots: typeof r["brandKitSlots"] === "number" ? r["brandKitSlots"] : 0,
    assetCount: typeof r["assetCount"] === "number" ? r["assetCount"] : 0,
    projectCount: typeof r["projectCount"] === "number" ? r["projectCount"] : 0,
    memoryCount: typeof r["memoryCount"] === "number" ? r["memoryCount"] : 0,
  };
}

// ── Public adapter function ───────────────────────────────────────────────────

export async function adaptBrandDnaForV2(
  clientId: string,
): Promise<{ input: BrandDnaAdapterInput; sourceDna: AiBrandDna | null }> {
  // Read V1 Brand DNA
  const [dna] = await db
    .select()
    .from(aiBrandDnaTable)
    .where(eq(aiBrandDnaTable.clientId, clientId))
    .limit(1);

  // Read memories for this client
  const memories = await db
    .select({
      key: aiClientMemoryTable.memoryKey,
      value: aiClientMemoryTable.memoryValue,
      category: aiClientMemoryTable.category,
      source: aiClientMemoryTable.source,
      confidence: aiClientMemoryTable.confidence,
      updatedAt: aiClientMemoryTable.updatedAt,
    })
    .from(aiClientMemoryTable)
    .where(eq(aiClientMemoryTable.clientId, clientId));

  // Read project history
  const projects = await db
    .select({
      projectId: creativeProjectsTable.id,
      brandName: creativeProjectsTable.brandName,
      status: creativeProjectsTable.status,
      createdAt: creativeProjectsTable.createdAt,
    })
    .from(creativeProjectsTable)
    .where(eq(creativeProjectsTable.clientId, clientId));

  const input: BrandDnaAdapterInput = {
    clientId,
    brandPersonality: dna ? normStringArray(dna.brandPersonality) : [],
    brandVoice: dna?.brandVoice ?? "",
    writingStyle: dna?.writingStyle ?? "",
    photographyStyle: dna?.photographyStyle ?? "",
    illustrationStyle: dna?.illustrationStyle ?? "",
    iconStyle: dna?.iconStyle ?? "",
    layoutStyle: dna?.layoutStyle ?? "",
    visualDensity: dna?.visualDensity ?? "",
    spacingStyle: dna?.spacingStyle ?? "",
    detectedColors: normColors(dna?.detectedColors),
    colorPsychology: normStringArray(dna?.colorPsychology),
    detectedTypography: normTypography(dna?.detectedTypography),
    targetAudience: normAudience(dna?.targetAudience),
    industry: dna?.industry ?? "",
    riskProfile: dna?.riskProfile ?? "",
    completenessScore: dna?.completenessScore ?? 0,
    consistencyScore: dna?.consistencyScore ?? 0,
    confidenceScore: dna?.confidenceScore != null ? parseFloat(String(dna.confidenceScore)) : 0,
    dataSourcesSummary: normDataSources(dna?.dataSourcesSummary),
    memories: memories.map((m: { key: string; value: string; category: string | null; source: string | null; confidence: unknown; updatedAt: Date | null | undefined }) => ({
      key: m.key,
      value: m.value,
      category: m.category ?? "general",
      source: m.source ?? "memory",
      confidence: m.confidence != null ? parseFloat(String(m.confidence)) : 0.5,
      updatedAt: m.updatedAt?.toISOString(),
    })),
    projectHistory: projects.map((p: { projectId: number | string; brandName: string | null; status: string | null; createdAt: Date | null | undefined }) => ({
      projectId: String(p.projectId),
      brandName: p.brandName ?? "",
      status: p.status ?? "unknown",
      createdAt: p.createdAt?.toISOString(),
    })),
  };

  return { input, sourceDna: dna ?? null };
}
