/**
 * Design Template Engine — Core Service Layer
 *
 * CRUD for design_templates + design_template_versions.
 * Tenant isolation is enforced on every read/write.
 * Published versions are immutable (no update allowed after publishedAt is set).
 */

import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  designTemplatesTable,
  designTemplateVersionsTable,
  type NewDesignTemplate,
  type NewDesignTemplateVersion,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { assertTenantMatch, TenantAccessError } from "./designTemplateVariableService.js";
import { designTemplateJsonSchema } from "../validators/designTemplateSchema.js";
import { DESIGN_TEMPLATE_SCHEMA_VERSION } from "../types/designTemplate.js";
import type { DesignTemplate } from "../types/designTemplate.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeUniqueSlug(base: string): string {
  return `${base}-${randomUUID().slice(0, 8)}`;
}

// ── Template CRUD ─────────────────────────────────────────────────────────────

export interface CreateTemplateInput {
  tenantId: string;
  name: string;
  description?: string;
  category?: string;
  createdBy: string;
}

export async function createTemplate(input: CreateTemplateInput) {
  const slug = makeUniqueSlug(slugify(input.name));

  const [template] = await db
    .insert(designTemplatesTable)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      slug,
      description: input.description,
      category: input.category,
      status: "draft",
      createdBy: input.createdBy,
    } satisfies NewDesignTemplate)
    .returning();

  await logAudit({
    module: "design-template-engine",
    action: "template_created",
    resourceType: "design_template",
    resourceId: String(template!.id),
    status: "success",
    details: { name: input.name, tenantId: input.tenantId },
  });

  return template!;
}

export async function getTemplate(id: number, tenantId: string) {
  const [template] = await db
    .select()
    .from(designTemplatesTable)
    .where(
      and(
        eq(designTemplatesTable.id, id),
        eq(designTemplatesTable.tenantId, tenantId),
        isNull(designTemplatesTable.deletedAt),
      ),
    )
    .limit(1);

  if (!template) return null;
  // Double-check tenant (guard against future ORM bugs)
  assertTenantMatch(template.tenantId, tenantId, `design_template#${id}`);
  return template;
}

export async function listTemplates(
  tenantId: string,
  opts: { status?: string; category?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(designTemplatesTable.tenantId, tenantId),
    isNull(designTemplatesTable.deletedAt),
  ];
  if (opts.status) conditions.push(eq(designTemplatesTable.status, opts.status));
  if (opts.category) conditions.push(eq(designTemplatesTable.category, opts.category));

  const [rows, countRow] = await Promise.all([
    db
      .select()
      .from(designTemplatesTable)
      .where(and(...conditions))
      .orderBy(desc(designTemplatesTable.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(designTemplatesTable)
      .where(and(...conditions)),
  ]);

  return {
    items: rows,
    templates: rows, // backwards-compat alias
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  };
}

export async function updateTemplate(
  id: number,
  tenantId: string,
  updates: { name?: string; description?: string; category?: string; status?: string },
  updatedBy: string,
) {
  const existing = await getTemplate(id, tenantId);
  if (!existing) return null;

  // Prevent setting status to "published" via PATCH — use publishVersion()
  if (updates.status === "published") {
    throw new Error('Use POST /design-templates/:id/publish to publish a template');
  }

  const [updated] = await db
    .update(designTemplatesTable)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(designTemplatesTable.id, id))
    .returning();

  await logAudit({
    module: "design-template-engine",
    action: "template_updated",
    resourceType: "design_template",
    resourceId: String(id),
    status: "success",
    details: { updates, updatedBy },
  });

  return updated!;
}

export async function softDeleteTemplate(id: number, tenantId: string, deletedBy: string) {
  const existing = await getTemplate(id, tenantId);
  if (!existing) return null;

  await db
    .update(designTemplatesTable)
    .set({ deletedAt: new Date(), status: "archived" })
    .where(eq(designTemplatesTable.id, id));

  await logAudit({
    module: "design-template-engine",
    action: "template_deleted",
    resourceType: "design_template",
    resourceId: String(id),
    status: "success",
    details: { deletedBy },
  });

  return true;
}

export async function duplicateTemplate(id: number, tenantId: string, requestedBy: string) {
  const source = await getTemplate(id, tenantId);
  if (!source) return null;

  const copy = await createTemplate({
    tenantId,
    name: `${source.name} (Copy)`,
    description: source.description ?? undefined,
    category: source.category ?? undefined,
    createdBy: requestedBy,
  });

  // If source has an active version, copy the JSON into a new draft version
  if (source.activeVersionId) {
    const [srcVersion] = await db
      .select()
      .from(designTemplateVersionsTable)
      .where(eq(designTemplateVersionsTable.id, source.activeVersionId))
      .limit(1);

    if (srcVersion) {
      await createVersion({
        templateId: copy.id,
        tenantId,
        templateJson: srcVersion.templateJson as unknown as DesignTemplate,
        changelog: `Duplicated from template #${id} v${srcVersion.versionNumber}`,
        createdBy: requestedBy,
      });
    }
  }

  return copy;
}

// ── Version Management ────────────────────────────────────────────────────────

export interface CreateVersionInput {
  templateId: number;
  tenantId: string;
  templateJson: DesignTemplate;
  changelog?: string;
  createdBy: string;
}

export async function createVersion(input: CreateVersionInput) {
  const template = await getTemplate(input.templateId, input.tenantId);
  if (!template) throw new Error(`Template #${input.templateId} not found`);

  // Validate template JSON against schema
  const parsed = designTemplateJsonSchema.safeParse(input.templateJson);
  if (!parsed.success) {
    throw new Error(`Invalid template JSON: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }

  // Next version number
  const [lastVersion] = await db
    .select({ maxVersion: sql<number>`coalesce(max(version_number), 0)` })
    .from(designTemplateVersionsTable)
    .where(eq(designTemplateVersionsTable.templateId, input.templateId));

  const versionNumber = (lastVersion?.maxVersion ?? 0) + 1;

  const [version] = await db
    .insert(designTemplateVersionsTable)
    .values({
      tenantId: input.tenantId,
      templateId: input.templateId,
      versionNumber,
      schemaVersion: DESIGN_TEMPLATE_SCHEMA_VERSION,
      templateJson: input.templateJson as unknown as Record<string, unknown>,
      changelog: input.changelog,
      createdBy: input.createdBy,
    } satisfies NewDesignTemplateVersion)
    .returning();

  // Update the template's activeVersionId to this new draft
  await db
    .update(designTemplatesTable)
    .set({ activeVersionId: version!.id, updatedAt: new Date() })
    .where(eq(designTemplatesTable.id, input.templateId));

  await logAudit({
    module: "design-template-engine",
    action: "version_created",
    resourceType: "design_template_version",
    resourceId: String(version!.id),
    status: "success",
    details: { templateId: input.templateId, versionNumber, tenantId: input.tenantId },
  });

  return version!;
}

export async function listVersions(templateId: number, tenantId: string) {
  // Verify tenant ownership first
  const template = await getTemplate(templateId, tenantId);
  if (!template) return null;

  return db
    .select()
    .from(designTemplateVersionsTable)
    .where(
      and(
        eq(designTemplateVersionsTable.templateId, templateId),
        eq(designTemplateVersionsTable.tenantId, tenantId),
      ),
    )
    .orderBy(desc(designTemplateVersionsTable.versionNumber));
}

export async function getVersion(versionId: number, tenantId: string) {
  const [version] = await db
    .select()
    .from(designTemplateVersionsTable)
    .where(
      and(
        eq(designTemplateVersionsTable.id, versionId),
        eq(designTemplateVersionsTable.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!version) return null;
  assertTenantMatch(version.tenantId, tenantId, `design_template_version#${versionId}`);
  return version;
}

export async function publishVersion(
  templateId: number,
  versionId: number,
  tenantId: string,
  publishedBy: string,
) {
  const template = await getTemplate(templateId, tenantId);
  if (!template) throw new Error(`Template #${templateId} not found`);

  const version = await getVersion(versionId, tenantId);
  if (!version) throw new Error(`Version #${versionId} not found`);

  if (version.templateId !== templateId) {
    throw new Error(`Version #${versionId} does not belong to template #${templateId}`);
  }
  if (version.publishedAt) {
    // Already published — idempotent
    return { template, version };
  }

  const now = new Date();

  const [publishedVersion] = await db
    .update(designTemplateVersionsTable)
    .set({ publishedAt: now })
    .where(eq(designTemplateVersionsTable.id, versionId))
    .returning();

  await db
    .update(designTemplatesTable)
    .set({ status: "published", activeVersionId: versionId, updatedAt: now })
    .where(eq(designTemplatesTable.id, templateId));

  await logAudit({
    module: "design-template-engine",
    action: "version_published",
    resourceType: "design_template_version",
    resourceId: String(versionId),
    status: "success",
    details: { templateId, versionNumber: version.versionNumber, publishedBy },
  });

  return { template, version: publishedVersion! };
}

// ── Preview ───────────────────────────────────────────────────────────────────

/**
 * Returns the active version's templateJson + sample data for a client preview.
 * Does NOT render anything — rendering happens in the worker.
 */
export async function getPreviewData(templateId: number, tenantId: string) {
  const template = await getTemplate(templateId, tenantId);
  if (!template || !template.activeVersionId) return null;

  const version = await getVersion(template.activeVersionId, tenantId);
  if (!version) return null;

  const tpl = version.templateJson as unknown as DesignTemplate;

  // Build sample data from variable defaults
  const sampleData: Record<string, unknown> = {};
  for (const v of tpl.variables ?? []) {
    sampleData[v.key] = v.defaultValue ?? `[${v.label}]`;
  }

  return { template, version, templateJson: tpl, sampleData };
}
