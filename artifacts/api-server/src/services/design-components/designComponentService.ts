/**
 * Universal Creative Component Library — CRUD Service (Team 8)
 *
 * Persists component instances to the database.
 * Validation is delegated to componentValidationService.ts before any write.
 *
 * NOTE: The `ai_design_components` table is created by the migration draft at
 * integration/migrations/team-08.sql — it must be applied before this service
 * is active at runtime.
 */

import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { text, jsonb, timestamp, serial, pgSchema, unique } from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";

// ── Local table definition ─────────────────────────────────────────────────────
// Mirrors lib/db/src/schema/ai-design-components.ts.
// Using a local definition until Team 24 adds it to the @workspace/db barrel
// and the schema export is available via the @workspace/db package alias.
// Must stay in sync with lib/db/src/schema/ai-design-components.ts.

const _localSchema = pgSchema("ai_platform");
const designComponentsTable = _localSchema.table(
  "ai_design_components",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    type: text("type").notNull(),
    domain: text("domain").notNull(),
    fieldValues: jsonb("field_values").$type<Record<string, unknown>>().notNull().default({}),
    blueprintId: text("blueprint_id"),
    status: text("status").notNull().default("active"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    // P2: unique slug per tenant (mirrors uq_ai_design_components_tenant_slug in migration)
    tenantSlugUniq: unique("uq_ai_design_components_tenant_slug").on(t.tenantId, t.slug),
  }),
);

type DesignComponent = typeof designComponentsTable.$inferSelect;
type NewDesignComponent = typeof designComponentsTable.$inferInsert;
import { validateComponentInstance, applyDefaults } from "./componentValidationService.js";
import { getComponentDefinition } from "./componentRegistry.js";
import type { ComponentInstanceInput, ComponentType, ComponentDomain } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function makeSlug(name: string): string {
  return `${slugify(name)}-${randomUUID().slice(0, 8)}`;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class ComponentValidationError extends Error {
  constructor(
    public readonly errors: Array<{ field: string; message: string }>,
  ) {
    super(`Component validation failed: ${errors.map((e) => e.message).join("; ")}`);
    this.name = "ComponentValidationError";
  }
}

export class ComponentNotFoundError extends Error {
  constructor(id: number) {
    super(`Design component #${id} not found.`);
    this.name = "ComponentNotFoundError";
  }
}

export class ComponentTenantError extends Error {
  constructor() {
    super("Access denied: component belongs to a different tenant.");
    this.name = "ComponentTenantError";
  }
}

export class ComponentSlugConflictError extends Error {
  constructor(slug: string) {
    super(`A component with slug "${slug}" already exists in this tenant.`);
    this.name = "ComponentSlugConflictError";
  }
}

/** Detect PostgreSQL unique-constraint violation (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createDesignComponent(
  input: ComponentInstanceInput,
): Promise<DesignComponent> {
  // Apply defaults then validate
  const fieldValues = applyDefaults(input.type, input.fieldValues);
  const validation = validateComponentInstance({
    type: input.type,
    domain: input.domain,
    fieldValues,
  });
  if (!validation.valid) {
    throw new ComponentValidationError(validation.errors);
  }

  const slug = makeSlug(input.name);
  try {
    const [row] = await db
      .insert(designComponentsTable)
      .values({
        tenantId: input.tenantId,
        name: input.name,
        slug,
        type: input.type,
        domain: input.domain,
        fieldValues,
        blueprintId: input.blueprintId ?? null,
        status: "active",
        createdBy: input.createdBy ?? null,
      } satisfies NewDesignComponent)
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ComponentSlugConflictError(slug);
    throw err;
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getDesignComponent(
  id: number,
  tenantId: string,
): Promise<DesignComponent | null> {
  const [row] = await db
    .select()
    .from(designComponentsTable)
    .where(
      and(
        eq(designComponentsTable.id, id),
        eq(designComponentsTable.tenantId, tenantId),
        isNull(designComponentsTable.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (row.tenantId !== tenantId) throw new ComponentTenantError();
  return row;
}

export interface ListDesignComponentsOptions {
  domain?: ComponentDomain;
  type?: ComponentType;
  blueprintId?: string;
  status?: "active" | "archived";
  page?: number;
  pageSize?: number;
}

export async function listDesignComponents(
  tenantId: string,
  opts: ListDesignComponentsOptions = {},
): Promise<{ items: DesignComponent[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(opts.pageSize ?? 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions = [
    eq(designComponentsTable.tenantId, tenantId),
    isNull(designComponentsTable.deletedAt),
  ];

  if (opts.domain) conditions.push(eq(designComponentsTable.domain, opts.domain));
  if (opts.type) conditions.push(eq(designComponentsTable.type, opts.type));
  if (opts.blueprintId) conditions.push(eq(designComponentsTable.blueprintId, opts.blueprintId));
  if (opts.status) conditions.push(eq(designComponentsTable.status, opts.status));

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(designComponentsTable)
      .where(and(...conditions))
      .orderBy(desc(designComponentsTable.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(designComponentsTable)
      .where(and(...conditions)),
  ]);

  return {
    items: rows,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
  };
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface UpdateDesignComponentInput {
  name?: string;
  fieldValues?: Record<string, unknown>;
  blueprintId?: string | null;
  status?: "active" | "archived";
}

export async function updateDesignComponent(
  id: number,
  tenantId: string,
  input: UpdateDesignComponentInput,
): Promise<DesignComponent> {
  const existing = await getDesignComponent(id, tenantId);
  if (!existing) throw new ComponentNotFoundError(id);

  // If field values are updated, re-validate
  if (input.fieldValues !== undefined) {
    const merged = { ...existing.fieldValues, ...input.fieldValues };
    const validation = validateComponentInstance({
      type: existing.type as ComponentType,
      domain: existing.domain as ComponentDomain,
      fieldValues: merged,
    });
    if (!validation.valid) throw new ComponentValidationError(validation.errors);
  }

  const updateData: Partial<NewDesignComponent> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    updateData.name = input.name;
    updateData.slug = makeSlug(input.name);
  }
  if (input.fieldValues !== undefined) {
    updateData.fieldValues = { ...existing.fieldValues, ...input.fieldValues };
  }
  if (input.blueprintId !== undefined) updateData.blueprintId = input.blueprintId;
  if (input.status !== undefined) updateData.status = input.status;

  const [updated] = await db
    .update(designComponentsTable)
    .set(updateData)
    .where(
      and(
        eq(designComponentsTable.id, id),
        eq(designComponentsTable.tenantId, tenantId),
      ),
    )
    .returning();

  return updated!;
}

// ── Soft delete ───────────────────────────────────────────────────────────────

export async function softDeleteDesignComponent(
  id: number,
  tenantId: string,
): Promise<void> {
  const existing = await getDesignComponent(id, tenantId);
  if (!existing) throw new ComponentNotFoundError(id);

  await db
    .update(designComponentsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(designComponentsTable.id, id),
        eq(designComponentsTable.tenantId, tenantId),
      ),
    );
}

// ── Duplicate ─────────────────────────────────────────────────────────────────

export async function duplicateDesignComponent(
  id: number,
  tenantId: string,
  newName?: string,
): Promise<DesignComponent> {
  const source = await getDesignComponent(id, tenantId);
  if (!source) throw new ComponentNotFoundError(id);

  const name = newName ?? `${source.name} (copy)`;
  const slug = makeSlug(name);
  try {
    const [row] = await db
      .insert(designComponentsTable)
      .values({
        tenantId: source.tenantId,
        name,
        slug,
        type: source.type,
        domain: source.domain,
        fieldValues: source.fieldValues ?? {},
        blueprintId: source.blueprintId,
        status: "active",
        createdBy: source.createdBy,
      } satisfies NewDesignComponent)
      .returning();
    return row!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ComponentSlugConflictError(slug);
    throw err;
  }
}

// ── Component definition lookup ───────────────────────────────────────────────

export function getComponentSchema(type: ComponentType) {
  return getComponentDefinition(type) ?? null;
}
