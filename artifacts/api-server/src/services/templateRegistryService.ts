/**
 * templateRegistryService — V4.6 Template Registry + Versioning + Mappings
 *
 * Manages the V4.6 Template Registry (separate from legacy ai_templates):
 * - Registry CRUD (template_key, category, status, current_version)
 * - Version history (create, publish, rollback, compare)
 * - Brand / Industry / Package mappings
 * - Recommendation scoring using mapping weights
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  aiTemplateRegistryTable,
  aiTemplateVersionsTable,
  aiTemplateBrandMappingsTable,
  aiTemplateIndustryMappingsTable,
  aiTemplatePackageMappingsTable,
  aiTemplateThemesTable,
  aiTemplateLayoutsTable,
} from "@workspace/db";
import type {
  AiTemplateRegistry,
  InsertAiTemplateRegistry,
  AiTemplateVersion,
  InsertAiTemplateVersion,
} from "@workspace/db";
import { TEMPLATE_CATEGORIES } from "./themeEngineService.js";

// ── Registry CRUD ─────────────────────────────────────────────────────────────

export interface RegistryFilter {
  category?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listRegistryTemplates(filter: RegistryFilter = {}) {
  const { category, status, limit = 50, offset = 0 } = filter;

  // Safe literal injection — category/status values are controlled strings
  const escape = (v: string) => v.replace(/'/g, "''");
  const whereParts: string[] = [];
  if (category) whereParts.push(`r.category = '${escape(category)}'`);
  if (status)   whereParts.push(`r.status = '${escape(status)}'`);
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const { rows } = await db.execute(sql.raw(
    `SELECT r.*, v.version_number, v.theme_id, v.layout_id, v.status AS version_status,
            t.name AS theme_name, l.name AS layout_name
     FROM ai_template_registry r
     LEFT JOIN ai_template_versions v ON v.id = r.current_version_id
     LEFT JOIN ai_template_themes t ON t.id = v.theme_id
     LEFT JOIN ai_template_layouts l ON l.id = v.layout_id
     ${whereClause}
     ORDER BY r.updated_at DESC
     LIMIT ${limit} OFFSET ${offset}`
  ));

  const [{ count }] = (await db.execute(sql.raw(
    `SELECT count(*)::int AS count FROM ai_template_registry r ${whereClause}`
  ))).rows as [{ count: number }];

  return { items: rows, total: count ?? 0 };
}

export async function getRegistryTemplate(id: number): Promise<AiTemplateRegistry | null> {
  const [row] = await db.select().from(aiTemplateRegistryTable)
    .where(eq(aiTemplateRegistryTable.id, id)).limit(1);
  return row ?? null;
}

export async function getRegistryTemplateByKey(key: string): Promise<AiTemplateRegistry | null> {
  const [row] = await db.select().from(aiTemplateRegistryTable)
    .where(eq(aiTemplateRegistryTable.templateKey, key)).limit(1);
  return row ?? null;
}

export async function createRegistryTemplate(data: InsertAiTemplateRegistry): Promise<AiTemplateRegistry> {
  const [row] = await db.insert(aiTemplateRegistryTable).values(data).returning();
  return row;
}

export async function updateRegistryTemplate(id: number, data: Partial<InsertAiTemplateRegistry>): Promise<AiTemplateRegistry | null> {
  const [row] = await db.update(aiTemplateRegistryTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(aiTemplateRegistryTable.id, id))
    .returning();
  return row ?? null;
}

export async function publishRegistryTemplate(id: number): Promise<AiTemplateRegistry | null> {
  return updateRegistryTemplate(id, { status: "published" });
}

export async function archiveRegistryTemplate(id: number): Promise<AiTemplateRegistry | null> {
  return updateRegistryTemplate(id, { status: "archived" });
}

// ── Version Management ────────────────────────────────────────────────────────

export async function listVersions(templateId: number): Promise<AiTemplateVersion[]> {
  return db.select().from(aiTemplateVersionsTable)
    .where(eq(aiTemplateVersionsTable.templateId, templateId))
    .orderBy(desc(aiTemplateVersionsTable.versionNumber));
}

export async function getVersion(versionId: number): Promise<AiTemplateVersion | null> {
  const [row] = await db.select().from(aiTemplateVersionsTable)
    .where(eq(aiTemplateVersionsTable.id, versionId)).limit(1);
  return row ?? null;
}

export async function createVersion(data: {
  templateId: number;
  themeId?: number;
  layoutId?: number;
  layoutSpecJson?: Record<string, unknown>;
  themeOverridesJson?: Record<string, unknown>;
  changelog?: string;
}): Promise<AiTemplateVersion> {
  // Next version number = max existing + 1
  const [{ maxVer }] = (await db.execute(sql.raw(
    `SELECT COALESCE(MAX(version_number), 0) AS "maxVer" FROM ai_template_versions WHERE template_id = ${data.templateId}`
  ))).rows as [{ maxVer: number }];

  const [row] = await db.insert(aiTemplateVersionsTable).values({
    templateId: data.templateId,
    versionNumber: (maxVer ?? 0) + 1,
    status: "draft",
    themeId: data.themeId ?? null,
    layoutId: data.layoutId ?? null,
    layoutSpecJson: data.layoutSpecJson ?? {},
    themeOverridesJson: data.themeOverridesJson ?? {},
    changelog: data.changelog ?? null,
  }).returning();

  return row;
}

export async function publishVersion(versionId: number): Promise<void> {
  // 1. Mark version as published
  const [version] = await db.update(aiTemplateVersionsTable)
    .set({ status: "published", publishedAt: new Date() })
    .where(eq(aiTemplateVersionsTable.id, versionId))
    .returning();

  if (!version) throw new Error("Version not found");

  // 2. Set as current_version_id on registry + publish the registry entry
  await db.update(aiTemplateRegistryTable)
    .set({ currentVersionId: versionId, status: "published", updatedAt: new Date() })
    .where(eq(aiTemplateRegistryTable.id, version.templateId));
}

export async function rollbackToVersion(templateId: number, versionId: number): Promise<void> {
  const version = await getVersion(versionId);
  if (!version || version.templateId !== templateId) throw new Error("Version not found for this template");

  await db.update(aiTemplateRegistryTable)
    .set({ currentVersionId: versionId, updatedAt: new Date() })
    .where(eq(aiTemplateRegistryTable.id, templateId));
}

export async function compareVersions(versionIdA: number, versionIdB: number): Promise<{
  a: AiTemplateVersion | null;
  b: AiTemplateVersion | null;
  diff: { field: string; valueA: unknown; valueB: unknown }[];
}> {
  const [a, b] = await Promise.all([getVersion(versionIdA), getVersion(versionIdB)]);

  const diff: { field: string; valueA: unknown; valueB: unknown }[] = [];
  const fields: (keyof AiTemplateVersion)[] = ["themeId", "layoutId", "layoutSpecJson", "themeOverridesJson", "status", "changelog"];

  for (const field of fields) {
    const valA = a?.[field];
    const valB = b?.[field];
    if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      diff.push({ field, valueA: valA, valueB: valB });
    }
  }

  return { a, b, diff };
}

// ── Brand Mappings ────────────────────────────────────────────────────────────

export async function getBrandMappings(templateId: number) {
  return db.select().from(aiTemplateBrandMappingsTable)
    .where(eq(aiTemplateBrandMappingsTable.templateId, templateId))
    .orderBy(desc(aiTemplateBrandMappingsTable.weight));
}

export async function setBrandMappings(templateId: number, mappings: Array<{
  brandAttribute: string;
  attributeValue: string;
  weight: number;
}>): Promise<void> {
  await db.delete(aiTemplateBrandMappingsTable)
    .where(eq(aiTemplateBrandMappingsTable.templateId, templateId));

  if (mappings.length > 0) {
    await db.insert(aiTemplateBrandMappingsTable).values(
      mappings.map((m) => ({ ...m, templateId }))
    );
  }
}

// ── Industry Mappings ─────────────────────────────────────────────────────────

export async function getIndustryMappings(templateId: number) {
  return db.select().from(aiTemplateIndustryMappingsTable)
    .where(eq(aiTemplateIndustryMappingsTable.templateId, templateId))
    .orderBy(desc(aiTemplateIndustryMappingsTable.weight));
}

export async function setIndustryMappings(templateId: number, mappings: Array<{
  industry: string;
  weight: number;
  notes?: string;
}>): Promise<void> {
  await db.delete(aiTemplateIndustryMappingsTable)
    .where(eq(aiTemplateIndustryMappingsTable.templateId, templateId));

  if (mappings.length > 0) {
    await db.insert(aiTemplateIndustryMappingsTable).values(
      mappings.map((m) => ({ ...m, templateId }))
    );
  }
}

// ── Package Mappings ──────────────────────────────────────────────────────────

export async function getPackageMappings(templateId: number) {
  return db.select().from(aiTemplatePackageMappingsTable)
    .where(eq(aiTemplatePackageMappingsTable.templateId, templateId))
    .orderBy(desc(aiTemplatePackageMappingsTable.weight));
}

export async function setPackageMappings(templateId: number, mappings: Array<{
  serviceCode: string;
  weight: number;
  notes?: string;
}>): Promise<void> {
  await db.delete(aiTemplatePackageMappingsTable)
    .where(eq(aiTemplatePackageMappingsTable.templateId, templateId));

  if (mappings.length > 0) {
    await db.insert(aiTemplatePackageMappingsTable).values(
      mappings.map((m) => ({ ...m, templateId }))
    );
  }
}

// ── Full Template Detail (with mappings + current version) ────────────────────

export async function getTemplateDetail(id: number) {
  const template = await getRegistryTemplate(id);
  if (!template) return null;

  const [versions, brandMappings, industryMappings, packageMappings] = await Promise.all([
    listVersions(id),
    getBrandMappings(id),
    getIndustryMappings(id),
    getPackageMappings(id),
  ]);

  const currentVersion = versions.find((v) => v.id === template.currentVersionId) ?? null;

  let theme = null;
  let layout = null;
  if (currentVersion?.themeId) {
    const [t] = await db.select().from(aiTemplateThemesTable)
      .where(eq(aiTemplateThemesTable.id, currentVersion.themeId)).limit(1);
    theme = t ?? null;
  }
  if (currentVersion?.layoutId) {
    const [l] = await db.select().from(aiTemplateLayoutsTable)
      .where(eq(aiTemplateLayoutsTable.id, currentVersion.layoutId)).limit(1);
    layout = l ?? null;
  }

  return {
    ...template,
    versions,
    currentVersion,
    theme,
    layout,
    brandMappings,
    industryMappings,
    packageMappings,
  };
}

// ── Recommendation Engine ─────────────────────────────────────────────────────

export interface RecommendInput {
  industry?: string;
  brandAttributes?: Array<{ attribute: string; value: string }>;
  packageCode?: string;
  category?: string;
  limit?: number;
}

export async function recommendTemplates(input: RecommendInput): Promise<Array<{
  template: AiTemplateRegistry;
  score: number;
  reasons: string[];
}>> {
  const { industry, brandAttributes = [], packageCode, category, limit = 10 } = input;

  // Get all published templates in category
  const filter: RegistryFilter = { status: "published" };
  if (category) filter.category = category;

  // First try published, fallback to any status if empty (e.g. fresh install with only drafts)
  let { items: templates } = await listRegistryTemplates({ status: "published", category, limit: 200 });
  if (templates.length === 0) {
    const fallback = await listRegistryTemplates({ category, limit: 200 });
    templates = fallback.items;
  }

  const scored = await Promise.all(
    (templates as AiTemplateRegistry[]).map(async (template) => {
      let score = 0;
      const reasons: string[] = [];

      // Industry score
      if (industry) {
        const [indMapping] = await db.select()
          .from(aiTemplateIndustryMappingsTable)
          .where(and(
            eq(aiTemplateIndustryMappingsTable.templateId, template.id),
            eq(aiTemplateIndustryMappingsTable.industry, industry),
          )).limit(1);
        if (indMapping) {
          score += Number(indMapping.weight);
          reasons.push(`Industry match: ${industry} (+${indMapping.weight})`);
        }
      }

      // Brand attribute scores
      for (const attr of brandAttributes) {
        const [brandMapping] = await db.select()
          .from(aiTemplateBrandMappingsTable)
          .where(and(
            eq(aiTemplateBrandMappingsTable.templateId, template.id),
            eq(aiTemplateBrandMappingsTable.brandAttribute, attr.attribute),
            eq(aiTemplateBrandMappingsTable.attributeValue, attr.value),
          )).limit(1);
        if (brandMapping) {
          score += Number(brandMapping.weight);
          reasons.push(`Brand ${attr.attribute}: ${attr.value} (+${brandMapping.weight})`);
        }
      }

      // Package score
      if (packageCode) {
        const [pkgMapping] = await db.select()
          .from(aiTemplatePackageMappingsTable)
          .where(and(
            eq(aiTemplatePackageMappingsTable.templateId, template.id),
            eq(aiTemplatePackageMappingsTable.serviceCode, packageCode),
          )).limit(1);
        if (pkgMapping) {
          score += Number(pkgMapping.weight);
          reasons.push(`Package: ${packageCode} (+${pkgMapping.weight})`);
        }
      }

      return { template: template as AiTemplateRegistry, score, reasons };
    })
  );

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Category Stats ────────────────────────────────────────────────────────────

export async function getCategoryStats() {
  const { rows } = await db.execute(sql.raw(`
    SELECT category,
           count(*) FILTER (WHERE status = 'published') AS published,
           count(*) FILTER (WHERE status = 'draft')     AS drafts,
           count(*) FILTER (WHERE status = 'archived')  AS archived,
           count(*)                                      AS total
    FROM ai_template_registry
    GROUP BY category
    ORDER BY category
  `));
  return rows;
}

// ── Seed V4.6 Registry Templates ──────────────────────────────────────────────

const SEED_REGISTRY: InsertAiTemplateRegistry[] = TEMPLATE_CATEGORIES.map((cat) => ({
  templateKey: `TPL-${cat.replace(/\s+/g, "-").toUpperCase()}-001`,
  name: `${cat} — Standard`,
  description: `Professional ${cat} template for Indonesian enterprises.`,
  category: cat,
  status: "draft",
  thumbnailUrl: null,
  createdBy: "system",
}));

export async function seedRegistryTemplates(): Promise<void> {
  for (const entry of SEED_REGISTRY) {
    const existing = await getRegistryTemplateByKey(entry.templateKey);
    if (!existing) {
      await createRegistryTemplate(entry);
    }
  }
}
